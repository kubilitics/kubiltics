// Package rest: ingress TLS inspection subresource.
//
// GET /clusters/{clusterId}/resources/ingresses/{namespace}/{name}/tls-info
//
// Walks ingress.spec.tls[], looks up each referenced Secret, parses the
// tls.crt x509 certificate, and returns a stable shape the kubilitics-ai
// observe_ingresses_by_tls_expiry tool consumes:
//
//   { "certificates": [
//       { "host": "...", "secret_name": "...", "issuer": "...",
//         "not_after": "2026-05-01T00:00:00Z", "expires_at": "<same>",
//         "days_remaining": 42 }
//   ] }
//
// When a TLS entry lists multiple hosts, one certificate row is emitted per
// host so the brain's per-host aggregation works without extra fan-out.
// Per-entry parse errors are isolated into a row-level `error` field so one
// bad secret does not black-box the whole response.

package rest

import (
	"crypto/x509"
	"encoding/pem"
	"net/http"
	"time"

	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// ingressTLSCertificate mirrors the brain's consumer shape
// (handlers_gaps.go reads host / issuer / not_after|expires_at).
type ingressTLSCertificate struct {
	Host          string `json:"host"`
	SecretName    string `json:"secret_name"`
	Issuer        string `json:"issuer,omitempty"`
	Subject       string `json:"subject,omitempty"`
	NotBefore     string `json:"not_before,omitempty"`
	NotAfter      string `json:"not_after,omitempty"`
	ExpiresAt     string `json:"expires_at,omitempty"` // alias for not_after
	DaysRemaining int    `json:"days_remaining"`
	Error         string `json:"error,omitempty"`
}

type ingressTLSResponse struct {
	ClusterID    string                  `json:"cluster_id"`
	Namespace    string                  `json:"namespace"`
	IngressName  string                  `json:"ingress_name"`
	Certificates []ingressTLSCertificate `json:"certificates"`
}

// GetIngressTLSInfo handles GET .../resources/ingresses/{namespace}/{name}/tls-info.
func (h *Handler) GetIngressTLSInfo(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	namespace := vars["namespace"]
	name := vars["name"]

	if !validate.ClusterID(clusterID) || !validate.Namespace(namespace) || !validate.Name(name) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId, namespace, or name")
		return
	}
	if namespace == "" {
		respondError(w, http.StatusBadRequest, "namespace is required")
		return
	}

	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	ing, err := client.Clientset.NetworkingV1().Ingresses(namespace).Get(r.Context(), name, metav1.GetOptions{})
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	out := ingressTLSResponse{
		ClusterID:    clusterID,
		Namespace:    namespace,
		IngressName:  name,
		Certificates: []ingressTLSCertificate{},
	}

	for _, tls := range ing.Spec.TLS {
		secretName := tls.SecretName
		// Fetch the referenced secret once per entry
		var certErr string
		var parsedCert *x509.Certificate
		if secretName == "" {
			certErr = "ingress.spec.tls entry has no secretName"
		} else {
			sec, secErr := client.Clientset.CoreV1().Secrets(namespace).Get(r.Context(), secretName, metav1.GetOptions{})
			switch {
			case secErr != nil:
				certErr = "secret lookup failed: " + secErr.Error()
			default:
				certBytes, ok := sec.Data["tls.crt"]
				if !ok || len(certBytes) == 0 {
					certErr = "secret has no tls.crt key"
				} else {
					block, _ := pem.Decode(certBytes)
					if block == nil {
						certErr = "tls.crt is not PEM-encoded"
					} else if c, parseErr := x509.ParseCertificate(block.Bytes); parseErr != nil {
						certErr = "x509 parse failed: " + parseErr.Error()
					} else {
						parsedCert = c
					}
				}
			}
		}

		hosts := tls.Hosts
		if len(hosts) == 0 {
			// Still emit a single row so the brain can see the secret even
			// when hosts are unset (rare but valid in cert-manager setups).
			hosts = []string{""}
		}
		for _, host := range hosts {
			row := ingressTLSCertificate{
				Host:       host,
				SecretName: secretName,
				Error:      certErr,
			}
			if parsedCert != nil {
				row.Issuer = parsedCert.Issuer.String()
				row.Subject = parsedCert.Subject.String()
				row.NotBefore = parsedCert.NotBefore.UTC().Format(time.RFC3339)
				row.NotAfter = parsedCert.NotAfter.UTC().Format(time.RFC3339)
				row.ExpiresAt = row.NotAfter
				row.DaysRemaining = int(time.Until(parsedCert.NotAfter).Hours() / 24)
			}
			out.Certificates = append(out.Certificates, row)
		}
	}

	respondJSON(w, http.StatusOK, out)
}
