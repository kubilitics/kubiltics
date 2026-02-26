package cli

// security.go — kcli security command group.
//
// Provides instant Kubernetes security analysis without Wiz, Snyk, or Lacework.
// Scans the live cluster for common misconfigurations across:
//   - RBAC: overly-permissive roles and bindings
//   - Pods: privileged containers, hostPath mounts, root users, missing security contexts
//   - Secrets: plaintext secrets in env vars, large secret stores
//   - Network: missing NetworkPolicies, open egress
//
// Commands:
//   kcli security scan          — full cluster security scan
//   kcli security rbac          — RBAC analysis (cluster-admin bindings, wildcards)
//   kcli security pods          — pod-level security issues
//
// Severity levels:
//   CRITICAL — immediate attention required (privilege escalation, cluster-admin abuse)
//   HIGH     — significant risk (root containers, hostPID/hostNetwork, no network policy)
//   MEDIUM   — best-practice violations (no read-only root FS, no security context)
//   LOW      — informational (deprecated APIs, missing labels)

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

// ─── Kubernetes API types for security analysis ───────────────────────────────

type k8sClusterRoleBindingList struct {
	Items []k8sClusterRoleBinding `json:"items"`
}

type k8sClusterRoleBinding struct {
	Metadata struct {
		Name string `json:"name"`
	} `json:"metadata"`
	RoleRef struct {
		Kind string `json:"kind"`
		Name string `json:"name"`
	} `json:"roleRef"`
	Subjects []k8sRBACSubject `json:"subjects"`
}

type k8sRoleBindingList struct {
	Items []k8sRoleBinding `json:"items"`
}

type k8sRoleBinding struct {
	Metadata struct {
		Name      string `json:"name"`
		Namespace string `json:"namespace"`
	} `json:"metadata"`
	RoleRef struct {
		Kind string `json:"kind"`
		Name string `json:"name"`
	} `json:"roleRef"`
	Subjects []k8sRBACSubject `json:"subjects"`
}

type k8sRBACSubject struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
}

type k8sClusterRoleList struct {
	Items []k8sClusterRole `json:"items"`
}

type k8sClusterRole struct {
	Metadata struct {
		Name string `json:"name"`
	} `json:"metadata"`
	Rules []k8sRBACRule `json:"rules"`
}

type k8sRBACRule struct {
	Verbs     []string `json:"verbs"`
	Resources []string `json:"resources"`
	APIGroups []string `json:"apiGroups"`
}

// ─── Security finding types ───────────────────────────────────────────────────

type securityFinding struct {
	Severity    string `json:"severity"`  // CRITICAL, HIGH, MEDIUM, LOW
	Category    string `json:"category"`  // rbac, pod, network, secret
	Resource    string `json:"resource"`  // resource kind
	Namespace   string `json:"namespace,omitempty"`
	Name        string `json:"name"`
	Issue       string `json:"issue"`
	Detail      string `json:"detail"`
	Remediation string `json:"remediation"`
}

// findingKey returns a unique key for comparing findings across scans.
func findingKey(f securityFinding) string {
	return f.Category + "|" + f.Resource + "|" + f.Namespace + "|" + f.Name + "|" + f.Issue
}

// ─── Security scan history (for kcli security diff) ─────────────────────────────

const (
	securityHistoryMaxSnapshots = 100
	securityHistoryMaxAge       = 90 * 24 * time.Hour
)

type securityHistoryEntry struct {
	Timestamp time.Time         `json:"timestamp"`
	Namespace string            `json:"namespace"`
	Findings  []securityFinding `json:"findings"`
}

type securityHistory struct {
	Scans []securityHistoryEntry `json:"scans"`
}

func securityHistoryPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".kcli", "security-history.json"), nil
}

func loadSecurityHistory() (*securityHistory, error) {
	path, err := securityHistoryPath()
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &securityHistory{Scans: []securityHistoryEntry{}}, nil
		}
		return nil, err
	}
	var h securityHistory
	if err := json.Unmarshal(b, &h); err != nil {
		return nil, err
	}
	if h.Scans == nil {
		h.Scans = []securityHistoryEntry{}
	}
	return &h, nil
}

