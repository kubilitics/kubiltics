package rest

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gorilla/mux"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// makeTestCert returns a PEM-encoded self-signed cert that expires `ttl` from now.
func makeTestCert(t *testing.T, ttl time.Duration, commonName string) []byte {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("gen key: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: commonName},
		Issuer:       pkix.Name{CommonName: "test-ca"},
		NotBefore:    time.Now().Add(-1 * time.Hour),
		NotAfter:     time.Now().Add(ttl),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &priv.PublicKey, priv)
	if err != nil {
		t.Fatalf("create cert: %v", err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
}

func TestGetIngressTLSInfo_ParsesCertificateExpiry(t *testing.T) {
	clusterID := "test-cluster"
	ns := "demo"
	ingName := "web-ingress"
	secretName := "web-tls"

	certPEM := makeTestCert(t, 30*24*time.Hour, "web.example.com")

	ingress := &networkingv1.Ingress{
		ObjectMeta: metav1.ObjectMeta{Name: ingName, Namespace: ns},
		Spec: networkingv1.IngressSpec{
			TLS: []networkingv1.IngressTLS{{
				Hosts:      []string{"web.example.com"},
				SecretName: secretName,
			}},
		},
	}
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: secretName, Namespace: ns},
		Type:       corev1.SecretTypeTLS,
		Data: map[string][]byte{
			"tls.crt": certPEM,
			"tls.key": []byte("unused-in-test"),
		},
	}
	clientset := fake.NewSimpleClientset(ingress, secret)
	client := k8s.NewClientForTest(clientset)

	cluster := &models.Cluster{ID: clusterID, Name: "t", Context: "c", Status: "connected"}
	csvc := &mockClusterServiceWithClient{clusters: []*models.Cluster{cluster}, client: client}

	h := NewHandler(csvc, nil, &config.Config{}, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, h)

	req := httptest.NewRequest(http.MethodGet,
		"/api/v1/clusters/"+clusterID+"/resources/ingresses/"+ns+"/"+ingName+"/tls-info", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		ClusterID    string `json:"cluster_id"`
		Certificates []struct {
			Host          string `json:"host"`
			SecretName    string `json:"secret_name"`
			Issuer        string `json:"issuer"`
			NotAfter      string `json:"not_after"`
			ExpiresAt     string `json:"expires_at"`
			DaysRemaining int    `json:"days_remaining"`
			Error         string `json:"error"`
		} `json:"certificates"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("parse response: %v (body: %s)", err, w.Body.String())
	}
	if len(resp.Certificates) != 1 {
		t.Fatalf("expected 1 certificate row, got %d: %+v", len(resp.Certificates), resp.Certificates)
	}
	c := resp.Certificates[0]
	if c.Host != "web.example.com" {
		t.Errorf("host: got %q want web.example.com", c.Host)
	}
	if c.SecretName != secretName {
		t.Errorf("secret_name: got %q want %q", c.SecretName, secretName)
	}
	if c.NotAfter == "" || c.ExpiresAt == "" {
		t.Errorf("not_after/expires_at both must populate: %+v", c)
	}
	if c.DaysRemaining <= 0 || c.DaysRemaining > 31 {
		t.Errorf("days_remaining expected ~30, got %d", c.DaysRemaining)
	}
	if c.Error != "" {
		t.Errorf("unexpected error: %q", c.Error)
	}
}

func TestGetIngressTLSInfo_MissingSecretIsolated(t *testing.T) {
	clusterID := "test-cluster"
	ns := "demo"
	ingName := "broken-ingress"

	ingress := &networkingv1.Ingress{
		ObjectMeta: metav1.ObjectMeta{Name: ingName, Namespace: ns},
		Spec: networkingv1.IngressSpec{
			TLS: []networkingv1.IngressTLS{{
				Hosts:      []string{"missing.example.com"},
				SecretName: "does-not-exist",
			}},
		},
	}
	clientset := fake.NewSimpleClientset(ingress)
	client := k8s.NewClientForTest(clientset)

	cluster := &models.Cluster{ID: clusterID, Name: "t", Context: "c", Status: "connected"}
	csvc := &mockClusterServiceWithClient{clusters: []*models.Cluster{cluster}, client: client}
	h := NewHandler(csvc, nil, &config.Config{}, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, h)

	req := httptest.NewRequest(http.MethodGet,
		"/api/v1/clusters/"+clusterID+"/resources/ingresses/"+ns+"/"+ingName+"/tls-info", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 even with missing secret (per-row error), got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Certificates []struct {
			Host  string `json:"host"`
			Error string `json:"error"`
		} `json:"certificates"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(resp.Certificates) != 1 {
		t.Fatalf("want 1 row, got %d", len(resp.Certificates))
	}
	if resp.Certificates[0].Error == "" {
		t.Fatalf("expected per-row error for missing secret, got empty")
	}
}
