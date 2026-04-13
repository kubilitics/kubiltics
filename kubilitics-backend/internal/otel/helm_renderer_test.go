package otel

import (
	"os"
	"strings"
	"testing"
)

func TestRenderKubiliticsOtelChart_InterpolatesClusterID(t *testing.T) {
	r := NewHelmRenderer(testChartPath(t))
	out, err := r.Render(RenderOptions{
		ClusterID:  "test-cluster-abc",
		BackendURL: "http://kubilitics.example.com",
		Namespace:  "kubilitics-system",
	})
	if err != nil {
		t.Fatalf("render failed: %v", err)
	}
	if !strings.Contains(out, "test-cluster-abc") {
		t.Errorf("expected cluster ID in rendered output, not found")
	}
	if !strings.Contains(out, "kubilitics.example.com") {
		t.Errorf("expected backend URL in rendered output, not found")
	}
	if !strings.Contains(out, "kind: Deployment") {
		t.Errorf("expected Deployment in rendered output")
	}
	if !strings.Contains(out, "kind: ConfigMap") {
		t.Errorf("expected ConfigMap in rendered output")
	}
}

func TestRenderKubiliticsOtelChart_FailsWithoutClusterID(t *testing.T) {
	r := NewHelmRenderer(testChartPath(t))
	_, err := r.Render(RenderOptions{
		BackendURL: "http://example.com",
		Namespace:  "kubilitics-system",
	})
	if err == nil {
		t.Fatal("expected error when ClusterID is empty")
	}
	if !strings.Contains(err.Error(), "clusterId") && !strings.Contains(err.Error(), "REQUIRED") {
		t.Errorf("expected error to mention clusterId or REQUIRED, got: %v", err)
	}
}

func TestRenderKubiliticsOtelChart_IncludesInstrumentationCR(t *testing.T) {
	r := NewHelmRenderer(testChartPath(t))
	out, err := r.Render(RenderOptions{
		ClusterID:  "abc",
		BackendURL: "http://example.com",
	})
	if err != nil {
		t.Fatalf("render failed: %v", err)
	}
	if !strings.Contains(out, "kind: Instrumentation") {
		t.Errorf("expected Instrumentation CR in rendered output")
	}
	if !strings.Contains(out, "kubilitics-auto") {
		t.Errorf("expected Instrumentation CR named kubilitics-auto")
	}
	if !strings.Contains(out, "kind: ClusterRole") {
		t.Errorf("expected ClusterRole for k8sattributes processor")
	}
}

func TestRenderKubiliticsOtelChart_AirGapImageOverride(t *testing.T) {
	r := NewHelmRenderer(testChartPath(t))
	out, err := r.Render(RenderOptions{
		ClusterID:       "abc",
		BackendURL:      "http://example.com",
		ImageRepository: "my-registry.internal/otel-collector-contrib",
		ImageTag:        "0.118.0",
	})
	if err != nil {
		t.Fatalf("render failed: %v", err)
	}
	if !strings.Contains(out, "my-registry.internal/otel-collector-contrib:0.118.0") {
		t.Errorf("expected air-gap image override in rendered output")
	}
}

// testChartPath finds the chart relative to the repo root regardless of
// where tests are invoked from.
func testChartPath(t *testing.T) string {
	t.Helper()
	// The test runs from kubilitics-backend/internal/otel/. Walk up to repo root.
	return "../../../charts/kubilitics-otel"
}

// --- Input validation tests (injection prevention) -------------------------

func TestRender_RejectsClusterIDWithComma(t *testing.T) {
	r := NewHelmRenderer(testChartPath(t))
	_, err := r.Render(RenderOptions{
		ClusterID:  "evil,image.repository=attacker/malware",
		BackendURL: "http://example.com",
	})
	if err == nil {
		t.Fatal("expected error for cluster ID containing comma (helm --set injection vector)")
	}
	if !strings.Contains(err.Error(), "invalid characters") {
		t.Errorf("expected 'invalid characters' error, got: %v", err)
	}
}