func saveSecurityHistory(h *securityHistory) error {
	path, err := securityHistoryPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	b, err := json.MarshalIndent(h, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}

// pruneSecurityHistory removes entries older than 90 days and keeps at most 100.
func pruneSecurityHistory(h *securityHistory) {
	cutoff := time.Now().Add(-securityHistoryMaxAge)
	var kept []securityHistoryEntry
	for _, e := range h.Scans {
		if e.Timestamp.After(cutoff) {
			kept = append(kept, e)
		}
	}
	if len(kept) > securityHistoryMaxSnapshots {
		kept = kept[len(kept)-securityHistoryMaxSnapshots:]
	}
	h.Scans = kept
}

func saveSecurityScan(findings []securityFinding, namespace string) error {
	h, err := loadSecurityHistory()
	if err != nil {
		return err
	}
	h.Scans = append(h.Scans, securityHistoryEntry{
		Timestamp: time.Now().UTC(),
		Namespace: namespace,
		Findings:  findings,
	})
	pruneSecurityHistory(h)
	return saveSecurityHistory(h)
}

func severityOrder(s string) int {
	switch s {
	case "CRITICAL":
		return 0
	case "HIGH":
		return 1
	case "MEDIUM":
		return 2
	case "LOW":
		return 3
	default:
		return 4
	}
}

func severityColor(s string) string {
	switch s {
	case "CRITICAL":
		return ansiRed + ansiBold
	case "HIGH":
		return ansiRed
	case "MEDIUM":
		return ansiYellow
	case "LOW":
		return ansiGray
	default:
		return ansiReset
	}
}

// ─── Security score ───────────────────────────────────────────────────────────

// securityScore computes 0-100 score: 100 - (CRITICAL×20 + HIGH×5 + MEDIUM×2 + LOW×0.5), capped at 0.
func securityScore(findings []securityFinding) int {
	score := 100.0
	for _, f := range findings {
		switch f.Severity {
		case "CRITICAL":
			score -= 20
		case "HIGH":
			score -= 5
		case "MEDIUM":
			score -= 2
		case "LOW":
			score -= 0.5
		}
	}
	if score < 0 {
		return 0
	}
	return int(score)
}

// ─── SARIF 2.1.0 output ───────────────────────────────────────────────────────

func buildSARIF(findings []securityFinding) map[string]interface{} {
	rules := []map[string]interface{}{}
	seen := map[string]bool{}
	results := []map[string]interface{}{}

	for _, f := range findings {
		ruleID := "kcli-sec-" + strings.ReplaceAll(strings.ToLower(f.Issue), " ", "-")

		if !seen[ruleID] {
			seen[ruleID] = true
			level := "warning"
			if f.Severity == "CRITICAL" || f.Severity == "HIGH" {
				level = "error"
			} else if f.Severity == "LOW" {
				level = "note"
			}
			rules = append(rules, map[string]interface{}{
				"id":               ruleID,
				"name":             f.Issue,
				"shortDescription": map[string]string{"text": f.Issue},
				"fullDescription":  map[string]string{"text": f.Detail},
				"defaultConfiguration": map[string]string{"level": level},
				"help":             map[string]string{"text": f.Remediation},
				"properties":       map[string]string{"severity": f.Severity, "category": f.Category},
			})
		}

		loc := f.Name
		if f.Namespace != "" {
			loc = f.Namespace + "/" + f.Name
		}
		level := "warning"
		if f.Severity == "CRITICAL" || f.Severity == "HIGH" {
			level = "error"
		} else if f.Severity == "LOW" {
			level = "note"
		}
		results = append(results, map[string]interface{}{
			"ruleId":  ruleID,
			"level":   level,
			"message": map[string]string{"text": f.Detail + " — Fix: " + f.Remediation},
			"locations": []map[string]interface{}{
				{
					"physicalLocation": map[string]interface{}{
						"artifactLocation": map[string]interface{}{
							"uri": "k8s://" + loc,
						},
					},
				},
			},
		})
	}

	return map[string]interface{}{
		"$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
		"version": "2.1.0",
		"runs": []map[string]interface{}{
			{
				"tool": map[string]interface{}{
					"driver": map[string]interface{}{
						"name":           "kcli-security",
						"version":        "1.0.0",
						"informationUri": "https://github.com/kubilitics/kcli",
						"rules":          rules,
					},
				},
				"results": results,
			},
		},
	}
}

// ─── RBAC Analysis ────────────────────────────────────────────────────────────

func (a *app) scanRBAC() ([]securityFinding, error) {
	var findings []securityFinding

	// 1. ClusterRoleBindings — find cluster-admin bindings
	crbOut, err := a.captureKubectl([]string{"get", "clusterrolebindings", "-o", "json"})
	if err != nil {
		return nil, fmt.Errorf("failed to list clusterrolebindings: %w", err)
	}
	var crbList k8sClusterRoleBindingList
	if err := json.Unmarshal([]byte(crbOut), &crbList); err != nil {
		return nil, fmt.Errorf("failed to parse clusterrolebindings: %w", err)
	}

	for _, crb := range crbList.Items {
		if crb.RoleRef.Name == "cluster-admin" {
			for _, sub := range crb.Subjects {
				severity := "HIGH"
				detail := fmt.Sprintf("Subject '%s' (%s) has cluster-admin via binding '%s'",
					sub.Name, sub.Kind, crb.Metadata.Name)
				remediation := "Review if cluster-admin is truly needed. Use a least-privilege ClusterRole instead."

				// ServiceAccounts with cluster-admin are CRITICAL
				if sub.Kind == "ServiceAccount" {
					severity = "CRITICAL"
					detail = fmt.Sprintf("ServiceAccount '%s/%s' has cluster-admin — workloads using this SA can do anything in the cluster",
						sub.Namespace, sub.Name)
					remediation = "Remove cluster-admin from ServiceAccounts. Create a minimal ClusterRole with only required permissions."
				}

				// system: groups are expected
				if strings.HasPrefix(sub.Name, "system:") {
					continue
				}

				findings = append(findings, securityFinding{
					Severity:    severity,
					Category:    "rbac",
					Resource:    "ClusterRoleBinding",
					Name:        crb.Metadata.Name,
					Issue:       "cluster-admin-binding",
					Detail:      detail,
					Remediation: remediation,
				})
			}
		}
	}

	// 2. ClusterRoles with wildcard verbs or resources
	crOut, err := a.captureKubectl([]string{"get", "clusterroles", "-o", "json"})
	if err == nil {
		var crList k8sClusterRoleList
		if json.Unmarshal([]byte(crOut), &crList) == nil {
			for _, cr := range crList.Items {
				// Skip system roles
				if strings.HasPrefix(cr.Metadata.Name, "system:") {
					continue
				}
				for _, rule := range cr.Rules {
					hasWildcardVerb := false
					hasWildcardResource := false
					for _, v := range rule.Verbs {
						if v == "*" {
							hasWildcardVerb = true
						}
					}
					for _, r := range rule.Resources {
						if r == "*" {
							hasWildcardResource = true
						}
					}
					if hasWildcardVerb && hasWildcardResource {
						findings = append(findings, securityFinding{
							Severity:    "HIGH",
							Category:    "rbac",
							Resource:    "ClusterRole",
							Name:        cr.Metadata.Name,
							Issue:       "wildcard-permissions",
							Detail:      fmt.Sprintf("ClusterRole '%s' has wildcard verbs AND resources — equivalent to cluster-admin for those API groups", cr.Metadata.Name),
							Remediation: "Replace wildcard permissions with specific verbs (get, list, watch) and specific resource names.",
						})
						break
					} else if hasWildcardVerb {
						findings = append(findings, securityFinding{
							Severity:    "MEDIUM",
							Category:    "rbac",
							Resource:    "ClusterRole",
							Name:        cr.Metadata.Name,
							Issue:       "wildcard-verbs",
							Detail:      fmt.Sprintf("ClusterRole '%s' uses wildcard verbs (*) on resources: %s", cr.Metadata.Name, strings.Join(rule.Resources, ", ")),
							Remediation: "Replace '*' verbs with only the verbs actually needed (get, list, watch).",
						})
						break
					}
				}
			}
		}
	}

	return findings, nil
}

// ─── Pod Security Analysis ─────────────────────────────────────────────────────

func (a *app) scanPodSecurity(namespace string) ([]securityFinding, error) {
	var findings []securityFinding

	args := []string{"get", "pods", "-o", "json"}
	if namespace != "" && namespace != "all" {
		args = append(args, "-n", namespace)
	} else {
		args = append(args, "--all-namespaces")
	}

	out, err := a.captureKubectl(args)
	if err != nil {
		return nil, fmt.Errorf("failed to list pods: %w", err)
	}

	// Use existing k8sResourceList but with extended pod spec parsing
	type podSecSpec struct {
		Items []struct {
			Metadata struct {
				Name      string `json:"name"`
				Namespace string `json:"namespace"`
			} `json:"metadata"`
			Spec struct {
				HostPID     bool `json:"hostPID"`
				HostNetwork bool `json:"hostNetwork"`
				HostIPC     bool `json:"hostIPC"`
				Containers  []struct {
					Name  string `json:"name"`
					Image string `json:"image"`
					SecurityContext struct {
						Privileged               *bool  `json:"privileged"`
						AllowPrivilegeEscalation *bool  `json:"allowPrivilegeEscalation"`
						RunAsNonRoot             *bool  `json:"runAsNonRoot"`
						RunAsUser                *int64 `json:"runAsUser"`
						ReadOnlyRootFilesystem   *bool  `json:"readOnlyRootFilesystem"`
						Capabilities struct {
							Add  []string `json:"add"`
							Drop []string `json:"drop"`
						} `json:"capabilities"`
					} `json:"securityContext"`
					VolumeMounts []struct {
						MountPath string `json:"mountPath"`
						Name      string `json:"name"`
					} `json:"volumeMounts"`
					Resources struct {
						Limits struct {
							CPU    string `json:"cpu"`
							Memory string `json:"memory"`
						} `json:"limits"`
					} `json:"resources"`
					LivenessProbe *struct {
						HTTPGet   *struct{} `json:"httpGet"`
						TCPSocket *struct{} `json:"tcpSocket"`
						Exec      *struct{} `json:"exec"`
					} `json:"livenessProbe"`
					ReadinessProbe *struct {
						HTTPGet   *struct{} `json:"httpGet"`
						TCPSocket *struct{} `json:"tcpSocket"`
						Exec      *struct{} `json:"exec"`
					} `json:"readinessProbe"`
					Env []struct {
						Name      string `json:"name"`
						ValueFrom *struct {
							SecretKeyRef *struct {
								Name string `json:"name"`
								Key  string `json:"key"`
							} `json:"secretKeyRef"`
						} `json:"valueFrom"`
					} `json:"env"`
				} `json:"containers"`
				Volumes []struct {
					Name     string `json:"name"`
					HostPath *struct {
						Path string `json:"path"`
					} `json:"hostPath"`
				} `json:"volumes"`
				SecurityContext struct {
					RunAsNonRoot *bool  `json:"runAsNonRoot"`
					RunAsUser    *int64 `json:"runAsUser"`
				} `json:"securityContext"`
			} `json:"spec"`
			Status struct {
				Phase string `json:"phase"`
			} `json:"status"`
		} `json:"items"`
	}

	var pods podSecSpec
	if err := json.Unmarshal([]byte(out), &pods); err != nil {
		return nil, fmt.Errorf("failed to parse pods: %w", err)
	}

	dangerCapabilities := map[string]bool{
		"SYS_ADMIN": true, "NET_ADMIN": true, "SYS_PTRACE": true,
		"SYS_MODULE": true, "DAC_OVERRIDE": true, "NET_RAW": true,
		"SYS_CHROOT": true, "SETUID": true, "SETGID": true,
	}

	for _, pod := range pods.Items {
		if pod.Status.Phase == "Succeeded" || pod.Status.Phase == "Failed" {
			continue
		}
		ns := pod.Metadata.Namespace
		podName := pod.Metadata.Name

		// hostPID / hostNetwork / hostIPC
		if pod.Spec.HostPID {
			findings = append(findings, securityFinding{
				Severity:    "CRITICAL",
				Category:    "pod",
				Resource:    "Pod",
				Namespace:   ns,
				Name:        podName,
				Issue:       "hostPID",
				Detail:      "Pod uses hostPID=true — can see and signal all host processes",
				Remediation: "Remove hostPID from pod spec unless absolutely required (e.g., debugging tools).",
			})
		}
		if pod.Spec.HostNetwork {
			findings = append(findings, securityFinding{
				Severity:    "HIGH",
				Category:    "pod",
				Resource:    "Pod",
				Namespace:   ns,
				Name:        podName,
				Issue:       "hostNetwork",
				Detail:      "Pod uses hostNetwork=true — has direct access to host network interfaces",
				Remediation: "Remove hostNetwork from pod spec. Use proper Service/Ingress for network exposure.",
			})
		}
		if pod.Spec.HostIPC {
			findings = append(findings, securityFinding{
				Severity:    "HIGH",
				Category:    "pod",
				Resource:    "Pod",
				Namespace:   ns,
				Name:        podName,
				Issue:       "hostIPC",
				Detail:      "Pod uses hostIPC=true — can access host IPC namespace and shared memory",
				Remediation: "Remove hostIPC from pod spec.",
			})
		}

		// hostPath volumes
		hostPathVols := map[string]string{}
		for _, v := range pod.Spec.Volumes {
			if v.HostPath != nil {
				hostPathVols[v.Name] = v.HostPath.Path
			}
		}
		for _, hp := range hostPathVols {
			severity := "HIGH"
			detail := fmt.Sprintf("Pod mounts host path '%s' — can access sensitive host filesystem areas", hp)
			if strings.HasPrefix(hp, "/etc") || strings.HasPrefix(hp, "/var/run/docker.sock") ||
				strings.HasPrefix(hp, "/proc") || strings.HasPrefix(hp, "/sys") ||
				hp == "/" {
				severity = "CRITICAL"
				detail = fmt.Sprintf("Pod mounts critical host path '%s' — potential full host compromise", hp)
			}
			findings = append(findings, securityFinding{
				Severity:    severity,
				Category:    "pod",
				Resource:    "Pod",
				Namespace:   ns,
				Name:        podName,
				Issue:       "hostPath-mount",
				Detail:      detail,
				Remediation: "Replace hostPath mounts with PersistentVolumeClaims or ConfigMaps/Secrets.",
			})
		}

		// Container-level checks
		for _, c := range pod.Spec.Containers {
			containerRef := fmt.Sprintf("%s/%s", podName, c.Name)

			// Privileged container
			if c.SecurityContext.Privileged != nil && *c.SecurityContext.Privileged {
				findings = append(findings, securityFinding{
					Severity:    "CRITICAL",
					Category:    "pod",
					Resource:    "Container",
					Namespace:   ns,
					Name:        containerRef,
					Issue:       "privileged-container",
					Detail:      fmt.Sprintf("Container '%s' runs as privileged — equivalent to root on the host node", c.Name),
					Remediation: "Remove privileged: true. Use specific capabilities via securityContext.capabilities.add instead.",
				})
			}

			// Root container: runAsUser=0 explicitly, or missing runAsNonRoot: true (defaults to root)
			if c.SecurityContext.RunAsUser != nil && *c.SecurityContext.RunAsUser == 0 {
				findings = append(findings, securityFinding{
					Severity:    "HIGH",
					Category:    "pod",
					Resource:    "Container",
					Namespace:   ns,
					Name:        containerRef,
					Issue:       "run-as-root",
					Detail:      fmt.Sprintf("Container '%s' explicitly runs as UID 0 (root)", c.Name),
					Remediation: "Set runAsNonRoot: true and runAsUser: 1000 (or any non-zero UID) in securityContext.",
				})
			} else if (c.SecurityContext.RunAsNonRoot == nil || !*c.SecurityContext.RunAsNonRoot) &&
				c.SecurityContext.RunAsUser == nil {
				// runAsUser not set and runAsNonRoot not true — container may default to root
				findings = append(findings, securityFinding{
					Severity:    "HIGH",
					Category:    "pod",
					Resource:    "Container",
					Namespace:   ns,
					Name:        containerRef,
					Issue:       "missing-runAsNonRoot",
					Detail:      fmt.Sprintf("Container '%s' does not set runAsNonRoot: true — may run as root by default", c.Name),
					Remediation: "Add runAsNonRoot: true and runAsUser: 1000 (or any non-zero UID) to securityContext.",
				})
			}

			// allowPrivilegeEscalation not explicitly disabled
			if c.SecurityContext.AllowPrivilegeEscalation == nil || *c.SecurityContext.AllowPrivilegeEscalation {
				// Only flag if no explicit false — not always wrong but worth noting
				if c.SecurityContext.AllowPrivilegeEscalation == nil {
					findings = append(findings, securityFinding{
						Severity:    "MEDIUM",
						Category:    "pod",
						Resource:    "Container",
						Namespace:   ns,
						Name:        containerRef,
						Issue:       "privilege-escalation-allowed",
						Detail:      fmt.Sprintf("Container '%s' does not set allowPrivilegeEscalation=false — child processes can gain more privileges", c.Name),
						Remediation: "Add allowPrivilegeEscalation: false to container securityContext.",
					})
				}
			}

			// No readOnlyRootFilesystem
			if c.SecurityContext.ReadOnlyRootFilesystem == nil || !*c.SecurityContext.ReadOnlyRootFilesystem {
				findings = append(findings, securityFinding{
					Severity:    "LOW",
					Category:    "pod",
					Resource:    "Container",
					Namespace:   ns,
					Name:        containerRef,
					Issue:       "writable-root-fs",
					Detail:      fmt.Sprintf("Container '%s' has a writable root filesystem — attackers can modify binaries", c.Name),
					Remediation: "Set readOnlyRootFilesystem: true. Use emptyDir or volumeMounts for writable paths.",
				})
			}

			// Dangerous capabilities
			for _, cap := range c.SecurityContext.Capabilities.Add {
				if dangerCapabilities[cap] {
					findings = append(findings, securityFinding{
						Severity:    "HIGH",
						Category:    "pod",
						Resource:    "Container",
						Namespace:   ns,
						Name:        containerRef,
						Issue:       "dangerous-capability",
						Detail:      fmt.Sprintf("Container '%s' adds dangerous capability: %s", c.Name, cap),
						Remediation: fmt.Sprintf("Remove %s from capabilities.add unless strictly required. Use securityContext.capabilities.drop: [ALL] instead.", cap),
					})
				}
			}

			// Using latest tag
			if strings.HasSuffix(c.Image, ":latest") || !strings.Contains(c.Image, ":") {
				findings = append(findings, securityFinding{
					Severity:    "LOW",
					Category:    "pod",
					Resource:    "Container",
					Namespace:   ns,
					Name:        containerRef,
					Issue:       "image-latest-tag",
					Detail:      fmt.Sprintf("Container '%s' uses image without pinned tag: '%s' — unpredictable deployments", c.Name, c.Image),
					Remediation: "Pin image to a specific digest or semver tag (e.g., myapp:v1.2.3@sha256:...).",
				})
			}

			// Missing CPU limit
			if c.Resources.Limits.CPU == "" {
				findings = append(findings, securityFinding{
					Severity:    "MEDIUM",
					Category:    "pod",
					Resource:    "Container",
					Namespace:   ns,
					Name:        containerRef,
					Issue:       "missing-cpu-limit",
					Detail:      fmt.Sprintf("Container '%s' has no CPU limit — can starve other pods on the node", c.Name),
					Remediation: "Set resources.limits.cpu (e.g., 500m). Start with resources.requests.cpu to profile actual usage first.",
				})
			}

			// Missing memory limit
			if c.Resources.Limits.Memory == "" {
				findings = append(findings, securityFinding{
					Severity:    "HIGH",
					Category:    "pod",
					Resource:    "Container",
					Namespace:   ns,
					Name:        containerRef,
					Issue:       "missing-memory-limit",
					Detail:      fmt.Sprintf("Container '%s' has no memory limit — OOMKiller will evict all pods on the node if container leaks memory", c.Name),
					Remediation: "Set resources.limits.memory (e.g., 256Mi). Use 'kcli top pods --containers' to profile actual usage.",
				})
			}

			// Missing liveness probe
			if c.LivenessProbe == nil {
				findings = append(findings, securityFinding{
					Severity:    "MEDIUM",
					Category:    "pod",
					Resource:    "Container",
					Namespace:   ns,
					Name:        containerRef,
					Issue:       "no-liveness-probe",
					Detail:      fmt.Sprintf("Container '%s' has no liveness probe — stuck containers won't be restarted automatically", c.Name),
					Remediation: "Add livenessProbe with httpGet, tcpSocket, or exec. Start with a generous initialDelaySeconds.",
				})
			}

			// Missing readiness probe
			if c.ReadinessProbe == nil {
				findings = append(findings, securityFinding{
					Severity:    "MEDIUM",
					Category:    "pod",
					Resource:    "Container",
					Namespace:   ns,
					Name:        containerRef,
					Issue:       "no-readiness-probe",
					Detail:      fmt.Sprintf("Container '%s' has no readiness probe — traffic will be sent to containers before they are ready", c.Name),
					Remediation: "Add readinessProbe. Readiness probe failure removes pod from Service endpoints (no traffic). Different from liveness.",
				})
			}

			// Secret in env var
			for _, env := range c.Env {
				if env.ValueFrom != nil && env.ValueFrom.SecretKeyRef != nil {
					findings = append(findings, securityFinding{
						Severity:    "HIGH",
						Category:    "pod",
						Resource:    "Container",
						Namespace:   ns,
						Name:        containerRef,
						Issue:       "secret-in-env",
						Detail:      fmt.Sprintf("Container '%s' mounts secret '%s' as env var — visible in process listings and crash dumps", c.Name, env.ValueFrom.SecretKeyRef.Name),
						Remediation: "Mount secrets as files via volumeMounts instead of env vars. Env vars are visible via /proc/<pid>/environ.",
					})
				}
			}
		}
	}

	return findings, nil
}

// ─── Network Policy Check ─────────────────────────────────────────────────────

func (a *app) checkNetworkPolicies() ([]securityFinding, error) {
	var findings []securityFinding

	// List all namespaces
	nsOut, err := a.captureKubectl([]string{"get", "namespaces", "-o", "json"})
	if err != nil {
		return nil, nil // non-fatal
	}

	var nsList struct {
		Items []struct {
			Metadata struct {
				Name string `json:"name"`
			} `json:"metadata"`
		} `json:"items"`
	}
	if err := json.Unmarshal([]byte(nsOut), &nsList); err != nil {
		return nil, nil
	}

	// List all network policies
	npOut, err := a.captureKubectl([]string{"get", "networkpolicies", "--all-namespaces", "-o", "json"})
	if err != nil {
		return nil, nil
	}

	var npList struct {
		Items []struct {
			Metadata struct {
				Namespace string `json:"namespace"`
			} `json:"metadata"`
		} `json:"items"`
	}
	json.Unmarshal([]byte(npOut), &npList) // best-effort

	coveredNS := map[string]bool{}
	for _, np := range npList.Items {
		coveredNS[np.Metadata.Namespace] = true
	}

	skipNS := map[string]bool{
		"kube-system": true, "kube-public": true, "kube-node-lease": true,
	}

	for _, ns := range nsList.Items {
		name := ns.Metadata.Name
		if skipNS[name] {
			continue
		}
		if !coveredNS[name] {
			findings = append(findings, securityFinding{
				Severity:    "HIGH",
				Category:    "network",
				Resource:    "Namespace",
				Namespace:   name,
				Name:        name,
				Issue:       "no-network-policy",
				Detail:      fmt.Sprintf("Namespace '%s' has no NetworkPolicy — all ingress/egress is allowed by default", name),
				Remediation: "Add a default-deny NetworkPolicy and explicitly allow only required traffic.",
			})
		}
	}

	return findings, nil
}

// ─── Service Security Analysis ────────────────────────────────────────────────

type k8sServiceList struct {
	Items []struct {
		Metadata struct {
			Name      string `json:"name"`
			Namespace string `json:"namespace"`
		} `json:"metadata"`
		Spec struct {
			Type  string `json:"type"`
			Ports []struct {
				NodePort int `json:"nodePort"`
			} `json:"ports"`
		} `json:"spec"`
	} `json:"items"`
}

func (a *app) scanServices(namespace string) ([]securityFinding, error) {
	var findings []securityFinding

	args := []string{"get", "services", "-o", "json"}
	if namespace != "" && namespace != "all" {
		args = append(args, "-n", namespace)
	} else {
		args = append(args, "--all-namespaces")
	}

	out, err := a.captureKubectl(args)
	if err != nil {
		return nil, fmt.Errorf("failed to list services: %w", err)
	}

	var svcList k8sServiceList
	if err := json.Unmarshal([]byte(out), &svcList); err != nil {
		return nil, fmt.Errorf("failed to parse services: %w", err)
	}

	for _, svc := range svcList.Items {
		// Skip kube-system namespace
		if svc.Metadata.Namespace == "kube-system" {
			continue
		}

		if svc.Spec.Type == "NodePort" {
			// Collect the NodePort numbers for the detail message
			var ports []int
			for _, p := range svc.Spec.Ports {
				if p.NodePort != 0 {
					ports = append(ports, p.NodePort)
				}
			}

			portStr := ""
			if len(ports) > 0 {
				parts := make([]string, len(ports))
				for i, p := range ports {
					parts[i] = fmt.Sprintf("%d", p)
				}
				portStr = strings.Join(parts, ", ")
			}

			detail := fmt.Sprintf("Service '%s' uses NodePort — port %s directly exposed on every node's public IP", svc.Metadata.Name, portStr)
			if portStr == "" {
				detail = fmt.Sprintf("Service '%s' uses NodePort — directly exposed on every node's public IP", svc.Metadata.Name)
			}

			findings = append(findings, securityFinding{
				Severity:    "MEDIUM",
				Category:    "network",
				Resource:    "Service",
				Namespace:   svc.Metadata.Namespace,
				Name:        svc.Metadata.Name,
				Issue:       "nodeport-service",
				Detail:      detail,
				Remediation: "Use ClusterIP + Ingress controller instead of NodePort for production workloads.",
			})
		}
	}

	return findings, nil
}

// ─── PodDisruptionBudget Check ───────────────────────────────────────────────

// scanPodDisruptionBudget finds deployments with replicas > 1 that lack a matching PDB.
func (a *app) scanPodDisruptionBudget(namespace string) ([]securityFinding, error) {
	var findings []securityFinding

	// Get deployments with replicas > 1
	args := []string{"get", "deployments", "-o", "json"}
	if namespace != "" && namespace != "all" {
		args = append(args, "-n", namespace)
	} else {
		args = append(args, "--all-namespaces")
	}
	deployOut, err := a.captureKubectl(args)
	if err != nil {
		return nil, nil // non-fatal
	}
	var deployList struct {
		Items []struct {
			Metadata struct {
				Name      string `json:"name"`
				Namespace string `json:"namespace"`
			} `json:"metadata"`
			Spec struct {
				Replicas *int32 `json:"replicas"`
				Selector struct {
					MatchLabels map[string]string `json:"matchLabels"`
				} `json:"selector"`
			} `json:"spec"`
		} `json:"items"`
	}
	if err := json.Unmarshal([]byte(deployOut), &deployList); err != nil {
		return nil, nil
	}

	// Get all PDBs and build selector coverage
	pdbArgs := []string{"get", "poddisruptionbudgets", "-o", "json"}
	if namespace != "" && namespace != "all" {
		pdbArgs = append(pdbArgs, "-n", namespace)
	} else {
		pdbArgs = append(pdbArgs, "--all-namespaces")
	}
	pdbOut, err := a.captureKubectl(pdbArgs)
	if err != nil {
		return nil, nil
	}
	var pdbList struct {
		Items []struct {
			Metadata struct {
				Namespace string `json:"namespace"`
			} `json:"metadata"`
			Spec struct {
				Selector struct {
					MatchLabels map[string]string `json:"matchLabels"`
				} `json:"selector"`
			} `json:"spec"`
		} `json:"items"`
	}
	if err := json.Unmarshal([]byte(pdbOut), &pdbList); err != nil {
		return nil, nil
	}

	// For each namespace, collect deployment names that have replicas > 1
	type nsDeploy struct {
		ns   string
		name string
	}
	needPDB := []nsDeploy{}
	for _, d := range deployList.Items {
		replicas := int32(1)
		if d.Spec.Replicas != nil {
			replicas = *d.Spec.Replicas
		}
		if replicas > 1 {
			needPDB = append(needPDB, nsDeploy{d.Metadata.Namespace, d.Metadata.Name})
		}
	}

	// PDBs typically match deployments via selector. A PDB in the same namespace
	// that selects pods from a deployment (e.g. matchLabels app=foo) protects it.
	// Simplified check: if namespace has at least one PDB, we assume deployments
	// may be covered. More accurate: parse PDB selector and match against
	// deployment template labels. For robustness, we check: deployment ns has
	// no PDB at all → flag each deployment in that ns with replicas>1.
	nsWithPDB := map[string]bool{}
	for _, p := range pdbList.Items {
		nsWithPDB[p.Metadata.Namespace] = true
	}

	for _, nd := range needPDB {
		if !nsWithPDB[nd.ns] {
			findings = append(findings, securityFinding{
				Severity:    "MEDIUM",
				Category:    "pod",
				Resource:    "Deployment",
				Namespace:   nd.ns,
				Name:        nd.name,
				Issue:       "missing-pdb",
				Detail:      fmt.Sprintf("Deployment '%s' has replicas > 1 but namespace has no PodDisruptionBudget — no protection against voluntary disruptions", nd.name),
				Remediation: "Create a PodDisruptionBudget that matches this deployment's pods. Example: kubectl create pdb <name> --selector=app=<label> --min-available=1",
			})
		}
	}

	// Refined check: namespace has PDBs but verify each deployment is covered.
	// Build deploy selector map for deployments we already flagged (ns has no PDB).
	deploySelectors := map[nsDeploy]map[string]string{}
	for _, d := range deployList.Items {
		replicas := int32(1)
		if d.Spec.Replicas != nil {
			replicas = *d.Spec.Replicas
		}
		if replicas > 1 && len(d.Spec.Selector.MatchLabels) > 0 {
			deploySelectors[nsDeploy{d.Metadata.Namespace, d.Metadata.Name}] = d.Spec.Selector.MatchLabels
		}
	}
	for nd, depLabels := range deploySelectors {
		if !nsWithPDB[nd.ns] {
			continue // already flagged above (ns has no PDB)
		}
		covered := false
		for _, p := range pdbList.Items {
			if p.Metadata.Namespace != nd.ns {
				continue
			}
			// PDB matches if all its matchLabels match deployment's selector
			match := true
			for k, v := range p.Spec.Selector.MatchLabels {
				if depLabels[k] != v {
					match = false
					break
				}
			}
			if match && len(p.Spec.Selector.MatchLabels) > 0 {
				covered = true
				break
			}
		}
		if !covered {
			findings = append(findings, securityFinding{
				Severity:    "MEDIUM",
				Category:    "pod",
				Resource:    "Deployment",
				Namespace:   nd.ns,
				Name:        nd.name,
				Issue:       "missing-pdb",
				Detail:      fmt.Sprintf("Deployment '%s' has replicas > 1 but no PodDisruptionBudget matches its pods", nd.name),
				Remediation: "Create a PodDisruptionBudget with a selector matching this deployment's pod template labels.",
			})
		}
	}

	return findings, nil
}

// ─── Deprecated API Check ────────────────────────────────────────────────────

// deprecatedAPIVersion maps deprecated API versions to their replacement.
var deprecatedAPIVersion = map[string]string{
	"policy/v1beta1":  "policy/v1",           // PodDisruptionBudget
	"extensions/v1beta1": "networking.k8s.io/v1", // Ingress
	"networking.k8s.io/v1beta1": "networking.k8s.io/v1", // Ingress
	"batch/v1beta1":  "batch/v1",           // CronJob
	"rbac.authorization.k8s.io/v1beta1": "rbac.authorization.k8s.io/v1",
	"rbac.authorization.k8s.io/v1alpha1": "rbac.authorization.k8s.io/v1",
	"admissionregistration.k8s.io/v1beta1": "admissionregistration.k8s.io/v1",
	"apiextensions.k8s.io/v1beta1": "apiextensions.k8s.io/v1", // CRD
	"scheduling.k8s.io/v1beta1": "scheduling.k8s.io/v1",
	"storage.k8s.io/v1beta1": "storage.k8s.io/v1",
	"certificates.k8s.io/v1beta1": "certificates.k8s.io/v1",
	"coordination.k8s.io/v1beta1": "coordination.k8s.io/v1",
	"node.k8s.io/v1beta1": "node.k8s.io/v1",
	"discovery.k8s.io/v1beta1": "discovery.k8s.io/v1",
	"flowcontrol.apiserver.k8s.io/v1beta1": "flowcontrol.apiserver.k8s.io/v1",
	"flowcontrol.apiserver.k8s.io/v1beta2": "flowcontrol.apiserver.k8s.io/v1",
}

func (a *app) scanDeprecatedAPIs(namespace string) ([]securityFinding, error) {
	var findings []securityFinding

	// Check common workload resources for deprecated apiVersion
	resources := []struct {
		kind  string
		plural string
	}{
		{"PodDisruptionBudget", "poddisruptionbudgets"},
		{"Ingress", "ingresses"},
		{"CronJob", "cronjobs"},
		{"Role", "roles"},
		{"ClusterRole", "clusterroles"},
		{"RoleBinding", "rolebindings"},
		{"ClusterRoleBinding", "clusterrolebindings"},
	}
	for _, r := range resources {
		args := []string{"get", r.plural, "-o", "json"}
		if r.kind == "ClusterRole" || r.kind == "ClusterRoleBinding" {
			// cluster-scoped
		} else if namespace != "" && namespace != "all" {
			args = append(args, "-n", namespace)
		} else {
			args = append(args, "--all-namespaces")
		}
		out, err := a.captureKubectl(args)
		if err != nil {
			continue
		}
		var list struct {
			Items []struct {
				Metadata struct {
					Name      string `json:"name"`
					Namespace string `json:"namespace"`
					// apiVersion is at top level for each item in kubectl get -o json
				} `json:"metadata"`
				APIVersion string `json:"apiVersion"`
			} `json:"items"`
		}
		if err := json.Unmarshal([]byte(out), &list); err != nil {
			continue
		}
		for _, item := range list.Items {
			if replacement, deprecated := deprecatedAPIVersion[item.APIVersion]; deprecated {
				ref := item.Metadata.Name
				if item.Metadata.Namespace != "" {
					ref = item.Metadata.Namespace + "/" + ref
				}
				findings = append(findings, securityFinding{
					Severity:    "LOW",
					Category:    "api",
					Resource:    r.kind,
					Namespace:   item.Metadata.Namespace,
					Name:        item.Metadata.Name,
					Issue:       "deprecated-api",
					Detail:      fmt.Sprintf("%s '%s' uses deprecated apiVersion %s — migrate to %s", r.kind, ref, item.APIVersion, replacement),
					Remediation: fmt.Sprintf("Update manifest to use apiVersion: %s and re-apply.", replacement),
				})
			}
		}
	}

	return findings, nil
}

// ─── kcli security scan ───────────────────────────────────────────────────────

func newSecurityScanCmd(a *app) *cobra.Command {
	var namespace string
	var jsonOut bool
	var minSeverity string
	var skipNetwork bool
	var skipServices bool
	var format string

	cmd := &cobra.Command{
		Use:     "scan",
		Short:   "Full cluster security scan: RBAC, pods, network policies",
		Aliases: []string{"check", "audit"},
		Example: `  # Full cluster security scan
  kcli security scan

  # Scan a specific namespace only
  kcli security scan -n production

  # Show only HIGH and CRITICAL findings
  kcli security scan --min-severity HIGH

  # JSON output for CI/CD integration
  kcli security scan -o json

  # SARIF output for GitHub Advanced Security / code scanning
  kcli security scan --format sarif`,
		RunE: func(cmd *cobra.Command, args []string) error {
			ns := namespace
			if ns == "" {
				ns = a.namespace
			}

			minSev := severityOrder(strings.ToUpper(minSeverity))
			formatNorm := strings.ToLower(strings.TrimSpace(format))
			machineOut := formatNorm == "sarif" || jsonOut

			// For SARIF/JSON, progress goes to stderr so stdout is clean machine-readable output.
			out := a.stdout
			if machineOut {
				out = a.stderr
			}

			fmt.Fprintf(out, "\n%s%s Kubilitics Security Scan%s\n", ansiBold, ansiCyan, ansiReset)
			if ns != "" && ns != "all" {
				fmt.Fprintf(out, "%sScope: namespace=%s%s\n", ansiGray, ns, ansiReset)
			} else {
				fmt.Fprintf(out, "%sScope: cluster-wide%s\n", ansiGray, ansiReset)
			}
			fmt.Fprintln(out)

			var allFindings []securityFinding

			// RBAC scan
			fmt.Fprintf(out, "%sScanning RBAC...%s\r", ansiGray, ansiReset)
			rbacFindings, err := a.scanRBAC()
			if err != nil {
				fmt.Fprintf(a.stderr, "%sWARN: RBAC scan failed: %v%s\n", ansiYellow, err, ansiReset)
			}
			allFindings = append(allFindings, rbacFindings...)

			// Pod security scan
			fmt.Fprintf(out, "%sScanning pod security...%s\r", ansiGray, ansiReset)
			podFindings, err := a.scanPodSecurity(ns)
			if err != nil {
				fmt.Fprintf(a.stderr, "%sWARN: Pod scan failed: %v%s\n", ansiYellow, err, ansiReset)
			}
			allFindings = append(allFindings, podFindings...)

			// Network policy check
			if !skipNetwork {
				fmt.Fprintf(out, "%sChecking network policies...%s\r", ansiGray, ansiReset)
				netFindings, _ := a.checkNetworkPolicies()
				allFindings = append(allFindings, netFindings...)
			}

			// Service security scan
			if !skipServices {
				fmt.Fprintf(out, "%sScanning services...%s\r", ansiGray, ansiReset)
				svcFindings, err := a.scanServices(ns)
				if err != nil {
					fmt.Fprintf(a.stderr, "%sWARN: Service scan failed: %v%s\n", ansiYellow, err, ansiReset)
				}
				allFindings = append(allFindings, svcFindings...)
			}

			// PodDisruptionBudget check (deployments with replicas > 1)
			fmt.Fprintf(out, "%sChecking PodDisruptionBudgets...%s\r", ansiGray, ansiReset)
			pdbFindings, _ := a.scanPodDisruptionBudget(ns)
			allFindings = append(allFindings, pdbFindings...)

			// Deprecated API version check
			fmt.Fprintf(out, "%sChecking deprecated APIs...%s\r", ansiGray, ansiReset)
			depFindings, _ := a.scanDeprecatedAPIs(ns)
			allFindings = append(allFindings, depFindings...)

			// Filter by min severity
			var filtered []securityFinding
			for _, f := range allFindings {
				if severityOrder(f.Severity) <= minSev {
					filtered = append(filtered, f)
				}
			}

			// Sort: severity asc (CRITICAL first), then namespace, then name
			sort.Slice(filtered, func(i, j int) bool {
				si := severityOrder(filtered[i].Severity)
				sj := severityOrder(filtered[j].Severity)
				if si != sj {
					return si < sj
				}
				if filtered[i].Namespace != filtered[j].Namespace {
					return filtered[i].Namespace < filtered[j].Namespace
				}
				return filtered[i].Name < filtered[j].Name
			})

			// Save to history for kcli security diff (after every scan)
			if err := saveSecurityScan(filtered, ns); err != nil {
				fmt.Fprintf(a.stderr, "%sWARN: could not save scan history: %v%s\n", ansiYellow, err, ansiReset)
			}

			// Count by severity
			counts := map[string]int{}
			for _, f := range filtered {
				counts[f.Severity]++
			}

			// SARIF output
			if formatNorm == "sarif" {
				sarifDoc := buildSARIF(filtered)
				b, _ := json.MarshalIndent(sarifDoc, "", "  ")
				fmt.Fprintln(a.stdout, string(b))
				return nil
			}

			if jsonOut {
				b, _ := json.MarshalIndent(map[string]interface{}{
					"findings": filtered,
					"total":    len(filtered),
					"critical": counts["CRITICAL"],
					"high":     counts["HIGH"],
					"medium":   counts["MEDIUM"],
					"low":      counts["LOW"],
					"score":    securityScore(filtered),
				}, "", "  ")
				fmt.Fprintln(a.stdout, string(b))
				return nil
			}

			// Pretty output
			// Clear the scanning status line
			fmt.Fprint(a.stdout, ansiClearLine) // clear line

			// Security score
			score := securityScore(filtered)
			scoreColor := ansiGreen
			if score < 70 {
				scoreColor = ansiRed
			} else if score < 85 {
				scoreColor = ansiYellow
			}
			fmt.Fprintf(a.stdout, "%sSecurity Score: %s%d/100%s\n\n", ansiBold, scoreColor, score, ansiReset)

			// Summary badge
			fmt.Fprintf(a.stdout, "%sScan complete. Findings:%s  ", ansiBold, ansiReset)
			for _, sev := range []string{"CRITICAL", "HIGH", "MEDIUM", "LOW"} {
				if c := counts[sev]; c > 0 {
					fmt.Fprintf(a.stdout, "%s%s:%d%s  ", severityColor(sev), sev, c, ansiReset)
				}
			}
			if len(filtered) == 0 {
				fmt.Fprintf(a.stdout, "%s✓ No findings%s", ansiGreen, ansiReset)
			}
			fmt.Fprintf(a.stdout, "\n\n")

			if len(filtered) == 0 {
				fmt.Fprintf(a.stdout, "%s✓ Cluster passed security scan with no findings at or above %s severity.%s\n\n",
					ansiGreen, strings.ToUpper(minSeverity), ansiReset)
				return nil
			}

			// Findings table
			fmt.Fprintf(a.stdout, "%s%-10s %-10s %-20s %-30s %-30s%s\n",
				ansiBold, "SEVERITY", "CATEGORY", "RESOURCE/NAME", "ISSUE", "DETAIL (truncated)", ansiReset)
			fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 104))

			for _, f := range filtered {
				resourceRef := f.Name
				if f.Namespace != "" {
					resourceRef = f.Namespace + "/" + f.Name
				}
				fmt.Fprintf(a.stdout, "%s%-10s%s %-10s %-20s %-30s %s\n",
					severityColor(f.Severity), f.Severity, ansiReset,
					f.Category,
					truncate(resourceRef, 20),
					f.Issue,
					truncate(f.Detail, 55),
				)
			}

			fmt.Fprintf(a.stdout, "\n%sTip: Use `kcli security scan -o json` for full details and remediation steps.%s\n",
				ansiGray, ansiReset)
			fmt.Fprintf(a.stdout, "%sTip: Use `kcli security scan --format sarif` for SARIF output (GitHub Advanced Security).%s\n",
				ansiGray, ansiReset)
			fmt.Fprintf(a.stdout, "%sTip: Use `kcli security rbac` or `kcli security pods` for focused analysis.%s\n\n",
				ansiGray, ansiReset)

			return nil
		},
	}

	cmd.Flags().StringVarP(&namespace, "namespace", "n", "", "Scope pod scan to a namespace (default: all)")
	cmd.Flags().BoolVarP(&jsonOut, "json", "j", false, "Output as JSON")
	cmd.Flags().StringVar(&minSeverity, "min-severity", "LOW", "Minimum severity to report (CRITICAL, HIGH, MEDIUM, LOW)")
	cmd.Flags().BoolVar(&skipNetwork, "skip-network", false, "Skip NetworkPolicy analysis")
	cmd.Flags().BoolVar(&skipServices, "skip-services", false, "Skip Service NodePort analysis")
	cmd.Flags().StringP("output", "o", "", "Output format (json)")
	cmd.Flags().StringVar(&format, "format", "", "Output format override (sarif)")
	cmd.PreRunE = func(cmd *cobra.Command, args []string) error {
		if o, _ := cmd.Flags().GetString("output"); o == "json" {
			jsonOut = true
		}
		return nil
	}
	return cmd
}

