package aiclient

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

type HTTPClient struct {
	base string
	http *http.Client
	opts ClientOpts
}

type Status struct {
	State   string   `json:"state"`
	Version string   `json:"version"`
	Engines []string `json:"engines"`
}

func NewHTTPClient(baseURL string, opts ClientOpts) *HTTPClient {
	return &HTTPClient{
		base: baseURL,
		http: &http.Client{Timeout: opts.UnaryTimeout},
		opts: opts,
	}
}

func (c *HTTPClient) GetStatus(ctx context.Context) (*Status, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+"/status", nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("get status: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("status returned HTTP %d", resp.StatusCode)
	}
	var s Status
	if err := json.NewDecoder(resp.Body).Decode(&s); err != nil {
		return nil, fmt.Errorf("decode status: %w", err)
	}
	return &s, nil
}
