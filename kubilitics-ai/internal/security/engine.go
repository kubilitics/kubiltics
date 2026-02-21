package security

// A-CORE-012: Security Analysis — Real Vulnerability Scanning
//
// SecurityEngine orchestrates live cluster security analysis by:
//   1. Scraping Pods, Roles, ClusterRoles, Secrets, NetworkPolicies via backend proxy
//   2. Running pod security context analysis on each pod
//   3. Running RBAC audit on all roles + cluster roles
//   4. Detecting namespaces with no network policies (lateral movement gaps)
//   5. Detecting plaintext secret exposure risk
//   6. Running CIS Kubernetes Benchmark compliance checks
//   7. Computing an overall security posture score + grade

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	pb "github.com/kubilitics/kubilitics-ai/api/proto/v1"
)

// ResourceFetcher is the minimal interface SecurityEngine needs from the backend.
// (Same interface as CostPipeline — both are satisfied by *backend.Proxy.)
type ResourceFetcher interface {
	ListResources(ctx context.Context, kind, namespace string) ([]*pb.Resource, error)
}

// NetworkPolicyGap describes a namespace that has no NetworkPolicy protection.
type NetworkPolicyGap struct {
	Namespace   string `json:"namespace"`
	PodCount    int    `json:"pod_count"`
	Description string `json:"description"`
	Remediation string `json:"remediation"`
}

// SecretExposure describes a secret that may be improperly exposed.
type SecretExposure struct {
	Name        string   `json:"name"`
	Namespace   string   `json:"namespace"`
	Type        string   `json:"secret_type"`
	RiskLevel   string   `json:"risk_level"`
	Description string   `json:"description"`
	Remediation string   `json:"remediation"`
	MountedBy   []string `json:"mounted_by,omitempty"`
}

// RBACFinding describes an over-privileged role or binding.
type RBACFinding struct {
	ResourceType string   `json:"resource_type"` // "Role","ClusterRole","RoleBinding","ClusterRoleBinding"
	Name         string   `json:"name"`
	Namespace    string   `json:"namespace,omitempty"`
	Issues       []string `json:"issues"`
	Severity     Severity `json:"severity"`
	Remediation  string   `json:"remediation"`
}

// SecuritySnapshot holds the full point-in-time security posture.
type SecuritySnapshot struct {
	Timestamp       time.Time          `json:"timestamp"`
	Score           int                `json:"score"` // 0-100
	Grade           string             `json:"grade"` // A–F
	Issues          []SecurityIssue    `json:"issues"`
	Summary         IssueSummary       `json:"summary"`
	RBACFindings    []RBACFinding      `json:"rbac_findings"`
	NetworkGaps     []NetworkPolicyGap `json:"network_policy_gaps"`
	SecretExposures []SecretExposure   `json:"secret_exposures"`
	Compliance      *ComplianceReport  `json:"compliance,omitempty"`
	Recommendations []string           `json:"recommendations"`
	PodCount        int                `json:"pod_scanned"`
	RoleCount       int                `json:"roles_audited"`
	NamespaceCount  int                `json:"namespaces_scanned"`
}

// SecurityEngine drives real security analysis against live cluster resources.
type SecurityEngine struct {
	mu       sync.RWMutex
	fetcher  ResourceFetcher
	analyzer *Analyzer
	checker  *ComplianceChecker
	scanner  *Scanner

	// Most-recent snapshot.
	lastSnapshot *SecuritySnapshot

	// Ring buffer of up to 20 snapshots.
	snapshots []SecuritySnapshot
	maxSnaps  int
}

// NewSecurityEngine creates a SecurityEngine backed by the given ResourceFetcher.
// fetcher may be nil; all analysis will run with an empty resource list (graceful degradation).
func NewSecurityEngine(fetcher ResourceFetcher) *SecurityEngine {
	return &SecurityEngine{
		fetcher:   fetcher,
		analyzer:  NewAnalyzer(),
		checker:   NewComplianceChecker(CISKubernetes),
		scanner:   NewScanner(),
		snapshots: make([]SecuritySnapshot, 0, 20),
		maxSnaps:  20,
	}
}

