package rest

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"golang.org/x/time/rate"

	"github.com/kubilitics/kubilitics-backend/internal/auth"
	mfa "github.com/kubilitics/kubilitics-backend/internal/auth/mfa"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/metrics"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// AuthHandler handles /api/v1/auth/* (BE-AUTH-001, BE-AUTH-002).
type AuthHandler struct {
	repo             *repository.SQLiteRepository
	cfg              *config.Config
	loginLimiterMu   sync.Mutex
	loginLimiters    map[string]*rate.Limiter // per-IP rate limiters (BE-AUTH-002)
	securityDetector *auth.SecurityDetector   // Phase 5: Security event detection
}

const (
	minPasswordLength = 12
	loginRateLimit    = 5 // per minute
	loginBurst        = 5
	maxFailedLogins   = 10
	lockoutDuration   = 30 * time.Minute
)

// NewAuthHandler creates an auth handler.
func NewAuthHandler(repo *repository.SQLiteRepository, cfg *config.Config) *AuthHandler {
	// Create security detector adapter
	detectorRepo := &securityDetectorRepoAdapter{repo: repo}
	securityDetector := auth.NewSecurityDetector(detectorRepo)

	return &AuthHandler{
		repo:             repo,
		cfg:              cfg,
		loginLimiters:    make(map[string]*rate.Limiter),
		securityDetector: securityDetector,
	}
}

// securityDetectorRepoAdapter adapts SQLiteRepository to SecurityDetector.Repository interface
type securityDetectorRepoAdapter struct {
	repo *repository.SQLiteRepository
}

func (a *securityDetectorRepoAdapter) CreateSecurityEvent(ctx context.Context, event *models.SecurityEvent) error {
	return a.repo.CreateSecurityEvent(ctx, event)
}

func (a *securityDetectorRepoAdapter) GetIPSecurityTracking(ctx context.Context, ipAddress string) (*models.IPSecurityTracking, error) {
	return a.repo.GetIPSecurityTracking(ctx, ipAddress)
}

func (a *securityDetectorRepoAdapter) CreateOrUpdateIPSecurityTracking(ctx context.Context, tracking *models.IPSecurityTracking) error {
	return a.repo.CreateOrUpdateIPSecurityTracking(ctx, tracking)
}

func (a *securityDetectorRepoAdapter) IncrementIPFailedLogin(ctx context.Context, ipAddress string) error {
	return a.repo.IncrementIPFailedLogin(ctx, ipAddress)
}

func (a *securityDetectorRepoAdapter) IncrementIPAccountEnumeration(ctx context.Context, ipAddress string) error {
	return a.repo.IncrementIPAccountEnumeration(ctx, ipAddress)
}

func (a *securityDetectorRepoAdapter) BlockIP(ctx context.Context, ipAddress string, until time.Time) error {
	return a.repo.BlockIP(ctx, ipAddress, until)
}

func (a *securityDetectorRepoAdapter) ListSecurityEvents(ctx context.Context, eventType *string, ipAddress *string, since *time.Time, limit int) ([]*models.SecurityEvent, error) {
	return a.repo.ListSecurityEvents(ctx, eventType, ipAddress, since, limit)
}

// LoginRequest is the body for POST /auth/login.
type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	MFACode  string `json:"mfa_code,omitempty"` // MFA code if MFA is enabled
}

