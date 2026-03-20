package server

// A-CORE-012: Security Analysis — Handler Tests
//
// Tests for all 8 security endpoints wired through handleSecurityDispatch.
// Uses real SecurityEngine with a nil or stub fetcher so all analysis logic
// is exercised without needing a live backend.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	pb "github.com/kubilitics/kubilitics-ai/api/proto/v1"
	"github.com/kubilitics/kubilitics-ai/internal/security"
)

// ─── Test Helpers ─────────────────────────────────────────────────────────────

// secStubFetcher returns pre-loaded resources per kind.
type secStubFetcher struct {
	resources map[string][]*pb.Resource
}

func (f *secStubFetcher) ListResources(_ context.Context, kind, _ string) ([]*pb.Resource, error) {
	return f.resources[kind], nil
}

// buildSecurityServer creates a minimal Server with a real SecurityEngine.
func buildSecurityServer(t *testing.T, fetcher security.ResourceFetcher) *Server {
	t.Helper()
	return &Server{securityEngine: security.NewSecurityEngine(fetcher)}
}

// buildSecurityServerNoPipeline creates a Server without a security engine.
func buildSecurityServerNoPipeline(t *testing.T) *Server {
	t.Helper()
	return &Server{}
}

// podWithNoSecurityContext creates a minimal Pod resource (triggers all security issues).
func podWithNoSecurityContext(name, ns string) *pb.Resource {
	return &pb.Resource{Name: name, Namespace: ns, Kind: "Pod"}
}

// podWithGoodSecurityContext creates a Pod resource with a hardened security context.
func podWithGoodSecurityContext(name, ns string) *pb.Resource {
	trueVal := true
	falseVal := false
	data := map[string]interface{}{
		"spec": map[string]interface{}{
			"securityContext": map[string]interface{}{
				"runAsNonRoot": trueVal,
			},
			"containers": []interface{}{
				map[string]interface{}{
					"securityContext": map[string]interface{}{
						"privileged":               falseVal,
						"allowPrivilegeEscalation": falseVal,
						"readOnlyRootFilesystem":   trueVal,
						"capabilities": map[string]interface{}{
							"drop": []interface{}{"ALL"},
						},
					},
				},
			},
		},
	}
	raw, _ := json.Marshal(data)
	return &pb.Resource{Name: name, Namespace: ns, Kind: "Pod", Data: raw}
}

// roleWithWildcard creates a Role resource with wildcard permissions.
func roleWithWildcard(name, ns string) *pb.Resource {
	data := map[string]interface{}{
		"rules": []interface{}{
			map[string]interface{}{
				"verbs":     []interface{}{"*"},
				"resources": []interface{}{"*"},
				"apiGroups": []interface{}{"*"},
			},
		},
	}
	raw, _ := json.Marshal(data)
	return &pb.Resource{Name: name, Namespace: ns, Kind: "Role", Data: raw}
}

// secretWithSensitiveName creates a Secret with a name that triggers risk detection.
func secretWithSensitiveName(name, ns string) *pb.Resource {
	return &pb.Resource{Name: name, Namespace: ns, Kind: "Secret"}
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

func TestHandleSecurityDispatch_NotFound(t *testing.T) {
	srv := buildSecurityServerNoPipeline(t)
	rr := doRequest(t, srv.handleSecurityDispatch, http.MethodGet, "/api/v1/security/nonexistent", "")
	if rr.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rr.Code)
	}
}

