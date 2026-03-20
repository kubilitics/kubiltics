package oidc

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
	"golang.org/x/oauth2"
)

// Provider wraps OIDC provider and OAuth2 config
type Provider struct {
	provider     *oidc.Provider
	oauth2Config *oauth2.Config
	verifier     *oidc.IDTokenVerifier
	cfg          *config.Config
	repo         *repository.SQLiteRepository
	roleMapping  map[string]string // OIDC group -> kubilitics role
	stateStore   map[string]time.Time
	mu           sync.RWMutex
}

// NewProvider creates a new OIDC provider
func NewProvider(ctx context.Context, cfg *config.Config, repo *repository.SQLiteRepository) (*Provider, error) {
	if !cfg.OIDCEnabled || cfg.OIDCIssuerURL == "" {
		return nil, fmt.Errorf("OIDC not enabled or issuer URL not configured")
	}

	provider, err := oidc.NewProvider(ctx, cfg.OIDCIssuerURL)
	if err != nil {
		return nil, fmt.Errorf("failed to create OIDC provider: %w", err)
	}

	scopes := strings.Split(cfg.OIDCScopes, ",")
	for i := range scopes {
		scopes[i] = strings.TrimSpace(scopes[i])
	}
	if len(scopes) == 0 || scopes[0] == "" {
		scopes = []string{oidc.ScopeOpenID, "profile", "email"}
	}

	oauth2Config := &oauth2.Config{
		ClientID:     cfg.OIDCClientID,
		ClientSecret: cfg.OIDCClientSecret,
		RedirectURL:  cfg.OIDCRedirectURL,
		Endpoint:     provider.Endpoint(),
		Scopes:       scopes,
	}

	verifier := provider.Verifier(&oidc.Config{
		ClientID: cfg.OIDCClientID,
	})

	// Parse role mapping
	roleMapping := make(map[string]string)
	if cfg.OIDCRoleMapping != "" {
		if err := json.Unmarshal([]byte(cfg.OIDCRoleMapping), &roleMapping); err != nil {
			log.Printf("Failed to parse OIDC role mapping: %v", err)
		}
	}

	p := &Provider{
		provider:     provider,
		oauth2Config: oauth2Config,
		verifier:     verifier,
		cfg:          cfg,
		repo:         repo,
		roleMapping:  roleMapping,
		stateStore:   make(map[string]time.Time),
	}

	// Cleanup expired states every 10 minutes
	go p.cleanupStates()

	return p, nil
}

// GenerateState generates a random state token for OAuth2 flow
func (p *Provider) GenerateState() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	state := base64.URLEncoding.EncodeToString(b)
	p.mu.Lock()
	p.stateStore[state] = time.Now().Add(10 * time.Minute) // State expires in 10 minutes
	p.mu.Unlock()
	return state, nil
}

// ValidateState validates and consumes a state token
func (p *Provider) ValidateState(state string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	expiry, exists := p.stateStore[state]
	if !exists {
		return false
	}
	if time.Now().After(expiry) {
		delete(p.stateStore, state)
		return false
	}
	delete(p.stateStore, state)
	return true
}

// cleanupStates removes expired states periodically
func (p *Provider) cleanupStates() {
	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		p.mu.Lock()
		now := time.Now()
		for state, expiry := range p.stateStore {
			if now.After(expiry) {
				delete(p.stateStore, state)
			}
		}
		p.mu.Unlock()
	}
}

// AuthCodeURL returns the OAuth2 authorization URL
func (p *Provider) AuthCodeURL(state string) string {
	return p.oauth2Config.AuthCodeURL(state, oauth2.AccessTypeOnline)
}

// ExchangeCode exchanges authorization code for tokens
func (p *Provider) ExchangeCode(ctx context.Context, code string) (*oauth2.Token, error) {
	return p.oauth2Config.Exchange(ctx, code)
}

// VerifyIDToken verifies and extracts claims from ID token
func (p *Provider) VerifyIDToken(ctx context.Context, token *oauth2.Token) (*oidc.IDToken, map[string]interface{}, error) {
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok {
		return nil, nil, fmt.Errorf("id_token not found in token response")
	}

	idToken, err := p.verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to verify ID token: %w", err)
	}

	var claims map[string]interface{}
	if err := idToken.Claims(&claims); err != nil {
		return nil, nil, fmt.Errorf("failed to parse ID token claims: %w", err)
	}

	return idToken, claims, nil
}

// GetUserInfo fetches user info from OIDC provider
func (p *Provider) GetUserInfo(ctx context.Context, token *oauth2.Token) (*oidc.UserInfo, error) {
	return p.provider.UserInfo(ctx, oauth2.StaticTokenSource(token))
}

// MapOIDCUserToKubiliticsUser creates or updates a kubilitics user from OIDC claims
func (p *Provider) MapOIDCUserToKubiliticsUser(ctx context.Context, claims map[string]interface{}, userInfo *oidc.UserInfo) (*models.User, error) {
	// Extract user identifier (prefer email, fallback to sub)
	email := ""
	if userInfo != nil && userInfo.Email != "" {
		email = userInfo.Email
	} else if e, ok := claims["email"].(string); ok {
		email = e
	}

	sub := ""
	if s, ok := claims["sub"].(string); ok {
		sub = s
	}

	if email == "" && sub == "" {
		return nil, fmt.Errorf("no email or sub claim found")
	}

	username := email
	if username == "" {
		username = sub
	}

	// Extract groups
	groups := []string{}
	if p.cfg.OIDCGroupClaim != "" {
		if g, ok := claims[p.cfg.OIDCGroupClaim].([]interface{}); ok {
			for _, group := range g {
				if gStr, ok := group.(string); ok {
					groups = append(groups, gStr)
				}
			}
		} else if g, ok := claims[p.cfg.OIDCGroupClaim].(string); ok {
			groups = []string{g}
		}
	}

	// Map groups to role
	role := "viewer" // default role
	for _, group := range groups {
		if mappedRole, ok := p.roleMapping[group]; ok {
			role = mappedRole
			break // Use first match
		}
	}

	// Check if user exists
	user, err := p.repo.GetUserByUsername(ctx, username)
	if err == nil && user != nil {
		// Update existing user (role may have changed)
		if user.Role != role {
			_ = p.repo.UpdateUserRole(ctx, user.ID, role)
			user.Role = role
		}
		return user, nil
	}

	// Create new user (no password - OIDC only)
	// Use sub as ID to ensure uniqueness
	userID := fmt.Sprintf("oidc-%s", sub)
	user = &models.User{
		ID:          userID,
		Username:    username,
		Role:        role,
		PasswordHash: "", // OIDC users don't have passwords - they authenticate via OIDC only
	}

	return user, nil
}