// LoginResponse is the response for POST /auth/login.
type LoginResponse struct {
	AccessToken  string `json:"access_token,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
	ExpiresIn    int    `json:"expires_in,omitempty"`
	TokenType    string `json:"token_type,omitempty"`
	MFARequired  bool   `json:"mfa_required,omitempty"` // True if MFA code is required
	Message      string `json:"message,omitempty"`      // Message if MFA is required
}

// RefreshRequest is the body for POST /auth/refresh.
type RefreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

// MeResponse is the response for GET /auth/me (BE-AUTHZ-001).
type MeResponse struct {
	ID                 string            `json:"id"`
	Username           string            `json:"username"`
	Role               string            `json:"role"`
	ClusterPermissions map[string]string `json:"cluster_permissions,omitempty"` // cluster_id -> role
	MFAEnabled         bool              `json:"mfa_enabled"`                   // Whether MFA is enabled for this user
	MFARequired        bool              `json:"mfa_required"`                  // Whether MFA is required for this user's role
	Groups             []string          `json:"groups,omitempty"`              // Group names user belongs to
}

// RegisterRoutes registers auth routes on the given router (expect path prefix /api/v1 already applied).
func (h *AuthHandler) RegisterRoutes(router *mux.Router) {
	router.HandleFunc("/auth/login", h.Login).Methods("POST")
	router.HandleFunc("/auth/refresh", h.Refresh).Methods("POST")
	router.HandleFunc("/auth/logout", h.Logout).Methods("POST")
	router.HandleFunc("/auth/me", h.Me).Methods("GET")
	router.HandleFunc("/auth/change-password", h.ChangePassword).Methods("POST")
	// User management (admin only) - BE-AUTHZ-001
	router.HandleFunc("/users", h.ListUsers).Methods("GET")
	router.HandleFunc("/users", h.CreateUser).Methods("POST")
	router.HandleFunc("/users/{userId}", h.GetUser).Methods("GET")
	router.HandleFunc("/users/{userId}", h.UpdateUser).Methods("PATCH")
	router.HandleFunc("/users/{userId}", h.DeleteUser).Methods("DELETE")
	router.HandleFunc("/users/{userId}/unlock", h.UnlockUser).Methods("POST")
	router.HandleFunc("/users/{userId}/cluster-permissions", h.ListUserClusterPermissions).Methods("GET")
	router.HandleFunc("/users/{userId}/cluster-permissions", h.SetUserClusterPermission).Methods("POST")
	router.HandleFunc("/users/{userId}/cluster-permissions/{clusterId}", h.DeleteUserClusterPermission).Methods("DELETE")
	// Namespace-level permissions (Phase 3: Advanced RBAC)
	router.HandleFunc("/users/{userId}/namespace-permissions", h.SetUserNamespacePermission).Methods("POST")
	router.HandleFunc("/users/{userId}/namespace-permissions", h.ListUserNamespacePermissions).Methods("GET")
	router.HandleFunc("/users/{userId}/namespace-permissions/{clusterId}/{namespace}", h.DeleteUserNamespacePermission).Methods("DELETE")
	// API key management (BE-AUTH-003)
	router.HandleFunc("/auth/api-keys", h.CreateAPIKey).Methods("POST")
	router.HandleFunc("/auth/api-keys", h.ListAPIKeys).Methods("GET")
	router.HandleFunc("/auth/api-keys/{keyId}", h.DeleteAPIKey).Methods("DELETE")
	// Token revocation endpoints (Phase 1: Token Revocation)
	router.HandleFunc("/auth/revoke", h.RevokeToken).Methods("POST")
	router.HandleFunc("/auth/revoke-all", h.RevokeAllTokens).Methods("POST")
	// Token introspection endpoint (Phase 5: Advanced Security Features)
	router.HandleFunc("/auth/introspect", h.IntrospectToken).Methods("POST")
	// Session management endpoints (Phase 4: Session Management)
	router.HandleFunc("/auth/sessions", h.ListSessions).Methods("GET")
	router.HandleFunc("/auth/sessions/{sessionId}", h.DeleteSession).Methods("DELETE")
	// Password strength endpoint (Phase 5: Password Policy)
	router.HandleFunc("/auth/password/strength", h.CheckPasswordStrength).Methods("POST")
	// Account recovery endpoints (Phase 5: Account Recovery)
	router.HandleFunc("/auth/forgot-password", h.ForgotPassword).Methods("POST")
	router.HandleFunc("/auth/reset-password", h.ResetPassword).Methods("POST")
	// MFA TOTP endpoints (Phase 5: MFA TOTP Support)
	router.HandleFunc("/auth/mfa/setup", h.MFASetup).Methods("POST")
	router.HandleFunc("/auth/mfa/verify", h.MFAVerify).Methods("POST")
	router.HandleFunc("/auth/mfa/enable", h.MFAEnable).Methods("POST")
	router.HandleFunc("/auth/mfa/disable", h.MFADisable).Methods("POST")
	router.HandleFunc("/auth/mfa/backup-codes", h.MFAGetBackupCodes).Methods("GET")
	router.HandleFunc("/auth/mfa/regenerate-backup-codes", h.MFARegenerateBackupCodes).Methods("POST")
}

// extractDeviceInfo extracts device info from user agent string
func (h *AuthHandler) extractDeviceInfo(userAgent string) string {
	// Simple device info extraction (can be enhanced with a proper user agent parser)
	if strings.Contains(strings.ToLower(userAgent), "mobile") || strings.Contains(strings.ToLower(userAgent), "android") || strings.Contains(strings.ToLower(userAgent), "iphone") {
		return "Mobile"
	}
	if strings.Contains(strings.ToLower(userAgent), "tablet") || strings.Contains(strings.ToLower(userAgent), "ipad") {
		return "Tablet"
	}
	return "Desktop"
}

// getIP extracts the client IP from the request (BE-AUTH-002).
func (h *AuthHandler) getIP(r *http.Request) string {
	ip := r.Header.Get("X-Forwarded-For")
	if ip != "" {
		parts := strings.Split(ip, ",")
		if len(parts) > 0 {
			ip = strings.TrimSpace(parts[0])
		}
	}
	if ip == "" {
		ip = r.Header.Get("X-Real-IP")
	}
	if ip == "" {
		host, _, _ := net.SplitHostPort(r.RemoteAddr)
		ip = host
	}
	return ip
}

// getLoginLimiter returns or creates a rate limiter for the given IP (BE-AUTH-002).
func (h *AuthHandler) getLoginLimiter(ip string) *rate.Limiter {
	h.loginLimiterMu.Lock()
	defer h.loginLimiterMu.Unlock()
	limiter, ok := h.loginLimiters[ip]
	if !ok {
		limiter = rate.NewLimiter(rate.Limit(loginRateLimit), loginBurst)
		h.loginLimiters[ip] = limiter
	}
	return limiter
}

// logAuthEvent logs an authentication event (BE-AUTH-002).
// Phase 6: Enhanced with session_id, device_info, geolocation, risk_score, correlation_id
func (h *AuthHandler) logAuthEvent(ctx context.Context, eventType, username, ip, userAgent string, userID *string, details string) {
	// Extract session ID from context if available
	var sessionID *string
	if claims := auth.ClaimsFromContext(ctx); claims != nil && claims.ID != "" {
		session, _ := h.repo.GetSessionByTokenID(ctx, claims.ID)
		if session != nil {
			sessionID = &session.ID
		}
	}

	// Extract device info
	deviceInfo := h.extractDeviceInfo(userAgent)

	// Calculate risk score (simple implementation - can be enhanced)
	riskScore := 0
	switch eventType {
	case "login_failure":
		riskScore = 30
	case "account_locked":
		riskScore = 80
	case "login_success":
		riskScore = 10
	}

	// Generate correlation ID for related events (e.g., login attempts)
	correlationID := uuid.New().String()

	// Simple geolocation (can be enhanced with IP geolocation service)
	geolocation := "Unknown"
	if ip != "" && ip != "127.0.0.1" && !strings.HasPrefix(ip, "192.168.") && !strings.HasPrefix(ip, "10.") {
		geolocation = "External" // Placeholder - would use IP geolocation service in production
	}

	// Create audit log entry
	_ = h.repo.CreateAuditLog(ctx, &models.AuditLogEntry{
		Timestamp:     time.Now(),
		UserID:        userID,
		Username:      username,
		Action:        eventType,
		RequestIP:     ip,
		Details:       details,
		SessionID:     sessionID,
		DeviceInfo:    &deviceInfo,
		Geolocation:   &geolocation,
		RiskScore:     &riskScore,
		CorrelationID: &correlationID,
	})

	// Also create AuthEvent for backward compatibility
	e := &models.AuthEvent{
		ID:        uuid.New().String(),
		UserID:    userID,
		Username:  username,
		EventType: eventType,
		IPAddress: ip,
		UserAgent: userAgent,
		Timestamp: time.Now(),
		Details:   details,
	}
	if err := h.repo.CreateAuthEvent(ctx, e); err != nil {
		log.Printf("[auth] Failed to log event %s for user %s: %v", eventType, username, err)
	} else {
		log.Printf("[auth] %s: user=%s ip=%s", eventType, username, ip)
	}
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	if h.cfg.AuthMode == "disabled" {
		respondError(w, http.StatusBadRequest, "Authentication is disabled")
		return
	}
	if h.cfg.AuthJWTSecret == "" {
		respondError(w, http.StatusInternalServerError, "Server auth not configured")
		return
	}
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" || req.Password == "" {
		respondError(w, http.StatusBadRequest, "Username and password required")
		return
	}
	// Phase 5: Enhanced password policy validation
	policy := auth.PasswordPolicy{
		MinLength:        h.cfg.PasswordMinLength,
		RequireUppercase: h.cfg.PasswordRequireUppercase,
		RequireLowercase: h.cfg.PasswordRequireLowercase,
		RequireNumbers:   h.cfg.PasswordRequireNumbers,
		RequireSpecial:   h.cfg.PasswordRequireSpecial,
	}
	if err := auth.ValidatePassword(req.Password, policy); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Check common passwords
	if auth.CheckCommonPasswords(req.Password) {
		respondError(w, http.StatusBadRequest, "Password is too common. Please choose a more unique password.")
		return
	}
	ctx := r.Context()
	ip := h.getIP(r)
	userAgent := r.Header.Get("User-Agent")
	// BE-AUTH-002: Rate limit login attempts per IP (5 per minute)
	limiter := h.getLoginLimiter(ip)
	if !limiter.Allow() {
		h.logAuthEvent(ctx, "login_failure", req.Username, ip, userAgent, nil, "rate_limit_exceeded")
		w.Header().Set("Retry-After", "60")
		respondError(w, http.StatusTooManyRequests, "Too many login attempts. Please try again later.")
		return
	}
	u, err := h.repo.GetUserByUsername(ctx, req.Username)
	if err != nil || u == nil {
		// Phase 5: Record account enumeration attempt
		if h.securityDetector != nil {
			_ = h.securityDetector.RecordAccountEnumeration(ctx, ip, req.Username, userAgent)
		}
		// Don't reveal if user exists; log failure
		h.logAuthEvent(ctx, "login_failure", req.Username, ip, userAgent, nil, "user_not_found_or_error")
		respondError(w, http.StatusUnauthorized, "Invalid credentials")
		return
	}
	// BE-FUNC-004: Check if user is deleted (soft delete)
	if u.IsDeleted() {
		h.logAuthEvent(ctx, "login_failure", u.Username, ip, userAgent, &u.ID, "account_deleted")
		respondError(w, http.StatusForbidden, "Account has been deactivated. Contact an administrator.")
		return
	}
	// BE-AUTH-002: Check if account is locked
	if u.IsLocked() {
		h.logAuthEvent(ctx, "login_failure", u.Username, ip, userAgent, &u.ID, "account_locked")
		respondError(w, http.StatusForbidden, "Account temporarily locked. Contact an administrator.")
		return
	}
	// Phase 5: Check if IP is blocked
	if h.securityDetector != nil {
		isBlocked, err := h.securityDetector.DetectBruteForce(ctx, ip, req.Username, userAgent)
		if err == nil && isBlocked {
			h.logAuthEvent(ctx, "login_failure", req.Username, ip, userAgent, &u.ID, "ip_blocked")
			respondError(w, http.StatusForbidden, "IP address has been temporarily blocked due to suspicious activity. Please try again later.")
			return
		}
	}

	// Validate password
	if err := auth.CheckPassword(u.PasswordHash, req.Password); err != nil {
		// BE-AUTH-002: Increment failed login count
		_ = h.repo.IncrementFailedLogin(ctx, u.ID)

		// Phase 5: Record failed login for security detection
		if h.securityDetector != nil {
			_ = h.securityDetector.RecordFailedLogin(ctx, ip, req.Username, userAgent)
		}

		// Reload user to get updated failed count
		u, _ = h.repo.GetUserByUsername(ctx, req.Username)
		if u != nil {
			h.logAuthEvent(ctx, "login_failure", u.Username, ip, userAgent, &u.ID, "")
			// BE-AUTH-002: Lock account after 10 consecutive failures
			if u.FailedLoginCount >= maxFailedLogins {
				lockUntil := time.Now().Add(lockoutDuration)
				_ = h.repo.LockUser(ctx, u.ID, lockUntil)
				// Phase 1: Auto-revoke all tokens on account lock
				_ = h.repo.RevokeAllUserTokens(ctx, u.ID, "account_lock")
				h.logAuthEvent(ctx, "account_locked", u.Username, ip, userAgent, &u.ID, "")
				respondError(w, http.StatusForbidden, "Account locked due to too many failed login attempts. Contact an administrator.")
				return
			}
		}
		metrics.AuthLoginAttemptsTotal.WithLabelValues("password", "failure").Inc()
		respondError(w, http.StatusUnauthorized, "Invalid credentials")
		return
	}
	// BE-AUTH-002: Successful login - reset failed count
	_ = h.repo.ResetFailedLogin(ctx, u.ID)

	// Phase 5: Check if MFA is required/enabled
	mfaRequired := h.isMFARequired(u.Role)
	mfaSecret, _ := h.repo.GetMFATOTPSecret(ctx, u.ID)
	mfaEnabled := mfaSecret != nil && mfaSecret.Enabled

	if mfaRequired || mfaEnabled {
		// MFA is required - check if code provided
		if req.MFACode == "" {
			h.logAuthEvent(ctx, "login_mfa_required", u.Username, ip, userAgent, &u.ID, "")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(LoginResponse{
				MFARequired: true,
				Message:     "MFA code required",
			})
			return
		}

		// Verify MFA code
		if mfaSecret == nil || !mfaSecret.Enabled {
			respondError(w, http.StatusBadRequest, "MFA not set up for this account")
			return
		}

		// Try backup code first (backup codes use bcrypt which is correct)
		backupValid, err := h.repo.VerifyAndUseMFABackupCode(ctx, u.ID, req.MFACode)
		if err == nil && backupValid {
			// Backup code valid
		} else {
			// Try TOTP code - decrypt secret first
			var plainSecret string
			if h.cfg.MFAEncryptionKey != "" {
				plainSecret, err = mfa.DecryptTOTPSecret(mfaSecret.Secret, h.cfg.MFAEncryptionKey)
				if err != nil {
					h.logAuthEvent(ctx, "login_mfa_failure", u.Username, ip, userAgent, &u.ID, "decryption_error")
					respondError(w, http.StatusInternalServerError, "Failed to decrypt MFA secret")
					return
				}
			} else {
				// Fallback: base64 decode if no encryption key
				decoded, err := base64.StdEncoding.DecodeString(mfaSecret.Secret)
				if err != nil {
					h.logAuthEvent(ctx, "login_mfa_failure", u.Username, ip, userAgent, &u.ID, "invalid_secret_format")
					respondError(w, http.StatusInternalServerError, "Invalid MFA secret format")
					return
				}
				plainSecret = string(decoded)
			}

			// Verify TOTP code
			if !mfa.VerifyTOTPCode(plainSecret, req.MFACode) {
				h.logAuthEvent(ctx, "login_mfa_failure", u.Username, ip, userAgent, &u.ID, "invalid_mfa_code")
				respondError(w, http.StatusUnauthorized, "Invalid MFA code")
				return
			}
		}
	}

	// Login successful - issue tokens
	h.logAuthEvent(ctx, "login_success", u.Username, ip, userAgent, &u.ID, "")
	metrics.AuthLoginAttemptsTotal.WithLabelValues("password", "success").Inc()
	accessToken, err := auth.IssueAccessToken(h.cfg.AuthJWTSecret, u.ID, u.Username, u.Role)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to issue token")
		return
	}
	refreshToken, err := auth.IssueRefreshToken(h.cfg.AuthJWTSecret, u.ID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to issue token")
		return
	}

	// Phase 1: Create refresh token family for rotation
	refreshClaims, _ := auth.ValidateToken(h.cfg.AuthJWTSecret, refreshToken)
	if refreshClaims != nil && refreshClaims.ID != "" {
		familyID := uuid.New().String()
		family := &models.RefreshTokenFamily{
			FamilyID:  familyID,
			UserID:    u.ID,
			TokenID:   refreshClaims.ID,
			CreatedAt: time.Now(),
		}
		if err := h.repo.CreateRefreshTokenFamily(ctx, family); err != nil {
			log.Printf("Failed to create refresh token family: %v", err)
		}
	}

	// Phase 4: Create session for tracking
	accessClaims, _ := auth.ValidateToken(h.cfg.AuthJWTSecret, accessToken)
	if accessClaims != nil && accessClaims.ID != "" {
		now := time.Now()
		expiresAt := now.Add(auth.AccessTokenExpiry)
		session := &models.Session{
			UserID:       u.ID,
			TokenID:      accessClaims.ID,
			DeviceInfo:   h.extractDeviceInfo(userAgent),
			IPAddress:    ip,
			UserAgent:    userAgent,
			CreatedAt:    now,
			LastActivity: now,
			ExpiresAt:    expiresAt,
		}
		// Phase 4: Check session limits
		if h.cfg.MaxConcurrentSessions > 0 {
			count, _ := h.repo.CountUserSessions(ctx, u.ID)
			if count >= h.cfg.MaxConcurrentSessions {
				// Revoke oldest session
				oldest, err := h.repo.GetOldestUserSession(ctx, u.ID)
				if err == nil && oldest != nil {
					// Revoke token and delete session
					entry := &models.TokenBlacklistEntry{
						TokenID:   oldest.TokenID,
						UserID:    u.ID,
						RevokedAt: time.Now(),
						ExpiresAt: oldest.ExpiresAt,
						Reason:    "session_limit",
					}
					_ = h.repo.CreateTokenBlacklistEntry(ctx, entry)
					_ = h.repo.DeleteSession(ctx, oldest.ID)
				}
			}
		}
		if err := h.repo.CreateSession(ctx, session); err != nil {
			log.Printf("Failed to create session: %v", err)
		}
	}

	_ = h.repo.UpdateUserLastLogin(ctx, u.ID, time.Now())
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(LoginResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    int(auth.AccessTokenExpiry.Seconds()),
		TokenType:    "Bearer",
	})
}

// isMFARequired checks if MFA is required for a role
func (h *AuthHandler) isMFARequired(role string) bool {
	if h.cfg.MFARequired {
		return true // MFA required for all users
	}
	if h.cfg.MFAEnforcedRoles != "" {
		enforcedRoles := strings.Split(h.cfg.MFAEnforcedRoles, ",")
		for _, enforcedRole := range enforcedRoles {
			if strings.TrimSpace(enforcedRole) == role {
				return true
			}
		}
	}
	return false
}

func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	if h.cfg.AuthMode == "disabled" {
		respondError(w, http.StatusBadRequest, "Authentication is disabled")
		return
	}
	if h.cfg.AuthJWTSecret == "" {
		respondError(w, http.StatusInternalServerError, "Server auth not configured")
		return
	}
	var req RefreshRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if req.RefreshToken == "" {
		respondError(w, http.StatusBadRequest, "refresh_token required")
		return
	}
	claims, err := auth.ValidateTokenWithRepo(r.Context(), h.cfg.AuthJWTSecret, req.RefreshToken, h.repo)
	if err != nil || !claims.Refresh {
		metrics.AuthTokenRefreshesTotal.WithLabelValues("failure").Inc()
		respondError(w, http.StatusUnauthorized, "Invalid or expired refresh token")
		return
	}

	// Phase 1: Check refresh token family for rotation
	family, err := h.repo.GetRefreshTokenFamilyByTokenID(r.Context(), claims.ID)
	if err != nil || family == nil {
		// Token not in family (old token format) - allow but log
		log.Printf("Refresh token %s not found in family", claims.ID)
	} else if family.IsRevoked() {
		respondError(w, http.StatusUnauthorized, "Refresh token has been revoked")
		return
	}

	u, err := h.repo.GetUserByID(r.Context(), claims.UserID)
	if err != nil || u == nil {
		respondError(w, http.StatusUnauthorized, "User not found")
		return
	}

	// Phase 1: Token rotation - revoke old refresh token and issue new one
	var newRefreshToken string
	if family != nil && !family.IsRevoked() && claims.ID != "" {
		// Revoke old refresh token
		expiresAt := time.Now().Add(auth.RefreshTokenExpiry)
		if claims.ExpiresAt != nil {
			expiresAt = claims.ExpiresAt.Time
		}
		oldTokenEntry := &models.TokenBlacklistEntry{
			TokenID:   claims.ID,
			UserID:    u.ID,
			RevokedAt: time.Now(),
			ExpiresAt: expiresAt,
			Reason:    "token_rotation",
		}
		_ = h.repo.CreateTokenBlacklistEntry(r.Context(), oldTokenEntry)

		// Issue new refresh token
		newRefreshTokenStr, err := auth.IssueRefreshToken(h.cfg.AuthJWTSecret, u.ID)
		if err == nil {
			newRefreshToken = newRefreshTokenStr
			// Update family with new token
			newRefreshClaims, _ := auth.ValidateToken(h.cfg.AuthJWTSecret, newRefreshToken)
			if newRefreshClaims != nil && newRefreshClaims.ID != "" {
				_ = h.repo.UpdateRefreshTokenFamilyToken(r.Context(), family.FamilyID, newRefreshClaims.ID)
			}
		}
	}

	accessToken, err := auth.IssueAccessToken(h.cfg.AuthJWTSecret, u.ID, u.Username, u.Role)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to issue token")
		return
	}

	response := LoginResponse{
		AccessToken: accessToken,
		ExpiresIn:   int(auth.AccessTokenExpiry.Seconds()),
		TokenType:   "Bearer",
	}
	if newRefreshToken != "" {
		response.RefreshToken = newRefreshToken
	}

	metrics.AuthTokenRefreshesTotal.WithLabelValues("success").Inc()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(response)
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	// Stateless JWT: client discards token; we just return 200
	w.WriteHeader(http.StatusOK)
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		respondError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}
	// BE-AUTHZ-001: Load cluster permissions
	perms, _ := h.repo.ListClusterPermissionsByUser(r.Context(), claims.UserID)
	permMap := make(map[string]string)
	for _, p := range perms {
		permMap[p.ClusterID] = p.Role
	}

	// Phase 5: Check MFA status
	mfaSecret, _ := h.repo.GetMFATOTPSecret(r.Context(), claims.UserID)
	mfaEnabled := mfaSecret != nil && mfaSecret.Enabled
	mfaRequired := h.isMFARequired(claims.Role)

	// Phase 5: Get user groups
	userGroups, _ := h.repo.ListUserGroups(r.Context(), claims.UserID)
	groupNames := make([]string, len(userGroups))
	for i, g := range userGroups {
		groupNames[i] = g.Name
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(MeResponse{
		ID:                 claims.UserID,
		Username:           claims.Username,
		Role:               claims.Role,
		ClusterPermissions: permMap,
		MFAEnabled:         mfaEnabled,
		MFARequired:        mfaRequired,
		Groups:             groupNames,
	})
}

// ChangePasswordRequest is the body for POST /auth/change-password (BE-AUTH-002).
type ChangePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

func (h *AuthHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		respondError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}
	var req ChangePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	ctx := r.Context()
	u, err := h.repo.GetUserByID(ctx, claims.UserID)
	if err != nil || u == nil {
		respondError(w, http.StatusUnauthorized, "User not found")
		return
	}

	// Verify current password
	if err := auth.CheckPassword(u.PasswordHash, req.CurrentPassword); err != nil {
		ip := h.getIP(r)
		userAgent := r.Header.Get("User-Agent")
		h.logAuthEvent(ctx, "login_failure", u.Username, ip, userAgent, &u.ID, "password_change_wrong_current")
		respondError(w, http.StatusUnauthorized, "Current password is incorrect")
		return
	}

	// Phase 5: Enhanced password policy validation
	policy := auth.PasswordPolicy{
		MinLength:        h.cfg.PasswordMinLength,
		RequireUppercase: h.cfg.PasswordRequireUppercase,
		RequireLowercase: h.cfg.PasswordRequireLowercase,
		RequireNumbers:   h.cfg.PasswordRequireNumbers,
		RequireSpecial:   h.cfg.PasswordRequireSpecial,
	}
	if err := auth.ValidatePassword(req.NewPassword, policy); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Check common passwords
	if auth.CheckCommonPasswords(req.NewPassword) {
		respondError(w, http.StatusBadRequest, "Password is too common. Please choose a more unique password.")
		return
	}

	// Hash new password
	newHash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to hash password")
		return
	}

	// Check password history
	historyCount := h.cfg.PasswordHistoryCount
	if historyCount > 0 {
		inHistory, err := h.repo.CheckPasswordInHistory(ctx, claims.UserID, newHash, historyCount)
		if err == nil && inHistory {
			respondError(w, http.StatusBadRequest, fmt.Sprintf("Password cannot be one of your last %d passwords", historyCount))
			return
		}
	}

	// Update password
	if err := h.repo.UpdateUserPassword(ctx, u.ID, newHash); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to update password")
		return
	}

	// Phase 5: Add to password history
	if historyCount > 0 {
		_ = h.repo.CreatePasswordHistory(ctx, u.ID, newHash)
		_ = h.repo.CleanupOldPasswordHistory(ctx, u.ID, historyCount+1) // Keep one extra for safety
	}

	// Phase 1: Auto-revoke all tokens on password change
	_ = h.repo.RevokeAllUserTokens(ctx, u.ID, "password_change")

	ip := h.getIP(r)
	userAgent := r.Header.Get("User-Agent")
	h.logAuthEvent(ctx, "password_change", u.Username, ip, userAgent, &u.ID, "")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"message":"Password changed successfully"}`))
}

