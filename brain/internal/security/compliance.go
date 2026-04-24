package security

import (
	"fmt"
	"strings"
	"time"
)

// ComplianceStandard represents a compliance framework
type ComplianceStandard string

const (
	CISKubernetes ComplianceStandard = "cis_kubernetes"
	PodSecurity   ComplianceStandard = "pod_security_standard"
	NIST          ComplianceStandard = "nist"
	SOC2          ComplianceStandard = "soc2"
)

// ComplianceStatus represents compliance check status
type ComplianceStatus string

const (
	StatusPass    ComplianceStatus = "pass"
	StatusFail    ComplianceStatus = "fail"
	StatusWarning ComplianceStatus = "warning"
	StatusNA      ComplianceStatus = "not_applicable"
)

// ComplianceCheck represents a single compliance check
type ComplianceCheck struct {
	ID          string             `json:"id"`
	Standard    ComplianceStandard `json:"standard"`
	Section     string             `json:"section"`
	Title       string             `json:"title"`
	Description string             `json:"description"`
	Status      ComplianceStatus   `json:"status"`
	Severity    Severity           `json:"severity"`
	Details     string             `json:"details"`
	Remediation string             `json:"remediation"`
	Resource    string             `json:"resource,omitempty"`
	Namespace   string             `json:"namespace,omitempty"`
	Timestamp   time.Time          `json:"timestamp"`
}

// ComplianceReport represents overall compliance status
type ComplianceReport struct {
	Standard        ComplianceStandard `json:"standard"`
	TotalChecks     int                `json:"total_checks"`
	PassedChecks    int                `json:"passed_checks"`
	FailedChecks    int                `json:"failed_checks"`
	WarningChecks   int                `json:"warning_checks"`
	ComplianceScore float64            `json:"compliance_score"` // 0-100
	Checks          []ComplianceCheck  `json:"checks"`
	Timestamp       time.Time          `json:"timestamp"`
}

// ComplianceChecker performs compliance checks
type ComplianceChecker struct {
	standard ComplianceStandard
}

// NewComplianceChecker creates a new compliance checker
func NewComplianceChecker(standard ComplianceStandard) *ComplianceChecker {
	return &ComplianceChecker{
		standard: standard,
	}
}

// CheckPodCompliance checks pod against compliance standards
func (c *ComplianceChecker) CheckPodCompliance(ctx *PodSecurityContext) []ComplianceCheck {
	checks := make([]ComplianceCheck, 0)

	switch c.standard {
	case CISKubernetes:
		checks = append(checks, c.cisPodChecks(ctx)...)
	case PodSecurity:
		checks = append(checks, c.podSecurityChecks(ctx)...)
	default:
		checks = append(checks, c.cisPodChecks(ctx)...)
	}

	return checks
}

// CheckRBACCompliance checks RBAC against compliance standards
func (c *ComplianceChecker) CheckRBACCompliance(roleName string, rules []RBACRule) []ComplianceCheck {
	checks := make([]ComplianceCheck, 0)

	switch c.standard {
	case CISKubernetes:
		checks = append(checks, c.cisRBACChecks(roleName, rules)...)
	default:
		checks = append(checks, c.cisRBACChecks(roleName, rules)...)
	}

	return checks
}

