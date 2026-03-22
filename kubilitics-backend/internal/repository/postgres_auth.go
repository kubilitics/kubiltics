package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/auth/mfa"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// User methods (BE-AUTH-001)

func (r *PostgresRepository) CreateUser(ctx context.Context, u *models.User) error {
	if u.ID == "" {
		u.ID = uuid.New().String()
	}
	query := `INSERT INTO users (id, username, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5)`
	_, err := r.db.ExecContext(ctx, query, u.ID, u.Username, u.PasswordHash, u.Role, u.CreatedAt)
	return err
}

func (r *PostgresRepository) GetUserByUsername(ctx context.Context, username string) (*models.User, error) {
	var u models.User
	err := r.db.GetContext(ctx, &u, `SELECT id, username, password_hash, role, created_at, last_login, locked_until, failed_login_count, last_failed_login, deleted_at FROM users WHERE username = $1 AND deleted_at IS NULL`, username)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *PostgresRepository) GetUserByID(ctx context.Context, id string) (*models.User, error) {
	var u models.User
	err := r.db.GetContext(ctx, &u, `SELECT id, username, password_hash, role, created_at, last_login, locked_until, failed_login_count, last_failed_login, deleted_at FROM users WHERE id = $1 AND deleted_at IS NULL`, id)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *PostgresRepository) UpdateUserLastLogin(ctx context.Context, id string, t time.Time) error {
	_, err := r.db.ExecContext(ctx, `UPDATE users SET last_login = $1 WHERE id = $2`, t, id)
	return err
}

func (r *PostgresRepository) CountUsers(ctx context.Context) (int, error) {
	var n int
	err := r.db.GetContext(ctx, &n, `SELECT COUNT(*) FROM users WHERE deleted_at IS NULL`)
	return n, err
}

func (r *PostgresRepository) ListUsers(ctx context.Context) ([]*models.User, error) {
	var users []*models.User
	err := r.db.SelectContext(ctx, &users, `SELECT id, username, password_hash, role, created_at, last_login, locked_until, failed_login_count, last_failed_login, deleted_at FROM users WHERE deleted_at IS NULL ORDER BY username`)
	return users, err
}

func (r *PostgresRepository) UpdateUserRole(ctx context.Context, userID, role string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE users SET role = $1 WHERE id = $2`, role, userID)
	return err
}

func (r *PostgresRepository) DeleteUser(ctx context.Context, userID string) error {
	// BE-FUNC-004: Soft delete (set deleted_at) instead of hard delete
	now := time.Now()
	_, err := r.db.ExecContext(ctx, `UPDATE users SET deleted_at = $1 WHERE id = $2`, now, userID)
	return err
}

// Auth security methods (BE-AUTH-002)

func (r *PostgresRepository) IncrementFailedLogin(ctx context.Context, userID string) error {
	now := time.Now()
	_, err := r.db.ExecContext(ctx, `UPDATE users SET failed_login_count = failed_login_count + 1, last_failed_login = $1 WHERE id = $2`, now, userID)
	return err
}

func (r *PostgresRepository) ResetFailedLogin(ctx context.Context, userID string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE users SET failed_login_count = 0, last_failed_login = NULL WHERE id = $1`, userID)
	return err
}

func (r *PostgresRepository) LockUser(ctx context.Context, userID string, until time.Time) error {
	_, err := r.db.ExecContext(ctx, `UPDATE users SET locked_until = $1 WHERE id = $2`, until, userID)
	return err
}

func (r *PostgresRepository) UnlockUser(ctx context.Context, userID string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE users SET locked_until = NULL, failed_login_count = 0, last_failed_login = NULL WHERE id = $1`, userID)
	return err
}

func (r *PostgresRepository) UpdateUserPassword(ctx context.Context, userID, passwordHash string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE users SET password_hash = $1 WHERE id = $2`, passwordHash, userID)
	return err
}

// Auth event methods

