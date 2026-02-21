package security

import (
	"fmt"
	"strings"
	"time"
)

// SecurityIssue represents a security configuration issue
type SecurityIssue struct {
	Type        string    `json:"type"` // "security_context", "rbac", "network_policy", etc.
	Severity    Severity  `json:"severity"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Remediation string    `json:"remediation"`
	Resource    string    `json:"resource"`
	Namespace   string    `json:"namespace,omitempty"`
	Timestamp   time.Time `json:"timestamp"`
}

// SecurityPosture represents overall security status
type SecurityPosture struct {
	Score           int             `json:"score"` // 0-100
	Grade           string          `json:"grade"` // A, B, C, D, F
	Issues          []SecurityIssue `json:"issues"`
	Summary         IssueSummary    `json:"summary"`
	Recommendations []string        `json:"recommendations"`
	Timestamp       time.Time       `json:"timestamp"`
}

// IssueSummary summarizes security issues
type IssueSummary struct {
	Total    int `json:"total"`
	Critical int `json:"critical"`
	High     int `json:"high"`
	Medium   int `json:"medium"`
	Low      int `json:"low"`
}

// PodSecurityContext represents pod security configuration
type PodSecurityContext struct {
	Name                string
	Namespace           string
	RunAsNonRoot        *bool
	RunAsUser           *int64
	ReadOnlyRootFS      *bool
	Privileged          *bool
	AllowPrivEscalation *bool
	Capabilities        *Capabilities
}

// Capabilities represents Linux capabilities
type Capabilities struct {
	Add  []string
	Drop []string
}

// Analyzer performs security analysis
type Analyzer struct{}

// NewAnalyzer creates a new security analyzer
func NewAnalyzer() *Analyzer {
	return &Analyzer{}
}

// AnalyzePodSecurity analyzes pod security context
func (a *Analyzer) AnalyzePodSecurity(ctx *PodSecurityContext) []SecurityIssue {
	issues := make([]SecurityIssue, 0)

	// Check if running as root
	if ctx.RunAsNonRoot == nil || !*ctx.RunAsNonRoot {
		issues = append(issues, SecurityIssue{
			Type:        "security_context",
			Severity:    SeverityHigh,
			Title:       "Pod may run as root",
			Description: fmt.Sprintf("Pod %s/%s does not enforce non-root user", ctx.Namespace, ctx.Name),
			Remediation: "Set securityContext.runAsNonRoot: true and specify a non-root user ID",
			Resource:    ctx.Name,
			Namespace:   ctx.Namespace,
			Timestamp:   time.Now(),
		})
	}

	// Check for read-only root filesystem
	if ctx.ReadOnlyRootFS == nil || !*ctx.ReadOnlyRootFS {
		issues = append(issues, SecurityIssue{
			Type:        "security_context",
			Severity:    SeverityMedium,
			Title:       "Root filesystem is writable",
			Description: fmt.Sprintf("Pod %s/%s allows writes to root filesystem", ctx.Namespace, ctx.Name),
			Remediation: "Set securityContext.readOnlyRootFilesystem: true",
			Resource:    ctx.Name,
			Namespace:   ctx.Namespace,
			Timestamp:   time.Now(),
		})
	}

	// Check for privileged containers
	if ctx.Privileged != nil && *ctx.Privileged {
		issues = append(issues, SecurityIssue{
			Type:        "security_context",
			Severity:    SeverityCritical,
			Title:       "Privileged container detected",
			Description: fmt.Sprintf("Pod %s/%s runs in privileged mode", ctx.Namespace, ctx.Name),
			Remediation: "Remove securityContext.privileged or set to false. Use specific capabilities instead",
			Resource:    ctx.Name,
			Namespace:   ctx.Namespace,
			Timestamp:   time.Now(),
		})
	}

	// Check privilege escalation
	if ctx.AllowPrivEscalation == nil || *ctx.AllowPrivEscalation {
		issues = append(issues, SecurityIssue{
			Type:        "security_context",
			Severity:    SeverityHigh,
			Title:       "Privilege escalation allowed",
			Description: fmt.Sprintf("Pod %s/%s allows privilege escalation", ctx.Namespace, ctx.Name),
			Remediation: "Set securityContext.allowPrivilegeEscalation: false",
			Resource:    ctx.Name,
			Namespace:   ctx.Namespace,
			Timestamp:   time.Now(),
		})
	}

	// Check dangerous capabilities
	if ctx.Capabilities != nil {
		for _, cap := range ctx.Capabilities.Add {
			if isDangerousCapability(cap) {
				issues = append(issues, SecurityIssue{
					Type:        "security_context",
					Severity:    SeverityHigh,
					Title:       fmt.Sprintf("Dangerous capability: %s", cap),
					Description: fmt.Sprintf("Pod %s/%s adds dangerous capability %s", ctx.Namespace, ctx.Name, cap),
					Remediation: fmt.Sprintf("Remove capability %s or use a more restrictive alternative", cap),
					Resource:    ctx.Name,
					Namespace:   ctx.Namespace,
					Timestamp:   time.Now(),
				})
			}
		}
	}

	return issues
}

// AnalyzeRBAC analyzes RBAC configuration
func (a *Analyzer) AnalyzeRBAC(roleName string, rules []RBACRule) []SecurityIssue {
	issues := make([]SecurityIssue, 0)

	for _, rule := range rules {
		// Check for wildcard permissions
		if containsWildcard(rule.Verbs) {
			issues = append(issues, SecurityIssue{
				Type:        "rbac_wildcard",
				Severity:    SeverityHigh,
				Title:       "Wildcard verb permissions",
				Description: fmt.Sprintf("Role %s grants wildcard (*) verb permissions", roleName),
				Remediation: "Specify explicit verbs (get, list, watch, etc.) instead of wildcard",
				Resource:    roleName,
				Timestamp:   time.Now(),
			})
		}

		if containsWildcard(rule.Resources) {
			issues = append(issues, SecurityIssue{
				Type:        "rbac_wildcard",
				Severity:    SeverityCritical,
				Title:       "Wildcard resource permissions",
				Description: fmt.Sprintf("Role %s grants wildcard (*) resource permissions", roleName),
				Remediation: "Specify explicit resources instead of wildcard",
				Resource:    roleName,
				Timestamp:   time.Now(),
			})
		}

		// Check for dangerous verbs
		for _, verb := range rule.Verbs {
			if verb == "create" || verb == "delete" || verb == "deletecollection" {
				for _, resource := range rule.Resources {
					if isDangerousResource(resource) {
						issues = append(issues, SecurityIssue{
							Type:        "rbac",
							Severity:    SeverityHigh,
							Title:       fmt.Sprintf("Dangerous permission: %s %s", verb, resource),
							Description: fmt.Sprintf("Role %s can %s %s resources", roleName, verb, resource),
							Remediation: "Review if this permission is necessary. Consider using more restrictive verbs",
							Resource:    roleName,
							Timestamp:   time.Now(),
						})
					}
				}
			}
		}

		// Check for secrets access
		if contains(rule.Resources, "secrets") {
			if contains(rule.Verbs, "get") || contains(rule.Verbs, "list") {
				issues = append(issues, SecurityIssue{
					Type:        "rbac",
					Severity:    SeverityMedium,
					Title:       "Secrets read access",
					Description: fmt.Sprintf("Role %s can read secrets", roleName),
					Remediation: "Ensure secrets access is necessary. Consider using service account tokens instead",
					Resource:    roleName,
					Timestamp:   time.Now(),
				})
			}
		}
	}

	return issues
}

// CalculateSecurityScore calculates overall security score
func (a *Analyzer) CalculateSecurityScore(issues []SecurityIssue) int {
	score := 100

	for _, issue := range issues {
		switch issue.Severity {
		case SeverityCritical:
			score -= 20
		case SeverityHigh:
			score -= 10
		case SeverityMedium:
			score -= 5
		case SeverityLow:
			score -= 2
		}
	}

	if score < 0 {
		score = 0
	}

	return score
}

// GetSecurityGrade returns letter grade based on score
func GetSecurityGrade(score int) string {
	if score >= 90 {
		return "A"
	} else if score >= 80 {
		return "B"
	} else if score >= 70 {
		return "C"
	} else if score >= 60 {
		return "D"
	}
	return "F"
}

// GenerateRecommendations generates security recommendations
func (a *Analyzer) GenerateRecommendations(issues []SecurityIssue) []string {
	recommendations := make([]string, 0)
	issueTypes := make(map[string]bool)

	// Track issue types
	for _, issue := range issues {
		issueTypes[issue.Type] = true
	}

	// Generate recommendations based on issue types
	if issueTypes["security_context"] {
		recommendations = append(recommendations,
			"Implement Pod Security Standards (PSS) baseline or restricted profiles",
			"Use security context constraints to enforce non-root users",
			"Enable read-only root filesystems where possible",
		)
	}

	if issueTypes["rbac"] {
		recommendations = append(recommendations,
			"Follow principle of least privilege for RBAC",
			"Avoid wildcard permissions in roles",
			"Regularly audit RBAC configurations",
		)
	}

	return recommendations
}

// RBACRule represents an RBAC policy rule
type RBACRule struct {
	Verbs     []string
	Resources []string
	APIGroups []string
}

// Helper functions

func isDangerousCapability(cap string) bool {
	dangerous := []string{
		"SYS_ADMIN",
		"NET_ADMIN",
		"SYS_MODULE",
		"SYS_RAWIO",
		"SYS_PTRACE",
		"SYS_BOOT",
		"MAC_ADMIN",
	}

	cap = strings.ToUpper(cap)
	for _, d := range dangerous {
		if cap == d {
			return true
		}
	}
	return false
}

func isDangerousResource(resource string) bool {
	dangerous := []string{
		"pods/exec",
		"pods/attach",
		"pods/portforward",
		"secrets",
		"clusterroles",
		"clusterrolebindings",
		"roles",
		"rolebindings",
	}

	for _, d := range dangerous {
		if resource == d {
			return true
		}
	}
	return false
}

func containsWildcard(slice []string) bool {
	for _, s := range slice {
		if s == "*" {
			return true
		}
	}
	return false
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

// CalculateIssueSummary calculates issue summary
func CalculateIssueSummary(issues []SecurityIssue) IssueSummary {
	summary := IssueSummary{
		Total: len(issues),
	}

	for _, issue := range issues {
		switch issue.Severity {
		case SeverityCritical:
			summary.Critical++
		case SeverityHigh:
			summary.High++
		case SeverityMedium:
			summary.Medium++
		case SeverityLow:
			summary.Low++
		}
	}

	return summary
}