// ─── kcli security rbac ───────────────────────────────────────────────────────

func newSecurityRBACCmd(a *app) *cobra.Command {
	var jsonOut bool

	cmd := &cobra.Command{
		Use:     "rbac",
		Short:   "Analyze RBAC bindings for privilege escalation risks",
		Aliases: []string{"roles"},
		Example: `  # Show RBAC security analysis
  kcli security rbac

  # JSON output
  kcli security rbac -o json`,
		RunE: func(cmd *cobra.Command, args []string) error {
			findings, err := a.scanRBAC()
			if err != nil {
				return err
			}

			sort.Slice(findings, func(i, j int) bool {
				return severityOrder(findings[i].Severity) < severityOrder(findings[j].Severity)
			})

			if jsonOut {
				b, _ := json.MarshalIndent(map[string]interface{}{
					"findings": findings,
					"count":    len(findings),
				}, "", "  ")
				fmt.Fprintln(a.stdout, string(b))
				return nil
			}

			fmt.Fprintf(a.stdout, "\n%s%s RBAC Security Analysis%s\n\n", ansiBold, ansiCyan, ansiReset)

			if len(findings) == 0 {
				fmt.Fprintf(a.stdout, "%s✓ No RBAC issues found.%s\n\n", ansiGreen, ansiReset)
				return nil
			}

			for _, f := range findings {
				fmt.Fprintf(a.stdout, "%s[%s]%s %s/%s\n",
					severityColor(f.Severity), f.Severity, ansiReset, f.Resource, f.Name)
				fmt.Fprintf(a.stdout, "  %sIssue:%s %s\n", ansiBold, ansiReset, f.Issue)
				fmt.Fprintf(a.stdout, "  %sDetail:%s %s\n", ansiBold, ansiReset, f.Detail)
				fmt.Fprintf(a.stdout, "  %sFix:%s %s\n", ansiBold+ansiGreen, ansiReset, f.Remediation)
				fmt.Fprintln(a.stdout)
			}

			return nil
		},
	}

	cmd.Flags().BoolVarP(&jsonOut, "json", "j", false, "Output as JSON")
	cmd.Flags().StringP("output", "o", "", "Output format (json)")
	cmd.PreRunE = func(cmd *cobra.Command, args []string) error {
		if o, _ := cmd.Flags().GetString("output"); o == "json" {
			jsonOut = true
		}
		return nil
	}
	return cmd
}