// ─── Public API ───────────────────────────────────────────────────────────────

// Analyze performs a full cluster security scan and returns a snapshot.
func (e *SecurityEngine) Analyze(ctx context.Context) (*SecuritySnapshot, error) {
	var allIssues []SecurityIssue
	var rbacFindings []RBACFinding
	var netGaps []NetworkPolicyGap
	var secretExposures []SecretExposure
	var allCISChecks []ComplianceCheck

	podCount := 0
	roleCount := 0

	// ─── 1. Pod Security Analysis ─────────────────────────────────────────────
	pods, _ := e.listResources(ctx, "Pod", "")
	podCount = len(pods)
	for _, pod := range pods {
		issues, cisChecks := e.analyzePod(pod)
		allIssues = append(allIssues, issues...)
		allCISChecks = append(allCISChecks, cisChecks...)
	}

	// ─── 2. RBAC Audit ────────────────────────────────────────────────────────
	roles, _ := e.listResources(ctx, "Role", "")
	clusterRoles, _ := e.listResources(ctx, "ClusterRole", "")
	roleCount = len(roles) + len(clusterRoles)

	for _, role := range roles {
		findings, issues := e.auditRole(role, false)
		rbacFindings = append(rbacFindings, findings...)
		allIssues = append(allIssues, issues...)
		allCISChecks = append(allCISChecks, e.checker.CheckRBACCompliance(role.Name, e.extractRules(role))...)
	}
	for _, cr := range clusterRoles {
		findings, issues := e.auditRole(cr, true)
		rbacFindings = append(rbacFindings, findings...)
		allIssues = append(allIssues, issues...)
		allCISChecks = append(allCISChecks, e.checker.CheckRBACCompliance(cr.Name, e.extractRules(cr))...)
	}

	// ─── 3. Network Policy Gaps ───────────────────────────────────────────────
	netPolicies, _ := e.listResources(ctx, "NetworkPolicy", "")
	namespacesWithPolicy := map[string]bool{}
	for _, np := range netPolicies {
		namespacesWithPolicy[np.Namespace] = true
	}

	// Count pods per namespace.
	podsByNS := map[string]int{}
	for _, pod := range pods {
		podsByNS[pod.Namespace]++
	}

	for ns, count := range podsByNS {
		if !namespacesWithPolicy[ns] && count > 0 {
			netGaps = append(netGaps, NetworkPolicyGap{
				Namespace:   ns,
				PodCount:    count,
				Description: fmt.Sprintf("Namespace '%s' has %d pod(s) with no NetworkPolicy — all ingress/egress is unrestricted", ns, count),
				Remediation: "Create a default-deny NetworkPolicy and explicitly allow only required traffic",
			})
			allIssues = append(allIssues, SecurityIssue{
				Type:        "network_policy",
				Severity:    SeverityHigh,
				Title:       "No NetworkPolicy in namespace",
				Description: fmt.Sprintf("Namespace %s has no network isolation", ns),
				Remediation: "Apply a default-deny NetworkPolicy",
				Resource:    ns,
				Namespace:   ns,
				Timestamp:   time.Now(),
			})
		}
	}

	// ─── 4. Secret Exposure Detection ─────────────────────────────────────────
	secrets, _ := e.listResources(ctx, "Secret", "")
	// Build pod-mount map: secret name → list of pod names.
	secretMounts := e.buildSecretMountMap(pods)

	for _, sec := range secrets {
		exposure := e.analyzeSecret(sec, secretMounts)
		if exposure != nil {
			secretExposures = append(secretExposures, *exposure)
			allIssues = append(allIssues, SecurityIssue{
				Type:        "secret_exposure",
				Severity:    Severity(exposure.RiskLevel),
				Title:       "Sensitive secret detected",
				Description: exposure.Description,
				Remediation: exposure.Remediation,
				Resource:    sec.Name,
				Namespace:   sec.Namespace,
				Timestamp:   time.Now(),
			})
		}
	}

	// ─── 5. Compliance Report (CIS Kubernetes) ────────────────────────────────
	var compliance *ComplianceReport
	if len(allCISChecks) > 0 {
		r := GenerateComplianceReport(CISKubernetes, allCISChecks)
		compliance = &r
	}

	// ─── 6. Score & Grade ─────────────────────────────────────────────────────
	score := e.analyzer.CalculateSecurityScore(allIssues)
	grade := GetSecurityGrade(score)
	summary := CalculateIssueSummary(allIssues)
	recommendations := e.analyzer.GenerateRecommendations(allIssues)
	// Supplement with network + secret recommendations.
	if len(netGaps) > 0 {
		recommendations = append(recommendations,
			"Implement NetworkPolicies in all namespaces with default-deny rules",
			"Use Calico or Cilium for fine-grained network segmentation",
		)
	}
	if len(secretExposures) > 0 {
		recommendations = append(recommendations,
			"Rotate exposed credentials and audit secret access patterns",
			"Use external secret managers (Vault, AWS SSM) instead of native K8s secrets",
		)
	}

	// Deduplicate recommendations.
	recs := dedup(recommendations)

	// Sort findings by severity.
	sort.Slice(allIssues, func(i, j int) bool {
		return severityRank(allIssues[i].Severity) > severityRank(allIssues[j].Severity)
	})
	sort.Slice(rbacFindings, func(i, j int) bool {
		return severityRank(rbacFindings[i].Severity) > severityRank(rbacFindings[j].Severity)
	})

	// Count unique namespaces.
	nsSet := map[string]bool{}
	for _, p := range pods {
		nsSet[p.Namespace] = true
	}

	snap := &SecuritySnapshot{
		Timestamp:       time.Now(),
		Score:           score,
		Grade:           grade,
		Issues:          allIssues,
		Summary:         summary,
		RBACFindings:    rbacFindings,
		NetworkGaps:     netGaps,
		SecretExposures: secretExposures,
		Compliance:      compliance,
		Recommendations: recs,
		PodCount:        podCount,
		RoleCount:       roleCount,
		NamespaceCount:  len(nsSet),
	}

	e.mu.Lock()
	e.lastSnapshot = snap
	e.recordSnapshot(*snap)
	e.mu.Unlock()

	return snap, nil
}

