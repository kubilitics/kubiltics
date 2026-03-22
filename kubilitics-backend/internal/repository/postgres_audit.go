package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// Audit log methods (BE-SEC-002, append-only)

func (r *PostgresRepository) CreateAuditLog(ctx context.Context, e *models.AuditLogEntry) error {
	if e.ID == "" {
		e.ID = uuid.New().String()
	}
	// Phase 6: Enhanced audit log with new fields
	query := `INSERT INTO audit_log (id, timestamp, user_id, username, cluster_id, action, resource_kind, resource_namespace, resource_name, status_code, request_ip, details, session_id, device_info, geolocation, risk_score, correlation_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`
	_, err := r.db.ExecContext(ctx, query,
		e.ID, e.Timestamp, e.UserID, e.Username, e.ClusterID, e.Action,
		e.ResourceKind, e.ResourceNamespace, e.ResourceName, e.StatusCode, e.RequestIP, e.Details,
		e.SessionID, e.DeviceInfo, e.Geolocation, e.RiskScore, e.CorrelationID)
	return err
}

// ListAuditLog lists audit log entries with optional filters (BE-SEC-002).
// Phase 6: Enhanced with new fields
func (r *PostgresRepository) ListAuditLog(ctx context.Context, userID *string, clusterID *string, action *string, since *time.Time, until *time.Time, limit int) ([]*models.AuditLogEntry, error) {
	query := `SELECT id, timestamp, user_id, username, cluster_id, action, resource_kind, resource_namespace, resource_name, status_code, request_ip, details, session_id, device_info, geolocation, risk_score, correlation_id FROM audit_log WHERE 1=1`
	args := []interface{}{}
	paramCount := 1

	if userID != nil && *userID != "" {
		query += ` AND user_id = $` + fmt.Sprint(paramCount)
		args = append(args, *userID)
		paramCount++
	}
	if clusterID != nil && *clusterID != "" {
		query += ` AND cluster_id = $` + fmt.Sprint(paramCount)
		args = append(args, *clusterID)
		paramCount++
	}
	if action != nil && *action != "" {
		query += ` AND action = $` + fmt.Sprint(paramCount)
		args = append(args, *action)
		paramCount++
	}
	if since != nil {
		query += ` AND timestamp >= $` + fmt.Sprint(paramCount)
		args = append(args, *since)
		paramCount++
	}
	if until != nil {
		query += ` AND timestamp <= $` + fmt.Sprint(paramCount)
		args = append(args, *until)
		paramCount++
	}
	query += ` ORDER BY timestamp DESC LIMIT $` + fmt.Sprint(paramCount)
	if limit <= 0 {
		limit = 100
	}
	args = append(args, limit)

	var entries []*models.AuditLogEntry
	err := r.db.SelectContext(ctx, &entries, query, args...)
	return entries, err
}

// Security event detection methods (Phase 5: Security Event Detection)

// CreateSecurityEvent creates a security event
func (r *PostgresRepository) CreateSecurityEvent(ctx context.Context, event *models.SecurityEvent) error {
	if event.ID == "" {
		event.ID = uuid.New().String()
	}
	query := `INSERT INTO security_events (id, event_type, user_id, username, ip_address, user_agent, cluster_id, resource_type, resource_name, action, risk_score, details, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`
	_, err := r.db.ExecContext(ctx, query, event.ID, event.EventType, event.UserID, event.Username, event.IPAddress, event.UserAgent, event.ClusterID, event.ResourceType, event.ResourceName, event.Action, event.RiskScore, event.Details, event.CreatedAt)
	return err
}

// ListSecurityEvents lists security events
func (r *PostgresRepository) ListSecurityEvents(ctx context.Context, eventType *string, ipAddress *string, since *time.Time, limit int) ([]*models.SecurityEvent, error) {
	if limit <= 0 {
		limit = 100
	}
	query := `SELECT id, event_type, user_id, username, ip_address, user_agent, cluster_id, resource_type, resource_name, action, risk_score, details, created_at FROM security_events WHERE 1=1`
	args := []interface{}{}
	paramCount := 1

	if eventType != nil {
		query += ` AND event_type = $` + fmt.Sprint(paramCount)
		args = append(args, *eventType)
		paramCount++
	}
	if ipAddress != nil {
		query += ` AND ip_address = $` + fmt.Sprint(paramCount)
		args = append(args, *ipAddress)
		paramCount++
	}
	if since != nil {
		query += ` AND created_at >= $` + fmt.Sprint(paramCount)
		args = append(args, *since)
		paramCount++
	}
	query += ` ORDER BY created_at DESC LIMIT $` + fmt.Sprint(paramCount)
	args = append(args, limit)

	var events []*models.SecurityEvent
	err := r.db.SelectContext(ctx, &events, query, args...)
	return events, err
}

// IP Security Tracking methods

