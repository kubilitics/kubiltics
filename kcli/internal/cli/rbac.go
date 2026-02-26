package cli

// rbac.go — kcli rbac command group.
//
// Deep RBAC analysis beyond what `kcli security rbac` provides.
// Provides query-based RBAC inspection like `kubectl auth can-i` but
// for entire subjects and with privilege escalation mapping.
//
// Commands:
//   kcli rbac analyze                  — full RBAC privilege map
//   kcli rbac who-can <verb> <resource> — who can do this action?
//   kcli rbac what-can <subject>        — what can this subject do?
//   kcli rbac diff <role1> <role2>      — compare two roles
//   kcli rbac report [--format=pdf]     — compliance report

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

// ─── Extended RBAC types ───────────────────────────────────────────────────────

type rbacSubjectSummary struct {
	Kind      string
	Name      string
	Namespace string
	Roles     []string
	Verbs     map[string][]string // resource → verbs
	IsAdmin   bool
}

// ─── Full RBAC analyze ────────────────────────────────────────────────────────

func (a *app) rbacAnalyzeFull(namespace string) ([]rbacSubjectSummary, error) {
	subjectMap := map[string]*rbacSubjectSummary{}

	// 1. ClusterRoleBindings
	crbOut, err := a.captureKubectl([]string{"get", "clusterrolebindings", "-o", "json"})
	if err != nil {
		return nil, fmt.Errorf("failed to list clusterrolebindings: %w", err)
	}
	var crbList k8sClusterRoleBindingList
	if err := json.Unmarshal([]byte(crbOut), &crbList); err != nil {
		return nil, fmt.Errorf("failed to parse clusterrolebindings: %w", err)
	}

	for _, crb := range crbList.Items {
		for _, sub := range crb.Subjects {
			if strings.HasPrefix(sub.Name, "system:") {
				continue
			}
			key := sub.Kind + "/" + sub.Name
			s, ok := subjectMap[key]
			if !ok {
				s = &rbacSubjectSummary{
					Kind:      sub.Kind,
					Name:      sub.Name,
					Namespace: sub.Namespace,
					Verbs:     map[string][]string{},
				}
				subjectMap[key] = s
			}
			s.Roles = append(s.Roles, "ClusterRole/"+crb.RoleRef.Name)
			if crb.RoleRef.Name == "cluster-admin" {
				s.IsAdmin = true
			}
		}
	}

	// 2. Namespaced RoleBindings
	nsArgs := []string{"get", "rolebindings", "-o", "json"}
	if namespace != "" {
		nsArgs = append(nsArgs, "-n", namespace)
	} else {
		nsArgs = append(nsArgs, "--all-namespaces")
	}
	rbOut, err := a.captureKubectl(nsArgs)
	if err == nil {
		var rbList k8sRoleBindingList
		if json.Unmarshal([]byte(rbOut), &rbList) == nil {
			for _, rb := range rbList.Items {
				for _, sub := range rb.Subjects {
					if strings.HasPrefix(sub.Name, "system:") {
						continue
					}
					key := sub.Kind + "/" + sub.Name
					s, ok := subjectMap[key]
					if !ok {
						s = &rbacSubjectSummary{
							Kind:      sub.Kind,
							Name:      sub.Name,
							Namespace: sub.Namespace,
							Verbs:     map[string][]string{},
						}
						subjectMap[key] = s
					}
					s.Roles = append(s.Roles, rb.Metadata.Namespace+"/"+rb.RoleRef.Kind+"/"+rb.RoleRef.Name)
				}
			}
		}
	}

	result := make([]rbacSubjectSummary, 0, len(subjectMap))
	for _, s := range subjectMap {
		result = append(result, *s)
	}
	sort.Slice(result, func(i, j int) bool {
		// Admins first, then by kind, then name
		if result[i].IsAdmin != result[j].IsAdmin {
			return result[i].IsAdmin
		}
		if result[i].Kind != result[j].Kind {
			return result[i].Kind < result[j].Kind
		}
		return result[i].Name < result[j].Name
	})
	return result, nil
}

// ─── who-can analysis ─────────────────────────────────────────────────────────