// User management endpoints (admin only) - BE-AUTHZ-001

type CreateUserRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Role     string `json:"role"` // viewer | operator | admin
}

type UpdateUserRequest struct {
	Role     string `json:"role,omitempty"`     // viewer | operator | admin (admin only)
	Password string `json:"password,omitempty"` // New password (admin or self)
}

type SetClusterPermissionRequest struct {
	ClusterID string `json:"cluster_id"`
	Role      string `json:"role"` // viewer | operator | admin
}

func (h *AuthHandler) ListUsers(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != auth.RoleAdmin {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}
	users, err := h.repo.ListUsers(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Remove password hashes from response
	for _, u := range users {
		u.PasswordHash = ""
	}
	respondJSON(w, http.StatusOK, users)
}

func (h *AuthHandler) CreateUser(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != auth.RoleAdmin {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}
	var req CreateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" || req.Password == "" {
		respondError(w, http.StatusBadRequest, "Username and password required")
		return
	}
	if len(req.Password) < minPasswordLength {
		respondError(w, http.StatusBadRequest, "Password must be at least 12 characters")
		return
	}
	if req.Role != auth.RoleViewer && req.Role != auth.RoleOperator && req.Role != auth.RoleAdmin {
		req.Role = auth.RoleViewer
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to hash password")
		return
	}
	u := &models.User{
		Username:     req.Username,
		PasswordHash: hash,
		Role:         req.Role,
	}
	if err := h.repo.CreateUser(r.Context(), u); err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint") {
			respondError(w, http.StatusConflict, "Username already exists")
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	u.PasswordHash = ""
	respondJSON(w, http.StatusCreated, u)
}

