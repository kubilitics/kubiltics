package resilient

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"syscall"
	"testing"
)

type fakePods struct {
	Count int `json:"count"`
}

func TestWrap_HealthyPath(t *testing.T) {
	cache := NewLRUCache[string, fakePods](4)
	h := WrapClusterHandler(cache,
		func(r *http.Request) string { return "c1" },
		func(ctx context.Context, r *http.Request) (fakePods, error) {
			return fakePods{Count: 5}, nil
		})
	req := httptest.NewRequest("GET", "/pods", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status: %d", rec.Code)
	}
	var env ResilientResponse[fakePods]
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	if !env.Reachable || env.Data.Count != 5 || env.HealthStatus != "healthy" {
		t.Fatalf("healthy envelope malformed: %+v", env)
	}
	if _, ok := cache.Get("c1"); !ok {
		t.Fatal("healthy fetch should have been cached")
	}
}

func TestWrap_TransientNoCacheReturnsUnreachableNoData(t *testing.T) {
	cache := NewLRUCache[string, fakePods](4)
	h := WrapClusterHandler(cache,
		func(r *http.Request) string { return "c1" },
		func(ctx context.Context, r *http.Request) (fakePods, error) {
			return fakePods{}, syscall.ECONNREFUSED
		})
	req := httptest.NewRequest("GET", "/pods", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("transient error must still be 200, got %d", rec.Code)
	}
	var env ResilientResponse[fakePods]
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	if env.Reachable {
		t.Fatal("reachable must be false")
	}
	if env.HealthStatus != "unreachable" {
		t.Fatalf("health_status: %q", env.HealthStatus)
	}
	if env.ErrorMessage == "" {
		t.Fatal("error_message must be populated")
	}
	if env.Stale {
		t.Fatal("no cache existed — stale must be false")
	}
}

func TestWrap_TransientWithCacheServesStale(t *testing.T) {
	cache := NewLRUCache[string, fakePods](4)
	cache.Put("c1", fakePods{Count: 42})
	h := WrapClusterHandler(cache,
		func(r *http.Request) string { return "c1" },
		func(ctx context.Context, r *http.Request) (fakePods, error) {
			return fakePods{}, syscall.ECONNREFUSED
		})
	req := httptest.NewRequest("GET", "/pods", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status: %d", rec.Code)
	}
	var env ResilientResponse[fakePods]
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	if env.Reachable || !env.Stale {
		t.Fatalf("expected reachable=false, stale=true: %+v", env)
	}
	if env.Data.Count != 42 {
		t.Fatalf("stale data lost: %+v", env)
	}
	if env.StaleAsOf == nil {
		t.Fatal("stale_as_of must be populated")
	}
}

func TestWrap_RealBugReturns5xx(t *testing.T) {
	cache := NewLRUCache[string, fakePods](4)
	h := WrapClusterHandler(cache,
		func(r *http.Request) string { return "c1" },
		func(ctx context.Context, r *http.Request) (fakePods, error) {
			return fakePods{}, errors.New("database schema corrupt: table missing")
		})
	req := httptest.NewRequest("GET", "/pods", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code < 500 {
		t.Fatalf("real bug must return 5xx, got %d", rec.Code)
	}
}