func (r *PostgresRepository) CreateAuthEvent(ctx context.Context, e *models.AuthEvent) error {
	if e.ID == "" {
		e.ID = uuid.New().String()
	}
	query := `INSERT INTO auth_events (id, user_id, username, event_type, ip_address, user_agent, timestamp, details) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`
	_, err := r.db.ExecContext(ctx, query, e.ID, e.UserID, e.Username, e.EventType, e.IPAddress, e.UserAgent, e.Timestamp, e.Details)
	return err
}

func (r *PostgresRepository) ListAuthEvents(ctx context.Context, userID *string, eventType *string, limit int) ([]*models.AuthEvent, error) {
	query := `SELECT id, user_id, username, event_type, ip_address, user_agent, timestamp, details FROM auth_events WHERE 1=1`
	args := []interface{}{}
	paramCount := 1

	if userID != nil {
		query += ` AND user_id = $` + fmt.Sprint(paramCount)
		args = append(args, *userID)
		paramCount++
	}
	if eventType != nil {
		query += ` AND event_type = $` + fmt.Sprint(paramCount)
		args = append(args, *eventType)
		paramCount++
	}
	query += ` ORDER BY timestamp DESC LIMIT $` + fmt.Sprint(paramCount)
	args = append(args, limit)

	var events []*models.AuthEvent
	err := r.db.SelectContext(ctx, &events, query, args...)
	return events, err
}

// API key methods (BE-AUTH-003)

func (r *PostgresRepository) CreateAPIKey(ctx context.Context, key *models.APIKey) error {
	if key.ID == "" {
		key.ID = uuid.New().String()
	}
	query := `INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, last_used, expires_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`
	_, err := r.db.ExecContext(ctx, query, key.ID, key.UserID, key.KeyHash, key.KeyPrefix, key.Name, key.LastUsed, key.ExpiresAt, key.CreatedAt)
	return err
}

func (r *PostgresRepository) GetAPIKeyByHash(ctx context.Context, keyHash string) (*models.APIKey, error) {
	var key models.APIKey
	err := r.db.GetContext(ctx, &key, `SELECT id, user_id, key_hash, name, last_used, expires_at, created_at FROM api_keys WHERE key_hash = $1`, keyHash)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &key, nil
}

func (r *PostgresRepository) ListAPIKeysByUser(ctx context.Context, userID string) ([]*models.APIKey, error) {
	var keys []*models.APIKey
	err := r.db.SelectContext(ctx, &keys, `SELECT id, user_id, key_hash, name, last_used, expires_at, created_at FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`, userID)
	return keys, err
}

func (r *PostgresRepository) UpdateAPIKeyLastUsed(ctx context.Context, keyID string) error {
	now := time.Now()
	_, err := r.db.ExecContext(ctx, `UPDATE api_keys SET last_used = $1 WHERE id = $2`, now, keyID)
	return err
}

