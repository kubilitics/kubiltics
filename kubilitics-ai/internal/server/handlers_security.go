package server

// A-CORE-012: Security Analysis — Real Vulnerability Scanning
//
// All endpoints backed by SecurityEngine (s.securityEngine) which scrapes live
// cluster resources and computes real RBAC audits, network policy gaps,
// secret exposures, pod security issues, and CIS compliance checks.
//
// Routes (all under /api/v1/security/...):
//   GET  /api/v1/security/posture         — full security posture snapshot (triggers scan)
//   GET  /api/v1/security/issues          — filterable list of security issues
//   GET  /api/v1/security/rbac            — RBAC audit findings
//   GET  /api/v1/security/network         — network policy gap analysis
//   GET  /api/v1/security/secrets         — secret exposure detection
//   GET  /api/v1/security/compliance      — CIS Kubernetes compliance report
//   POST /api/v1/security/scan/image      — image vulnerability scan
//   POST /api/v1/security/analyze/pod     — analyse a single pod's security context

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/security"
)

// handleSecurityDispatch routes /api/v1/security/... to the right handler.
func (s *Server) handleSecurityDispatch(w http.ResponseWriter, r *http.Request) {
	suffix := strings.TrimPrefix(r.URL.Path, "/api/v1/security")
	suffix = strings.TrimPrefix(suffix, "/")

	switch {
	case suffix == "posture" || suffix == "":
		s.handleSecurityPosture(w, r)
	case suffix == "issues":
		s.handleSecurityIssues(w, r)
	case suffix == "rbac":
		s.handleSecurityRBAC(w, r)
	case suffix == "network":
		s.handleSecurityNetwork(w, r)
	case suffix == "secrets":
		s.handleSecuritySecrets(w, r)
	case suffix == "compliance":
		s.handleSecurityCompliance(w, r)
	case suffix == "scan/image":
		s.handleSecurityScanImage(w, r)
	case suffix == "analyze/pod":
		s.handleSecurityAnalyzePod(w, r)
	default:
		http.Error(w, "not found", http.StatusNotFound)
	}
}

// ─── Posture ──────────────────────────────────────────────────────────────────

// handleSecurityPosture — GET /api/v1/security/posture
// Triggers a full cluster security scan; returns the complete snapshot.
func (s *Server) handleSecurityPosture(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.securityEngine == nil {
		jsonOK(w, map[string]interface{}{
			"note":      "security engine not initialised",
			"score":     0,
			"grade":     "F",
			"timestamp": time.Now(),
		})
		return
	}

	snap, err := s.securityEngine.Analyze(r.Context())
	if err != nil {
		http.Error(w, "security analysis failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]interface{}{
		"score":            snap.Score,
		"grade":            snap.Grade,
		"summary":          snap.Summary,
		"pod_scanned":      snap.PodCount,
		"roles_audited":    snap.RoleCount,
		"namespaces":       snap.NamespaceCount,
		"recommendations":  snap.Recommendations,
		"rbac_findings":    len(snap.RBACFindings),
		"network_gaps":     len(snap.NetworkGaps),
		"secret_exposures": len(snap.SecretExposures),
		"timestamp":        snap.Timestamp,
	})
}

// ─── Issues ───────────────────────────────────────────────────────────────────