func (h *AuthHandler) GetUser(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		respondError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}
	vars := mux.Vars(r)
	userID := vars["userId"]
	// Users can view themselves; admins can view anyone
	if claims.UserID != userID && claims.Role != auth.RoleAdmin {
		respondError(w, http.StatusForbidden, "Access denied")
		return
	}
	u, err := h.repo.GetUserByID(r.Context(), userID)
	if err != nil || u == nil {
		respondError(w, http.StatusNotFound, "User not found")
		return
	}
	u.PasswordHash = ""
	respondJSON(w, http.StatusOK, u)
}

func (h *AuthHandler) UpdateUser(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		respondError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}
	vars := mux.Vars(r)
	userID := vars["userId"]
	isSelf := claims.UserID == userID
	isAdmin := claims.Role == auth.RoleAdmin
	if !isSelf && !isAdmin {
		respondError(w, http.StatusForbidden, "Access denied")
		return
	}
	var req UpdateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	u, err := h.repo.GetUserByID(r.Context(), userID)
	if err != nil || u == nil {
		respondError(w, http.StatusNotFound, "User not found")
		return
	}
	// BE-FUNC-004: Role can only be updated by admin
	if req.Role != "" {
		if !isAdmin {
			respondError(w, http.StatusForbidden, "Only admins can update user roles")
			return
		}
		if req.Role != auth.RoleViewer && req.Role != auth.RoleOperator && req.Role != auth.RoleAdmin {
			respondError(w, http.StatusBadRequest, "Invalid role")
			return
		}
		if err := h.repo.UpdateUserRole(r.Context(), userID, req.Role); err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		u.Role = req.Role
	}
	// BE-FUNC-004: Password can be updated by admin or self
	if req.Password != "" {
		if len(req.Password) < minPasswordLength {
			respondError(w, http.StatusBadRequest, "Password must be at least 12 characters")
			return
		}
		hash, err := auth.HashPassword(req.Password)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to hash password")
			return
		}
		if err := h.repo.UpdateUserPassword(r.Context(), userID, hash); err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		ip := h.getIP(r)
		userAgent := r.Header.Get("User-Agent")
		h.logAuthEvent(r.Context(), "password_change", u.Username, ip, userAgent, &u.ID, "")
	}
	u.PasswordHash = ""
	respondJSON(w, http.StatusOK, u)
}

