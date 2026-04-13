package rest

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/kubilitics/kubilitics-backend/internal/otel"
)

func TestGetTracingStatus_AllMissing(t *testing.T) {
	clientset := fake.NewSimpleClientset()
	resp := callTracingStatus(t, clientset, "test-cluster", "http://kubilitics:8190")

	if resp.AllReady {
		t.Error("expected all_ready=false for empty cluster")
	}
	statuses := map[string]string{}
	for _, c := range resp.Components {
		statuses[c.Key] = c.Status
	}
	if statuses["cert-manager"] != "missing" {
		t.Errorf("cert-manager: expected missing, got %s", statuses["cert-manager"])
	}
	if statuses["otel-operator"] != "missing" {
		t.Errorf("otel-operator: expected missing, got %s", statuses["otel-operator"])
	}
	if statuses["kubilitics-collector"] != "missing" {
		t.Errorf("collector: expected missing, got %s", statuses["kubilitics-collector"])
	}
}

func TestGetTracingStatus_CertManagerOnly(t *testing.T) {
	clientset := fake.NewSimpleClientset(&corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{Name: "cert-manager"},
	})
	resp := callTracingStatus(t, clientset, "test-cluster", "http://kubilitics:8190")
	statuses := map[string]string{}
	for _, c := range resp.Components {
		statuses[c.Key] = c.Status
	}
	// cert-manager namespace exists but webhook deployment doesn't — should be "installing".
	if statuses["cert-manager"] != "installing" {
		t.Errorf("cert-manager: expected installing (namespace only, no webhook), got %s", statuses["cert-manager"])
	}
}

func TestGetTracingStatus_RendersInstallCommand(t *testing.T) {
	clientset := fake.NewSimpleClientset()
	resp := callTracingStatus(t, clientset, "test-cluster-abc", "http://my-backend:8190")
	if resp.Install.Helm == "" {
		t.Error("expected non-empty helm install command")
	}
	if !strings.Contains(resp.Install.Helm, "test-cluster-abc") {
		t.Errorf("helm command should embed cluster ID, got: %s", resp.Install.Helm)
	}
	if !strings.Contains(resp.Install.Helm, "my-backend") {
		t.Errorf("helm command should embed backend URL, got: %s", resp.Install.Helm)
	}
}

func TestComputeTracingStatus_TraceIngestionWithRecentSpans(t *testing.T) {
	// Build a fake clientset with the collector ready, and a real receiver
	// that we'll prime with a recent span.
	one := int32(1)
	clientset := fake.NewSimpleClientset(
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "kubilitics-system"}},
		&appsv1.Deployment{
			ObjectMeta: metav1.ObjectMeta{Name: "otel-collector", Namespace: "kubilitics-system"},
			Spec:       appsv1.DeploymentSpec{Replicas: &one},
			Status:     appsv1.DeploymentStatus{Replicas: 1, ReadyReplicas: 1},
		},
	)
	receiver := otel.NewReceiver(nil, "")
	receiver.RecordSpansForClusterTest("test-cluster", 42)

	h := &TracingHandler{otelReceiver: receiver}
	resp := h.computeTracingStatus(context.Background(), clientset, "test-cluster", "test-cluster", "http://example.com")

	var ingestion *TracingComponent
	for i := range resp.Components {
		if resp.Components[i].Key == "trace-ingestion" {
			ingestion = &resp.Components[i]
		}
	}
	if ingestion == nil {
		t.Fatal("trace-ingestion component missing")
	}
	if ingestion.Status != "ready" {
		t.Errorf("expected status=ready, got %q", ingestion.Status)
	}
	if ingestion.SpansPerMinute == nil || *ingestion.SpansPerMinute != 42 {
		t.Errorf("expected SpansPerMinute=42, got %v", ingestion.SpansPerMinute)
	}
	if ingestion.LastSpanSeenAt == nil {
		t.Error("expected LastSpanSeenAt to be set")
	}
}

// callTracingStatus calls the pure computeTracingStatus helper directly.
func callTracingStatus(t *testing.T, clientset *fake.Clientset, clusterID, backendURL string) TracingStatusResponse {
	t.Helper()
	h := &TracingHandler{}
	resp := h.computeTracingStatus(context.Background(), clientset, clusterID, "test-cluster", backendURL)
	if _, err := json.Marshal(resp); err != nil {
		t.Errorf("response failed to marshal: %v", err)
	}
	return resp
}