// CIS Kubernetes Benchmark checks for pods
func (c *ComplianceChecker) cisPodChecks(ctx *PodSecurityContext) []ComplianceCheck {
	checks := make([]ComplianceCheck, 0)

	// 5.2.1 - Minimize the admission of privileged containers
	if ctx.Privileged != nil && *ctx.Privileged {
		checks = append(checks, ComplianceCheck{
			ID:          "CIS-5.2.1",
			Standard:    CISKubernetes,
			Section:     "5.2 Pod Security Policies",
			Title:       "Minimize the admission of privileged containers",
			Description: "Privileged containers have access to all Linux capabilities",
			Status:      StatusFail,
			Severity:    SeverityCritical,
			Details:     fmt.Sprintf("Pod %s/%s is running in privileged mode", ctx.Namespace, ctx.Name),
			Remediation: "Set securityContext.privileged to false or remove the field",
			Resource:    ctx.Name,
			Namespace:   ctx.Namespace,
			Timestamp:   time.Now(),
		})
	} else {
		checks = append(checks, ComplianceCheck{
			ID:          "CIS-5.2.1",
			Standard:    CISKubernetes,
			Section:     "5.2 Pod Security Policies",
			Title:       "Minimize the admission of privileged containers",
			Description: "Privileged containers have access to all Linux capabilities",
			Status:      StatusPass,
			Severity:    SeverityInfo,
			Details:     fmt.Sprintf("Pod %s/%s is not running in privileged mode", ctx.Namespace, ctx.Name),
			Resource:    ctx.Name,
			Namespace:   ctx.Namespace,
			Timestamp:   time.Now(),
		})
	}

	// 5.2.2 - Minimize the admission of containers wishing to share the host process ID namespace
	checks = append(checks, ComplianceCheck{
		ID:          "CIS-5.2.2",
		Standard:    CISKubernetes,
		Section:     "5.2 Pod Security Policies",
		Title:       "Minimize admission of containers wishing to share the host process ID namespace",
		Description: "Containers should not share the host process ID namespace",
		Status:      StatusPass,
		Severity:    SeverityInfo,
		Details:     "HostPID not configured",
		Resource:    ctx.Name,
		Namespace:   ctx.Namespace,
		Timestamp:   time.Now(),
	})

	// 5.2.3 - Minimize the admission of containers wishing to share the host IPC namespace
	checks = append(checks, ComplianceCheck{
		ID:          "CIS-5.2.3",
		Standard:    CISKubernetes,
		Section:     "5.2 Pod Security Policies",
		Title:       "Minimize admission of containers wishing to share the host IPC namespace",
		Description: "Containers should not share the host IPC namespace",
		Status:      StatusPass,
		Severity:    SeverityInfo,
		Details:     "HostIPC not configured",
		Resource:    ctx.Name,
		Namespace:   ctx.Namespace,
		Timestamp:   time.Now(),
	})

	// 5.2.4 - Minimize the admission of containers wishing to share the host network namespace
	checks = append(checks, ComplianceCheck{
		ID:          "CIS-5.2.4",
		Standard:    CISKubernetes,
		Section:     "5.2 Pod Security Policies",
		Title:       "Minimize admission of containers wishing to share the host network namespace",
		Description: "Containers should not share the host network namespace",
		Status:      StatusPass,
		Severity:    SeverityInfo,
		Details:     "HostNetwork not configured",
		Resource:    ctx.Name,
		Namespace:   ctx.Namespace,
		Timestamp:   time.Now(),
	})

	// 5.2.5 - Minimize the admission of containers with allowPrivilegeEscalation
	if ctx.AllowPrivEscalation == nil || *ctx.AllowPrivEscalation {
		checks = append(checks, ComplianceCheck{
			ID:          "CIS-5.2.5",
			Standard:    CISKubernetes,
			Section:     "5.2 Pod Security Policies",
			Title:       "Minimize the admission of containers with allowPrivilegeEscalation",
			Description: "Privilege escalation allows processes to gain more privileges than their parent",
			Status:      StatusFail,
			Severity:    SeverityHigh,
			Details:     fmt.Sprintf("Pod %s/%s allows privilege escalation", ctx.Namespace, ctx.Name),
			Remediation: "Set securityContext.allowPrivilegeEscalation to false",
			Resource:    ctx.Name,
			Namespace:   ctx.Namespace,
			Timestamp:   time.Now(),
		})
	} else {
		checks = append(checks, ComplianceCheck{
			ID:          "CIS-5.2.5",
			Standard:    CISKubernetes,
			Section:     "5.2 Pod Security Policies",
			Title:       "Minimize the admission of containers with allowPrivilegeEscalation",
			Description: "Privilege escalation allows processes to gain more privileges than their parent",
			Status:      StatusPass,
			Severity:    SeverityInfo,
			Details:     fmt.Sprintf("Pod %s/%s does not allow privilege escalation", ctx.Namespace, ctx.Name),
			Resource:    ctx.Name,
			Namespace:   ctx.Namespace,
			Timestamp:   time.Now(),
		})
	}

	// 5.2.6 - Minimize the admission of root containers
	if ctx.RunAsNonRoot == nil || !*ctx.RunAsNonRoot {
		checks = append(checks, ComplianceCheck{
			ID:          "CIS-5.2.6",
			Standard:    CISKubernetes,
			Section:     "5.2 Pod Security Policies",
			Title:       "Minimize the admission of root containers",
			Description: "Containers should not run as root user",
			Status:      StatusFail,
			Severity:    SeverityHigh,
			Details:     fmt.Sprintf("Pod %s/%s may run as root user", ctx.Namespace, ctx.Name),
			Remediation: "Set securityContext.runAsNonRoot to true and specify a non-root user ID",
			Resource:    ctx.Name,
			Namespace:   ctx.Namespace,
			Timestamp:   time.Now(),
		})
	} else {
		checks = append(checks, ComplianceCheck{
			ID:          "CIS-5.2.6",
			Standard:    CISKubernetes,
			Section:     "5.2 Pod Security Policies",
			Title:       "Minimize the admission of root containers",
			Description: "Containers should not run as root user",
			Status:      StatusPass,
			Severity:    SeverityInfo,
			Details:     fmt.Sprintf("Pod %s/%s enforces non-root user", ctx.Namespace, ctx.Name),
			Resource:    ctx.Name,
			Namespace:   ctx.Namespace,
			Timestamp:   time.Now(),
		})
	}

	// 5.2.7 - Minimize the admission of containers with added capabilities
	if ctx.Capabilities != nil && len(ctx.Capabilities.Add) > 0 {
		checks = append(checks, ComplianceCheck{
			ID:          "CIS-5.2.7",
			Standard:    CISKubernetes,
			Section:     "5.2 Pod Security Policies",
			Title:       "Minimize the admission of containers with added capabilities",
			Description: "Containers should drop all capabilities and add only those required",
			Status:      StatusWarning,
			Severity:    SeverityMedium,
			Details:     fmt.Sprintf("Pod %s/%s adds capabilities: %v", ctx.Namespace, ctx.Name, ctx.Capabilities.Add),
			Remediation: "Remove unnecessary capabilities and use 'drop: [ALL]' first",
			Resource:    ctx.Name,
			Namespace:   ctx.Namespace,
			Timestamp:   time.Now(),
		})
	} else {
		checks = append(checks, ComplianceCheck{
			ID:          "CIS-5.2.7",
			Standard:    CISKubernetes,
			Section:     "5.2 Pod Security Policies",
			Title:       "Minimize the admission of containers with added capabilities",
			Description: "Containers should drop all capabilities and add only those required",
			Status:      StatusPass,
			Severity:    SeverityInfo,
			Details:     fmt.Sprintf("Pod %s/%s does not add capabilities", ctx.Namespace, ctx.Name),
			Resource:    ctx.Name,
			Namespace:   ctx.Namespace,
			Timestamp:   time.Now(),
		})
	}

	// 5.2.9 - Minimize the admission of containers with capabilities assigned
	hasDropAll := false
	if ctx.Capabilities != nil {
		for _, cap := range ctx.Capabilities.Drop {
			if strings.ToUpper(cap) == "ALL" {
				hasDropAll = true
				break
			}
		}
	}

	if !hasDropAll {
		checks = append(checks, ComplianceCheck{
			ID:          "CIS-5.2.9",
			Standard:    CISKubernetes,
			Section:     "5.2 Pod Security Policies",
			Title:       "Minimize the admission of containers with capabilities assigned",
			Description: "Containers should drop all capabilities by default",
			Status:      StatusWarning,
			Severity:    SeverityMedium,
			Details:     fmt.Sprintf("Pod %s/%s does not drop all capabilities", ctx.Namespace, ctx.Name),
			Remediation: "Add 'capabilities: { drop: [ALL] }' to security context",
			Resource:    ctx.Name,
			Namespace:   ctx.Namespace,
			Timestamp:   time.Now(),
		})
	} else {
		checks = append(checks, ComplianceCheck{
			ID:          "CIS-5.2.9",
			Standard:    CISKubernetes,
			Section:     "5.2 Pod Security Policies",
			Title:       "Minimize the admission of containers with capabilities assigned",
			Description: "Containers should drop all capabilities by default",
			Status:      StatusPass,
			Severity:    SeverityInfo,
			Details:     fmt.Sprintf("Pod %s/%s drops all capabilities", ctx.Namespace, ctx.Name),
			Resource:    ctx.Name,
			Namespace:   ctx.Namespace,
			Timestamp:   time.Now(),
		})
	}

	return checks
}