// GetIPSecurityTracking gets IP security tracking
func (r *PostgresRepository) GetIPSecurityTracking(ctx context.Context, ipAddress string) (*models.IPSecurityTracking, error) {
	var tracking models.IPSecurityTracking
	query := `SELECT ip_address, failed_login_count, last_failed_login, account_enumeration_count, last_enumeration_attempt, blocked_until, created_at, updated_at FROM ip_security_tracking WHERE ip_address = $1`
	err := r.db.GetContext(ctx, &tracking, query, ipAddress)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &tracking, nil
}

// CreateOrUpdateIPSecurityTracking creates or updates IP security tracking
func (r *PostgresRepository) CreateOrUpdateIPSecurityTracking(ctx context.Context, tracking *models.IPSecurityTracking) error {
	tracking.UpdatedAt = time.Now()
	query := `INSERT INTO ip_security_tracking (ip_address, failed_login_count, last_failed_login, account_enumeration_count, last_enumeration_attempt, blocked_until, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, COALESCE((SELECT created_at FROM ip_security_tracking WHERE ip_address = $1), NOW()), $7)
		ON CONFLICT (ip_address) DO UPDATE SET
			failed_login_count = $2,
			last_failed_login = $3,
			account_enumeration_count = $4,
			last_enumeration_attempt = $5,
			blocked_until = $6,
			updated_at = $7`
	_, err := r.db.ExecContext(ctx, query, tracking.IPAddress, tracking.FailedLoginCount, tracking.LastFailedLogin, tracking.AccountEnumerationCount, tracking.LastEnumerationAttempt, tracking.BlockedUntil, tracking.UpdatedAt)
	return err
}

// IncrementIPFailedLogin increments failed login count for an IP
func (r *PostgresRepository) IncrementIPFailedLogin(ctx context.Context, ipAddress string) error {
	now := time.Now()
	query := `INSERT INTO ip_security_tracking (ip_address, failed_login_count, last_failed_login, created_at, updated_at)
		VALUES ($1, 1, $2, NOW(), NOW())
		ON CONFLICT (ip_address) DO UPDATE SET
			failed_login_count = ip_security_tracking.failed_login_count + 1,
			last_failed_login = $2,
			updated_at = NOW()`
	_, err := r.db.ExecContext(ctx, query, ipAddress, now)
	return err
}

// IncrementIPAccountEnumeration increments account enumeration count for an IP
func (r *PostgresRepository) IncrementIPAccountEnumeration(ctx context.Context, ipAddress string) error {
	now := time.Now()
	query := `INSERT INTO ip_security_tracking (ip_address, account_enumeration_count, last_enumeration_attempt, created_at, updated_at)
		VALUES ($1, 1, $2, NOW(), NOW())
		ON CONFLICT (ip_address) DO UPDATE SET
			account_enumeration_count = ip_security_tracking.account_enumeration_count + 1,
			last_enumeration_attempt = $2,
			updated_at = NOW()`
	_, err := r.db.ExecContext(ctx, query, ipAddress, now)
	return err
}

// BlockIP blocks an IP address until a specified time
func (r *PostgresRepository) BlockIP(ctx context.Context, ipAddress string, until time.Time) error {
	query := `INSERT INTO ip_security_tracking (ip_address, blocked_until, created_at, updated_at)
		VALUES ($1, $2, NOW(), NOW())
		ON CONFLICT (ip_address) DO UPDATE SET
			blocked_until = $2,
			updated_at = NOW()`
	_, err := r.db.ExecContext(ctx, query, ipAddress, until)
	return err
}

// ListBlockedIPs lists currently blocked IP addresses
func (r *PostgresRepository) ListBlockedIPs(ctx context.Context) ([]*models.IPSecurityTracking, error) {
	var ips []*models.IPSecurityTracking
	query := `SELECT ip_address, failed_login_count, last_failed_login, account_enumeration_count, last_enumeration_attempt, blocked_until, created_at, updated_at FROM ip_security_tracking WHERE blocked_until IS NOT NULL AND blocked_until > NOW()`
	err := r.db.SelectContext(ctx, &ips, query)
	return ips, err
}

// UnblockIP unblocks an IP address
func (r *PostgresRepository) UnblockIP(ctx context.Context, ipAddress string) error {
	query := `UPDATE ip_security_tracking SET blocked_until = NULL, updated_at = NOW() WHERE ip_address = $1`
	_, err := r.db.ExecContext(ctx, query, ipAddress)
	return err
}

// CleanupOldIPSecurityTracking cleans up old IP tracking records (older than 30 days and not blocked)
func (r *PostgresRepository) CleanupOldIPSecurityTracking(ctx context.Context) error {
	query := `DELETE FROM ip_security_tracking WHERE (blocked_until IS NULL OR blocked_until < NOW()) AND updated_at < NOW() - INTERVAL '30 days'`
	_, err := r.db.ExecContext(ctx, query)
	return err
}