func (h *AuthHandler) DeleteUser(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != auth.RoleAdmin {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}
	vars := mux.Vars(r)
	userID := vars["userId"]
	if userID == claims.UserID {
		respondError(w, http.StatusBadRequest, "Cannot delete your own account")
		return
	}

	// Phase 1: Auto-revoke all tokens on user deletion
	_ = h.repo.RevokeAllUserTokens(r.Context(), userID, "user_deletion")

	if err := h.repo.DeleteUser(r.Context(), userID); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *AuthHandler) UnlockUser(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != auth.RoleAdmin {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}
	vars := mux.Vars(r)
	userID := vars["userId"]
	if err := h.repo.UnlockUser(r.Context(), userID); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	u, _ := h.repo.GetUserByID(r.Context(), userID)
	if u != nil {
		ip := h.getIP(r)
		userAgent := r.Header.Get("User-Agent")
		h.logAuthEvent(r.Context(), "account_unlocked", u.Username, ip, userAgent, &u.ID, "")
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"message":"User unlocked"}`))
}

func (h *AuthHandler) ListUserClusterPermissions(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		respondError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}
	vars := mux.Vars(r)
	userID := vars["userId"]
	// Users can view their own permissions; admins can view anyone's
	if claims.UserID != userID && claims.Role != auth.RoleAdmin {
		respondError(w, http.StatusForbidden, "Access denied")
		return
	}
	perms, err := h.repo.ListClusterPermissionsByUser(r.Context(), userID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, perms)
}

func (h *AuthHandler) SetUserClusterPermission(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != auth.RoleAdmin {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}
	vars := mux.Vars(r)
	userID := vars["userId"]
	var req SetClusterPermissionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if req.Role != auth.RoleViewer && req.Role != auth.RoleOperator && req.Role != auth.RoleAdmin {
		respondError(w, http.StatusBadRequest, "Invalid role")
		return
	}
	// Check if permission exists
	cp, _ := h.repo.GetClusterPermission(r.Context(), userID, req.ClusterID)
	if cp != nil {
		cp.Role = req.Role
		if err := h.repo.UpdateClusterPermission(r.Context(), cp); err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, cp)
		return
	}
	// Create new permission
	cp = &models.ClusterPermission{
		UserID:    userID,
		ClusterID: req.ClusterID,
		Role:      req.Role,
	}
	if err := h.repo.CreateClusterPermission(r.Context(), cp); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	respondJSON(w, http.StatusCreated, cp)
}

func (h *AuthHandler) DeleteUserClusterPermission(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != auth.RoleAdmin {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}
	vars := mux.Vars(r)
	userID := vars["userId"]
	clusterID := vars["clusterId"]
	if err := h.repo.DeleteClusterPermission(r.Context(), userID, clusterID); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// API key management endpoints (BE-AUTH-003)

type CreateAPIKeyRequest struct {
	Name      string `json:"name"`       // Human-readable name for the key
	ExpiresIn *int   `json:"expires_in"` // Optional: expiration in days (nil = never expires)
}

type CreateAPIKeyResponse struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Key       string     `json:"key"` // Plaintext key (shown only once)
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

type APIKeyResponse struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	LastUsed  *time.Time `json:"last_used,omitempty"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

func (h *AuthHandler) CreateAPIKey(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		respondError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}
	var req CreateAPIKeyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		respondError(w, http.StatusBadRequest, "Name is required")
		return
	}
	// Generate API key
	plaintext, hash, err := auth.GenerateAPIKey()
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to generate API key")
		return
	}
	// Calculate expiration
	var expiresAt *time.Time
	if req.ExpiresIn != nil && *req.ExpiresIn > 0 {
		exp := time.Now().Add(time.Duration(*req.ExpiresIn) * 24 * time.Hour)
		expiresAt = &exp
	}
	// Create API key record
	apiKey := &models.APIKey{
		UserID:    claims.UserID,
		KeyHash:   hash,
		Name:      req.Name,
		ExpiresAt: expiresAt,
		CreatedAt: time.Now(),
	}
	if err := h.repo.CreateAPIKey(r.Context(), apiKey); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	respondJSON(w, http.StatusCreated, CreateAPIKeyResponse{
		ID:        apiKey.ID,
		Name:      apiKey.Name,
		Key:       plaintext, // Only time this is returned
		ExpiresAt: apiKey.ExpiresAt,
		CreatedAt: apiKey.CreatedAt,
	})
}

func (h *AuthHandler) ListAPIKeys(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		respondError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}
	keys, err := h.repo.ListAPIKeysByUser(r.Context(), claims.UserID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Convert to response format (no key_hash or plaintext)
	responses := make([]APIKeyResponse, len(keys))
	for i, k := range keys {
		responses[i] = APIKeyResponse{
			ID:        k.ID,
			Name:      k.Name,
			LastUsed:  k.LastUsed,
			ExpiresAt: k.ExpiresAt,
			CreatedAt: k.CreatedAt,
		}
	}
	respondJSON(w, http.StatusOK, responses)
}

