package rest

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"golang.org/x/time/rate"
)

// KubeconfigRequest represents a request that includes kubeconfig (Headlamp/Lens model).
// Kubeconfig can be provided as:
// - kubeconfig_base64: base64-encoded kubeconfig content
// - X-Kubeconfig header: base64-encoded kubeconfig (for GET requests)
type KubeconfigRequest struct {
	KubeconfigBase64 string `json:"kubeconfig_base64,omitempty"`
	Context          string `json:"context,omitempty"` // Optional context name, defaults to current context
}

// getKubeconfigFromRequest extracts kubeconfig from request (body or header).
// Returns kubeconfig bytes and context name.
// This enables Headlamp/Lens-style stateless cluster management.
func (h *Handler) getKubeconfigFromRequest(r *http.Request) ([]byte, string, error) {
	var kubeconfigBytes []byte
	var contextName string
	var err error

	// Try header first (for GET requests)
	if kubeconfigHeader := r.Header.Get("X-Kubeconfig"); kubeconfigHeader != "" {
		kubeconfigBytes, err = base64.StdEncoding.DecodeString(kubeconfigHeader)
		if err != nil {
			return nil, "", fmt.Errorf("invalid X-Kubeconfig header: %w", err)
		}
		contextName = r.Header.Get("X-Kubeconfig-Context")
		return kubeconfigBytes, contextName, nil
	}

	// Try body (for POST/PATCH requests)
	// BA-6: Read body into memory and restore it so handlers can read it again (e.g. PatchResource reads body after getClientFromRequest).
	if r.Body != nil && r.ContentLength > 0 {
		bodyBytes, err := io.ReadAll(r.Body)
		if err != nil {
			return nil, "", fmt.Errorf("failed to read request body: %w", err)
		}
		r.Body.Close()
		r.Body = io.NopCloser(bytes.NewReader(bodyBytes))

		var req KubeconfigRequest
		if err := json.NewDecoder(bytes.NewReader(bodyBytes)).Decode(&req); err == nil && req.KubeconfigBase64 != "" {
			kubeconfigBytes, err = base64.StdEncoding.DecodeString(req.KubeconfigBase64)
			if err != nil {
				return nil, "", fmt.Errorf("invalid kubeconfig_base64: %w", err)
			}
			contextName = req.Context
			return kubeconfigBytes, contextName, nil
		}
	}

	return nil, "", fmt.Errorf("no kubeconfig provided in request")
}

// getClientFromRequest creates a Kubernetes client from kubeconfig in request (Headlamp/Lens model).
// Falls back to stored cluster if kubeconfig not provided.
func (h *Handler) getClientFromRequest(ctx context.Context, r *http.Request, clusterID string, cfg *config.Config) (*k8s.Client, error) {
	// Try to get kubeconfig from request first (Headlamp/Lens model)
	kubeconfigBytes, contextName, err := h.getKubeconfigFromRequest(r)
	if err == nil && len(kubeconfigBytes) > 0 {
		// BA-6: Cache stateless clients by kubeconfig hash + context to avoid overhead.
		cacheKey := fmt.Sprintf("%x:%s", sha256.Sum256(kubeconfigBytes), contextName)
		if client, ok := h.k8sClientCache.Get(cacheKey); ok {
			return client, nil
		}

		// Create client from kubeconfig bytes (stateless, per-request)
		client, err := k8s.NewClientFromBytes(kubeconfigBytes, contextName)
		if err != nil {
			return nil, fmt.Errorf("failed to create client from kubeconfig: %w", err)
		}
		// Apply service-level settings
		if cfg != nil && cfg.K8sTimeoutSec > 0 {
			client.SetTimeout(time.Duration(cfg.K8sTimeoutSec) * time.Second)
		}
		if cfg != nil && cfg.K8sRateLimitPerSec > 0 && cfg.K8sRateLimitBurst > 0 {
			client.SetLimiter(rate.NewLimiter(rate.Limit(cfg.K8sRateLimitPerSec), cfg.K8sRateLimitBurst))
		}
		client.SetClusterID(clusterID)

		h.k8sClientCache.Add(cacheKey, client)
		return client, nil
	}

	// Fall back to stored cluster (backward compatibility)
	resolvedID, err := h.resolveClusterID(ctx, clusterID)
	if err != nil {
		return nil, err
	}
	return h.clusterService.GetClient(resolvedID)
}
