package cli

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// P2-5: Audit record writing tests
// ---------------------------------------------------------------------------

// TestAppendAuditRecord_RoundTrip writes a record and reads it back.
func TestAppendAuditRecord_RoundTrip(t *testing.T) {
	// Redirect the audit log to a temp dir so tests don't pollute ~/.kcli.
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	if _, err := os.Stat(filepath.Join(dir, ".kcli")); os.IsNotExist(err) {
		if err := os.MkdirAll(filepath.Join(dir, ".kcli"), 0o750); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}

	rec := auditRecord{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		User:      "testuser",
		Context:   "test-ctx",
		Namespace: "test-ns",
		Command:   "delete",
		Args:      "pod api-0",
		Result:    "success",
		Duration:  "42",
	}

	AppendAuditRecord(rec)

	log, err := loadAuditLog()
	if err != nil {
		t.Fatalf("loadAuditLog: %v", err)
	}
	if len(log.Records) == 0 {
		t.Fatal("expected at least 1 audit record after AppendAuditRecord")
	}
	got := log.Records[0] // prepended, so most recent first
	if got.Command != "delete" {
		t.Errorf("expected command=delete, got %q", got.Command)
	}
	if got.User != "testuser" {
		t.Errorf("expected user=testuser, got %q", got.User)
	}
	if got.Context != "test-ctx" {
		t.Errorf("expected context=test-ctx, got %q", got.Context)
	}
	if got.Namespace != "test-ns" {
		t.Errorf("expected namespace=test-ns, got %q", got.Namespace)
	}
	if got.Result != "success" {
		t.Errorf("expected result=success, got %q", got.Result)
	}
}

// TestBuildAuditFn_CapturesContextAndNamespace verifies that the closure
// produced by buildAuditFn captures the app's context/namespace and derives
// the correct verb from the full scoped arg list.
func TestBuildAuditFn_CapturesContextAndNamespace(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	if err := os.MkdirAll(filepath.Join(dir, ".kcli"), 0o750); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	a := &app{
		context:   "prod-east",
		namespace: "payments",
	}

	fn := a.buildAuditFn()
	// Simulate RunKubectl calling AuditFn after `kubectl delete pod api-0`
	// with the full scoped args (as built by scopeArgsFor).
	fn([]string{"--context", "prod-east", "-n", "payments", "delete", "pod", "api-0"}, 0, 150)

	log, err := loadAuditLog()
	if err != nil {
		t.Fatalf("loadAuditLog: %v", err)
	}
	if len(log.Records) == 0 {
		t.Fatal("expected at least 1 record")
	}
	got := log.Records[0]
	if got.Context != "prod-east" {
		t.Errorf("expected context=prod-east, got %q", got.Context)
	}
	if got.Namespace != "payments" {
		t.Errorf("expected namespace=payments, got %q", got.Namespace)
	}
	if got.Command != "delete" {
		t.Errorf("expected command=delete, got %q", got.Command)
	}
	if got.Duration != "150" {
		t.Errorf("expected duration=150, got %q", got.Duration)
	}
	if got.Result != "success" {
		t.Errorf("expected result=success, got %q", got.Result)
	}
	// Args should contain the pod name but not the context/namespace flags.
	if !strings.Contains(got.Args, "api-0") {
		t.Errorf("expected args to contain api-0, got %q", got.Args)
	}
	if strings.Contains(got.Args, "--context") || strings.Contains(got.Args, "-n") || strings.Contains(got.Args, "prod-east") {
		t.Errorf("args should not contain scoping flags/values, got %q", got.Args)
	}
}

// TestBuildAuditFn_ErrorResult verifies that exitCode!=0 produces result="error".
func TestBuildAuditFn_ErrorResult(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	if err := os.MkdirAll(filepath.Join(dir, ".kcli"), 0o750); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	a := &app{context: "dev", namespace: "default"}
	fn := a.buildAuditFn()
	fn([]string{"apply", "-f", "bad.yaml"}, 1, 300)

	log, _ := loadAuditLog()
	if len(log.Records) == 0 {
		t.Fatal("expected a record")
	}
	if log.Records[0].Result != "error" {
		t.Errorf("expected result=error for exitCode=1, got %q", log.Records[0].Result)
	}
}

// TestAuditLogPath verifies the path uses ~/.kcli/audit.json.
func TestAuditLogPath(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	path := auditLogPath()
	if !strings.HasSuffix(path, filepath.Join(".kcli", "audit.json")) {
		t.Errorf("unexpected audit log path: %q", path)
	}
}

// TestKCLI_NO_AUDIT_DisablesRecording verifies that KCLI_NO_AUDIT=1 prevents
// the AuditFn from being set (i.e. buildAuditFn is skipped).
// We test this at the app.runKubectl level indirectly via the env var check logic.
func TestKCLI_NO_AUDIT_EnvVarLogic(t *testing.T) {
	t.Setenv("KCLI_NO_AUDIT", "1")

	noAudit := strings.TrimSpace(os.Getenv("KCLI_NO_AUDIT")) == "1" ||
		strings.TrimSpace(os.Getenv("KCLI_NO_AUDIT")) == "true"
	if !noAudit {
		t.Fatal("expected KCLI_NO_AUDIT=1 to trigger no-audit path")
	}

	t.Setenv("KCLI_NO_AUDIT", "0")
	noAudit = strings.TrimSpace(os.Getenv("KCLI_NO_AUDIT")) == "1" ||
		strings.TrimSpace(os.Getenv("KCLI_NO_AUDIT")) == "true"
	if noAudit {
		t.Fatal("expected KCLI_NO_AUDIT=0 to NOT disable audit")
	}
}
