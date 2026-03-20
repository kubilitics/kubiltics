package saml

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/crewjam/saml"
	"github.com/crewjam/saml/samlsp"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// Provider wraps SAML SP (Service Provider) configuration
type Provider struct {
	serviceProvider *samlsp.Middleware
	cfg             *config.Config
	repo            *repository.SQLiteRepository
	attributeMapping map[string]string // SAML attribute name -> kubilitics field
	roleMapping     map[string]string // SAML group -> kubilitics role
	requestStore    map[string]*AuthnRequest // Store AuthnRequests for validation
	mu              sync.RWMutex
}

// AuthnRequest stores SAML AuthnRequest state
type AuthnRequest struct {
	ID        string
	RelayState string
	CreatedAt time.Time
}

// NewProvider creates a new SAML provider
func NewProvider(ctx context.Context, cfg *config.Config, repo *repository.SQLiteRepository) (*Provider, error) {
	if !cfg.SAMLEnabled || cfg.SAMLIdpMetadataURL == "" {
		return nil, fmt.Errorf("SAML not enabled or IdP metadata URL not configured")
	}

	// Parse SP certificate and key
	certBlock, _ := pem.Decode([]byte(cfg.SAMLCertificate))
	if certBlock == nil {
		return nil, fmt.Errorf("failed to parse SAML certificate")
	}
	cert, err := x509.ParseCertificate(certBlock.Bytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse certificate: %w", err)
	}

	keyBlock, _ := pem.Decode([]byte(cfg.SAMLPrivateKey))
	if keyBlock == nil {
		return nil, fmt.Errorf("failed to parse SAML private key")
	}
	keyInterface, err := x509.ParsePKCS8PrivateKey(keyBlock.Bytes)
	if err != nil {
		// Try PKCS1 format
		keyInterface, err = x509.ParsePKCS1PrivateKey(keyBlock.Bytes)
		if err != nil {
			return nil, fmt.Errorf("failed to parse private key: %w", err)
		}
	}
	
	// Convert to crypto.Signer
	key, ok := keyInterface.(crypto.Signer)
	if !ok {
		return nil, fmt.Errorf("private key does not implement crypto.Signer")
	}

	// Fetch IdP metadata
	idpMetadataURL, err := url.Parse(cfg.SAMLIdpMetadataURL)
	if err != nil {
		return nil, fmt.Errorf("invalid IdP metadata URL: %w", err)
	}

	// Fetch IdP metadata
	httpClient := &http.Client{Timeout: 30 * time.Second}
	idpMetadata, err := samlsp.FetchMetadata(ctx, httpClient, *idpMetadataURL)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch IdP metadata: %w", err)
	}

	// Create SAML SP middleware
	opts := samlsp.Options{
		URL:         *idpMetadataURL,
		Key:         key,
		Certificate: cert,
		IDPMetadata: idpMetadata,
	}

	// Set entity ID if provided
	if cfg.SAMLIdpEntityID != "" {
		opts.EntityID = cfg.SAMLIdpEntityID
	}

	// Create service provider
	sp, err := samlsp.New(opts)
	if err != nil {
		return nil, fmt.Errorf("failed to create SAML SP: %w", err)
	}

	// Parse attribute mapping
	attributeMapping := make(map[string]string)
	if cfg.SAMLAttributeMapping != "" {
		if err := json.Unmarshal([]byte(cfg.SAMLAttributeMapping), &attributeMapping); err != nil {
			log.Printf("Failed to parse SAML attribute mapping: %v", err)
			// Use defaults
			attributeMapping["email"] = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
			attributeMapping["username"] = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"
			attributeMapping["groups"] = "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups"
		}
	} else {
		// Default attribute mapping
		attributeMapping["email"] = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
		attributeMapping["username"] = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"
		attributeMapping["groups"] = "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups"
	}

	// Parse role mapping (from groups)
	roleMapping := make(map[string]string)
	// Role mapping can be part of attribute mapping or separate config
	// For now, we'll extract it from groups attribute

	p := &Provider{
		serviceProvider:  sp,
		cfg:              cfg,
		repo:             repo,
		attributeMapping: attributeMapping,
		roleMapping:      roleMapping,
		requestStore:     make(map[string]*AuthnRequest),
	}

	// Cleanup expired requests every 10 minutes
	go p.cleanupRequests()

	return p, nil
}

