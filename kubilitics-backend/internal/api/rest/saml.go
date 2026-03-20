package rest

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"net/http"
	"time"

	saml "github.com/crewjam/saml"
	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	samlpkg "github.com/kubilitics/kubilitics-backend/internal/auth/saml"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// SAMLHandler handles SAML 2.0 authentication flows
type SAMLHandler struct {
	provider *samlpkg.Provider
	cfg      *config.Config
	repo     *repository.SQLiteRepository
}

// NewSAMLHandler creates a new SAML handler
func NewSAMLHandler(cfg *config.Config, repo *repository.SQLiteRepository) (*SAMLHandler, error) {
	if !cfg.SAMLEnabled {
		return nil, nil // SAML not enabled
	}

	provider, err := samlpkg.NewProvider(context.Background(), cfg, repo)
	if err != nil {
		return nil, err
	}

	return &SAMLHandler{
		provider: provider,
		cfg:      cfg,
		repo:     repo,
	}, nil
}

// RegisterRoutes registers SAML routes
func (h *SAMLHandler) RegisterRoutes(router *mux.Router) {
	if h == nil {
		return // SAML not enabled
	}
	router.HandleFunc("/auth/saml/login", h.Login).Methods("GET")
	router.HandleFunc("/auth/saml/acs", h.AssertionConsumerService).Methods("POST")
	router.HandleFunc("/auth/saml/slo", h.SingleLogout).Methods("POST", "GET")
	router.HandleFunc("/auth/saml/metadata", h.Metadata).Methods("GET")
}

// Login initiates SAML login flow
func (h *SAMLHandler) Login(w http.ResponseWriter, r *http.Request) {
	if h.cfg.AuthMode == "disabled" {
		respondError(w, http.StatusBadRequest, "Authentication is disabled")
		return
	}

	// Generate relay state (optional, can be used to redirect after login)
	relayState := r.URL.Query().Get("relay_state")
	if relayState == "" {
		relayState = "/"
	}

	// Generate AuthnRequest ID
	requestID, err := h.provider.GenerateAuthnRequestID()
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to generate request ID")
		return
	}

	// Store request for validation
	h.provider.StoreAuthnRequest(requestID, relayState)

	// Use SAML SP to create AuthnRequest and redirect
	sp := h.provider.GetServiceProvider()
	
	// Get SSO URL from IdP metadata
	idpSSOURL := ""
	if sp.ServiceProvider.IDPMetadata != nil && len(sp.ServiceProvider.IDPMetadata.IDPSSODescriptors) > 0 {
		for _, endpoint := range sp.ServiceProvider.IDPMetadata.IDPSSODescriptors[0].SingleSignOnServices {
			if endpoint.Binding == saml.HTTPRedirectBinding {
				idpSSOURL = endpoint.Location
				break
			}
		}
	}
	
	if idpSSOURL == "" {
		respondError(w, http.StatusInternalServerError, "IdP SSO URL not found in metadata")
		return
	}
	
	// Create AuthnRequest
	authnRequest, _ := sp.ServiceProvider.MakeAuthenticationRequest(idpSSOURL, saml.HTTPRedirectBinding, saml.HTTPPostBinding)
	
	// Redirect to IdP
	redirectURL, err := authnRequest.Redirect(relayState, &sp.ServiceProvider)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to create redirect: "+err.Error())
		return
	}

	http.Redirect(w, r, redirectURL.String(), http.StatusFound)
}

