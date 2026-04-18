package hubclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRegisterAndHeartbeat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/agent/register":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"cluster_id": "c1", "refresh_token": "rk_live_x", "access_token": "eyJ",
				"access_ttl_s": 3600, "heartbeat_interval_s": 30,
			})
		case "/api/v1/agent/heartbeat":
			if r.Header.Get("Authorization") != "Bearer eyJ" {
				http.Error(w, "no", 401)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"ack": true, "commands": []any{}})
		case "/api/v1/agent/token/refresh":
			_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "eyJ2", "access_ttl_s": 3600})
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	c, _ := New(srv.URL, "", false)

	resp, err := c.Register(context.Background(), RegisterRequest{ClusterUID: "u1", AgentVersion: "0.4.0", K8sVersion: "v1.29"})
	if err != nil {
		t.Fatal(err)
	}
	if resp.AccessToken != "eyJ" {
		t.Fatalf("got %+v", resp)
	}

	if _, err := c.Heartbeat(context.Background(), "eyJ", HeartbeatRequest{ClusterID: "c1", ClusterUID: "u1", Status: "healthy"}); err != nil {
		t.Fatal(err)
	}

	rt, err := c.Refresh(context.Background(), "rk_live_x")
	if err != nil {
		t.Fatal(err)
	}
	if rt.AccessToken != "eyJ2" {
		t.Fatalf("got %+v", rt)
	}
}
