package aiclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestGetStatus_Happy(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/status" {
			t.Errorf("path = %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"state":"ready","version":"1.0.0","engines":["llm"]}`))
	}))
	defer srv.Close()

	c := NewHTTPClient(srv.URL, DefaultOpts())
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	st, err := c.GetStatus(ctx)
	if err != nil {
		t.Fatalf("get status: %v", err)
	}
	if st.State != "ready" || st.Version != "1.0.0" || len(st.Engines) != 1 {
		t.Errorf("unexpected status: %+v", st)
	}
}

func TestGetStatus_500(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := NewHTTPClient(srv.URL, DefaultOpts())
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := c.GetStatus(ctx); err == nil {
		t.Fatal("expected error on 500")
	}
}