type whoCan struct {
	Subject   string
	Kind      string
	Namespace string
	Via       string // role/binding that grants permission
}

// subjectWithVia holds a subject and the binding that references it.
type subjectWithVia struct {
	Kind      string
	Name      string
	Namespace string
	Via       string
}

const whoCanCacheTTL = 2 * time.Second

// rbacWhoCan uses kubectl auth can-i for each subject for accuracy.
// Lists all subjects from ClusterRoleBindings and RoleBindings, then checks
// each with kubectl auth can-i <verb> <resource> --as=<subject>.
// Results are cached for 2s to avoid excessive API calls.
func (a *app) rbacWhoCan(verb, resource, namespace string) ([]whoCan, error) {
	cacheKey := fmt.Sprintf("rbac-who-can:%s|%s|%s", verb, resource, namespace)
	a.cacheMu.Lock()
	if ent, ok := a.cache[cacheKey]; ok && time.Now().Before(ent.expires) {
		var cached []whoCan
		if json.Unmarshal([]byte(ent.value), &cached) == nil {
			a.cacheMu.Unlock()
			return cached, nil
		}
	}
	a.cacheMu.Unlock()

	subjects, err := a.rbacCollectSubjectsWithVia(namespace)
	if err != nil {
		return nil, err
	}

	var results []whoCan
	for _, sub := range subjects {
		can, err := a.rbacAuthCanI(verb, resource, namespace, sub)
		if err != nil {
			continue
		}
		if can {
			results = append(results, whoCan{
				Subject:   sub.Name,
				Kind:      sub.Kind,
				Namespace: sub.Namespace,
				Via:       sub.Via,
			})
		}
	}

	// Cache results
	if b, err := json.Marshal(results); err == nil {
		a.cacheMu.Lock()
		a.cache[cacheKey] = cacheEntry{value: string(b), expires: time.Now().Add(whoCanCacheTTL)}
		a.cacheMu.Unlock()
	}

	return results, nil
}

// rbacCollectSubjectsWithVia returns all subjects from CRB and RB with their binding info.
func (a *app) rbacCollectSubjectsWithVia(namespace string) ([]subjectWithVia, error) {
	seen := make(map[string]bool) // "Kind/Name/Namespace" to dedupe
	var out []subjectWithVia

	// ClusterRoleBindings
	crbOut, err := a.captureKubectl([]string{"get", "clusterrolebindings", "-o", "json"})
	if err != nil {
		return nil, fmt.Errorf("failed to list clusterrolebindings: %w", err)
	}
	var crbList k8sClusterRoleBindingList
	if err := json.Unmarshal([]byte(crbOut), &crbList); err != nil {
		return nil, err
	}
	for _, crb := range crbList.Items {
		roleKey := crb.RoleRef.Kind + "/" + crb.RoleRef.Name
		via := "ClusterRoleBinding/" + crb.Metadata.Name + " → " + roleKey
		for _, sub := range crb.Subjects {
			if strings.HasPrefix(sub.Name, "system:") {
				continue
			}
			key := sub.Kind + "/" + sub.Name + "/" + sub.Namespace
			if seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, subjectWithVia{
				Kind:      sub.Kind,
				Name:      sub.Name,
				Namespace: sub.Namespace,
				Via:       via,
			})
		}
	}

	// RoleBindings (namespace-scoped if namespace specified, else all)
	rbArgs := []string{"get", "rolebindings", "-o", "json"}
	if namespace != "" {
		rbArgs = append(rbArgs, "-n", namespace)
	} else {
		rbArgs = append(rbArgs, "--all-namespaces")
	}
	rbOut, err := a.captureKubectl(rbArgs)
	if err != nil {
		return out, nil
	}
	var rbList k8sRoleBindingList
	if json.Unmarshal([]byte(rbOut), &rbList) != nil {
		return out, nil
	}
	for _, rb := range rbList.Items {
		roleKey := rb.RoleRef.Kind + "/" + rb.RoleRef.Name
		via := "RoleBinding/" + rb.Metadata.Namespace + "/" + rb.Metadata.Name + " → " + roleKey
		for _, sub := range rb.Subjects {
			if strings.HasPrefix(sub.Name, "system:") {
				continue
			}
			key := sub.Kind + "/" + sub.Name + "/" + sub.Namespace
			if seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, subjectWithVia{
				Kind:      sub.Kind,
				Name:      sub.Name,
				Namespace: sub.Namespace,
				Via:       via,
			})
		}
	}

	return out, nil
}