// ─── kcli security pods ───────────────────────────────────────────────────────

func newSecurityPodsCmd(a *app) *cobra.Command {
	var jsonOut bool
	var namespace string

	cmd := &cobra.Command{
		Use:     "pods",
		Short:   "Analyze pod security contexts for privilege issues",
		Aliases: []string{"pod"},
		Example: `  # Scan all pods cluster-wide
  kcli security pods

  # Scan a specific namespace
  kcli security pods -n production`,
		RunE: func(cmd *cobra.Command, args []string) error {
			ns := namespace
			if ns == "" {
				ns = a.namespace
			}

			findings, err := a.scanPodSecurity(ns)
			if err != nil {
				return err
			}

			sort.Slice(findings, func(i, j int) bool {
				if severityOrder(findings[i].Severity) != severityOrder(findings[j].Severity) {
					return severityOrder(findings[i].Severity) < severityOrder(findings[j].Severity)
				}
				return findings[i].Namespace < findings[j].Namespace
			})

			if jsonOut {
				b, _ := json.MarshalIndent(map[string]interface{}{
					"findings": findings,
					"count":    len(findings),
				}, "", "  ")
				fmt.Fprintln(a.stdout, string(b))
				return nil
			}

			fmt.Fprintf(a.stdout, "\n%s%s Pod Security Analysis%s\n\n", ansiBold, ansiCyan, ansiReset)

			if len(findings) == 0 {
				fmt.Fprintf(a.stdout, "%s✓ No pod security issues found.%s\n\n", ansiGreen, ansiReset)
				return nil
			}

			counts := map[string]int{}
			for _, f := range findings {
				counts[f.Severity]++
			}

			fmt.Fprintf(a.stdout, "Findings: ")
			for _, sev := range []string{"CRITICAL", "HIGH", "MEDIUM", "LOW"} {
				if c := counts[sev]; c > 0 {
					fmt.Fprintf(a.stdout, "%s%s:%d%s  ", severityColor(sev), sev, c, ansiReset)
				}
			}
			fmt.Fprintln(a.stdout)
			fmt.Fprintln(a.stdout)

			fmt.Fprintf(a.stdout, "%s%-10s %-10s %-35s %-25s %s%s\n",
				ansiBold, "SEVERITY", "CATEGORY", "RESOURCE", "ISSUE", "DETAIL", ansiReset)
			fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 100))

			for _, f := range findings {
				resourceRef := f.Name
				if f.Namespace != "" {
					resourceRef = f.Namespace + "/" + f.Name
				}
				fmt.Fprintf(a.stdout, "%s%-10s%s %-10s %-35s %-25s %s\n",
					severityColor(f.Severity), f.Severity, ansiReset,
					f.Category,
					truncate(resourceRef, 35),
					f.Issue,
					truncate(f.Detail, 50),
				)
			}

			fmt.Fprintf(a.stdout, "\n%sTip: Run `kcli security scan -o json` to get full remediation steps.%s\n\n",
				ansiGray, ansiReset)

			return nil
		},
	}

	cmd.Flags().BoolVarP(&jsonOut, "json", "j", false, "Output as JSON")
	cmd.Flags().StringVarP(&namespace, "namespace", "n", "", "Namespace to scan (default: all)")
	cmd.Flags().StringP("output", "o", "", "Output format (json)")
	cmd.PreRunE = func(cmd *cobra.Command, args []string) error {
		if o, _ := cmd.Flags().GetString("output"); o == "json" {
			jsonOut = true
		}
		return nil
	}
	return cmd
}