func (r *PostgresRepository) DeleteAPIKey(ctx context.Context, keyID string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM api_keys WHERE id = $1`, keyID)
	return err
}

// FindAPIKeyByPlaintext finds an API key by prefix-indexed lookup then bcrypt verification (BE-AUTH-003).
// Uses key_prefix (SHA-256 prefix) for O(1) DB lookup, then bcrypt-verifies the match.
// Falls back to full-table scan for legacy keys without a prefix (created before migration 041).
func (r *PostgresRepository) FindAPIKeyByPlaintext(ctx context.Context, plaintextKey string) (*models.APIKey, error) {
	prefix := auth.APIKeyPrefix(plaintextKey)

	// Fast path: query by prefix index (O(1) with idx_api_keys_prefix)
	var candidates []*models.APIKey
	err := r.db.SelectContext(ctx, &candidates,
		`SELECT id, user_id, key_hash, key_prefix, name, last_used, expires_at, created_at FROM api_keys WHERE key_prefix = $1`, prefix)
	if err != nil {
		return nil, err
	}
	for _, key := range candidates {
		if err := auth.CheckAPIKey(key.KeyHash, plaintextKey); err == nil {
			return key, nil
		}
	}

	// Slow path: legacy keys with empty prefix (created before migration 041).
	// Check only un-prefixed keys to avoid re-checking prefixed ones.
	var legacy []*models.APIKey
	err = r.db.SelectContext(ctx, &legacy,
		`SELECT id, user_id, key_hash, key_prefix, name, last_used, expires_at, created_at FROM api_keys WHERE key_prefix = ''`)
	if err != nil {
		return nil, err
	}
	for _, key := range legacy {
		if err := auth.CheckAPIKey(key.KeyHash, plaintextKey); err == nil {
			// Backfill prefix for future fast lookups
			_, _ = r.db.ExecContext(ctx, `UPDATE api_keys SET key_prefix = $1 WHERE id = $2`, prefix, key.ID)
			key.KeyPrefix = prefix
			return key, nil
		}
	}

	return nil, sql.ErrNoRows
}

// Session management methods (Phase 4: Session Management)

// CreateSession creates a new session
func (r *PostgresRepository) CreateSession(ctx context.Context, session *models.Session) error {
	if session.ID == "" {
		session.ID = uuid.New().String()
	}
	query := `INSERT INTO sessions (id, user_id, token_id, device_info, ip_address, user_agent, created_at, last_activity, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`
	_, err := r.db.ExecContext(ctx, query, session.ID, session.UserID, session.TokenID, session.DeviceInfo, session.IPAddress, session.UserAgent, session.CreatedAt, session.LastActivity, session.ExpiresAt)
	return err
}

// GetSessionByTokenID gets a session by token ID
func (r *PostgresRepository) GetSessionByTokenID(ctx context.Context, tokenID string) (*models.Session, error) {
	var session models.Session
	err := r.db.GetContext(ctx, &session, `SELECT id, user_id, token_id, device_info, ip_address, user_agent, created_at, last_activity, expires_at FROM sessions WHERE token_id = $1`, tokenID)
	if err != nil {
		return nil, err
	}
	return &session, nil
}

// UpdateSessionActivity updates the last activity time for a session
func (r *PostgresRepository) UpdateSessionActivity(ctx context.Context, sessionID string) error {
	query := `UPDATE sessions SET last_activity = NOW() WHERE id = $1`
	_, err := r.db.ExecContext(ctx, query, sessionID)
	return err
}

// ListUserSessions lists all active sessions for a user
func (r *PostgresRepository) ListUserSessions(ctx context.Context, userID string) ([]*models.Session, error) {
	var sessions []*models.Session
	query := `SELECT id, user_id, token_id, device_info, ip_address, user_agent, created_at, last_activity, expires_at FROM sessions WHERE user_id = $1 AND expires_at > NOW() ORDER BY last_activity DESC`
	err := r.db.SelectContext(ctx, &sessions, query, userID)
	return sessions, err
}

// DeleteSession deletes a session
func (r *PostgresRepository) DeleteSession(ctx context.Context, sessionID string) error {
	query := `DELETE FROM sessions WHERE id = $1`
	_, err := r.db.ExecContext(ctx, query, sessionID)
	return err
}

// DeleteUserSessions deletes all sessions for a user
func (r *PostgresRepository) DeleteUserSessions(ctx context.Context, userID string) error {
	query := `DELETE FROM sessions WHERE user_id = $1`
	_, err := r.db.ExecContext(ctx, query, userID)
	return err
}

// CountUserSessions counts active sessions for a user
func (r *PostgresRepository) CountUserSessions(ctx context.Context, userID string) (int, error) {
	var count int
	query := `SELECT COUNT(*) FROM sessions WHERE user_id = $1 AND expires_at > NOW()`
	err := r.db.GetContext(ctx, &count, query, userID)
	return count, err
}

// GetOldestUserSession gets the oldest active session for a user
func (r *PostgresRepository) GetOldestUserSession(ctx context.Context, userID string) (*models.Session, error) {
	var session models.Session
	query := `SELECT id, user_id, token_id, device_info, ip_address, user_agent, created_at, last_activity, expires_at FROM sessions WHERE user_id = $1 AND expires_at > NOW() ORDER BY created_at ASC LIMIT 1`
	err := r.db.GetContext(ctx, &session, query, userID)
	if err != nil {
		return nil, err
	}
	return &session, nil
}

// CleanupExpiredSessions removes expired sessions (should be called periodically)
func (r *PostgresRepository) CleanupExpiredSessions(ctx context.Context) error {
	query := `DELETE FROM sessions WHERE expires_at < NOW()`
	_, err := r.db.ExecContext(ctx, query)
	return err
}

// Password history methods (Phase 5: Password Policy Enhancements)

// CreatePasswordHistory adds a password hash to user's password history
func (r *PostgresRepository) CreatePasswordHistory(ctx context.Context, userID, passwordHash string) error {
	id := uuid.New().String()
	query := `INSERT INTO password_history (id, user_id, password_hash, created_at) VALUES ($1, $2, $3, NOW())`
	_, err := r.db.ExecContext(ctx, query, id, userID, passwordHash)
	return err
}

// GetPasswordHistory gets recent password history for a user
func (r *PostgresRepository) GetPasswordHistory(ctx context.Context, userID string, limit int) ([]string, error) {
	if limit <= 0 {
		limit = 5
	}
	var hashes []string
	query := `SELECT password_hash FROM password_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`
	err := r.db.SelectContext(ctx, &hashes, query, userID, limit)
	return hashes, err
}

// CheckPasswordInHistory checks if password hash exists in user's recent history
func (r *PostgresRepository) CheckPasswordInHistory(ctx context.Context, userID, passwordHash string, historyCount int) (bool, error) {
	hashes, err := r.GetPasswordHistory(ctx, userID, historyCount)
	if err != nil {
		return false, err
	}
	for _, hash := range hashes {
		if hash == passwordHash {
			return true, nil
		}
	}
	return false, nil
}

// CleanupOldPasswordHistory removes old password history entries (keep only recent N)
func (r *PostgresRepository) CleanupOldPasswordHistory(ctx context.Context, userID string, keepCount int) error {
	query := `DELETE FROM password_history WHERE user_id = $1 AND id NOT IN (
		SELECT id FROM password_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2
	)`
	_, err := r.db.ExecContext(ctx, query, userID, keepCount)
	return err
}

// Password reset token methods (Phase 5: Account Recovery)

// CreatePasswordResetToken creates a new password reset token
func (r *PostgresRepository) CreatePasswordResetToken(ctx context.Context, token *models.PasswordResetToken) error {
	if token.ID == "" {
		token.ID = uuid.New().String()
	}
	query := `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES ($1, $2, $3, $4, $5)`
	_, err := r.db.ExecContext(ctx, query, token.ID, token.UserID, token.TokenHash, token.ExpiresAt, token.CreatedAt)
	return err
}

// GetPasswordResetTokenByHash gets a password reset token by hash
func (r *PostgresRepository) GetPasswordResetTokenByHash(ctx context.Context, tokenHash string) (*models.PasswordResetToken, error) {
	var token models.PasswordResetToken
	query := `SELECT id, user_id, token_hash, expires_at, used_at, created_at FROM password_reset_tokens WHERE token_hash = $1`
	err := r.db.GetContext(ctx, &token, query, tokenHash)
	if err != nil {
		return nil, err
	}
	return &token, nil
}

// MarkPasswordResetTokenUsed marks a password reset token as used
func (r *PostgresRepository) MarkPasswordResetTokenUsed(ctx context.Context, tokenID string) error {
	query := `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`
	_, err := r.db.ExecContext(ctx, query, tokenID)
	return err
}

// CleanupExpiredPasswordResetTokens removes expired tokens (should be called periodically)
func (r *PostgresRepository) CleanupExpiredPasswordResetTokens(ctx context.Context) error {
	query := `DELETE FROM password_reset_tokens WHERE expires_at < NOW()`
	_, err := r.db.ExecContext(ctx, query)
	return err
}

// CountPasswordResetTokensForUser counts active reset tokens for a user (for rate limiting)
func (r *PostgresRepository) CountPasswordResetTokensForUser(ctx context.Context, userID string, since time.Time) (int, error) {
	var count int
	query := `SELECT COUNT(*) FROM password_reset_tokens WHERE user_id = $1 AND created_at >= $2`
	err := r.db.GetContext(ctx, &count, query, userID, since)
	return count, err
}

// ListActivePasswordResetTokens lists all active (not expired, not used) reset tokens
func (r *PostgresRepository) ListActivePasswordResetTokens(ctx context.Context) ([]*models.PasswordResetToken, error) {
	var tokens []*models.PasswordResetToken
	query := `SELECT id, user_id, token_hash, expires_at, used_at, created_at FROM password_reset_tokens WHERE expires_at > NOW() AND used_at IS NULL`
	err := r.db.SelectContext(ctx, &tokens, query)
	return tokens, err
}

// SAML session methods (Phase 2: SAML 2.0 Integration)

// CreateSAMLSession creates a new SAML session
func (r *PostgresRepository) CreateSAMLSession(ctx context.Context, session *models.SAMLSession) error {
	if session.ID == "" {
		session.ID = uuid.New().String()
	}
	query := `INSERT INTO saml_sessions (id, user_id, saml_session_index, idp_entity_id, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)`
	_, err := r.db.ExecContext(ctx, query, session.ID, session.UserID, session.SAMLSessionIndex, session.IdpEntityID, session.CreatedAt, session.ExpiresAt)
	return err
}

// GetSAMLSessionByIndex gets a SAML session by session index
func (r *PostgresRepository) GetSAMLSessionByIndex(ctx context.Context, sessionIndex string) (*models.SAMLSession, error) {
	var session models.SAMLSession
	query := `SELECT id, user_id, saml_session_index, idp_entity_id, created_at, expires_at FROM saml_sessions WHERE saml_session_index = $1 AND expires_at > NOW()`
	err := r.db.GetContext(ctx, &session, query, sessionIndex)
	if err != nil {
		return nil, err
	}
	return &session, nil
}

// DeleteUserSAMLSessions deletes all SAML sessions for a user
func (r *PostgresRepository) DeleteUserSAMLSessions(ctx context.Context, userID string) error {
	query := `DELETE FROM saml_sessions WHERE user_id = $1`
	_, err := r.db.ExecContext(ctx, query, userID)
	return err
}

// CleanupExpiredSAMLSessions removes expired SAML sessions
func (r *PostgresRepository) CleanupExpiredSAMLSessions(ctx context.Context) error {
	query := `DELETE FROM saml_sessions WHERE expires_at < NOW()`
	_, err := r.db.ExecContext(ctx, query)
	return err
}

// Token blacklist methods (Phase 1: Token Revocation)

// CreateTokenBlacklistEntry adds a token to the blacklist
func (r *PostgresRepository) CreateTokenBlacklistEntry(ctx context.Context, entry *models.TokenBlacklistEntry) error {
	if entry.ID == "" {
		entry.ID = uuid.New().String()
	}
	query := `INSERT INTO token_blacklist (id, token_id, user_id, revoked_at, expires_at, reason) VALUES ($1, $2, $3, $4, $5, $6)`
	_, err := r.db.ExecContext(ctx, query, entry.ID, entry.TokenID, entry.UserID, entry.RevokedAt, entry.ExpiresAt, entry.Reason)
	return err
}

// IsTokenBlacklisted checks if a token ID is blacklisted
func (r *PostgresRepository) IsTokenBlacklisted(ctx context.Context, tokenID string) (bool, error) {
	var count int
	err := r.db.GetContext(ctx, &count, `SELECT COUNT(*) FROM token_blacklist WHERE token_id = $1 AND expires_at > NOW()`, tokenID)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// DeleteExpiredTokens deletes expired tokens from the blacklist
func (r *PostgresRepository) DeleteExpiredTokens(ctx context.Context, cutoffTime time.Time) (int64, error) {
	query := `DELETE FROM token_blacklist WHERE expires_at < $1`
	result, err := r.db.ExecContext(ctx, query, cutoffTime)
	if err != nil {
		return 0, err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	return rowsAffected, nil
}

// RevokeAllUserTokens revokes all tokens for a user by revoking refresh token families
// Note: Access tokens are stateless JWTs, so we can't revoke them directly without blacklisting.
// This revokes refresh token families, preventing new access tokens from being issued.
func (r *PostgresRepository) RevokeAllUserTokens(ctx context.Context, userID string, reason string) error {
	return r.RevokeRefreshTokenFamily(ctx, userID, reason)
}

// Refresh token family methods (Phase 1: Refresh Token Rotation)

// CreateRefreshTokenFamily creates a new refresh token family
func (r *PostgresRepository) CreateRefreshTokenFamily(ctx context.Context, family *models.RefreshTokenFamily) error {
	if family.ID == "" {
		family.ID = uuid.New().String()
	}
	query := `INSERT INTO refresh_token_families (id, family_id, user_id, token_id, created_at) VALUES ($1, $2, $3, $4, $5)`
	_, err := r.db.ExecContext(ctx, query, family.ID, family.FamilyID, family.UserID, family.TokenID, family.CreatedAt)
	return err
}

// GetRefreshTokenFamilyByTokenID gets a refresh token family by token ID
func (r *PostgresRepository) GetRefreshTokenFamilyByTokenID(ctx context.Context, tokenID string) (*models.RefreshTokenFamily, error) {
	var family models.RefreshTokenFamily
	err := r.db.GetContext(ctx, &family, `SELECT id, family_id, user_id, token_id, created_at, revoked_at FROM refresh_token_families WHERE token_id = $1`, tokenID)
	if err != nil {
		return nil, err
	}
	return &family, nil
}

// GetRefreshTokenFamilyByFamilyID gets the current active token for a family
func (r *PostgresRepository) GetRefreshTokenFamilyByFamilyID(ctx context.Context, familyID string) (*models.RefreshTokenFamily, error) {
	var family models.RefreshTokenFamily
	err := r.db.GetContext(ctx, &family, `SELECT id, family_id, user_id, token_id, created_at, revoked_at FROM refresh_token_families WHERE family_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`, familyID)
	if err != nil {
		return nil, err
	}
	return &family, nil
}

// RevokeRefreshTokenFamily revokes a refresh token family (marks all tokens in family as revoked)
func (r *PostgresRepository) RevokeRefreshTokenFamily(ctx context.Context, userID string, reason string) error {
	now := time.Now()
	query := `UPDATE refresh_token_families SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL`
	_, err := r.db.ExecContext(ctx, query, now, userID)
	return err
}

// RevokeRefreshTokenFamilyByFamilyID revokes a specific refresh token family
func (r *PostgresRepository) RevokeRefreshTokenFamilyByFamilyID(ctx context.Context, familyID string) error {
	now := time.Now()
	query := `UPDATE refresh_token_families SET revoked_at = $1 WHERE family_id = $2 AND revoked_at IS NULL`
	_, err := r.db.ExecContext(ctx, query, now, familyID)
	return err
}

// UpdateRefreshTokenFamilyToken updates the current token ID for a family (rotation)
func (r *PostgresRepository) UpdateRefreshTokenFamilyToken(ctx context.Context, familyID string, newTokenID string) error {
	// Create new entry for the rotated token
	family, err := r.GetRefreshTokenFamilyByFamilyID(ctx, familyID)
	if err != nil {
		return err
	}
	newFamily := &models.RefreshTokenFamily{
		FamilyID:  familyID,
		UserID:    family.UserID,
		TokenID:   newTokenID,
		CreatedAt: time.Now(),
	}
	return r.CreateRefreshTokenFamily(ctx, newFamily)
}

// MFA TOTP methods (Phase 5: MFA TOTP Support)

// CreateMFATOTPSecret creates or updates a user's MFA TOTP secret
func (r *PostgresRepository) CreateMFATOTPSecret(ctx context.Context, secret *models.MFATOTPSecret) error {
	if secret.ID == "" {
		secret.ID = uuid.New().String()
	}
	query := `INSERT INTO mfa_totp_secrets (id, user_id, secret, enabled, created_at) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id) DO UPDATE SET secret = $3, created_at = $5`
	_, err := r.db.ExecContext(ctx, query, secret.ID, secret.UserID, secret.Secret, secret.Enabled, secret.CreatedAt)
	return err
}

// GetMFATOTPSecret gets a user's MFA TOTP secret
func (r *PostgresRepository) GetMFATOTPSecret(ctx context.Context, userID string) (*models.MFATOTPSecret, error) {
	var secret models.MFATOTPSecret
	err := r.db.GetContext(ctx, &secret, `SELECT id, user_id, secret, enabled, created_at FROM mfa_totp_secrets WHERE user_id = $1`, userID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &secret, nil
}

// EnableMFATOTP enables MFA TOTP for a user
func (r *PostgresRepository) EnableMFATOTP(ctx context.Context, userID string) error {
	query := `UPDATE mfa_totp_secrets SET enabled = true WHERE user_id = $1`
	_, err := r.db.ExecContext(ctx, query, userID)
	return err
}

// DisableMFATOTP disables MFA TOTP for a user
func (r *PostgresRepository) DisableMFATOTP(ctx context.Context, userID string) error {
	query := `UPDATE mfa_totp_secrets SET enabled = false WHERE user_id = $1`
	_, err := r.db.ExecContext(ctx, query, userID)
	return err
}

// DeleteMFATOTPSecret deletes a user's MFA TOTP secret
func (r *PostgresRepository) DeleteMFATOTPSecret(ctx context.Context, userID string) error {
	query := `DELETE FROM mfa_totp_secrets WHERE user_id = $1`
	_, err := r.db.ExecContext(ctx, query, userID)
	return err
}

// MFA Backup codes methods

// CreateMFABackupCodes creates backup codes for a user (matches SQLite signature)
func (r *PostgresRepository) CreateMFABackupCodes(ctx context.Context, userID string, codeHashes []string) error {
	query := `INSERT INTO mfa_backup_codes (id, user_id, code_hash, used, created_at) VALUES ($1, $2, $3, FALSE, NOW())`
	for _, hash := range codeHashes {
		id := uuid.New().String()
		if _, err := r.db.ExecContext(ctx, query, id, userID, hash); err != nil {
			return err
		}
	}
	return nil
}

// GetMFABackupCodes gets unused backup codes for a user
func (r *PostgresRepository) GetMFABackupCodes(ctx context.Context, userID string) ([]*models.MFABackupCode, error) {
	var codes []*models.MFABackupCode
	query := `SELECT id, user_id, code_hash, used, used_at, created_at FROM mfa_backup_codes WHERE user_id = $1 AND used = FALSE ORDER BY created_at DESC`
	err := r.db.SelectContext(ctx, &codes, query, userID)
	if err != nil {
		return nil, err
	}
	return codes, nil
}

// VerifyAndUseMFABackupCode verifies and marks a backup code as used
func (r *PostgresRepository) VerifyAndUseMFABackupCode(ctx context.Context, userID, code string) (bool, error) {
	// Get all unused backup codes for user
	codes, err := r.GetMFABackupCodes(ctx, userID)
	if err != nil {
		return false, err
	}

	// Check each code
	for _, backupCode := range codes {
		if mfa.VerifyBackupCode(backupCode.CodeHash, code) {
			// Mark as used
			query := `UPDATE mfa_backup_codes SET used = TRUE, used_at = NOW() WHERE id = $1`
			_, err := r.db.ExecContext(ctx, query, backupCode.ID)
			return true, err
		}
	}
	return false, nil
}

// DeleteUserMFABackupCodes deletes backup codes for a user
func (r *PostgresRepository) DeleteUserMFABackupCodes(ctx context.Context, userID string) error {
	query := `DELETE FROM mfa_backup_codes WHERE user_id = $1`
	_, err := r.db.ExecContext(ctx, query, userID)
	return err
}