// handleSecurityIssues — GET /api/v1/security/issues
//
// Query params:
//
//	severity  — filter by severity: CRITICAL, HIGH, MEDIUM, LOW
//	type      — filter by issue type: security_context, rbac, network_policy, secret_exposure
//	namespace — filter by namespace
func (s *Server) handleSecurityIssues(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.securityEngine == nil {
		jsonOK(w, map[string]interface{}{"issues": []interface{}{}, "total": 0, "note": "security engine not initialised"})
		return
	}

	snap, err := s.securityEngine.GetPosture(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	issues := snap.Issues

	// Apply filters.
	severityFilter := strings.ToUpper(r.URL.Query().Get("severity"))
	typeFilter := r.URL.Query().Get("type")
	nsFilter := r.URL.Query().Get("namespace")

	filtered := issues[:0:0]
	for _, iss := range issues {
		if severityFilter != "" && string(iss.Severity) != severityFilter {
			continue
		}
		if typeFilter != "" && iss.Type != typeFilter {
			continue
		}
		if nsFilter != "" && iss.Namespace != nsFilter {
			continue
		}
		filtered = append(filtered, iss)
	}

	jsonOK(w, map[string]interface{}{
		"issues":    filtered,
		"total":     len(filtered),
		"summary":   security.CalculateIssueSummary(filtered),
		"timestamp": snap.Timestamp,
	})
}

// ─── RBAC ─────────────────────────────────────────────────────────────────────

// handleSecurityRBAC — GET /api/v1/security/rbac
func (s *Server) handleSecurityRBAC(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.securityEngine == nil {
		jsonOK(w, map[string]interface{}{"findings": []interface{}{}, "note": "security engine not initialised"})
		return
	}

	snap, err := s.securityEngine.GetPosture(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	bySeverity := map[string]int{}
	for _, f := range snap.RBACFindings {
		bySeverity[string(f.Severity)]++
	}

	jsonOK(w, map[string]interface{}{
		"findings":      snap.RBACFindings,
		"total":         len(snap.RBACFindings),
		"by_severity":   bySeverity,
		"roles_audited": snap.RoleCount,
		"timestamp":     snap.Timestamp,
	})
}

// ─── Network ──────────────────────────────────────────────────────────────────

// handleSecurityNetwork — GET /api/v1/security/network
func (s *Server) handleSecurityNetwork(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.securityEngine == nil {
		jsonOK(w, map[string]interface{}{"gaps": []interface{}{}, "note": "security engine not initialised"})
		return
	}

	snap, err := s.securityEngine.GetPosture(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	totalPodsExposed := 0
	for _, g := range snap.NetworkGaps {
		totalPodsExposed += g.PodCount
	}

	jsonOK(w, map[string]interface{}{
		"gaps":               snap.NetworkGaps,
		"total_gaps":         len(snap.NetworkGaps),
		"total_pods_exposed": totalPodsExposed,
		"namespaces_scanned": snap.NamespaceCount,
		"timestamp":          snap.Timestamp,
	})
}

// ─── Secrets ─────────────────────────────────────────────────────────────────

// handleSecuritySecrets — GET /api/v1/security/secrets
func (s *Server) handleSecuritySecrets(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.securityEngine == nil {
		jsonOK(w, map[string]interface{}{"exposures": []interface{}{}, "note": "security engine not initialised"})
		return
	}

	snap, err := s.securityEngine.GetPosture(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	byRisk := map[string]int{}
	for _, ex := range snap.SecretExposures {
		byRisk[ex.RiskLevel]++
	}

	jsonOK(w, map[string]interface{}{
		"exposures": snap.SecretExposures,
		"total":     len(snap.SecretExposures),
		"by_risk":   byRisk,
		"timestamp": snap.Timestamp,
	})
}

// ─── Compliance ───────────────────────────────────────────────────────────────

// handleSecurityCompliance — GET /api/v1/security/compliance
func (s *Server) handleSecurityCompliance(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.securityEngine == nil {
		jsonOK(w, map[string]interface{}{"note": "security engine not initialised"})
		return
	}

	snap, err := s.securityEngine.GetPosture(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if snap.Compliance == nil {
		jsonOK(w, map[string]interface{}{
			"note":      "no compliance data — run posture scan first",
			"timestamp": snap.Timestamp,
		})
		return
	}

	jsonOK(w, snap.Compliance)
}

// ─── Image Scan ───────────────────────────────────────────────────────────────

// handleSecurityScanImage — POST /api/v1/security/scan/image
//
// Body: { "image": "nginx:1.21" }
func (s *Server) handleSecurityScanImage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.securityEngine == nil {
		http.Error(w, "security engine not initialised", http.StatusServiceUnavailable)
		return
	}

	var req struct {
		Image string `json:"image"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Image == "" {
		http.Error(w, "image field is required", http.StatusBadRequest)
		return
	}

	result, err := s.securityEngine.ScanImage(req.Image)
	if err != nil {
		http.Error(w, "scan failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	jsonOK(w, result)
}

// ─── Pod Analysis ─────────────────────────────────────────────────────────────

// handleSecurityAnalyzePod — POST /api/v1/security/analyze/pod
//
// Body: { "name": "...", "namespace": "...", "run_as_non_root": true, ... }
// Accepts the security context fields and returns analysis + CIS checks.
func (s *Server) handleSecurityAnalyzePod(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Name                string   `json:"name"`
		Namespace           string   `json:"namespace"`
		RunAsNonRoot        *bool    `json:"run_as_non_root"`
		RunAsUser           *int64   `json:"run_as_user"`
		ReadOnlyRootFS      *bool    `json:"read_only_root_fs"`
		Privileged          *bool    `json:"privileged"`
		AllowPrivEscalation *bool    `json:"allow_privilege_escalation"`
		DropCapabilities    []string `json:"drop_capabilities"`
		AddCapabilities     []string `json:"add_capabilities"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}

	var caps *security.Capabilities
	if len(req.AddCapabilities) > 0 || len(req.DropCapabilities) > 0 {
		caps = &security.Capabilities{
			Add:  req.AddCapabilities,
			Drop: req.DropCapabilities,
		}
	}

	ctx := &security.PodSecurityContext{
		Name:                req.Name,
		Namespace:           req.Namespace,
		RunAsNonRoot:        req.RunAsNonRoot,
		RunAsUser:           req.RunAsUser,
		ReadOnlyRootFS:      req.ReadOnlyRootFS,
		Privileged:          req.Privileged,
		AllowPrivEscalation: req.AllowPrivEscalation,
		Capabilities:        caps,
	}

	analyzer := security.NewAnalyzer()
	checker := security.NewComplianceChecker(security.CISKubernetes)

	issues := analyzer.AnalyzePodSecurity(ctx)
	cisChecks := checker.CheckPodCompliance(ctx)
	score := analyzer.CalculateSecurityScore(issues)
	grade := security.GetSecurityGrade(score)
	summary := security.CalculateIssueSummary(issues)
	compliance := security.GenerateComplianceReport(security.CISKubernetes, cisChecks)

	jsonOK(w, map[string]interface{}{
		"pod":        req.Name,
		"namespace":  req.Namespace,
		"score":      score,
		"grade":      grade,
		"summary":    summary,
		"issues":     issues,
		"compliance": compliance,
		"timestamp":  time.Now(),
	})
}