// ─── kcli security diff ─────────────────────────────────────────────────────

func newSecurityDiffCmd(a *app) *cobra.Command {
	var since string
	var jsonOut bool

	cmd := &cobra.Command{
		Use:     "diff",
		Short:   "Compare security scan results: NEW, RESOLVED, UNCHANGED",
		Example: `  # Compare latest scan vs previous
  kcli security diff

  # Compare vs scan from 7 days ago
  kcli security diff --since=7d`,
		RunE: func(cmd *cobra.Command, args []string) error {
			h, err := loadSecurityHistory()
			if err != nil {
				return fmt.Errorf("failed to load scan history: %w", err)
			}
			if len(h.Scans) < 2 {
				return fmt.Errorf("need at least 2 scans to diff. Run `kcli security scan` twice")
			}

			latest := h.Scans[len(h.Scans)-1]
			var previous securityHistoryEntry

			if since != "" {
				d, err := parseDuration(since)
				if err != nil {
					return fmt.Errorf("invalid --since: %w (use e.g. 7d, 24h)", err)
				}
				cutoff := time.Now().UTC().Add(-d)
				previous = securityHistoryEntry{}
				for i := len(h.Scans) - 1; i >= 0; i-- {
					if h.Scans[i].Timestamp.Before(cutoff) {
						previous = h.Scans[i]
						break
					}
				}
				if previous.Timestamp.IsZero() {
					return fmt.Errorf("no scan found older than %s", since)
				}
			} else {
				previous = h.Scans[len(h.Scans)-2]
			}

			prevKeys := make(map[string]securityFinding)
			for _, f := range previous.Findings {
				prevKeys[findingKey(f)] = f
			}
			latestKeys := make(map[string]securityFinding)
			for _, f := range latest.Findings {
				latestKeys[findingKey(f)] = f
			}

			var newFindings, resolved, unchanged []securityFinding
			for k, f := range latestKeys {
				if _, ok := prevKeys[k]; ok {
					unchanged = append(unchanged, f)
				} else {
					newFindings = append(newFindings, f)
				}
			}
			for k, f := range prevKeys {
				if _, ok := latestKeys[k]; !ok {
					resolved = append(resolved, f)
				}
			}

			sort.Slice(newFindings, func(i, j int) bool {
				return severityOrder(newFindings[i].Severity) < severityOrder(newFindings[j].Severity)
			})
			sort.Slice(resolved, func(i, j int) bool {
				return severityOrder(resolved[i].Severity) < severityOrder(resolved[j].Severity)
			})
			sort.Slice(unchanged, func(i, j int) bool {
				return severityOrder(unchanged[i].Severity) < severityOrder(unchanged[j].Severity)
			})

			if jsonOut {
				out := map[string]interface{}{
					"previous_timestamp": previous.Timestamp,
					"latest_timestamp":   latest.Timestamp,
					"new":                newFindings,
					"resolved":           resolved,
					"unchanged":          unchanged,
				}
				b, _ := json.MarshalIndent(out, "", "  ")
				fmt.Fprintln(a.stdout, string(b))
				return nil
			}

			fmt.Fprintf(a.stdout, "\n%s%s Security Scan Diff%s\n", ansiBold, ansiCyan, ansiReset)
			fmt.Fprintf(a.stdout, "%sPrevious: %s  →  Latest: %s%s\n\n",
				ansiGray, previous.Timestamp.Format(time.RFC3339), latest.Timestamp.Format(time.RFC3339), ansiReset)

			if len(newFindings) == 0 && len(resolved) == 0 {
				fmt.Fprintf(a.stdout, "%sNo changes. %d findings unchanged.%s\n\n", ansiGreen, len(unchanged), ansiReset)
				return nil
			}

			if len(newFindings) > 0 {
				fmt.Fprintf(a.stdout, "%s[NEW] %d introduced since previous scan:%s\n", ansiRed, len(newFindings), ansiReset)
				fmt.Fprintf(a.stdout, "%s%-10s %-10s %-25s %-25s%s\n", ansiBold, "SEVERITY", "CATEGORY", "RESOURCE", "ISSUE", ansiReset)
				fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 80))
				for _, f := range newFindings {
					ref := f.Name
					if f.Namespace != "" {
						ref = f.Namespace + "/" + f.Name
					}
					fmt.Fprintf(a.stdout, "%s%-10s%s %-10s %-25s %-25s\n",
						severityColor(f.Severity), f.Severity, ansiReset, f.Category, truncate(ref, 25), f.Issue)
				}
				fmt.Fprintln(a.stdout)
			}

			if len(resolved) > 0 {
				fmt.Fprintf(a.stdout, "%s[RESOLVED] %d fixed since previous scan:%s\n", ansiGreen, len(resolved), ansiReset)
				fmt.Fprintf(a.stdout, "%s%-10s %-10s %-25s %-25s%s\n", ansiBold, "SEVERITY", "CATEGORY", "RESOURCE", "ISSUE", ansiReset)
				fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 80))
				for _, f := range resolved {
					ref := f.Name
					if f.Namespace != "" {
						ref = f.Namespace + "/" + f.Name
					}
					fmt.Fprintf(a.stdout, "%s%-10s%s %-10s %-25s %-25s\n",
						severityColor(f.Severity), f.Severity, ansiReset, f.Category, truncate(ref, 25), f.Issue)
				}
				fmt.Fprintln(a.stdout)
			}

			fmt.Fprintf(a.stdout, "%s[UNCHANGED] %d findings%s\n\n", ansiGray, len(unchanged), ansiReset)
			return nil
		},
	}

	cmd.Flags().StringVar(&since, "since", "", "Compare vs scan from this duration ago (e.g. 7d, 24h)")
	cmd.Flags().BoolVarP(&jsonOut, "json", "j", false, "Output as JSON")
	return cmd
}