// AssertionConsumerService handles SAML response (ACS endpoint)
func (h *SAMLHandler) AssertionConsumerService(w http.ResponseWriter, r *http.Request) {
	if h.cfg.AuthMode == "disabled" {
		respondError(w, http.StatusBadRequest, "Authentication is disabled")
		return
	}

	ctx := r.Context()
	sp := h.provider.GetServiceProvider()

	// Parse SAML response - ParseResponse returns the assertion directly
	assertion, err := sp.ServiceProvider.ParseResponse(r, []string{""}) // Empty list means accept any request ID
	if err != nil {
		respondError(w, http.StatusBadRequest, "Failed to parse SAML response: "+err.Error())
		return
	}

	// Map SAML user to kubilitics user
	kubiliticsUser, err := h.provider.MapSAMLUserToKubiliticsUser(ctx, assertion)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to map user: "+err.Error())
		return
	}

	// Check if user exists
	existingUser, err := h.repo.GetUserByUsername(ctx, kubiliticsUser.Username)
	if err != nil || existingUser == nil {
		// Try by ID (for SAML users)
		existingUser, err = h.repo.GetUserByID(ctx, kubiliticsUser.ID)
		if err != nil || existingUser == nil {
			// Create SAML user (no password)
			if err := h.repo.CreateUser(ctx, kubiliticsUser); err != nil {
				respondError(w, http.StatusInternalServerError, "Failed to create user: "+err.Error())
				return
			}
			existingUser = kubiliticsUser
		}
	} else {
		// Update role if changed
		if existingUser.Role != kubiliticsUser.Role {
			_ = h.repo.UpdateUserRole(ctx, existingUser.ID, kubiliticsUser.Role)
			existingUser.Role = kubiliticsUser.Role
		}
	}

	// Create SAML session
	sessionIndex := ""
	if assertion.Subject != nil && len(assertion.Subject.SubjectConfirmations) > 0 {
		if assertion.Subject.SubjectConfirmations[0].SubjectConfirmationData != nil {
			sessionIndex = assertion.Subject.SubjectConfirmations[0].SubjectConfirmationData.InResponseTo
		}
	}
	// Try to get session index from AuthnStatements
	if sessionIndex == "" && len(assertion.AuthnStatements) > 0 {
		sessionIndex = assertion.AuthnStatements[0].SessionIndex
	}

	if sessionIndex != "" {
		samlSession := &models.SAMLSession{
			ID:              uuid.New().String(),
			UserID:          existingUser.ID,
			SAMLSessionIndex: sessionIndex,
			IdpEntityID:     h.provider.GetIdpEntityID(),
			CreatedAt:       time.Now(),
			ExpiresAt:       time.Now().Add(8 * time.Hour), // SAML sessions typically last 8 hours
		}
		_ = h.repo.CreateSAMLSession(ctx, samlSession)
	}

	// Issue kubilitics JWT tokens
	accessToken, err := auth.IssueAccessToken(h.cfg.AuthJWTSecret, existingUser.ID, existingUser.Username, existingUser.Role)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to issue access token: "+err.Error())
		return
	}
	refreshToken, err := auth.IssueRefreshToken(h.cfg.AuthJWTSecret, existingUser.ID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to issue refresh token: "+err.Error())
		return
	}

	// Return tokens (frontend will handle redirect)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
		"expires_in":    int(auth.AccessTokenExpiry.Seconds()),
		"token_type":    "Bearer",
	})
}

// SingleLogout handles SAML Single Logout (SLO)
func (h *SAMLHandler) SingleLogout(w http.ResponseWriter, r *http.Request) {
	if h.cfg.AuthMode == "disabled" {
		respondError(w, http.StatusBadRequest, "Authentication is disabled")
		return
	}

	ctx := r.Context()
	sp := h.provider.GetServiceProvider()

	// Parse logout request/response
	if r.Method == "POST" {
		// Handle LogoutRequest from IdP - parse from request body
		var logoutRequest saml.LogoutRequest
		if err := xml.NewDecoder(r.Body).Decode(&logoutRequest); err != nil {
			respondError(w, http.StatusBadRequest, "Failed to parse logout request: "+err.Error())
			return
		}

		// Find and revoke SAML session
		if logoutRequest.NameID != nil {
			user, err := h.repo.GetUserByID(ctx, fmt.Sprintf("saml-%s", logoutRequest.NameID.Value))
			if err == nil && user != nil {
				_ = h.repo.DeleteUserSAMLSessions(ctx, user.ID)
				// Also revoke all JWT tokens
				_ = h.repo.RevokeAllUserTokens(ctx, user.ID, "saml_logout")
			}
		}

		// Send logout response
		logoutResponse, err := sp.ServiceProvider.MakeLogoutResponse(logoutRequest.ID, saml.HTTPPostBinding)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to create logout response: "+err.Error())
			return
		}
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		postData := logoutResponse.Post("") // Empty relay state
		_, _ = w.Write([]byte(postData))
		return
	}

	// GET: Initiate logout
	claims := auth.ClaimsFromContext(ctx)
	if claims == nil {
		respondError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}

	// Revoke SAML sessions
	_ = h.repo.DeleteUserSAMLSessions(ctx, claims.UserID)
	// Revoke all tokens
	_ = h.repo.RevokeAllUserTokens(ctx, claims.UserID, "saml_logout")

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"message":"Logged out successfully"}`))
}

// Metadata returns SAML SP metadata
func (h *SAMLHandler) Metadata(w http.ResponseWriter, r *http.Request) {
	sp := h.provider.GetServiceProvider()
	metadata := sp.ServiceProvider.Metadata()

	w.Header().Set("Content-Type", "application/xml")
	w.WriteHeader(http.StatusOK)
	encoder := xml.NewEncoder(w)
	encoder.Indent("", "  ")
	if err := encoder.Encode(metadata); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to marshal metadata: "+err.Error())
		return
	}
}
