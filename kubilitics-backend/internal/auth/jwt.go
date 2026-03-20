package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var ErrExpiredToken = errors.New("token expired")
var ErrTokenRevoked = errors.New("token revoked")

const (
	AccessTokenExpiry  = time.Hour
	RefreshTokenExpiry = 7 * 24 * time.Hour
)

type Claims struct {
	jwt.RegisteredClaims
	UserID   string `json:"uid"`
	Username string `json:"username"`
	Role     string `json:"role"`
	Refresh  bool   `json:"refresh,omitempty"` // true = refresh token
}

// IssueAccessToken returns a signed JWT access token for the user.
func IssueAccessToken(secret string, userID, username, role string) (string, error) {
	if secret == "" {
		return "", fmt.Errorf("jwt secret is required")
	}
	now := time.Now()
	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(AccessTokenExpiry)),
			ID:        fmt.Sprintf("%d", now.UnixNano()),
		},
		UserID:   userID,
		Username: username,
		Role:     role,
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return tok.SignedString([]byte(secret))
}

// IssueRefreshToken returns a signed JWT refresh token.
func IssueRefreshToken(secret string, userID string) (string, error) {
	if secret == "" {
		return "", fmt.Errorf("jwt secret is required")
	}
	now := time.Now()
	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(RefreshTokenExpiry)),
			ID:        fmt.Sprintf("refresh-%d", now.UnixNano()),
		},
		UserID:  userID,
		Refresh: true,
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return tok.SignedString([]byte(secret))
}

// ValidateToken parses and validates the token string; returns claims or error.
func ValidateToken(secret, tokenString string) (*Claims, error) {
	if secret == "" {
		return nil, fmt.Errorf("jwt secret is required")
	}
	tok, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := tok.Claims.(*Claims)
	if !ok || !tok.Valid {
		return nil, fmt.Errorf("invalid token")
	}
	return claims, nil
}

// ValidateTokenWithRepo parses and validates the token string with optional repository for blacklist check.
// This is a separate function to avoid import cycles (repository imports auth, auth shouldn't import repository).
func ValidateTokenWithRepo(ctx context.Context, secret, tokenString string, repo interface{}) (*Claims, error) {
	claims, err := ValidateToken(secret, tokenString)
	if err != nil {
		return nil, err
	}
	
	// Check blacklist if repository is provided (using interface{} to avoid import cycle)
	if repo != nil && claims.ID != "" {
		// Type assertion to check if repo has IsTokenBlacklisted method
		type BlacklistChecker interface {
			IsTokenBlacklisted(ctx context.Context, tokenID string) (bool, error)
		}
		if checker, ok := repo.(BlacklistChecker); ok {
			blacklisted, err := checker.IsTokenBlacklisted(ctx, claims.ID)
			if err != nil {
				// Log error but don't fail validation (blacklist check is best-effort)
				return claims, nil
			}
			if blacklisted {
				return nil, ErrTokenRevoked
			}
		}
	}
	
	return claims, nil
}