func TestRender_RejectsClusterIDWithEquals(t *testing.T) {
	r := NewHelmRenderer(testChartPath(t))
	_, err := r.Render(RenderOptions{
		ClusterID:  "cid=injected",
		BackendURL: "http://example.com",
	})
	if err == nil {
		t.Fatal("expected error for cluster ID containing equals")
	}
}

func TestRender_RejectsClusterIDOverLength(t *testing.T) {
	r := NewHelmRenderer(testChartPath(t))
	long := strings.Repeat("a", 200)
	_, err := r.Render(RenderOptions{
		ClusterID:  long,
		BackendURL: "http://example.com",
	})
	if err == nil {
		t.Fatal("expected error for oversized cluster ID")
	}
}

func TestRender_RejectsBackendURLWithComma(t *testing.T) {
	r := NewHelmRenderer(testChartPath(t))
	_, err := r.Render(RenderOptions{
		ClusterID:  "abc",
		BackendURL: "http://example.com,image.repository=evil/img",
	})
	if err == nil {
		t.Fatal("expected error for backend URL containing comma")
	}
}

func TestRender_RejectsBackendURLWithBadScheme(t *testing.T) {
	r := NewHelmRenderer(testChartPath(t))
	_, err := r.Render(RenderOptions{
		ClusterID:  "abc",
		BackendURL: "file:///etc/passwd",
	})
	if err == nil {
		t.Fatal("expected error for non-http(s) backend URL")
	}
	if !strings.Contains(err.Error(), "http or https") {
		t.Errorf("expected 'http or https' error, got: %v", err)
	}
}

func TestRender_AcceptsUUIDClusterID(t *testing.T) {
	r := NewHelmRenderer(testChartPath(t))
	_, err := r.Render(RenderOptions{
		ClusterID:  "bfe72621-8163-4a8f-8161-1568f8eb5b35",
		BackendURL: "https://kubilitics.example.com",
	})
	if err != nil {
		t.Fatalf("expected UUID cluster ID to be valid, got error: %v", err)
	}
}

// --- Embedded chart tests --------------------------------------------------

func TestExtractedChartPath_ReturnsUsableChart(t *testing.T) {
	path, err := ExtractedChartPath()
	if err != nil {
		t.Fatalf("ExtractedChartPath failed: %v", err)
	}
	if path == "" {
		t.Fatal("ExtractedChartPath returned empty string")
	}
	// Chart.yaml must exist at the extracted path.
	chartYamlPath := path + "/Chart.yaml"
	if _, err := os.Stat(chartYamlPath); err != nil {
		t.Errorf("Chart.yaml not found at %s: %v", chartYamlPath, err)
	}
	// templates/ subdir must exist.
	if _, err := os.Stat(path + "/templates"); err != nil {
		t.Errorf("templates/ not found at %s: %v", path+"/templates", err)
	}
}

func TestExtractedChartPath_RenderableByHelm(t *testing.T) {
	path, err := ExtractedChartPath()
	if err != nil {
		t.Fatalf("ExtractedChartPath failed: %v", err)
	}
	r := NewHelmRenderer(path)
	out, err := r.Render(RenderOptions{
		ClusterID:  "embedded-test",
		BackendURL: "http://example.com",
	})
	if err != nil {
		t.Fatalf("render from extracted path failed: %v", err)
	}
	if !strings.Contains(out, "embedded-test") {
		t.Error("expected cluster ID in rendered output from embedded chart")
	}
	if !strings.Contains(out, "kind: Deployment") {
		t.Error("expected Deployment kind in rendered output from embedded chart")
	}
}

func TestExtractedChartPath_IsStable(t *testing.T) {
	// Called twice should return the same path (cached via sync.Once).
	p1, err := ExtractedChartPath()
	if err != nil {
		t.Fatal(err)
	}
	p2, err := ExtractedChartPath()
	if err != nil {
		t.Fatal(err)
	}
	if p1 != p2 {
		t.Errorf("expected stable path across calls, got %s then %s", p1, p2)
	}
}
