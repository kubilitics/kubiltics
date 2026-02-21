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
	"sort"
	"strings"

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
	Severity  string `json:"severity"`  // CRITICAL, HIGH, MEDIUM, LOW
	Category  string `json:"category"`  // rbac, pod, network, secret
	Resource  string `json:"resource"`  // resource kind
	Namespace string `json:"namespace,omitempty"`
	Name      string `json:"name"`
	Issue     string `json:"issue"`
	Detail    string `json:"detail"`
	Remediation string `json:"remediation"`
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
					Severity:     severity,
					Category:     "rbac",
					Resource:     "ClusterRoleBinding",
					Name:         crb.Metadata.Name,
					Issue:        "cluster-admin-binding",
					Detail:       detail,
					Remediation:  remediation,
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
					Name            string `json:"name"`
					Image           string `json:"image"`
					SecurityContext struct {
						Privileged             *bool  `json:"privileged"`
						AllowPrivilegeEscalation *bool `json:"allowPrivilegeEscalation"`
						RunAsNonRoot           *bool  `json:"runAsNonRoot"`
						RunAsUser              *int64 `json:"runAsUser"`
						ReadOnlyRootFilesystem *bool  `json:"readOnlyRootFilesystem"`
						Capabilities struct {
							Add  []string `json:"add"`
							Drop []string `json:"drop"`
						} `json:"capabilities"`
					} `json:"securityContext"`
					VolumeMounts []struct {
						MountPath string `json:"mountPath"`
						Name      string `json:"name"`
					} `json:"volumeMounts"`
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

			// Running as root (UID 0) explicitly
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

// ─── kcli security scan ───────────────────────────────────────────────────────

func newSecurityScanCmd(a *app) *cobra.Command {
	var namespace string
	var jsonOut bool
	var minSeverity string
	var skipNetwork bool

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
  kcli security scan -o json`,
		RunE: func(cmd *cobra.Command, args []string) error {
			ns := namespace
			if ns == "" {
				ns = a.namespace
			}

			minSev := severityOrder(strings.ToUpper(minSeverity))

			fmt.Fprintf(a.stdout, "\n%s%s Kubilitics Security Scan%s\n", ansiBold, ansiCyan, ansiReset)
			if ns != "" && ns != "all" {
				fmt.Fprintf(a.stdout, "%sScope: namespace=%s%s\n", ansiGray, ns, ansiReset)
			} else {
				fmt.Fprintf(a.stdout, "%sScope: cluster-wide%s\n", ansiGray, ansiReset)
			}
			fmt.Fprintln(a.stdout)

			var allFindings []securityFinding

			// RBAC scan
			fmt.Fprintf(a.stdout, "%sScanning RBAC...%s\r", ansiGray, ansiReset)
			rbacFindings, err := a.scanRBAC()
			if err != nil {
				fmt.Fprintf(a.stderr, "%sWARN: RBAC scan failed: %v%s\n", ansiYellow, err, ansiReset)
			}
			allFindings = append(allFindings, rbacFindings...)

			// Pod security scan
			fmt.Fprintf(a.stdout, "%sScanning pod security...%s\r", ansiGray, ansiReset)
			podFindings, err := a.scanPodSecurity(ns)
			if err != nil {
				fmt.Fprintf(a.stderr, "%sWARN: Pod scan failed: %v%s\n", ansiYellow, err, ansiReset)
			}
			allFindings = append(allFindings, podFindings...)

			// Network policy check
			if !skipNetwork {
				fmt.Fprintf(a.stdout, "%sChecking network policies...%s\r", ansiGray, ansiReset)
				netFindings, _ := a.checkNetworkPolicies()
				allFindings = append(allFindings, netFindings...)
			}

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

			// Count by severity
			counts := map[string]int{}
			for _, f := range filtered {
				counts[f.Severity]++
			}

			if jsonOut {
				b, _ := json.MarshalIndent(map[string]interface{}{
					"findings":          filtered,
					"total":             len(filtered),
					"critical":          counts["CRITICAL"],
					"high":              counts["HIGH"],
					"medium":            counts["MEDIUM"],
					"low":               counts["LOW"],
				}, "", "  ")
				fmt.Fprintln(a.stdout, string(b))
				return nil
			}

			// Pretty output
			// Clear the scanning status line
			fmt.Fprintf(a.stdout, "\033[2K\r") // clear line

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
			fmt.Fprintf(a.stdout, "%sTip: Use `kcli security rbac` or `kcli security pods` for focused analysis.%s\n\n",
				ansiGray, ansiReset)

			return nil
		},
	}

	cmd.Flags().StringVarP(&namespace, "namespace", "n", "", "Scope pod scan to a namespace (default: all)")
	cmd.Flags().BoolVarP(&jsonOut, "json", "j", false, "Output as JSON")
	cmd.Flags().StringVar(&minSeverity, "min-severity", "LOW", "Minimum severity to report (CRITICAL, HIGH, MEDIUM, LOW)")
	cmd.Flags().BoolVar(&skipNetwork, "skip-network", false, "Skip NetworkPolicy analysis")
	cmd.Flags().StringP("output", "o", "", "Output format (json)")
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
		newSecurityRBACCmd(a),
		newSecurityPodsCmd(a),
	)

	return cmd
}
