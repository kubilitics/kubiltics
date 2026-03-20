package rest

import (
	"encoding/json"
	"net/http"
)

// APIError represents a structured API error response
type APIError struct {
	Error     string            `json:"error"`
	Code      string            `json:"code,omitempty"`
	Message   string            `json:"message"`
	RequestID string            `json:"request_id,omitempty"`
	Details   map[string]string `json:"details,omitempty"`
}

// Error codes for common scenarios
const (
	ErrCodeInvalidRequest    = "INVALID_REQUEST"
	ErrCodeNotFound          = "NOT_FOUND"
	ErrCodeForbidden         = "FORBIDDEN"
	ErrCodeUnauthorized      = "UNAUTHORIZED"
	ErrCodeInternalError     = "INTERNAL_ERROR"
	ErrCodeTimeout           = "TIMEOUT"
	ErrCodeCircuitBreaker    = "CIRCUIT_BREAKER_OPEN"
	ErrCodeRateLimitExceeded = "RATE_LIMIT_EXCEEDED"
	ErrCodeValidationFailed  = "VALIDATION_FAILED"
	ErrCodeConflict          = "CONFLICT"
	ErrCodePayloadTooLarge   = "PAYLOAD_TOO_LARGE"
)

// respondStructuredError sends a structured error response with error code and details
func respondStructuredError(w http.ResponseWriter, status int, code, message string, requestID string, details map[string]string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	err := APIError{
		Error:     message,
		Code:      code,
		Message:   message,
		RequestID: requestID,
		Details:   details,
	}
	json.NewEncoder(w).Encode(err)
}

// respondErrorWithCode is a convenience wrapper for structured errors
func respondErrorWithCode(w http.ResponseWriter, status int, code, message string, requestID string) {
	respondStructuredError(w, status, code, message, requestID, nil)
}