func TestHandleSecurityDispatch_RoutesPosture(t *testing.T) {
	srv := buildSecurityServerNoPipeline(t)
	rr := doRequest(t, srv.handleSecurityDispatch, http.MethodGet, "/api/v1/security/posture", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	if resp["note"] == nil {
		t.Error("expected note field in degraded response")
	}
}

// ─── Posture ──────────────────────────────────────────────────────────────────

func TestHandleSecurityPosture_NoPipeline(t *testing.T) {
	srv := buildSecurityServerNoPipeline(t)
	rr := doRequest(t, srv.handleSecurityPosture, http.MethodGet, "/api/v1/security/posture", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
}

func TestHandleSecurityPosture_MethodNotAllowed(t *testing.T) {
	srv := buildSecurityServer(t, nil)
	rr := doRequest(t, srv.handleSecurityPosture, http.MethodPost, "/api/v1/security/posture", "")
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("want 405, got %d", rr.Code)
	}
}

func TestHandleSecurityPosture_WithPodsNoSecurity(t *testing.T) {
	fetcher := &secStubFetcher{
		resources: map[string][]*pb.Resource{
			"Pod": {
				podWithNoSecurityContext("api", "default"),
				podWithNoSecurityContext("worker", "default"),
			},
		},
	}
	srv := buildSecurityServer(t, fetcher)
	rr := doRequest(t, srv.handleSecurityPosture, http.MethodGet, "/api/v1/security/posture", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	for _, f := range []string{"score", "grade", "summary", "pod_scanned", "timestamp"} {
		if _, ok := resp[f]; !ok {
			t.Errorf("missing field: %s", f)
		}
	}
	// Pods with no security context should result in a lower score.
	score := resp["score"].(float64)
	if score >= 100 {
		t.Errorf("expected score < 100 for insecure pods, got %v", score)
	}
}

func TestHandleSecurityPosture_HardenedPods(t *testing.T) {
	fetcher := &secStubFetcher{
		resources: map[string][]*pb.Resource{
			"Pod": {
				podWithGoodSecurityContext("secure-api", "prod"),
			},
		},
	}
	srv := buildSecurityServer(t, fetcher)
	rr := doRequest(t, srv.handleSecurityPosture, http.MethodGet, "/api/v1/security/posture", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	score := resp["score"].(float64)
	// Hardened pod should have a higher score than insecure pods.
	if score <= 0 {
		t.Errorf("expected score > 0 for hardened pod, got %v", score)
	}
}

// ─── Issues ───────────────────────────────────────────────────────────────────

func TestHandleSecurityIssues_NoPipeline(t *testing.T) {
	srv := buildSecurityServerNoPipeline(t)
	rr := doRequest(t, srv.handleSecurityIssues, http.MethodGet, "/api/v1/security/issues", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
}

func TestHandleSecurityIssues_WithFilter(t *testing.T) {
	fetcher := &secStubFetcher{
		resources: map[string][]*pb.Resource{
			"Pod": {podWithNoSecurityContext("p1", "staging")},
		},
	}
	srv := buildSecurityServer(t, fetcher)
	rr := doRequest(t, srv.handleSecurityIssues, http.MethodGet, "/api/v1/security/issues?severity=HIGH", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	if _, ok := resp["issues"]; !ok {
		t.Error("expected issues field")
	}
	// All returned issues should be HIGH severity.
	issues, _ := resp["issues"].([]interface{})
	for _, iss := range issues {
		im, _ := iss.(map[string]interface{})
		if im["severity"] != "HIGH" {
			t.Errorf("expected only HIGH severity, got: %v", im["severity"])
		}
	}
}

func TestHandleSecurityIssues_NamespaceFilter(t *testing.T) {
	fetcher := &secStubFetcher{
		resources: map[string][]*pb.Resource{
			"Pod": {
				podWithNoSecurityContext("p1", "prod"),
				podWithNoSecurityContext("p2", "staging"),
			},
		},
	}
	srv := buildSecurityServer(t, fetcher)
	rr := doRequest(t, srv.handleSecurityIssues, http.MethodGet, "/api/v1/security/issues?namespace=prod", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	issues, _ := resp["issues"].([]interface{})
	for _, iss := range issues {
		im, _ := iss.(map[string]interface{})
		if im["namespace"] != "" && im["namespace"] != "prod" {
			t.Errorf("expected only prod namespace, got: %v", im["namespace"])
		}
	}
}

// ─── RBAC ─────────────────────────────────────────────────────────────────────

func TestHandleSecurityRBAC_NoPipeline(t *testing.T) {
	srv := buildSecurityServerNoPipeline(t)
	rr := doRequest(t, srv.handleSecurityRBAC, http.MethodGet, "/api/v1/security/rbac", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
}

func TestHandleSecurityRBAC_WildcardRole(t *testing.T) {
	fetcher := &secStubFetcher{
		resources: map[string][]*pb.Resource{
			"Role": {roleWithWildcard("over-privileged", "default")},
		},
	}
	srv := buildSecurityServer(t, fetcher)
	rr := doRequest(t, srv.handleSecurityRBAC, http.MethodGet, "/api/v1/security/rbac", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	findings, _ := resp["findings"].([]interface{})
	if len(findings) == 0 {
		t.Error("expected RBAC findings for wildcard role")
	}
}

// ─── Network Policy Gaps ──────────────────────────────────────────────────────

func TestHandleSecurityNetwork_NoPipeline(t *testing.T) {
	srv := buildSecurityServerNoPipeline(t)
	rr := doRequest(t, srv.handleSecurityNetwork, http.MethodGet, "/api/v1/security/network", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
}

func TestHandleSecurityNetwork_GapDetected(t *testing.T) {
	// Namespace has pods but no NetworkPolicy.
	fetcher := &secStubFetcher{
		resources: map[string][]*pb.Resource{
			"Pod":           {podWithNoSecurityContext("api", "exposed-ns")},
			"NetworkPolicy": {}, // No policies at all
		},
	}
	srv := buildSecurityServer(t, fetcher)
	rr := doRequest(t, srv.handleSecurityNetwork, http.MethodGet, "/api/v1/security/network", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	gaps := resp["total_gaps"].(float64)
	if gaps == 0 {
		t.Error("expected at least one network policy gap")
	}
	if resp["total_pods_exposed"] == nil {
		t.Error("expected total_pods_exposed field")
	}
}

func TestHandleSecurityNetwork_CoveredByPolicy(t *testing.T) {
	// Namespace has both pods AND a NetworkPolicy.
	fetcher := &secStubFetcher{
		resources: map[string][]*pb.Resource{
			"Pod": {podWithNoSecurityContext("api", "secured-ns")},
			"NetworkPolicy": {
				{Name: "default-deny", Namespace: "secured-ns", Kind: "NetworkPolicy"},
			},
		},
	}
	srv := buildSecurityServer(t, fetcher)
	rr := doRequest(t, srv.handleSecurityNetwork, http.MethodGet, "/api/v1/security/network", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	gaps := resp["total_gaps"].(float64)
	if gaps != 0 {
		t.Errorf("expected 0 gaps when namespace has a NetworkPolicy, got %v", gaps)
	}
}

// ─── Secret Exposure ──────────────────────────────────────────────────────────

func TestHandleSecuritySecrets_NoPipeline(t *testing.T) {
	srv := buildSecurityServerNoPipeline(t)
	rr := doRequest(t, srv.handleSecuritySecrets, http.MethodGet, "/api/v1/security/secrets", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
}

func TestHandleSecuritySecrets_SensitiveNameDetected(t *testing.T) {
	fetcher := &secStubFetcher{
		resources: map[string][]*pb.Resource{
			"Secret": {
				secretWithSensitiveName("db-password", "prod"),
				secretWithSensitiveName("api-key-stripe", "prod"),
			},
		},
	}
	srv := buildSecurityServer(t, fetcher)
	rr := doRequest(t, srv.handleSecuritySecrets, http.MethodGet, "/api/v1/security/secrets", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	total := resp["total"].(float64)
	if total == 0 {
		t.Error("expected secret exposures for sensitive secret names")
	}
}

// ─── Compliance ───────────────────────────────────────────────────────────────

func TestHandleSecurityCompliance_NoPipeline(t *testing.T) {
	srv := buildSecurityServerNoPipeline(t)
	rr := doRequest(t, srv.handleSecurityCompliance, http.MethodGet, "/api/v1/security/compliance", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
}

func TestHandleSecurityCompliance_WithData(t *testing.T) {
	fetcher := &secStubFetcher{
		resources: map[string][]*pb.Resource{
			"Pod": {podWithNoSecurityContext("app", "default")},
		},
	}
	srv := buildSecurityServer(t, fetcher)
	// Trigger analysis first.
	_, _ = srv.securityEngine.Analyze(context.Background())

	rr := doRequest(t, srv.handleSecurityCompliance, http.MethodGet, "/api/v1/security/compliance", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	// Should have CIS compliance data with checks.
	if _, ok := resp["checks"]; !ok {
		t.Error("expected checks field in compliance response")
	}
	if resp["compliance_score"] == nil {
		t.Error("expected compliance_score field")
	}
}

// ─── Image Scan ───────────────────────────────────────────────────────────────

func TestHandleSecurityScanImage_NoPipeline(t *testing.T) {
	srv := buildSecurityServerNoPipeline(t)
	rr := doRequest(t, srv.handleSecurityScanImage, http.MethodPost, "/api/v1/security/scan/image",
		`{"image":"nginx:latest"}`)
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503, got %d", rr.Code)
	}
}

func TestHandleSecurityScanImage_MissingImage(t *testing.T) {
	srv := buildSecurityServer(t, nil)
	rr := doRequest(t, srv.handleSecurityScanImage, http.MethodPost, "/api/v1/security/scan/image",
		`{"image":""}`)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
}

func TestHandleSecurityScanImage_MethodNotAllowed(t *testing.T) {
	srv := buildSecurityServer(t, nil)
	rr := doRequest(t, srv.handleSecurityScanImage, http.MethodGet, "/api/v1/security/scan/image", "")
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("want 405, got %d", rr.Code)
	}
}

func TestHandleSecurityScanImage_ScanResult(t *testing.T) {
	srv := buildSecurityServer(t, nil)
	rr := doRequest(t, srv.handleSecurityScanImage, http.MethodPost, "/api/v1/security/scan/image",
		`{"image":"node:16"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	for _, f := range []string{"image", "risk_score", "risk_level", "vulnerability_count"} {
		if resp[f] == nil {
			t.Errorf("missing field: %s", f)
		}
	}
	// node:16 should have HIGH vulnerabilities (from scanner simulation).
	if resp["risk_level"] == "MINIMAL" {
		t.Error("expected non-minimal risk for node:16")
	}
}

// ─── Pod Analysis ─────────────────────────────────────────────────────────────

func TestHandleSecurityAnalyzePod_MissingName(t *testing.T) {
	srv := buildSecurityServer(t, nil)
	rr := doRequest(t, srv.handleSecurityAnalyzePod, http.MethodPost, "/api/v1/security/analyze/pod",
		`{"namespace":"default"}`)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
}

func TestHandleSecurityAnalyzePod_Insecure(t *testing.T) {
	trueVal := true
	// Privileged + allow priv escalation → critical issues.
	body := fmt.Sprintf(`{"name":"bad-pod","namespace":"prod","privileged":true,"allow_privilege_escalation":%v}`, trueVal)
	srv := buildSecurityServer(t, nil)
	rr := doRequest(t, srv.handleSecurityAnalyzePod, http.MethodPost, "/api/v1/security/analyze/pod", body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	if resp["score"] == nil {
		t.Error("expected score field")
	}
	// Privileged pod should score < 80.
	if score, ok := resp["score"].(float64); ok && score >= 80 {
		t.Errorf("expected score < 80 for privileged pod, got %v", score)
	}
	issues, _ := resp["issues"].([]interface{})
	if len(issues) == 0 {
		t.Error("expected at least one security issue for privileged pod")
	}
}

func TestHandleSecurityAnalyzePod_Secure(t *testing.T) {
	body := `{"name":"secure-pod","namespace":"prod","run_as_non_root":true,"privileged":false,"allow_privilege_escalation":false,"read_only_root_fs":true,"drop_capabilities":["ALL"]}`
	srv := buildSecurityServer(t, nil)
	rr := doRequest(t, srv.handleSecurityAnalyzePod, http.MethodPost, "/api/v1/security/analyze/pod", body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	if resp["compliance"] == nil {
		t.Error("expected compliance field")
	}
}

func TestHandleSecurityAnalyzePod_MethodNotAllowed(t *testing.T) {
	srv := buildSecurityServer(t, nil)
	rr := doRequest(t, srv.handleSecurityAnalyzePod, http.MethodGet, "/api/v1/security/analyze/pod", "")
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("want 405, got %d", rr.Code)
	}
}

// ─── Integration: full dispatch round-trip ────────────────────────────────────

func TestHandleSecurityDispatch_AllRoutes(t *testing.T) {
	fetcher := &secStubFetcher{
		resources: map[string][]*pb.Resource{
			"Pod":  {podWithNoSecurityContext("api", "default")},
			"Role": {roleWithWildcard("admin-role", "default")},
		},
	}
	srv := buildSecurityServer(t, fetcher)

	routes := []struct {
		method string
		path   string
		body   string
		wantOK bool
	}{
		{"GET", "/api/v1/security/posture", "", true},
		{"GET", "/api/v1/security/issues", "", true},
		{"GET", "/api/v1/security/rbac", "", true},
		{"GET", "/api/v1/security/network", "", true},
		{"GET", "/api/v1/security/secrets", "", true},
		{"GET", "/api/v1/security/compliance", "", true},
		{"POST", "/api/v1/security/scan/image", `{"image":"alpine:3.18"}`, true},
		{"POST", "/api/v1/security/analyze/pod", `{"name":"test","namespace":"default"}`, true},
		{"GET", "/api/v1/security/unknown", "", false},
	}

	for _, tc := range routes {
		rr := doRequest(t, srv.handleSecurityDispatch, tc.method, tc.path, tc.body)
		if tc.wantOK && rr.Code != http.StatusOK {
			t.Errorf("%s %s: want 200, got %d: %s", tc.method, tc.path, rr.Code, rr.Body.String())
		}
		if !tc.wantOK && rr.Code != http.StatusNotFound {
			t.Errorf("%s %s: want 404, got %d", tc.method, tc.path, rr.Code)
		}
	}
}
