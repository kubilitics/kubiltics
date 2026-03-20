package middleware

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestRateLimitMiddleware_HealthEndpoint_Bypass(t *testing.T) {
	handler := RateLimit()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))
	
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	
	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}
}

func TestRateLimitMiddleware_GET_Allowed(t *testing.T) {
	handler := RateLimit()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))
	
	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters", nil)
	req.RemoteAddr = "192.168.1.1:12345"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	
	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}
	
	// Check rate limit headers
	limit := rec.Header().Get("X-RateLimit-Limit")
	if limit != strconv.Itoa(rateLimitGetPerMin) {
		t.Errorf("Expected X-RateLimit-Limit %d, got %s", rateLimitGetPerMin, limit)
	}
	
	remaining := rec.Header().Get("X-RateLimit-Remaining")
	if remaining == "" {
		t.Error("Expected X-RateLimit-Remaining header")
	}
}

func TestRateLimitMiddleware_GET_ExceedsLimit(t *testing.T) {
	handler := RateLimit()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	
	ip := "192.168.1.2"
	// Exhaust the rate limit by making many requests
	for i := 0; i < rateLimitGetBurst+1; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters", nil)
		req.RemoteAddr = ip + ":12345"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		
		if i >= rateLimitGetBurst {
			if rec.Code != http.StatusTooManyRequests {
				t.Errorf("Request %d: Expected status 429, got %d", i, rec.Code)
			}
			if !strings.Contains(rec.Body.String(), "Too many requests") {
				t.Errorf("Request %d: Expected rate limit error message", i)
			}
			retryAfter := rec.Header().Get("Retry-After")
			if retryAfter == "" {
				t.Error("Expected Retry-After header")
			}
		}
	}
}

func TestRateLimitMiddleware_POST_StandardTier(t *testing.T) {
	handler := RateLimit()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))
	
	req := httptest.NewRequest(http.MethodPost, "/api/v1/clusters", nil)
	req.RemoteAddr = "192.168.1.3:12345"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	
	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}
	
	limit := rec.Header().Get("X-RateLimit-Limit")
	if limit != strconv.Itoa(rateLimitStandardPerMin) {
		t.Errorf("Expected X-RateLimit-Limit %d, got %s", rateLimitStandardPerMin, limit)
	}
}

func TestRateLimitMiddleware_Exec_Tier(t *testing.T) {
	handler := RateLimit()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))
	
	req := httptest.NewRequest(http.MethodPost, "/api/v1/clusters/cluster-1/shell", nil)
	req.RemoteAddr = "192.168.1.4:12345"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	
	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}
	
	limit := rec.Header().Get("X-RateLimit-Limit")
	if limit != strconv.Itoa(rateLimitExecPerMin) {
		t.Errorf("Expected X-RateLimit-Limit %d, got %s", rateLimitExecPerMin, limit)
	}
}

func TestRateLimitMiddleware_DifferentIPs_Independent(t *testing.T) {
	handler := RateLimit()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))
	
	// Exhaust limit for IP1
	ip1 := "192.168.1.5"
	for i := 0; i < rateLimitGetBurst+1; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters", nil)
		req.RemoteAddr = ip1 + ":12345"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
	}
	
	// IP2 should still be able to make requests
	ip2 := "192.168.1.6"
	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters", nil)
	req.RemoteAddr = ip2 + ":12345"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	
	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200 for different IP, got %d", rec.Code)
	}
}

func TestRateLimitMiddleware_XForwardedFor_IP(t *testing.T) {
	handler := RateLimit()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))
	
	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters", nil)
	req.Header.Set("X-Forwarded-For", "10.0.0.1")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	
	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}
	
	// Make many requests from same forwarded IP
	ip := "10.0.0.1"
	for i := 0; i < rateLimitGetBurst+1; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters", nil)
		req.Header.Set("X-Forwarded-For", ip)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		
		if i >= rateLimitGetBurst {
			if rec.Code != http.StatusTooManyRequests {
				t.Errorf("Request %d: Expected status 429, got %d", i, rec.Code)
			}
		}
	}
}

func TestRateLimitMiddleware_XRealIP_IP(t *testing.T) {
	handler := RateLimit()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))
	
	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters", nil)
	req.Header.Set("X-Real-IP", "10.0.0.2")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	
	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}
}

func TestRateLimitMiddleware_ResetHeader(t *testing.T) {
	handler := RateLimit()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))
	
	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters", nil)
	req.RemoteAddr = "192.168.1.7:12345"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	
	reset := rec.Header().Get("X-RateLimit-Reset")
	if reset == "" {
		t.Error("Expected X-RateLimit-Reset header")
	}
	
	resetTime, err := strconv.ParseInt(reset, 10, 64)
	if err != nil {
		t.Fatalf("Failed to parse reset time: %v", err)
	}
	
	// Reset should be approximately 1 minute from now
	expectedReset := time.Now().Add(time.Minute).Unix()
	diff := resetTime - expectedReset
	if diff < -5 || diff > 5 {
		t.Errorf("Reset time should be ~1 minute from now, got diff %d seconds", diff)
	}
}
