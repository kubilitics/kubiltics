package security

import (
	"strings"
	"testing"
	"time"
)

// TestSecurityScanningPipeline tests the complete security scanning workflow
func TestSecurityScanningPipeline(t *testing.T) {
	t.Run("End-to-end image scanning", func(t *testing.T) {
		scanner := NewScanner()

		// Scan a vulnerable image
		result, err := scanner.ScanImage("nginx:1.19")
		if err != nil {
			t.Fatalf("Failed to scan image: %v", err)
		}

		// Validate scan result
		if result.Image != "nginx:1.19" {
			t.Errorf("Expected image 'nginx:1.19', got '%s'", result.Image)
		}

		if result.VulnerabilityCount == 0 {
			t.Error("Expected to find vulnerabilities in nginx:1.19")
		}

		// Check vulnerability severity breakdown
		total := result.CriticalCount + result.HighCount + result.MediumCount + result.LowCount + result.InfoCount
		if total != result.VulnerabilityCount {
			t.Errorf("Severity counts don't match total: %d vs %d", total, result.VulnerabilityCount)
		}

		// Risk score should be calculated
		if result.RiskScore < 0 || result.RiskScore > 100 {
			t.Errorf("Invalid risk score: %f", result.RiskScore)
		}

		t.Logf("Scan results: %d vulnerabilities, risk score %.1f (%s)",
			result.VulnerabilityCount, result.RiskScore, result.RiskLevel)
	})

	t.Run("Multiple image scanning", func(t *testing.T) {
		scanner := NewScanner()
		images := []string{"nginx:1.19", "redis:6.0", "postgres:12"}

		for _, image := range images {
			result, err := scanner.ScanImage(image)
			if err != nil {
				t.Errorf("Failed to scan %s: %v", image, err)
				continue
			}

			t.Logf("Image %s: %d vulns, risk %.1f", image, result.VulnerabilityCount, result.RiskScore)
		}
	})

	t.Run("Vulnerability details validation", func(t *testing.T) {
		scanner := NewScanner()
		result, err := scanner.ScanImage("nginx:1.19")
		if err != nil {
			t.Fatalf("Failed to scan: %v", err)
		}

		if len(result.Vulnerabilities) == 0 {
			t.Fatal("Expected vulnerabilities in result")
		}

		// Check first vulnerability has required fields
		vuln := result.Vulnerabilities[0]
		if vuln.CVEID == "" {
			t.Error("Vulnerability missing CVE ID")
		}
		if vuln.Severity == "" {
			t.Error("Vulnerability missing severity")
		}
		if vuln.Package == "" {
			t.Error("Vulnerability missing package")
		}
		if vuln.Description == "" {
			t.Error("Vulnerability missing description")
		}

		t.Logf("Sample vulnerability: %s (%s) - %s", vuln.CVEID, vuln.Severity, vuln.Package)
	})
}