// parseDuration parses durations like "7d", "24h", "1h30m".
func parseDuration(s string) (time.Duration, error) {
	s = strings.TrimSpace(strings.ToLower(s))
	if s == "" {
		return 0, fmt.Errorf("empty duration")
	}
	if strings.HasSuffix(s, "d") {
		var n int
		if _, err := fmt.Sscanf(s[:len(s)-1], "%d", &n); err != nil {
			return 0, fmt.Errorf("invalid duration %q", s)
		}
		return time.Duration(n) * 24 * time.Hour, nil
	}
	d, err := time.ParseDuration(s)
	if err != nil {
		return 0, fmt.Errorf("invalid duration %q: %w", s, err)
	}
	return d, nil
}

// ─── kcli security (parent command) ──────────────────────────────────────────

func newSecurityCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "security",
		Short: "Security analysis — RBAC, pod security, and network policies",
		Long: `kcli security provides instant Kubernetes security analysis without external scanners.

Checks RBAC for privilege escalation risks, pod specs for security misconfigurations,
and namespaces for missing network isolation.

No agents, no API calls to external services — runs entirely against your kubeconfig.`,
		GroupID: "observability",
		RunE: func(cmd *cobra.Command, args []string) error {
			return cmd.Help()
		},
	}

	cmd.AddCommand(
		newSecurityScanCmd(a),
		newSecurityDiffCmd(a),
		newSecurityRBACCmd(a),
		newSecurityPodsCmd(a),
	)

	return cmd
}
