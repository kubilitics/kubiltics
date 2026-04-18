package hubclient

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"time"
)

// Client is a typed HTTP client for the Kubilitics hub agent endpoints.
// TLS behaviour:
//   - default: system CAs
//   - caBundlePath != "": pin the provided PEM bundle
//   - insecure: skip TLS verification (dev only)
type Client struct {
	base string
	hc   *http.Client
}

// RegisterRequest contains the fields sent during agent registration.
type RegisterRequest struct {
	BootstrapToken string `json:"bootstrap_token,omitempty"`
	SAToken        string `json:"sa_token,omitempty"`
	ClusterUID     string `json:"cluster_uid"`
	ClusterName    string `json:"cluster_name,omitempty"`
	AgentVersion   string `json:"agent_version"`
	K8sVersion     string `json:"k8s_version"`
	NodeCount      int    `json:"node_count"`
}

// RegisterResponse is the hub's response to a successful registration.
type RegisterResponse struct {
	ClusterID          string `json:"cluster_id"`
	RefreshToken       string `json:"refresh_token"`
	AccessToken        string `json:"access_token"`
	AccessTTLs         int    `json:"access_ttl_s"`
	HeartbeatIntervalS int    `json:"heartbeat_interval_s"`
}

// HeartbeatRequest is sent on every heartbeat tick.
type HeartbeatRequest struct {
	ClusterID      string         `json:"cluster_id"`
	ClusterUID     string         `json:"cluster_uid"`
	AgentVersion   string         `json:"agent_version"`
	K8sVersion     string         `json:"k8s_version"`
	Status         string         `json:"status"`
	ResourceCounts map[string]int `json:"resource_counts"`
}

// HeartbeatResponse is the hub's acknowledgement and optional command list.
type HeartbeatResponse struct {
	Ack                 bool   `json:"ack"`
	DesiredAgentVersion string `json:"desired_agent_version,omitempty"`
	Commands            []any  `json:"commands"`
}

// RefreshResponse is returned when the access token is refreshed.
type RefreshResponse struct {
	AccessToken string `json:"access_token"`
	AccessTTLs  int    `json:"access_ttl_s"`
}

// APIError represents an error response from the hub.
type APIError struct {
	Status int    `json:"-"`
	Code   string `json:"code"`
	Msg    string `json:"message"`
}

func (e *APIError) Error() string { return fmt.Sprintf("hub %d %s: %s", e.Status, e.Code, e.Msg) }

// New creates a Client targeting baseURL.
//   - caBundlePath: path to a PEM CA bundle to pin; empty string uses system CAs.
//   - insecure: if true, TLS certificate verification is skipped (dev only).
func New(baseURL, caBundlePath string, insecure bool) (*Client, error) {
	tlsCfg := &tls.Config{InsecureSkipVerify: insecure} //nolint:gosec // insecure is dev-only, gated by caller
	if caBundlePath != "" {
		pem, err := os.ReadFile(caBundlePath)
		if err != nil {
			return nil, err
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pem) {
			return nil, errors.New("hubclient: invalid CA bundle — no certificates parsed")
		}
		tlsCfg.RootCAs = pool
	}
	return &Client{
		base: baseURL,
		hc: &http.Client{
			Timeout:   30 * time.Second,
			Transport: &http.Transport{TLSClientConfig: tlsCfg},
		},
	}, nil
}

// Register calls POST /api/v1/agent/register and returns the registration response.
func (c *Client) Register(ctx context.Context, req RegisterRequest) (RegisterResponse, error) {
	var out RegisterResponse
	return out, c.do(ctx, http.MethodPost, "/api/v1/agent/register", "", req, &out)
}

// Heartbeat calls POST /api/v1/agent/heartbeat using the supplied access token.
func (c *Client) Heartbeat(ctx context.Context, access string, req HeartbeatRequest) (HeartbeatResponse, error) {
	var out HeartbeatResponse
	return out, c.do(ctx, http.MethodPost, "/api/v1/agent/heartbeat", access, req, &out)
}

// Refresh calls POST /api/v1/agent/token/refresh with the refresh token and
// returns a new short-lived access token.
func (c *Client) Refresh(ctx context.Context, refresh string) (RefreshResponse, error) {
	var out RefreshResponse
	return out, c.do(ctx, http.MethodPost, "/api/v1/agent/token/refresh", "", map[string]string{"refresh_token": refresh}, &out)
}

// do is the internal HTTP round-tripper. bearer may be empty.
func (c *Client) do(ctx context.Context, method, path, bearer string, body, out any) error {
	buf, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("hubclient: marshal request: %w", err)
	}
	r, err := http.NewRequestWithContext(ctx, method, c.base+path, bytes.NewReader(buf))
	if err != nil {
		return fmt.Errorf("hubclient: build request: %w", err)
	}
	r.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		r.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := c.hc.Do(r)
	if err != nil {
		return fmt.Errorf("hubclient: send request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		var e APIError
		_ = json.NewDecoder(resp.Body).Decode(&e)
		e.Status = resp.StatusCode
		return &e
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			return fmt.Errorf("hubclient: decode response: %w", err)
		}
	}
	return nil
}