// GetLastSnapshot returns the most-recent snapshot, nil if never analyzed.
func (e *SecurityEngine) GetLastSnapshot() *SecuritySnapshot {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.lastSnapshot
}

// GetSnapshots returns stored snapshots (oldest first).
func (e *SecurityEngine) GetSnapshots() []SecuritySnapshot {
	e.mu.RLock()
	defer e.mu.RUnlock()
	out := make([]SecuritySnapshot, len(e.snapshots))
	copy(out, e.snapshots)
	return out
}

// ScanImage proxies to the embedded scanner.
func (e *SecurityEngine) ScanImage(image string) (*ImageScanResult, error) {
	return e.scanner.ScanImage(image)
}

// GetPosture returns the last snapshot (triggers analysis if none exists).
func (e *SecurityEngine) GetPosture(ctx context.Context) (*SecuritySnapshot, error) {
	snap := e.GetLastSnapshot()
	if snap == nil {
		return e.Analyze(ctx)
	}
	return snap, nil
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

func (e *SecurityEngine) listResources(ctx context.Context, kind, ns string) ([]*pb.Resource, error) {
	if e.fetcher == nil {
		return nil, nil
	}
	return e.fetcher.ListResources(ctx, kind, ns)
}

// analyzePod extracts security context from a pod's JSON Data and runs analysis.
func (e *SecurityEngine) analyzePod(pod *pb.Resource) ([]SecurityIssue, []ComplianceCheck) {
	var data map[string]interface{}
	if len(pod.Data) > 0 {
		_ = json.Unmarshal(pod.Data, &data)
	}

	ctx := extractPodSecurityContext(pod.Name, pod.Namespace, data)
	issues := e.analyzer.AnalyzePodSecurity(ctx)
	checks := e.checker.CheckPodCompliance(ctx)
	return issues, checks
}

// auditRole extracts rules from a Role/ClusterRole and runs RBAC analysis.
func (e *SecurityEngine) auditRole(role *pb.Resource, isCluster bool) ([]RBACFinding, []SecurityIssue) {
	rules := e.extractRules(role)
	issues := e.analyzer.AnalyzeRBAC(role.Name, rules)

	var findings []RBACFinding
	if len(issues) > 0 {
		issueTexts := make([]string, len(issues))
		maxSeverity := SeverityLow
		for i, iss := range issues {
			issueTexts[i] = iss.Title
			if severityRank(iss.Severity) > severityRank(maxSeverity) {
				maxSeverity = iss.Severity
			}
		}

		kind := "Role"
		if isCluster {
			kind = "ClusterRole"
		}
		findings = append(findings, RBACFinding{
			ResourceType: kind,
			Name:         role.Name,
			Namespace:    role.Namespace,
			Issues:       issueTexts,
			Severity:     maxSeverity,
			Remediation:  "Review and restrict permissions following the principle of least privilege",
		})
	}

	return findings, issues
}

// extractRules parses RBAC rules from a Role/ClusterRole resource's JSON Data.
func (e *SecurityEngine) extractRules(role *pb.Resource) []RBACRule {
	var data map[string]interface{}
	if len(role.Data) > 0 {
		_ = json.Unmarshal(role.Data, &data)
	}

	rawRules, _ := data["rules"].([]interface{})
	var rules []RBACRule
	for _, r := range rawRules {
		rm, _ := r.(map[string]interface{})
		if rm == nil {
			continue
		}
		rule := RBACRule{
			Verbs:     toStringSlice(rm["verbs"]),
			Resources: toStringSlice(rm["resources"]),
			APIGroups: toStringSlice(rm["apiGroups"]),
		}
		rules = append(rules, rule)
	}
	return rules
}

// buildSecretMountMap maps secret names to the list of pod names that mount them.
func (e *SecurityEngine) buildSecretMountMap(pods []*pb.Resource) map[string][]string {
	mounts := map[string][]string{}
	for _, pod := range pods {
		var data map[string]interface{}
		if len(pod.Data) > 0 {
			_ = json.Unmarshal(pod.Data, &data)
		}
		spec, _ := data["spec"].(map[string]interface{})
		if spec == nil {
			continue
		}
		volumes, _ := spec["volumes"].([]interface{})
		for _, v := range volumes {
			vm, _ := v.(map[string]interface{})
			if vm == nil {
				continue
			}
			secretVol, _ := vm["secret"].(map[string]interface{})
			if secretVol == nil {
				continue
			}
			secretName, _ := secretVol["secretName"].(string)
			if secretName != "" {
				key := fmt.Sprintf("%s/%s", pod.Namespace, secretName)
				mounts[key] = append(mounts[key], pod.Name)
			}
		}
	}
	return mounts
}

// analyzeSecret checks a secret for exposure risk.
func (e *SecurityEngine) analyzeSecret(sec *pb.Resource, mounts map[string][]string) *SecretExposure {
	var data map[string]interface{}
	if len(sec.Data) > 0 {
		_ = json.Unmarshal(sec.Data, &data)
	}

	secretType, _ := data["type"].(string)
	if secretType == "" {
		secretType = "Opaque"
	}

	// Determine risk level based on secret type and name.
	riskLevel := determineSecretRisk(sec.Name, secretType)
	if riskLevel == "" {
		return nil // Not a high-risk secret.
	}

	mountKey := fmt.Sprintf("%s/%s", sec.Namespace, sec.Name)
	mountedBy := mounts[mountKey]

	return &SecretExposure{
		Name:        sec.Name,
		Namespace:   sec.Namespace,
		Type:        secretType,
		RiskLevel:   riskLevel,
		Description: fmt.Sprintf("Secret '%s/%s' (type: %s) has elevated exposure risk", sec.Namespace, sec.Name, secretType),
		Remediation: "Rotate credentials, restrict RBAC access, and consider using an external secret manager",
		MountedBy:   mountedBy,
	}
}

func (e *SecurityEngine) recordSnapshot(snap SecuritySnapshot) {
	if len(e.snapshots) >= e.maxSnaps {
		e.snapshots = e.snapshots[1:]
	}
	e.snapshots = append(e.snapshots, snap)
}

// ─── Static helper functions ──────────────────────────────────────────────────

// extractPodSecurityContext reads security context fields from pod JSON.
func extractPodSecurityContext(name, namespace string, data map[string]interface{}) *PodSecurityContext {
	ctx := &PodSecurityContext{Name: name, Namespace: namespace}
	if data == nil {
		return ctx
	}

	spec, _ := data["spec"].(map[string]interface{})
	if spec == nil {
		return ctx
	}

	// Pod-level security context.
	podSC, _ := spec["securityContext"].(map[string]interface{})

	containers, _ := spec["containers"].([]interface{})
	// Merge pod-level and first container-level security context (conservative: use most permissive).
	var containerSC map[string]interface{}
	if len(containers) > 0 {
		if c, ok := containers[0].(map[string]interface{}); ok {
			containerSC, _ = c["securityContext"].(map[string]interface{})
		}
	}

	// runAsNonRoot
	if podSC != nil {
		if v, ok := podSC["runAsNonRoot"].(bool); ok {
			ctx.RunAsNonRoot = &v
		}
		if v, ok := podSC["runAsUser"].(float64); ok {
			uid := int64(v)
			ctx.RunAsUser = &uid
		}
	}

	// Container-level overrides take precedence.
	if containerSC != nil {
		if v, ok := containerSC["privileged"].(bool); ok {
			ctx.Privileged = &v
		}
		if v, ok := containerSC["allowPrivilegeEscalation"].(bool); ok {
			ctx.AllowPrivEscalation = &v
		}
		if v, ok := containerSC["readOnlyRootFilesystem"].(bool); ok {
			ctx.ReadOnlyRootFS = &v
		}
		if capMap, ok := containerSC["capabilities"].(map[string]interface{}); ok {
			ctx.Capabilities = &Capabilities{
				Add:  toStringSlice(capMap["add"]),
				Drop: toStringSlice(capMap["drop"]),
			}
		}
	}

	return ctx
}

// determineSecretRisk returns a risk level string for well-known sensitive secret patterns.
// Returns "" if the secret is not considered high-risk.
func determineSecretRisk(name, secretType string) string {
	name = strings.ToLower(name)

	// kubernetes.io/service-account-token and TLS certs are always worth noting.
	switch secretType {
	case "kubernetes.io/service-account-token":
		return string(SeverityMedium)
	case "kubernetes.io/tls":
		return string(SeverityMedium)
	case "kubernetes.io/dockerconfigjson", "kubernetes.io/dockercfg":
		return string(SeverityHigh)
	case "bootstrap.kubernetes.io/token":
		return string(SeverityHigh)
	}

	// Pattern-based: names that suggest credentials.
	sensitivePatterns := []string{
		"password", "passwd", "secret", "token", "credential", "api-key", "apikey",
		"private-key", "privatekey", "auth", "cert", "tls", "ssh-key", "sshkey",
		"database", "db-pass", "db-password",
	}
	for _, pat := range sensitivePatterns {
		if strings.Contains(name, pat) {
			return string(SeverityHigh)
		}
	}

	return ""
}

func severityRank(s Severity) int {
	switch s {
	case SeverityCritical:
		return 4
	case SeverityHigh:
		return 3
	case SeverityMedium:
		return 2
	case SeverityLow:
		return 1
	default:
		return 0
	}
}

func toStringSlice(v interface{}) []string {
	arr, _ := v.([]interface{})
	out := make([]string, 0, len(arr))
	for _, item := range arr {
		if s, ok := item.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func dedup(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}