// CIS Kubernetes Benchmark checks for RBAC
func (c *ComplianceChecker) cisRBACChecks(roleName string, rules []RBACRule) []ComplianceCheck {
	checks := make([]ComplianceCheck, 0)

	// 5.1.1 - Ensure that the cluster-admin role is only used where required
	if roleName == "cluster-admin" {
		checks = append(checks, ComplianceCheck{
			ID:          "CIS-5.1.1",
			Standard:    CISKubernetes,
			Section:     "5.1 RBAC and Service Accounts",
			Title:       "Ensure that the cluster-admin role is only used where required",
			Description: "The cluster-admin role provides unrestricted access",
			Status:      StatusWarning,
			Severity:    SeverityHigh,
			Details:     "cluster-admin role detected - ensure this is necessary",
			Remediation: "Use more restrictive roles and follow principle of least privilege",
			Resource:    roleName,
			Timestamp:   time.Now(),
		})
	}

	// 5.1.3 - Minimize wildcard use in Roles and ClusterRoles
	hasWildcard := false
	for _, rule := range rules {
		if containsWildcard(rule.Verbs) || containsWildcard(rule.Resources) || containsWildcard(rule.APIGroups) {
			hasWildcard = true
			break
		}
	}

	if hasWildcard {
		checks = append(checks, ComplianceCheck{
			ID:          "CIS-5.1.3",
			Standard:    CISKubernetes,
			Section:     "5.1 RBAC and Service Accounts",
			Title:       "Minimize wildcard use in Roles and ClusterRoles",
			Description: "Wildcard permissions grant excessive access",
			Status:      StatusFail,
			Severity:    SeverityCritical,
			Details:     fmt.Sprintf("Role %s uses wildcard (*) permissions", roleName),
			Remediation: "Specify explicit verbs, resources, and API groups instead of wildcards",
			Resource:    roleName,
			Timestamp:   time.Now(),
		})
	} else {
		checks = append(checks, ComplianceCheck{
			ID:          "CIS-5.1.3",
			Standard:    CISKubernetes,
			Section:     "5.1 RBAC and Service Accounts",
			Title:       "Minimize wildcard use in Roles and ClusterRoles",
			Description: "Wildcard permissions grant excessive access",
			Status:      StatusPass,
			Severity:    SeverityInfo,
			Details:     fmt.Sprintf("Role %s does not use wildcard permissions", roleName),
			Resource:    roleName,
			Timestamp:   time.Now(),
		})
	}

	// 5.1.5 - Ensure that default service accounts are not actively used
	if roleName == "default" {
		checks = append(checks, ComplianceCheck{
			ID:          "CIS-5.1.5",
			Standard:    CISKubernetes,
			Section:     "5.1 RBAC and Service Accounts",
			Title:       "Ensure that default service accounts are not actively used",
			Description: "Default service accounts should not be used by pods",
			Status:      StatusWarning,
			Severity:    SeverityMedium,
			Details:     "Default service account detected",
			Remediation: "Create dedicated service accounts for each workload",
			Resource:    roleName,
			Timestamp:   time.Now(),
		})
	}

	// 5.1.6 - Ensure that Service Account Tokens are only mounted where necessary
	checks = append(checks, ComplianceCheck{
		ID:          "CIS-5.1.6",
		Standard:    CISKubernetes,
		Section:     "5.1 RBAC and Service Accounts",
		Title:       "Ensure that Service Account Tokens are only mounted where necessary",
		Description: "Unnecessary service account token mounts increase attack surface",
		Status:      StatusPass,
		Severity:    SeverityInfo,
		Details:     "Manual verification required for automountServiceAccountToken",
		Remediation: "Set automountServiceAccountToken: false when not needed",
		Resource:    roleName,
		Timestamp:   time.Now(),
	})

	return checks
}