func (h *AuthHandler) DeleteAPIKey(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		respondError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}
	vars := mux.Vars(r)
	keyID := vars["keyId"]
	// Verify ownership (users can only delete their own keys)
	keys, err := h.repo.ListAPIKeysByUser(r.Context(), claims.UserID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	found := false
	for _, k := range keys {
		if k.ID == keyID {
			found = true
			break
		}
	}
	if !found {
		respondError(w, http.StatusNotFound, "API key not found")
		return
	}
	if err := h.repo.DeleteAPIKey(r.Context(), keyID); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// RevokeTokenRequest is the body for POST /auth/revoke
type RevokeTokenRequest struct {
	TokenID string `json:"token_id,omitempty"` // Optional: revoke specific token by JTI
}

// RevokeToken revokes a specific token or all user tokens (Phase 1: Token Revocation)
func (h *AuthHandler) RevokeToken(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		respondError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}

	var req RevokeTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	ctx := r.Context()
	if req.TokenID != "" {
		// Revoke specific token
		// Get token expiry from claims if available, otherwise use default
		expiresAt := time.Now().Add(auth.AccessTokenExpiry)
		if claims.ExpiresAt != nil {
			expiresAt = claims.ExpiresAt.Time
		}
		entry := &models.TokenBlacklistEntry{
			TokenID:   req.TokenID,
			UserID:    claims.UserID,
			RevokedAt: time.Now(),
			ExpiresAt: expiresAt,
			Reason:    "manual_revoke",
		}
		if err := h.repo.CreateTokenBlacklistEntry(ctx, entry); err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to revoke token")
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"message":"Token revoked successfully"}`))
	} else {
		// Revoke all user tokens
		if err := h.repo.RevokeAllUserTokens(ctx, claims.UserID, "manual_revoke"); err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to revoke tokens")
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"message":"All tokens revoked successfully"}`))
	}
}

// RevokeAllTokensRequest is the body for POST /auth/revoke-all (admin only)
type RevokeAllTokensRequest struct {
	UserID string `json:"user_id"` // User ID to revoke tokens for
}

// RevokeAllTokens revokes all tokens for a user (admin only) (Phase 1: Token Revocation)
func (h *AuthHandler) RevokeAllTokens(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		respondError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}

	// Admin only
	if claims.Role != "admin" {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}

	var req RevokeAllTokensRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.UserID == "" {
		respondError(w, http.StatusBadRequest, "user_id required")
		return
	}

	ctx := r.Context()
	if err := h.repo.RevokeAllUserTokens(ctx, req.UserID, "admin_revoke"); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to revoke tokens")
		return
	}

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"message":"All tokens revoked successfully"}`))
}

// ListSessions lists all active sessions for the authenticated user (Phase 4: Session Management)
func (h *AuthHandler) ListSessions(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		respondError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}

	sessions, err := h.repo.ListUserSessions(r.Context(), claims.UserID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to list sessions")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(sessions)
}

// DeleteSession deletes a specific session (Phase 4: Session Management)
func (h *AuthHandler) DeleteSession(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		respondError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}

	vars := mux.Vars(r)
	sessionID := vars["sessionId"]
	if sessionID == "" {
		respondError(w, http.StatusBadRequest, "session_id required")
		return
	}

	// Get all user sessions to find the one to delete
	sessions, err := h.repo.ListUserSessions(r.Context(), claims.UserID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to list sessions")
		return
	}

	var sessionToDelete *models.Session
	for _, s := range sessions {
		if s.ID == sessionID {
			sessionToDelete = s
			break
		}
	}

	if sessionToDelete == nil {
		respondError(w, http.StatusNotFound, "Session not found")
		return
	}

	// Revoke token if session has token ID
	if sessionToDelete.TokenID != "" {
		entry := &models.TokenBlacklistEntry{
			TokenID:   sessionToDelete.TokenID,
			UserID:    claims.UserID,
			RevokedAt: time.Now(),
			ExpiresAt: sessionToDelete.ExpiresAt,
			Reason:    "session_revoked",
		}
		_ = h.repo.CreateTokenBlacklistEntry(r.Context(), entry)
	}

	if err := h.repo.DeleteSession(r.Context(), sessionID); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to delete session")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// IntrospectTokenRequest is the body for POST /auth/introspect
type IntrospectTokenRequest struct {
	Token string `json:"token"` // Token to introspect
}

// IntrospectTokenResponse is the response for token introspection
type IntrospectTokenResponse struct {
	Active   bool   `json:"active"` // Whether token is active
	UserID   string `json:"user_id,omitempty"`
	Username string `json:"username,omitempty"`
	Role     string `json:"role,omitempty"`
	Exp      int64  `json:"exp,omitempty"` // Expiration timestamp
}

// IntrospectToken validates a token and returns its claims (Phase 5: Advanced Security Features)
func (h *AuthHandler) IntrospectToken(w http.ResponseWriter, r *http.Request) {
	var req IntrospectTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		// Try form-encoded
		req.Token = r.FormValue("token")
		if req.Token == "" {
			respondError(w, http.StatusBadRequest, "Invalid request body or missing token")
			return
		}
	}

	if req.Token == "" {
		respondError(w, http.StatusBadRequest, "token required")
		return
	}

	ctx := r.Context()
	claims, err := auth.ValidateTokenWithRepo(ctx, h.cfg.AuthJWTSecret, req.Token, h.repo)
	if err != nil {
		// Token is invalid or expired
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(IntrospectTokenResponse{
			Active: false,
		})
		return
	}

	// Token is valid
	exp := int64(0)
	if claims.ExpiresAt != nil {
		exp = claims.ExpiresAt.Unix()
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(IntrospectTokenResponse{
		Active:   true,
		UserID:   claims.UserID,
		Username: claims.Username,
		Role:     claims.Role,
		Exp:      exp,
	})
}

// CheckPasswordStrengthRequest is the body for POST /auth/password/strength
type CheckPasswordStrengthRequest struct {
	Password string `json:"password"`
}

// CheckPasswordStrengthResponse is the response for password strength check
type CheckPasswordStrengthResponse struct {
	Strength int      `json:"strength"`         // 0-100
	Label    string   `json:"label"`            // Weak, Fair, Good, Strong
	Valid    bool     `json:"valid"`            // Whether password meets policy requirements
	Errors   []string `json:"errors,omitempty"` // Policy validation errors
}

// CheckPasswordStrength checks password strength and policy compliance (Phase 5: Password Policy)
func (h *AuthHandler) CheckPasswordStrength(w http.ResponseWriter, r *http.Request) {
	var req CheckPasswordStrengthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.Password == "" {
		respondError(w, http.StatusBadRequest, "password required")
		return
	}

	policy := auth.PasswordPolicy{
		MinLength:        h.cfg.PasswordMinLength,
		RequireUppercase: h.cfg.PasswordRequireUppercase,
		RequireLowercase: h.cfg.PasswordRequireLowercase,
		RequireNumbers:   h.cfg.PasswordRequireNumbers,
		RequireSpecial:   h.cfg.PasswordRequireSpecial,
	}

	strength := auth.CalculatePasswordStrength(req.Password)
	label := auth.GetPasswordStrengthLabel(strength)

	var errors []string
	if err := auth.ValidatePassword(req.Password, policy); err != nil {
		errors = append(errors, err.Error())
	}

	if auth.CheckCommonPasswords(req.Password) {
		errors = append(errors, "Password is too common")
	}

	valid := len(errors) == 0

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(CheckPasswordStrengthResponse{
		Strength: strength,
		Label:    label,
		Valid:    valid,
		Errors:   errors,
	})
}

// MFA Setup Request/Response
type MFASetupRequest struct {
	// Empty - generates new secret
}

type MFASetupResponse struct {
	Secret      string   `json:"secret"`       // TOTP secret (for manual entry)
	QRCodeURL   string   `json:"qr_code_url"`  // QR code data URL
	BackupCodes []string `json:"backup_codes"` // Backup codes (shown only once)
}

// MFASetup generates a new TOTP secret and QR code (Phase 5: MFA TOTP)
func (h *AuthHandler) MFASetup(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		respondError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}

	ctx := r.Context()
	user, err := h.repo.GetUserByID(ctx, claims.UserID)
	if err != nil || user == nil {
		respondError(w, http.StatusUnauthorized, "User not found")
		return
	}

	// Generate TOTP secret and QR code
	secret, qrCodeURL, err := mfa.GenerateTOTPSecret(user.Username)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to generate TOTP secret: "+err.Error())
		return
	}

	// Encrypt secret using AES-GCM (reversible encryption for TOTP secrets)
	var encryptedSecret string
	if h.cfg.MFAEncryptionKey != "" {
		encryptedSecret, err = mfa.EncryptTOTPSecret(secret, h.cfg.MFAEncryptionKey)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to encrypt secret: "+err.Error())
			return
		}
	} else {
		// Fallback: use base64 encoding if no encryption key (not secure, but allows functionality)
		// In production, encryption key MUST be configured
		encryptedSecret = base64.StdEncoding.EncodeToString([]byte(secret))
	}

	// Store secret (not enabled yet - will be enabled after verification)
	mfaSecret := &models.MFATOTPSecret{
		UserID:    user.ID,
		Secret:    encryptedSecret,
		Enabled:   false,
		CreatedAt: time.Now(),
	}
	if err := h.repo.CreateMFATOTPSecret(ctx, mfaSecret); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to save secret")
		return
	}

	// Generate backup codes
	backupCodes, err := mfa.GenerateBackupCodes(10)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to generate backup codes")
		return
	}

	// Hash and store backup codes
	codeHashes := make([]string, len(backupCodes))
	for i, code := range backupCodes {
		hash, err := mfa.HashBackupCode(code)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to hash backup code")
			return
		}
		codeHashes[i] = hash
	}
	if err := h.repo.CreateMFABackupCodes(ctx, user.ID, codeHashes); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to save backup codes")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(MFASetupResponse{
		Secret:      secret,
		QRCodeURL:   qrCodeURL,
		BackupCodes: backupCodes,
	})
}

// MFA Verify Request
type MFAVerifyRequest struct {
	Code string `json:"code"` // TOTP code to verify
}

// MFAVerify verifies TOTP code during setup (Phase 5: MFA TOTP)
func (h *AuthHandler) MFAVerify(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		respondError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}

	var req MFAVerifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.Code == "" {
		respondError(w, http.StatusBadRequest, "code required")
		return
	}

	ctx := r.Context()
	mfaSecret, err := h.repo.GetMFATOTPSecret(ctx, claims.UserID)
	if err != nil || mfaSecret == nil {
		respondError(w, http.StatusBadRequest, "MFA not set up. Call /auth/mfa/setup first.")
		return
	}

	// Decrypt secret
	var plainSecret string
	if h.cfg.MFAEncryptionKey != "" {
		var decryptErr error
		plainSecret, decryptErr = mfa.DecryptTOTPSecret(mfaSecret.Secret, h.cfg.MFAEncryptionKey)
		if decryptErr != nil {
			respondError(w, http.StatusInternalServerError, "Failed to decrypt secret: "+decryptErr.Error())
			return
		}
	} else {
		// Fallback: base64 decode if no encryption key
		decoded, decodeErr := base64.StdEncoding.DecodeString(mfaSecret.Secret)
		if decodeErr != nil {
			respondError(w, http.StatusInternalServerError, "Invalid secret format")
			return
		}
		plainSecret = string(decoded)
	}

	// Verify TOTP code
	if !mfa.VerifyTOTPCode(plainSecret, req.Code) {
		respondError(w, http.StatusUnauthorized, "Invalid TOTP code")
		return
	}

	// Code verified - enable MFA
	if err := h.repo.EnableMFATOTP(ctx, claims.UserID, time.Now()); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to enable MFA")
		return
	}

	h.logAuthEvent(ctx, "mfa_enabled", claims.Username, h.getIP(r), r.Header.Get("User-Agent"), &claims.UserID, "")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"message":"MFA verified and enabled successfully"}`))
}

