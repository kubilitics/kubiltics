package rest

import (
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"net/http"
	"time"

	"github.com/gorilla/mux"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// TLSSecretInfoResponse is the JSON response for GET .../secrets/{namespace}/{name}/tls-info
type TLSSecretInfoResponse struct {
	Issuer        string `json:"issuer,omitempty"`
	Subject       string `json:"subject,omitempty"`
	ValidFrom     string `json:"validFrom,omitempty"`
	ValidTo       string `json:"validTo,omitempty"`
	DaysRemaining int    `json:"daysRemaining"` // negative if expired
	HasValidCert  bool   `json:"hasValidCert"`
	Error         string `json:"error,omitempty"`
}

// GetSecretTLSInfo handles GET /clusters/{clusterId}/resources/secrets/{namespace}/{name}/tls-info
// Returns parsed TLS certificate info from the secret's tls.crt when the secret exists and contains valid cert data.
func (h *Handler) GetSecretTLSInfo(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	namespace := vars["namespace"]
	name := vars["name"]

	if !validate.ClusterID(clusterID) || !validate.Namespace(namespace) || !validate.Name(name) {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest, "Invalid clusterId, namespace, or name", requestID)
		return
	}

	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	obj, err := client.GetResource(r.Context(), "secrets", namespace, name)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	out := parseTLSFromUnstructured(obj)
	respondJSON(w, http.StatusOK, out)
}

// parseTLSFromUnstructured extracts TLS cert info from a Secret unstructured. Does not redact; handler is authenticated.
func parseTLSFromUnstructured(obj *unstructured.Unstructured) TLSSecretInfoResponse {
	out := TLSSecretInfoResponse{}
	data, ok := obj.Object["data"].(map[string]interface{})
	if !ok {
		out.Error = "Secret has no data"
		return out
	}
	tlsCrt, ok := data["tls.crt"].(string)
	if !ok {
		out.Error = "Secret has no tls.crt key"
		return out
	}
	der, err := base64.StdEncoding.DecodeString(tlsCrt)
	if err != nil {
		out.Error = "Invalid base64 in tls.crt"
		return out
	}
	block, _ := pem.Decode(der)
	if block == nil {
		out.Error = "No PEM block in tls.crt"
		return out
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		out.Error = "Failed to parse certificate: " + err.Error()
		return out
	}
	out.HasValidCert = true
	out.Issuer = cert.Issuer.String()
	out.Subject = cert.Subject.String()
	out.ValidFrom = cert.NotBefore.Format(time.RFC3339)
	out.ValidTo = cert.NotAfter.Format(time.RFC3339)
	now := time.Now()
	if now.After(cert.NotAfter) {
		out.DaysRemaining = -int(cert.NotAfter.Sub(now).Hours() / 24)
	} else {
		out.DaysRemaining = int(cert.NotAfter.Sub(now).Hours() / 24)
	}
	return out
}