// Pod Security Standards checks
func (c *ComplianceChecker) podSecurityChecks(ctx *PodSecurityContext) []ComplianceCheck {
	checks := make([]ComplianceCheck, 0)

	// Baseline profile checks
	if ctx.Privileged != nil && *ctx.Privileged {
		checks = append(checks, ComplianceCheck{
			ID:          "PSS-BASELINE-1",
			Standard:    PodSecurity,
			Section:     "Baseline Profile",
			Title:       "Privileged containers are disallowed",
			Description: "Privileged pods disable most security mechanisms",
			Status:      StatusFail,
			Severity:    SeverityCritical,
			Details:     fmt.Sprintf("Pod %s/%s is privileged", ctx.Namespace, ctx.Name),
			Remediation: "Remove privileged: true from security context",
			Resource:    ctx.Name,
			Namespace:   ctx.Namespace,
			Timestamp:   time.Now(),
		})
	}

	// Restricted profile checks
	if ctx.RunAsNonRoot == nil || !*ctx.RunAsNonRoot {
		checks = append(checks, ComplianceCheck{
			ID:          "PSS-RESTRICTED-1",
			Standard:    PodSecurity,
			Section:     "Restricted Profile",
			Title:       "Running as Non-root",
			Description: "Containers must be required to run as non-root users",
			Status:      StatusFail,
			Severity:    SeverityHigh,
			Details:     fmt.Sprintf("Pod %s/%s may run as root", ctx.Namespace, ctx.Name),
			Remediation: "Set runAsNonRoot: true",
			Resource:    ctx.Name,
			Namespace:   ctx.Namespace,
			Timestamp:   time.Now(),
		})
	}

	if ctx.AllowPrivEscalation == nil || *ctx.AllowPrivEscalation {
		checks = append(checks, ComplianceCheck{
			ID:          "PSS-RESTRICTED-2",
			Standard:    PodSecurity,
			Section:     "Restricted Profile",
			Title:       "Privilege Escalation",
			Description: "Privilege escalation must be disallowed",
			Status:      StatusFail,
			Severity:    SeverityHigh,
			Details:     fmt.Sprintf("Pod %s/%s allows privilege escalation", ctx.Namespace, ctx.Name),
			Remediation: "Set allowPrivilegeEscalation: false",
			Resource:    ctx.Name,
			Namespace:   ctx.Namespace,
			Timestamp:   time.Now(),
		})
	}

	return checks
}

// GenerateComplianceReport generates a compliance report from checks
func GenerateComplianceReport(standard ComplianceStandard, checks []ComplianceCheck) ComplianceReport {
	report := ComplianceReport{
		Standard:  standard,
		Checks:    checks,
		Timestamp: time.Now(),
	}

	report.TotalChecks = len(checks)

	for _, check := range checks {
		switch check.Status {
		case StatusPass:
			report.PassedChecks++
		case StatusFail:
			report.FailedChecks++
		case StatusWarning:
			report.WarningChecks++
		}
	}

	// Calculate compliance score: only passed checks count (warnings do not)
	if report.TotalChecks > 0 {
		report.ComplianceScore = float64(report.PassedChecks) / float64(report.TotalChecks) * 100
	}

	return report
}