// GenerateAuthnRequestID generates a unique ID for AuthnRequest
func (p *Provider) GenerateAuthnRequestID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(b), nil
}

// StoreAuthnRequest stores an AuthnRequest for later validation
func (p *Provider) StoreAuthnRequest(id, relayState string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.requestStore[id] = &AuthnRequest{
		ID:         id,
		RelayState: relayState,
		CreatedAt:  time.Now(),
	}
}

// GetAuthnRequest retrieves an AuthnRequest by ID
func (p *Provider) GetAuthnRequest(id string) (*AuthnRequest, bool) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	req, exists := p.requestStore[id]
	return req, exists
}

// cleanupRequests removes expired AuthnRequests
func (p *Provider) cleanupRequests() {
	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		p.mu.Lock()
		now := time.Now()
		for id, req := range p.requestStore {
			if now.Sub(req.CreatedAt) > 10*time.Minute {
				delete(p.requestStore, id)
			}
		}
		p.mu.Unlock()
	}
}

// MapSAMLUserToKubiliticsUser creates or updates a kubilitics user from SAML assertion
func (p *Provider) MapSAMLUserToKubiliticsUser(ctx context.Context, assertion *saml.Assertion) (*models.User, error) {
	// Extract attributes from assertion
	attributes := make(map[string][]string)
	for _, statement := range assertion.AttributeStatements {
		for _, attr := range statement.Attributes {
			values := make([]string, len(attr.Values))
			for i, v := range attr.Values {
				values[i] = v.Value
			}
			attributes[attr.Name] = values
		}
	}
	
	// Also check NameID as fallback for username/email
	if assertion.Subject != nil && assertion.Subject.NameID != nil {
		if _, ok := attributes["nameid"]; !ok {
			attributes["nameid"] = []string{assertion.Subject.NameID.Value}
		}
	}

	// Extract email
	email := ""
	if emailAttr, ok := attributes[p.attributeMapping["email"]]; ok && len(emailAttr) > 0 {
		email = emailAttr[0]
	} else if emailAttr, ok := attributes["email"]; ok && len(emailAttr) > 0 {
		email = emailAttr[0]
	} else if emailAttr, ok := attributes["EmailAddress"]; ok && len(emailAttr) > 0 {
		email = emailAttr[0]
	}

	if email == "" {
		return nil, fmt.Errorf("email attribute not found in SAML assertion")
	}

	// Extract username (use email if not found)
	username := email
	if usernameAttr, ok := attributes[p.attributeMapping["username"]]; ok && len(usernameAttr) > 0 {
		username = usernameAttr[0]
	} else if usernameAttr, ok := attributes["name"]; ok && len(usernameAttr) > 0 {
		username = usernameAttr[0]
	} else if usernameAttr, ok := attributes["NameID"]; ok && len(usernameAttr) > 0 {
		username = usernameAttr[0]
	}

	// Extract groups
	groups := []string{}
	if groupsAttr, ok := attributes[p.attributeMapping["groups"]]; ok {
		groups = groupsAttr
	} else if groupsAttr, ok := attributes["groups"]; ok {
		groups = groupsAttr
	} else if groupsAttr, ok := attributes["Groups"]; ok {
		groups = groupsAttr
	}

	// Map groups to role
	role := "viewer" // default role
	for _, group := range groups {
		if mappedRole, ok := p.roleMapping[group]; ok {
			role = mappedRole
			break // Use first match
		}
	}

	// Use NameID as user identifier
	userID := fmt.Sprintf("saml-%s", assertion.Subject.NameID.Value)

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

	// Try by ID (for SAML users)
	user, err = p.repo.GetUserByID(ctx, userID)
	if err == nil && user != nil {
		if user.Role != role {
			_ = p.repo.UpdateUserRole(ctx, user.ID, role)
			user.Role = role
		}
		return user, nil
	}

	// Create new user (no password - SAML only)
	user = &models.User{
		ID:           userID,
		Username:     username,
		Role:         role,
		PasswordHash: "", // SAML users don't have passwords
	}

	return user, nil
}

// GetServiceProvider returns the SAML SP middleware
func (p *Provider) GetServiceProvider() *samlsp.Middleware {
	return p.serviceProvider
}

// GetIdpEntityID returns the IdP entity ID
func (p *Provider) GetIdpEntityID() string {
	if p.serviceProvider == nil {
		return ""
	}
	return p.serviceProvider.ServiceProvider.EntityID
}