// TestSecurityAnalysisPipeline tests security analysis workflow
func TestSecurityAnalysisPipeline(t *testing.T) {
	t.Run("Pod security analysis", func(t *testing.T) {
		analyzer := NewAnalyzer()

		// Insecure pod configuration
		insecureCtx := &PodSecurityContext{
			Name:                "insecure-pod",
			Namespace:           "production",
			Privileged:          boolPtr(true),
			RunAsNonRoot:        boolPtr(false),
			AllowPrivEscalation: boolPtr(true),
			ReadOnlyRootFS:      boolPtr(false),
		}

		issues := analyzer.AnalyzePodSecurity(insecureCtx)

		// Should find multiple issues
		if len(issues) == 0 {
			t.Error("Expected to find security issues in insecure pod")
		}

		// Should have critical issues
		criticalFound := false
		for _, issue := range issues {
			if issue.Severity == SeverityCritical {
				criticalFound = true
				t.Logf("Critical issue: %s - %s", issue.Title, issue.Description)
			}
		}

		if !criticalFound {
			t.Error("Expected critical issues for privileged pod")
		}

		// Calculate security score
		score := analyzer.CalculateSecurityScore(issues)
		if score >= 80 {
			t.Errorf("Expected low security score for insecure pod, got %d", score)
		}

		t.Logf("Insecure pod: %d issues, score %d", len(issues), score)
	})

	t.Run("Secure pod analysis", func(t *testing.T) {
		analyzer := NewAnalyzer()

		// Secure pod configuration
		secureCtx := &PodSecurityContext{
			Name:                "secure-pod",
			Namespace:           "production",
			Privileged:          boolPtr(false),
			RunAsNonRoot:        boolPtr(true),
			RunAsUser:           int64Ptr(1000),
			AllowPrivEscalation: boolPtr(false),
			ReadOnlyRootFS:      boolPtr(true),
			Capabilities: &Capabilities{
				Drop: []string{"ALL"},
			},
		}

		issues := analyzer.AnalyzePodSecurity(secureCtx)

		// Should have few or no issues
		if len(issues) > 2 {
			t.Errorf("Expected minimal issues for secure pod, got %d", len(issues))
		}

		score := analyzer.CalculateSecurityScore(issues)
		if score < 90 {
			t.Errorf("Expected high security score for secure pod, got %d", score)
		}

		t.Logf("Secure pod: %d issues, score %d", len(issues), score)
	})

	t.Run("RBAC analysis", func(t *testing.T) {
		analyzer := NewAnalyzer()

		// Dangerous RBAC configuration
		dangerousRules := []RBACRule{
			{
				Verbs:     []string{"*"},
				Resources: []string{"*"},
				APIGroups: []string{"*"},
			},
		}

		issues := analyzer.AnalyzeRBAC("cluster-admin", dangerousRules)

		// Should detect wildcard permissions
		if len(issues) == 0 {
			t.Error("Expected issues for wildcard RBAC permissions")
		}

		wildcardFound := false
		for _, issue := range issues {
			if strings.Contains(strings.ToLower(issue.Type), "wildcard") {
				wildcardFound = true
			}
		}

		if !wildcardFound {
			t.Error("Expected wildcard permission detection")
		}

		t.Logf("Dangerous RBAC: %d issues detected", len(issues))
	})

	t.Run("Security score grading", func(t *testing.T) {
		testCases := []struct {
			score         int
			expectedGrade string
		}{
			{95, "A"},
			{85, "B"},
			{75, "C"},
			{65, "D"},
			{55, "F"},
		}

		for _, tc := range testCases {
			grade := GetSecurityGrade(tc.score)
			if grade != tc.expectedGrade {
				t.Errorf("Score %d: expected grade %s, got %s", tc.score, tc.expectedGrade, grade)
			}
		}
	})
}

// TestComplianceCheckPipeline tests compliance checking workflow
func TestComplianceCheckPipeline(t *testing.T) {
	t.Run("CIS Kubernetes pod compliance", func(t *testing.T) {
		checker := NewComplianceChecker(CISKubernetes)

		// Non-compliant pod
		nonCompliantCtx := &PodSecurityContext{
			Name:                "non-compliant",
			Namespace:           "default",
			Privileged:          boolPtr(true),
			RunAsNonRoot:        boolPtr(false),
			AllowPrivEscalation: boolPtr(true),
		}

		checks := checker.CheckPodCompliance(nonCompliantCtx)

		// Should have compliance checks
		if len(checks) == 0 {
			t.Error("Expected CIS compliance checks")
		}

		// Should have failures
		failureCount := 0
		for _, check := range checks {
			if check.Status == StatusFail {
				failureCount++
				t.Logf("Failed check: %s - %s", check.ID, check.Title)
			}
		}

		if failureCount == 0 {
			t.Error("Expected failed compliance checks for non-compliant pod")
		}

		// Generate compliance report
		report := GenerateComplianceReport(CISKubernetes, checks)

		if report.TotalChecks != len(checks) {
			t.Errorf("Report total mismatch: %d vs %d", report.TotalChecks, len(checks))
		}

		if report.ComplianceScore > 50 {
			t.Errorf("Expected low compliance score, got %.1f%%", report.ComplianceScore)
		}

		t.Logf("CIS compliance: %.1f%% (%d/%d passed)",
			report.ComplianceScore, report.PassedChecks, report.TotalChecks)
	})

	t.Run("CIS Kubernetes RBAC compliance", func(t *testing.T) {
		checker := NewComplianceChecker(CISKubernetes)

		wildcardRules := []RBACRule{
			{
				Verbs:     []string{"*"},
				Resources: []string{"pods"},
				APIGroups: []string{""},
			},
		}

		checks := checker.CheckRBACCompliance("test-role", wildcardRules)

		// Should check for wildcard usage
		wildcardCheckFound := false
		for _, check := range checks {
			if strings.Contains(check.ID, "5.1.3") { // CIS check for wildcards
				wildcardCheckFound = true
				if check.Status != StatusFail {
					t.Error("Expected wildcard check to fail")
				}
			}
		}

		if !wildcardCheckFound {
			t.Error("Expected CIS 5.1.3 wildcard check")
		}
	})

	t.Run("Pod Security Standards compliance", func(t *testing.T) {
		checker := NewComplianceChecker(PodSecurity)

		// Test baseline profile
		baselineCtx := &PodSecurityContext{
			Name:       "baseline-test",
			Namespace:  "default",
			Privileged: boolPtr(false),
		}

		checks := checker.CheckPodCompliance(baselineCtx)

		if len(checks) == 0 {
			t.Error("Expected Pod Security Standards checks")
		}

		t.Logf("PSS checks: %d total", len(checks))
	})

	t.Run("Compliance report generation", func(t *testing.T) {
		checker := NewComplianceChecker(CISKubernetes)

		ctx := &PodSecurityContext{
			Name:           "test-pod",
			Namespace:      "default",
			Privileged:     boolPtr(false),
			RunAsNonRoot:   boolPtr(true),
			ReadOnlyRootFS: boolPtr(true),
			Capabilities: &Capabilities{
				Drop: []string{"ALL"},
			},
		}

		checks := checker.CheckPodCompliance(ctx)
		report := GenerateComplianceReport(CISKubernetes, checks)

		// Validate report structure
		if report.Standard != CISKubernetes {
			t.Error("Report has wrong standard")
		}

		if report.TotalChecks == 0 {
			t.Error("Report should have checks")
		}

		// Compliance score should be 0-100
		if report.ComplianceScore < 0 || report.ComplianceScore > 100 {
			t.Errorf("Invalid compliance score: %.1f", report.ComplianceScore)
		}

		// Counts should add up
		total := report.PassedChecks + report.FailedChecks + report.WarningChecks
		if total != report.TotalChecks {
			t.Errorf("Check counts don't add up: %d vs %d", total, report.TotalChecks)
		}

		t.Logf("Compliance report: %.1f%% - %d passed, %d failed, %d warnings",
			report.ComplianceScore, report.PassedChecks, report.FailedChecks, report.WarningChecks)
	})
}