// MFAEnable enables MFA for user (Phase 5: MFA TOTP)
func (h *AuthHandler) MFAEnable(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		respondError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}

	ctx := r.Context()
	mfaSecret, err := h.repo.GetMFATOTPSecret(ctx, claims.UserID)
	if err != nil || mfaSecret == nil {
		respondError(w, http.StatusBadRequest, "MFA not set up. Call /auth/mfa/setup first.")
		return
	}

	if mfaSecret.Enabled {
		respondError(w, http.StatusBadRequest, "MFA already enabled")
		return
	}

	// MFA should be verified first via /auth/mfa/verify
	// This endpoint is for re-enabling if disabled
	if mfaSecret.VerifiedAt == nil {
		respondError(w, http.StatusBadRequest, "MFA must be verified first. Call /auth/mfa/verify.")
		return
	}

	if err := h.repo.EnableMFATOTP(ctx, claims.UserID, time.Now()); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to enable MFA")
		return
	}

	h.logAuthEvent(ctx, "mfa_enabled", claims.Username, h.getIP(r), r.Header.Get("User-Agent"), &claims.UserID, "")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"message":"MFA enabled successfully"}`))
}

// MFADisableRequest is the body for POST /auth/mfa/disable
type MFADisableRequest struct {
	Password string `json:"password"` // Current password required to disable MFA
}

// MFADisable disables MFA for user (Phase 5: MFA TOTP)
func (h *AuthHandler) MFADisable(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		respondError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}

	var req MFADisableRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.Password == "" {
		respondError(w, http.StatusBadRequest, "password required")
		return
	}

	ctx := r.Context()
	user, err := h.repo.GetUserByID(ctx, claims.UserID)
	if err != nil || user == nil {
		respondError(w, http.StatusUnauthorized, "User not found")
		return
	}

	// Verify password
	if err := auth.CheckPassword(user.PasswordHash, req.Password); err != nil {
		h.logAuthEvent(ctx, "mfa_disable_failure", user.Username, h.getIP(r), r.Header.Get("User-Agent"), &user.ID, "wrong_password")
		respondError(w, http.StatusUnauthorized, "Invalid password")
		return
	}

	// Check if MFA is enforced
	if h.isMFARequired(user.Role) {
		respondError(w, http.StatusForbidden, "MFA is required for your role and cannot be disabled")
		return
	}

	// Disable MFA
	if err := h.repo.DisableMFATOTP(ctx, claims.UserID); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to disable MFA")
		return
	}

	h.logAuthEvent(ctx, "mfa_disabled", user.Username, h.getIP(r), r.Header.Get("User-Agent"), &user.ID, "")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"message":"MFA disabled successfully"}`))
}

// MFAGetBackupCodesResponse is the response for GET /auth/mfa/backup-codes
type MFAGetBackupCodesResponse struct {
	Count int `json:"count"` // Number of unused backup codes
}

// MFAGetBackupCodes gets count of unused backup codes (Phase 5: MFA TOTP)
func (h *AuthHandler) MFAGetBackupCodes(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		respondError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}

	ctx := r.Context()
	codes, err := h.repo.GetMFABackupCodes(ctx, claims.UserID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to get backup codes")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(MFAGetBackupCodesResponse{
		Count: len(codes),
	})
}

// MFARegenerateBackupCodesResponse is the response for POST /auth/mfa/regenerate-backup-codes
type MFARegenerateBackupCodesResponse struct {
	BackupCodes []string `json:"backup_codes"` // New backup codes
}

// MFARegenerateBackupCodes regenerates backup codes (Phase 5: MFA TOTP)
func (h *AuthHandler) MFARegenerateBackupCodes(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		respondError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}

	ctx := r.Context()
	mfaSecret, err := h.repo.GetMFATOTPSecret(ctx, claims.UserID)
	if err != nil || mfaSecret == nil || !mfaSecret.Enabled {
		respondError(w, http.StatusBadRequest, "MFA not enabled")
		return
	}

	// Delete old backup codes
	if err := h.repo.DeleteUserMFABackupCodes(ctx, claims.UserID); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to delete old backup codes")
		return
	}

	// Generate new backup codes
	backupCodes, err := mfa.GenerateBackupCodes(10)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to generate backup codes")
		return
	}

	// Hash and store backup codes
	codeHashes := make([]string, len(backupCodes))
	for i, code := range backupCodes {
		hash, err := mfa.HashBackupCode(code)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to hash backup code")
			return
		}
		codeHashes[i] = hash
	}
	if err := h.repo.CreateMFABackupCodes(ctx, claims.UserID, codeHashes); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to save backup codes")
		return
	}

	h.logAuthEvent(ctx, "mfa_backup_codes_regenerated", claims.Username, h.getIP(r), r.Header.Get("User-Agent"), &claims.UserID, "")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(MFARegenerateBackupCodesResponse{
		BackupCodes: backupCodes,
	})
}