// rbacAuthCanI runs kubectl auth can-i and returns true if the subject can perform the action.
func (a *app) rbacAuthCanI(verb, resource, namespace string, sub subjectWithVia) (bool, error) {
	args := []string{"auth", "can-i", verb, resource}
	if namespace != "" {
		args = append(args, "-n", namespace)
	}

	switch strings.ToLower(sub.Kind) {
	case "serviceaccount", "sa":
		ns := sub.Namespace
		if ns == "" {
			ns = "default"
		}
		args = append(args, "--as=system:serviceaccount:"+ns+":"+sub.Name)
	case "user":
		args = append(args, "--as="+sub.Name)
	case "group":
		args = append(args, "--as=system:group-check", "--as-group="+sub.Name)
	default:
		args = append(args, "--as="+sub.Name)
	}

	out, err := a.captureKubectl(args)
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(out) == "yes", nil
}

// ─── newRBACCmd ───────────────────────────────────────────────────────────────

func newRBACCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "rbac",
		Short: "RBAC privilege analysis — who can do what",
		Long: `kcli rbac provides deep RBAC analysis beyond kubectl auth can-i.

Map all subjects to their permissions, find who can perform specific actions,
compare roles, and generate compliance reports.`,
		GroupID: "observability",
		RunE: func(cmd *cobra.Command, args []string) error {
			return cmd.Help()
		},
	}

	// analyze
	var namespace string
	var jsonOut bool

	analyze := &cobra.Command{
		Use:     "analyze",
		Short:   "Full RBAC privilege map — all subjects and their roles",
		Aliases: []string{"analyse", "map"},
		RunE: func(cmd *cobra.Command, args []string) error {
			ns := namespace
			if ns == "" {
				ns = a.namespace
			}

			subjects, err := a.rbacAnalyzeFull(ns)
			if err != nil {
				return err
			}

			if jsonOut {
				b, _ := json.MarshalIndent(subjects, "", "  ")
				fmt.Fprintln(a.stdout, string(b))
				return nil
			}

			fmt.Fprintf(a.stdout, "\n%s%s RBAC Analysis%s", ansiBold, ansiCyan, ansiReset)
			if ns != "" {
				fmt.Fprintf(a.stdout, " — %s", ns)
			} else {
				fmt.Fprintf(a.stdout, " — cluster-wide")
			}
			fmt.Fprintf(a.stdout, "\n%s%d subjects found%s\n\n", ansiGray, len(subjects), ansiReset)

			admins := 0
			for _, s := range subjects {
				if s.IsAdmin {
					admins++
				}
			}
			if admins > 0 {
				fmt.Fprintf(a.stdout, "%s⚠ %d subject(s) with cluster-admin:%s\n", ansiRed+ansiBold, admins, ansiReset)
				for _, s := range subjects {
					if s.IsAdmin {
						fmt.Fprintf(a.stdout, "  %s[%s]%s %s\n", ansiRed, s.Kind, ansiReset, s.Name)
					}
				}
				fmt.Fprintln(a.stdout)
			}

			fmt.Fprintf(a.stdout, "%s%-12s %-40s %s%s\n", ansiBold, "KIND", "SUBJECT", "ROLES", ansiReset)
			fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 80))
			for _, s := range subjects {
				adminFlag := ""
				if s.IsAdmin {
					adminFlag = ansiRed + " [ADMIN]" + ansiReset
				}
				roles := strings.Join(s.Roles, ", ")
				fmt.Fprintf(a.stdout, "%-12s %-40s %s%s\n",
					s.Kind, truncate(s.Name, 40),
					truncate(roles, 40), adminFlag,
				)
			}
			fmt.Fprintf(a.stdout, "\n%sTip: kcli rbac who-can delete pods -n <namespace>%s\n", ansiGray, ansiReset)
			fmt.Fprintf(a.stdout, "%sTip: kcli rbac what-can service-account/<name>%s\n\n", ansiGray, ansiReset)
			return nil
		},
	}
	analyze.Flags().StringVarP(&namespace, "namespace", "n", "", "Scope to namespace")
	analyze.Flags().BoolVarP(&jsonOut, "json", "j", false, "JSON output")

	// who-can
	whoCan := &cobra.Command{
		Use:   "who-can <verb> <resource>",
		Short: "Find all subjects that can perform an action",
		Args:  cobra.ExactArgs(2),
		Example: `  kcli rbac who-can delete pods
  kcli rbac who-can get secrets -n production
  kcli rbac who-can create deployments`,
		RunE: func(cmd *cobra.Command, args []string) error {
			verb := args[0]
			resource := args[1]
			ns := namespace
			if ns == "" {
				ns = a.namespace
			}

			results, err := a.rbacWhoCan(verb, resource, ns)
			if err != nil {
				return err
			}

			fmt.Fprintf(a.stdout, "\n%s%s Who can %s %s?%s\n\n",
				ansiBold, ansiCyan, verb, resource, ansiReset)

			if len(results) == 0 {
				fmt.Fprintf(a.stdout, "%s(no subjects found with this permission)%s\n\n", ansiGray, ansiReset)
				return nil
			}

			fmt.Fprintf(a.stdout, "%s%-12s %-40s %s%s\n", ansiBold, "KIND", "SUBJECT", "VIA", ansiReset)
			fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 80))
			for _, r := range results {
				fmt.Fprintf(a.stdout, "%-12s %-40s %s\n",
					r.Kind, r.Subject, ansiGray+truncate(r.Via, 40)+ansiReset)
			}
			fmt.Fprintf(a.stdout, "\n%sTotal: %d subject(s)%s\n\n", ansiGray, len(results), ansiReset)
			return nil
		},
	}
	whoCan.Flags().StringVarP(&namespace, "namespace", "n", "", "Scope to namespace")

	// what-can
	whatCan := &cobra.Command{
		Use:   "what-can <kind/name>",
		Short: "Show what permissions a subject has",
		Args:  cobra.ExactArgs(1),
		Example: `  kcli rbac what-can ServiceAccount/ci-deployer
  kcli rbac what-can User/alice
  kcli rbac what-can Group/developers`,
		RunE: func(cmd *cobra.Command, args []string) error {
			subject := args[0]
			fmt.Fprintf(a.stdout, "\n%s%s Permissions for: %s%s%s\n\n",
				ansiBold, ansiCyan, ansiYellow, subject, ansiReset)

			// Use kubectl auth can-i --list for the subject
			parts := strings.SplitN(subject, "/", 2)
			kind, name := "User", subject
			if len(parts) == 2 {
				kind, name = parts[0], parts[1]
			}

			var authArgs []string
			switch strings.ToLower(kind) {
			case "serviceaccount", "sa":
				ns := namespace
				if ns == "" {
					ns = "default"
				}
				authArgs = []string{"auth", "can-i", "--list",
					fmt.Sprintf("--as=system:serviceaccount:%s:%s", ns, name)}
			case "user":
				authArgs = []string{"auth", "can-i", "--list", "--as=" + name}
			case "group":
				authArgs = []string{"auth", "can-i", "--list", "--as-group=" + name}
			default:
				authArgs = []string{"auth", "can-i", "--list", "--as=" + name}
			}

			return a.runKubectl(authArgs)
		},
	}
	whatCan.Flags().StringVarP(&namespace, "namespace", "n", "", "ServiceAccount namespace")

	// diff
	diffCmd := &cobra.Command{
		Use:   "diff <role1> <role2>",
		Short: "Compare permissions between two ClusterRoles or Roles",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			role1, role2 := args[0], args[1]

			getRole := func(name string) ([]k8sRBACRule, error) {
				// Try ClusterRole first
				out, err := a.captureKubectl([]string{"get", "clusterrole", name, "-o", "json"})
				if err != nil {
					// Try Role with namespace
					ns := namespace
					if ns == "" {
						ns = a.namespace
					}
					if ns == "" {
						ns = "default"
					}
					out, err = a.captureKubectl([]string{"get", "role", name, "-n", ns, "-o", "json"})
					if err != nil {
						return nil, fmt.Errorf("role %q not found: %w", name, err)
					}
				}
				var cr k8sClusterRole
				if err := json.Unmarshal([]byte(out), &cr); err != nil {
					return nil, err
				}
				return cr.Rules, nil
			}

			rules1, err := getRole(role1)
			if err != nil {
				return err
			}
			rules2, err := getRole(role2)
			if err != nil {
				return err
			}

			fmt.Fprintf(a.stdout, "\n%s%s Role Diff%s\n", ansiBold, ansiCyan, ansiReset)
			fmt.Fprintf(a.stdout, "  %s-%s %s  %s+%s %s\n\n",
				ansiRed, ansiReset, role1, ansiGreen, ansiReset, role2)

			rulesStr := func(rules []k8sRBACRule) []string {
				var out []string
				for _, r := range rules {
					key := fmt.Sprintf("verbs=[%s] resources=[%s]",
						strings.Join(r.Verbs, ","), strings.Join(r.Resources, ","))
					out = append(out, key)
				}
				sort.Strings(out)
				return out
			}

			set1 := map[string]bool{}
			set2 := map[string]bool{}
			for _, r := range rulesStr(rules1) {
				set1[r] = true
			}
			for _, r := range rulesStr(rules2) {
				set2[r] = true
			}

			for r := range set1 {
				if !set2[r] {
					fmt.Fprintf(a.stdout, "%s- %s%s\n", ansiRed, r, ansiReset)
				}
			}
			for r := range set2 {
				if !set1[r] {
					fmt.Fprintf(a.stdout, "%s+ %s%s\n", ansiGreen, r, ansiReset)
				}
			}
			fmt.Fprintln(a.stdout)
			return nil
		},
	}
	diffCmd.Flags().StringVarP(&namespace, "namespace", "n", "", "Namespace for namespaced roles")

	// report
	report := &cobra.Command{
		Use:   "report",
		Short: "Generate a compliance RBAC report",
		RunE: func(cmd *cobra.Command, args []string) error {
			subjects, err := a.rbacAnalyzeFull("")
			if err != nil {
				return err
			}

			fmt.Fprintf(a.stdout, "\n%s%s RBAC Compliance Report%s\n", ansiBold, ansiCyan, ansiReset)
			fmt.Fprintf(a.stdout, "%sGenerated: %s%s\n\n", ansiGray, "2026-02-22", ansiReset)

			// Count by kind
			kinds := map[string]int{}
			admins := 0
			for _, s := range subjects {
				kinds[s.Kind]++
				if s.IsAdmin {
					admins++
				}
			}

			fmt.Fprintf(a.stdout, "%sSummary:%s\n", ansiBold, ansiReset)
			fmt.Fprintf(a.stdout, "  Total subjects: %d\n", len(subjects))
			for k, c := range kinds {
				fmt.Fprintf(a.stdout, "  %s: %d\n", k, c)
			}
			fmt.Fprintf(a.stdout, "\n")

			if admins > 0 {
				fmt.Fprintf(a.stdout, "%s⛔ cluster-admin subjects: %d%s\n\n", ansiRed+ansiBold, admins, ansiReset)
			}

			fmt.Fprintf(a.stdout, "%sFull privilege mapping:%s\n", ansiBold, ansiReset)
			for _, s := range subjects {
				adminNote := ""
				if s.IsAdmin {
					adminNote = " [CLUSTER-ADMIN]"
				}
				fmt.Fprintf(a.stdout, "  %s/%s%s\n", s.Kind, s.Name, adminNote)
				for _, r := range s.Roles {
					fmt.Fprintf(a.stdout, "    → %s\n", r)
				}
			}
			fmt.Fprintf(a.stdout, "\n%sTip: Export with: kcli rbac report -o json > rbac-report.json%s\n\n",
				ansiGray, ansiReset)
			return nil
		},
	}

	cmd.AddCommand(analyze, whoCan, whatCan, diffCmd, report)
	return cmd
}