// TestSecurityIntegrationPerformance tests performance with multiple scans
func TestSecurityIntegrationPerformance(t *testing.T) {
	t.Run("Concurrent image scanning", func(t *testing.T) {
		scanner := NewScanner()
		images := []string{"nginx:1.19", "redis:6.0", "postgres:12", "mongodb:4.4", "mysql:8.0"}

		results := make(chan *ImageScanResult, len(images))
		errors := make(chan error, len(images))

		for _, image := range images {
			go func(img string) {
				result, err := scanner.ScanImage(img)
				if err != nil {
					errors <- err
					return
				}
				results <- result
			}(image)
		}

		// Collect results
		successCount := 0
		for i := 0; i < len(images); i++ {
			select {
			case result := <-results:
				successCount++
				t.Logf("Scanned %s: %d vulnerabilities", result.Image, result.VulnerabilityCount)
			case err := <-errors:
				t.Errorf("Scan failed: %v", err)
			case <-time.After(10 * time.Second):
				t.Fatal("Timeout waiting for scans")
			}
		}

		if successCount != len(images) {
			t.Errorf("Expected %d successful scans, got %d", len(images), successCount)
		}
	})

	t.Run("Bulk compliance checking", func(t *testing.T) {
		checker := NewComplianceChecker(CISKubernetes)

		// Check 50 pod configurations
		start := time.Now()
		for i := 0; i < 50; i++ {
			ctx := &PodSecurityContext{
				Name:         "test-pod",
				Namespace:    "default",
				Privileged:   boolPtr(i%2 == 0),
				RunAsNonRoot: boolPtr(i%2 == 1),
			}
			checker.CheckPodCompliance(ctx)
		}
		duration := time.Since(start)

		// Should complete quickly (< 1 second for 50 pods)
		if duration > time.Second {
			t.Errorf("Bulk compliance checking too slow: %v", duration)
		}

		t.Logf("Checked 50 pods in %v", duration)
	})
}

// Helper functions
func boolPtr(b bool) *bool {
	return &b
}

func int64Ptr(i int64) *int64 {
	return &i
}

// BenchmarkSecurityOperations benchmarks security operations
func BenchmarkSecurityOperations(b *testing.B) {
	b.Run("ImageScanning", func(b *testing.B) {
		scanner := NewScanner()
		for i := 0; i < b.N; i++ {
			scanner.ScanImage("nginx:1.19")
		}
	})

	b.Run("PodSecurityAnalysis", func(b *testing.B) {
		analyzer := NewAnalyzer()
		ctx := &PodSecurityContext{
			Name:       "test-pod",
			Namespace:  "default",
			Privileged: boolPtr(true),
		}

		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			analyzer.AnalyzePodSecurity(ctx)
		}
	})

	b.Run("ComplianceCheck", func(b *testing.B) {
		checker := NewComplianceChecker(CISKubernetes)
		ctx := &PodSecurityContext{
			Name:       "test-pod",
			Namespace:  "default",
			Privileged: boolPtr(false),
		}

		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			checker.CheckPodCompliance(ctx)
		}
	})
}