// ForgotPasswordRequest is the body for POST /auth/forgot-password
type ForgotPasswordRequest struct {
	Username string `json:"username"` // Username or email
}

// ForgotPassword initiates password reset flow (Phase 5: Account Recovery)
func (h *AuthHandler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	if h.cfg.AuthMode == "disabled" {
		respondError(w, http.StatusBadRequest, "Authentication is disabled")
		return
	}

	var req ForgotPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.Username == "" {
		respondError(w, http.StatusBadRequest, "username required")
		return
	}

	ctx := r.Context()
	ip := h.getIP(r)

	// Rate limiting: max 3 requests per hour per user
	user, err := h.repo.GetUserByUsername(ctx, req.Username)
	if err == nil && user != nil {
		since := time.Now().Add(-1 * time.Hour)
		count, _ := h.repo.CountPasswordResetTokensForUser(ctx, user.ID, since)
		if count >= 3 {
			respondError(w, http.StatusTooManyRequests, "Too many password reset requests. Please try again later.")
			return
		}
	}

	// Always return success (prevent username enumeration)
	// In production, would send email here
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"message":"If the username exists, a password reset link has been sent"}`))

	// If user exists, create reset token
	if user != nil {
		// Generate secure random token using UUIDs
		tokenPlaintext := uuid.New().String() + uuid.New().String()

		// Hash token for storage
		tokenHash, err := auth.HashPassword(tokenPlaintext)
		if err == nil {
			resetToken := &models.PasswordResetToken{
				UserID:    user.ID,
				TokenHash: tokenHash,
				ExpiresAt: time.Now().Add(1 * time.Hour), // Token expires in 1 hour
				CreatedAt: time.Now(),
			}
			if err := h.repo.CreatePasswordResetToken(ctx, resetToken); err == nil {
				// In production: send email with reset link containing tokenPlaintext
				// For now, log it (in production, never log tokens)
				log.Printf("[password-reset] Token for user %s: %s (expires in 1 hour)", user.Username, tokenPlaintext)
				h.logAuthEvent(ctx, "password_reset_requested", user.Username, ip, r.Header.Get("User-Agent"), &user.ID, "")
			}
		}
	}
}

// ResetPasswordRequest is the body for POST /auth/reset-password
type ResetPasswordRequest struct {
	Token       string `json:"token"`        // Password reset token
	NewPassword string `json:"new_password"` // New password
}

// ResetPassword resets password using reset token (Phase 5: Account Recovery)
func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	if h.cfg.AuthMode == "disabled" {
		respondError(w, http.StatusBadRequest, "Authentication is disabled")
		return
	}

	var req ResetPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.Token == "" || req.NewPassword == "" {
		respondError(w, http.StatusBadRequest, "token and new_password required")
		return
	}

	ctx := r.Context()
	ip := h.getIP(r)

	// Find token by checking all stored hashes
	// Note: bcrypt hashes are different each time, so we need to check all tokens
	var resetToken *models.PasswordResetToken
	allTokens, err := h.repo.ListActivePasswordResetTokens(ctx)
	if err == nil {
		for _, t := range allTokens {
			if err := auth.CheckPassword(t.TokenHash, req.Token); err == nil {
				resetToken = t
				break
			}
		}
	}

	if resetToken == nil || !resetToken.IsValid() {
		respondError(w, http.StatusBadRequest, "Invalid or expired reset token")
		return
	}

	// Get user
	user, err := h.repo.GetUserByID(ctx, resetToken.UserID)
	if err != nil || user == nil {
		respondError(w, http.StatusBadRequest, "User not found")
		return
	}

	// Validate new password
	policy := auth.PasswordPolicy{
		MinLength:        h.cfg.PasswordMinLength,
		RequireUppercase: h.cfg.PasswordRequireUppercase,
		RequireLowercase: h.cfg.PasswordRequireLowercase,
		RequireNumbers:   h.cfg.PasswordRequireNumbers,
		RequireSpecial:   h.cfg.PasswordRequireSpecial,
	}
	if err := auth.ValidatePassword(req.NewPassword, policy); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Check common passwords
	if auth.CheckCommonPasswords(req.NewPassword) {
		respondError(w, http.StatusBadRequest, "Password is too common. Please choose a more unique password.")
		return
	}

	// Hash new password
	newHash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to hash password")
		return
	}

	// Check password history
	historyCount := h.cfg.PasswordHistoryCount
	if historyCount > 0 {
		inHistory, err := h.repo.CheckPasswordInHistory(ctx, user.ID, newHash, historyCount)
		if err == nil && inHistory {
			respondError(w, http.StatusBadRequest, fmt.Sprintf("Password cannot be one of your last %d passwords", historyCount))
			return
		}
	}

	// Update password
	if err := h.repo.UpdateUserPassword(ctx, user.ID, newHash); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to update password")
		return
	}

	// Mark token as used
	_ = h.repo.MarkPasswordResetTokenUsed(ctx, resetToken.ID)

	// Add to password history
	if historyCount > 0 {
		_ = h.repo.CreatePasswordHistory(ctx, user.ID, newHash)
		_ = h.repo.CleanupOldPasswordHistory(ctx, user.ID, historyCount+1)
	}

	// Revoke all user tokens
	_ = h.repo.RevokeAllUserTokens(ctx, user.ID, "password_reset")

	h.logAuthEvent(ctx, "password_reset", user.Username, ip, r.Header.Get("User-Agent"), &user.ID, "")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"message":"Password reset successfully"}`))
}

// SetUserNamespacePermissionRequest is the body for POST /users/{userId}/namespace-permissions
type SetUserNamespacePermissionRequest struct {
	ClusterID string `json:"cluster_id"`
	Namespace string `json:"namespace"` // '*' for all namespaces
	Role      string `json:"role"`      // viewer | operator | admin
}

// SetUserNamespacePermission sets a namespace-level permission (Phase 3: Advanced RBAC)
func (h *AuthHandler) SetUserNamespacePermission(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != auth.RoleAdmin {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}

	vars := mux.Vars(r)
	userID := vars["userId"]

	var req SetUserNamespacePermissionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.ClusterID == "" || req.Namespace == "" || req.Role == "" {
		respondError(w, http.StatusBadRequest, "cluster_id, namespace, and role are required")
		return
	}

	if req.Role != "viewer" && req.Role != "operator" && req.Role != "admin" {
		respondError(w, http.StatusBadRequest, "role must be viewer, operator, or admin")
		return
	}

	perm := &models.NamespacePermission{
		UserID:    userID,
		ClusterID: req.ClusterID,
		Namespace: req.Namespace,
		Role:      req.Role,
		CreatedAt: time.Now(),
	}

	// Delete existing permission if exists
	_ = h.repo.DeleteNamespacePermissionByUserClusterNamespace(r.Context(), userID, req.ClusterID, req.Namespace)

	if err := h.repo.CreateNamespacePermission(r.Context(), perm); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to create namespace permission: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(perm)
}

// ListUserNamespacePermissions lists namespace permissions for a user (Phase 3: Advanced RBAC)
func (h *AuthHandler) ListUserNamespacePermissions(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		respondError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}

	vars := mux.Vars(r)
	userID := vars["userId"]

	// Users can only view their own permissions unless admin
	if claims.UserID != userID && claims.Role != auth.RoleAdmin {
		respondError(w, http.StatusForbidden, "Cannot view other user's permissions")
		return
	}

	perms, err := h.repo.ListNamespacePermissionsByUser(r.Context(), userID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to list namespace permissions")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(perms)
}

// DeleteUserNamespacePermission deletes a namespace permission (Phase 3: Advanced RBAC)
func (h *AuthHandler) DeleteUserNamespacePermission(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != auth.RoleAdmin {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}

	vars := mux.Vars(r)
	userID := vars["userId"]
	clusterID := vars["clusterId"]
	namespace := vars["namespace"]

	if err := h.repo.DeleteNamespacePermissionByUserClusterNamespace(r.Context(), userID, clusterID, namespace); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to delete namespace permission")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
