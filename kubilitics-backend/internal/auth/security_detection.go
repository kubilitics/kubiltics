package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// SecurityDetectorRepository interface for security detection (to avoid circular dependency)
type SecurityDetectorRepository interface {
	CreateSecurityEvent(ctx context.Context, event *models.SecurityEvent) error
	GetIPSecurityTracking(ctx context.Context, ipAddress string) (*models.IPSecurityTracking, error)
	CreateOrUpdateIPSecurityTracking(ctx context.Context, tracking *models.IPSecurityTracking) error
	IncrementIPFailedLogin(ctx context.Context, ipAddress string) error
	IncrementIPAccountEnumeration(ctx context.Context, ipAddress string) error
	BlockIP(ctx context.Context, ipAddress string, until time.Time) error
	ListSecurityEvents(ctx context.Context, eventType *string, ipAddress *string, since *time.Time, limit int) ([]*models.SecurityEvent, error)
}

const (
	// Security event types
	EventTypeBruteForce          = "brute_force"
	EventTypeCredentialStuffing  = "credential_stuffing"
	EventTypeAccountEnumeration  = "account_enumeration"
	EventTypeSuspiciousActivity  = "suspicious_activity"

	// Thresholds
	BruteForceThreshold          = 5  // Failed logins per IP per 5 minutes
	CredentialStuffingThreshold = 10 // Failed logins per IP per hour
	AccountEnumerationThreshold = 3  // Failed logins with different usernames per IP per 5 minutes
	IPBlockDuration             = 30 * time.Minute
)

// SecurityDetector detects security events and manages IP blocking
type SecurityDetector struct {
	repo SecurityDetectorRepository
}

// NewSecurityDetector creates a new security detector
func NewSecurityDetector(repo SecurityDetectorRepository) *SecurityDetector {
	return &SecurityDetector{repo: repo}
}

// DetectBruteForce detects brute force attacks
func (d *SecurityDetector) DetectBruteForce(ctx context.Context, ipAddress, username string, userAgent string) (bool, error) {
	tracking, err := d.repo.GetIPSecurityTracking(ctx, ipAddress)
	if err != nil {
		return false, err
	}

	if tracking == nil {
		tracking = &models.IPSecurityTracking{
			IPAddress:        ipAddress,
			FailedLoginCount: 0,
			CreatedAt:        time.Now(),
			UpdatedAt:        time.Now(),
		}
	}

	// Check if IP is blocked
	if tracking.IsBlocked() {
		return true, nil
	}

	// Check threshold
	if tracking.FailedLoginCount >= BruteForceThreshold {
		// Block IP
		blockUntil := time.Now().Add(IPBlockDuration)
		if err := d.repo.BlockIP(ctx, ipAddress, blockUntil); err != nil {
			return false, err
		}

		// Log security event
		details, _ := json.Marshal(map[string]interface{}{
			"failed_login_count": tracking.FailedLoginCount,
			"threshold":          BruteForceThreshold,
		})
		event := &models.SecurityEvent{
			EventType: EventTypeBruteForce,
			Username:  username,
			IPAddress: ipAddress,
			UserAgent: userAgent,
			RiskScore: 90,
			Details:   string(details),
			CreatedAt: time.Now(),
		}
		_ = d.repo.CreateSecurityEvent(ctx, event)

		return true, nil
	}

	return false, nil
}

// DetectCredentialStuffing detects credential stuffing attacks
func (d *SecurityDetector) DetectCredentialStuffing(ctx context.Context, ipAddress string, userAgent string) (bool, error) {
	tracking, err := d.repo.GetIPSecurityTracking(ctx, ipAddress)
	if err != nil {
		return false, err
	}

	if tracking == nil {
		return false, nil
	}

	// Check if IP is blocked
	if tracking.IsBlocked() {
		return true, nil
	}

	// Check threshold (failed logins in last hour)
	if tracking.FailedLoginCount >= CredentialStuffingThreshold {
		// Block IP
		blockUntil := time.Now().Add(IPBlockDuration)
		if err := d.repo.BlockIP(ctx, ipAddress, blockUntil); err != nil {
			return false, err
		}

		// Log security event
		details, _ := json.Marshal(map[string]interface{}{
			"failed_login_count": tracking.FailedLoginCount,
			"threshold":          CredentialStuffingThreshold,
		})
		event := &models.SecurityEvent{
			EventType: EventTypeCredentialStuffing,
			IPAddress: ipAddress,
			UserAgent: userAgent,
			RiskScore: 95,
			Details:   string(details),
			CreatedAt: time.Now(),
		}
		_ = d.repo.CreateSecurityEvent(ctx, event)

		return true, nil
	}

	return false, nil
}

// DetectAccountEnumeration detects account enumeration attempts
func (d *SecurityDetector) DetectAccountEnumeration(ctx context.Context, ipAddress, username string, userAgent string) (bool, error) {
	tracking, err := d.repo.GetIPSecurityTracking(ctx, ipAddress)
	if err != nil {
		return false, err
	}

	if tracking == nil {
		return false, nil
	}

	// Check if IP is blocked
	if tracking.IsBlocked() {
		return true, nil
	}

	// Check threshold
	if tracking.AccountEnumerationCount >= AccountEnumerationThreshold {
		// Block IP
		blockUntil := time.Now().Add(IPBlockDuration)
		if err := d.repo.BlockIP(ctx, ipAddress, blockUntil); err != nil {
			return false, err
		}

		// Log security event
		details, _ := json.Marshal(map[string]interface{}{
			"enumeration_count": tracking.AccountEnumerationCount,
			"threshold":         AccountEnumerationThreshold,
		})
		event := &models.SecurityEvent{
			EventType: EventTypeAccountEnumeration,
			Username:  username,
			IPAddress: ipAddress,
			UserAgent: userAgent,
			RiskScore: 85,
			Details:   string(details),
			CreatedAt: time.Now(),
		}
		_ = d.repo.CreateSecurityEvent(ctx, event)

		return true, nil
	}

	return false, nil
}

// RecordFailedLogin records a failed login attempt
func (d *SecurityDetector) RecordFailedLogin(ctx context.Context, ipAddress, username string, userAgent string) error {
	// Increment failed login count
	if err := d.repo.IncrementIPFailedLogin(ctx, ipAddress); err != nil {
		return err
	}

	// Check for brute force
	isBruteForce, err := d.DetectBruteForce(ctx, ipAddress, username, userAgent)
	if err != nil {
		return err
	}
	if isBruteForce {
		return fmt.Errorf("IP blocked due to brute force detection")
	}

	// Check for credential stuffing
	isCredentialStuffing, err := d.DetectCredentialStuffing(ctx, ipAddress, userAgent)
	if err != nil {
		return err
	}
	if isCredentialStuffing {
		return fmt.Errorf("IP blocked due to credential stuffing detection")
	}

	return nil
}

// RecordAccountEnumeration records an account enumeration attempt
func (d *SecurityDetector) RecordAccountEnumeration(ctx context.Context, ipAddress, username string, userAgent string) error {
	// Increment enumeration count
	if err := d.repo.IncrementIPAccountEnumeration(ctx, ipAddress); err != nil {
		return err
	}

	// Check for account enumeration
	isEnumeration, err := d.DetectAccountEnumeration(ctx, ipAddress, username, userAgent)
	if err != nil {
		return err
	}
	if isEnumeration {
		return fmt.Errorf("IP blocked due to account enumeration detection")
	}

	return nil
}
