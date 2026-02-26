package cli

// policy.go — kcli policy command group.
//
// Policy-as-code enforcement for Kubernetes manifests.
// Validates YAML manifests against configurable rules before apply.
// Supports built-in security presets and custom rules.
//
// Commands:
//   kcli policy list                         — list active policies
//   kcli policy check <file.yaml>            — validate before apply
//   kcli policy add --<preset>               — add a built-in policy preset
//   kcli policy remove <name>               — remove a policy
//   kcli policy import <dir>                — import custom policies

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"
)

// ─── Policy types ──────────────────────────────────────────────────────────────

type policyRule struct {
	Name        string `json:"name" yaml:"name"`
	Description string `json:"description" yaml:"description"`
	Severity    string `json:"severity" yaml:"severity"` // error, warning
	Check       string `json:"check" yaml:"check"`       // built-in check name
	Enabled     bool   `json:"enabled" yaml:"enabled"`
}

type policyStore struct {
	Rules []policyRule `json:"rules" yaml:"rules"`
}

// ─── Built-in presets ─────────────────────────────────────────────────────────

var builtinPolicies = map[string]policyRule{
	"no-latest-image-tag": {
		Name:        "no-latest-image-tag",
		Description: "Containers must not use :latest or untagged images",
		Severity:    "error",
		Check:       "no-latest-image-tag",
		Enabled:     true,
	},
	"require-resource-limits": {
		Name:        "require-resource-limits",
		Description: "All containers must have CPU and memory limits",
		Severity:    "error",
		Check:       "require-resource-limits",
		Enabled:     true,
	},
	"no-root-containers": {
		Name:        "no-root-containers",
		Description: "Containers must not run as root (UID 0)",
		Severity:    "error",
		Check:       "no-root-containers",
		Enabled:     true,
	},
	"require-readiness-probe": {
		Name:        "require-readiness-probe",
		Description: "All containers should have readiness probes",
		Severity:    "warning",
		Check:       "require-readiness-probe",
		Enabled:     true,
	},
	"require-liveness-probe": {
		Name:        "require-liveness-probe",
		Description: "All containers should have liveness probes",
		Severity:    "warning",
		Check:       "require-liveness-probe",
		Enabled:     true,
	},
	"no-privileged-containers": {
		Name:        "no-privileged-containers",
		Description: "Containers must not run in privileged mode",
		Severity:    "error",
		Check:       "no-privileged-containers",
		Enabled:     true,
	},
	"require-resource-requests": {
		Name:        "require-resource-requests",
		Description: "All containers must have CPU and memory requests",
		Severity:    "warning",
		Check:       "require-resource-requests",
		Enabled:     true,
	},
	"no-host-pid": {
		Name:        "no-host-pid",
		Description: "Pods must not use hostPID=true",
		Severity:    "error",
		Check:       "no-host-pid",
		Enabled:     true,
	},
	"no-host-network": {
		Name:        "no-host-network",
		Description: "Pods must not use hostNetwork=true",
		Severity:    "error",
		Check:       "no-host-network",
		Enabled:     true,
	},
	"readonly-root-filesystem": {
		Name:        "readonly-root-filesystem",
		Description: "Containers should have readOnlyRootFilesystem=true",
		Severity:    "warning",
		Check:       "readonly-root-filesystem",
		Enabled:     true,
	},
}

// ─── Policy store path ────────────────────────────────────────────────────────

func policyStorePath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".kcli", "policies.json")
}

func loadPolicyStore() (*policyStore, error) {
	path := policyStorePath()
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &policyStore{}, nil
		}
		return nil, err
	}
	var s policyStore
	if err := json.Unmarshal(b, &s); err != nil {
		return &policyStore{}, nil
	}
	return &s, nil
}

func savePolicyStore(s *policyStore) error {
	path := policyStorePath()
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}

// ─── Policy violation ─────────────────────────────────────────────────────────

type policyViolation struct {
	Policy    string
	Severity  string
	Resource  string
	Message   string
}

// ─── Policy checker ───────────────────────────────────────────────────────────

// checkManifest runs all active policies against a raw manifest byte slice.
func (a *app) checkManifest(manifestBytes []byte, rules []policyRule) []policyViolation {
	var violations []policyViolation

	// Parse YAML into a generic map for inspection
	var docs []interface{}
	dec := yaml.NewDecoder(strings.NewReader(string(manifestBytes)))
	for {
		var doc interface{}
		if err := dec.Decode(&doc); err != nil {
			break
		}
		if doc != nil {
			docs = append(docs, doc)
		}
	}

	for _, rawDoc := range docs {
		doc, ok := rawDoc.(map[string]interface{})
		if !ok {
			continue
		}

		kind, _ := doc["kind"].(string)
		metadata, _ := doc["metadata"].(map[string]interface{})
		name := ""
		if metadata != nil {
			name, _ = metadata["name"].(string)
		}
		resourceRef := fmt.Sprintf("%s/%s", kind, name)

		// Extract containers from spec
		spec, _ := doc["spec"].(map[string]interface{})
		if spec == nil {
			continue
		}

		// Handle both Pod spec and Deployment/StatefulSet template spec
		containers := getContainers(spec)
		podSpec := getPodSpec(spec)

		for _, rule := range rules {
			if !rule.Enabled {
				continue
			}
			vs := runCheck(rule.Check, rule.Name, rule.Severity, resourceRef, podSpec, containers)
			violations = append(violations, vs...)
		}
	}

	return violations
}

func getContainers(spec map[string]interface{}) []map[string]interface{} {
	var result []map[string]interface{}

	// Direct containers
	if cs, ok := spec["containers"].([]interface{}); ok {
		for _, c := range cs {
			if cm, ok := c.(map[string]interface{}); ok {
				result = append(result, cm)
			}
		}
		return result
	}

	// Template (Deployment/StatefulSet)
	if tpl, ok := spec["template"].(map[string]interface{}); ok {
		if tplSpec, ok := tpl["spec"].(map[string]interface{}); ok {
			if cs, ok := tplSpec["containers"].([]interface{}); ok {
				for _, c := range cs {
					if cm, ok := c.(map[string]interface{}); ok {
						result = append(result, cm)
					}
				}
			}
		}
	}
	return result
}

func getPodSpec(spec map[string]interface{}) map[string]interface{} {
	if _, ok := spec["containers"]; ok {
		return spec
	}
	if tpl, ok := spec["template"].(map[string]interface{}); ok {
		if tplSpec, ok := tpl["spec"].(map[string]interface{}); ok {
			return tplSpec
		}
	}
	return spec
}

func runCheck(check, policyName, severity, resource string, podSpec map[string]interface{}, containers []map[string]interface{}) []policyViolation {
	var violations []policyViolation

	switch check {
	case "no-latest-image-tag":
		for _, c := range containers {
			image, _ := c["image"].(string)
			cname, _ := c["name"].(string)
			if image == "" {
				continue
			}
			if strings.HasSuffix(image, ":latest") || !strings.Contains(image, ":") {
				violations = append(violations, policyViolation{
					Policy:   policyName,
					Severity: severity,
					Resource: resource + "/container:" + cname,
					Message:  fmt.Sprintf("Image '%s' uses :latest or no tag — pin to a specific version", image),
				})
			}
		}

	case "require-resource-limits":
		for _, c := range containers {
			cname, _ := c["name"].(string)
			resources, _ := c["resources"].(map[string]interface{})
			limits, _ := resources["limits"].(map[string]interface{})
			if limits == nil || (limits["cpu"] == nil && limits["memory"] == nil) {
				violations = append(violations, policyViolation{
					Policy:   policyName,
					Severity: severity,
					Resource: resource + "/container:" + cname,
					Message:  "Container is missing resource limits (cpu and/or memory)",
				})
			}
		}

	case "require-resource-requests":
		for _, c := range containers {
			cname, _ := c["name"].(string)
			resources, _ := c["resources"].(map[string]interface{})
			requests, _ := resources["requests"].(map[string]interface{})
			if requests == nil || (requests["cpu"] == nil && requests["memory"] == nil) {
				violations = append(violations, policyViolation{
					Policy:   policyName,
					Severity: severity,
					Resource: resource + "/container:" + cname,
					Message:  "Container is missing resource requests — will be scheduled as BestEffort",
				})
			}
		}

	case "no-root-containers":
		for _, c := range containers {
			cname, _ := c["name"].(string)
			sc, _ := c["securityContext"].(map[string]interface{})
			if sc != nil {
				if uid, ok := sc["runAsUser"]; ok {
					if fmt.Sprintf("%v", uid) == "0" {
						violations = append(violations, policyViolation{
							Policy:   policyName,
							Severity: severity,
							Resource: resource + "/container:" + cname,
							Message:  "Container runs as root (runAsUser: 0) — use a non-root UID",
						})
					}
				}
			}
		}

	case "no-privileged-containers":
		for _, c := range containers {
			cname, _ := c["name"].(string)
			sc, _ := c["securityContext"].(map[string]interface{})
			if sc != nil {
				if priv, ok := sc["privileged"]; ok {
					if fmt.Sprintf("%v", priv) == "true" {
						violations = append(violations, policyViolation{
							Policy:   policyName,
							Severity: severity,
							Resource: resource + "/container:" + cname,
							Message:  "Container is privileged — this grants root-equivalent access to the host",
						})
					}
				}
			}
		}

	case "require-readiness-probe":
		for _, c := range containers {
			cname, _ := c["name"].(string)
			if _, ok := c["readinessProbe"]; !ok {
				violations = append(violations, policyViolation{
					Policy:   policyName,
					Severity: severity,
					Resource: resource + "/container:" + cname,
					Message:  "Container is missing a readinessProbe — traffic may be sent to unready containers",
				})
			}
		}

	case "require-liveness-probe":
		for _, c := range containers {
			cname, _ := c["name"].(string)
			if _, ok := c["livenessProbe"]; !ok {
				violations = append(violations, policyViolation{
					Policy:   policyName,
					Severity: severity,
					Resource: resource + "/container:" + cname,
					Message:  "Container is missing a livenessProbe — stuck containers will not be restarted",
				})
			}
		}

	case "no-host-pid":
		if hostPID, ok := podSpec["hostPID"]; ok {
			if fmt.Sprintf("%v", hostPID) == "true" {
				violations = append(violations, policyViolation{
					Policy:   policyName,
					Severity: severity,
					Resource: resource,
					Message:  "Pod uses hostPID=true — can see all host processes",
				})
			}
		}

	case "no-host-network":
		if hostNetwork, ok := podSpec["hostNetwork"]; ok {
			if fmt.Sprintf("%v", hostNetwork) == "true" {
				violations = append(violations, policyViolation{
					Policy:   policyName,
					Severity: severity,
					Resource: resource,
					Message:  "Pod uses hostNetwork=true — has direct access to host network interfaces",
				})
			}
		}

	case "readonly-root-filesystem":
		for _, c := range containers {
			cname, _ := c["name"].(string)
			sc, _ := c["securityContext"].(map[string]interface{})
			if sc == nil {
				violations = append(violations, policyViolation{
					Policy:   policyName,
					Severity: severity,
					Resource: resource + "/container:" + cname,
					Message:  "Container should set readOnlyRootFilesystem: true",
				})
				continue
			}
			if rorf, ok := sc["readOnlyRootFilesystem"]; ok {
				if fmt.Sprintf("%v", rorf) != "true" {
					violations = append(violations, policyViolation{
						Policy:   policyName,
						Severity: severity,
						Resource: resource + "/container:" + cname,
						Message:  "Container should set readOnlyRootFilesystem: true",
					})
				}
			}
		}
	}

	return violations
}

// ─── newPolicyCmd ─────────────────────────────────────────────────────────────

func newPolicyCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "policy",
		Short: "Policy-as-code enforcement for Kubernetes manifests",
		Long: `kcli policy validates Kubernetes manifests against configurable rules
before they are applied to the cluster.

Built-in policy presets cover security best practices:
  --no-latest-image-tag, --require-resource-limits, --no-root-containers,
  --require-readiness-probe, --no-privileged-containers, and more.

Run 'kcli policy list' to see active policies.
Run 'kcli policy check manifest.yaml' to validate before applying.`,
		GroupID: "workflow",
		RunE: func(cmd *cobra.Command, args []string) error {
			return cmd.Help()
		},
	}

	// list
	list := &cobra.Command{
		Use:     "list",
		Short:   "List active policies",
		Aliases: []string{"ls"},
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := loadPolicyStore()
			if err != nil {
				return err
			}

			fmt.Fprintf(a.stdout, "\n%s%s Active Policies%s\n\n", ansiBold, ansiCyan, ansiReset)

			if len(s.Rules) == 0 {
				fmt.Fprintf(a.stdout, "%sNo policies configured.%s\n\n", ansiGray, ansiReset)
				fmt.Fprintf(a.stdout, "Add a policy:\n")
				fmt.Fprintf(a.stdout, "  kcli policy add --no-latest-image-tag\n")
				fmt.Fprintf(a.stdout, "  kcli policy add --require-resource-limits\n")
				fmt.Fprintf(a.stdout, "  kcli policy add --no-root-containers\n\n")
				fmt.Fprintf(a.stdout, "Available built-in presets:\n")
				for name, p := range builtinPolicies {
					fmt.Fprintf(a.stdout, "  --%s  (%s)\n", name, p.Severity)
				}
				fmt.Fprintln(a.stdout)
				return nil
			}

			fmt.Fprintf(a.stdout, "%s%-35s %-10s %-10s %s%s\n",
				ansiBold, "POLICY", "SEVERITY", "ENABLED", "DESCRIPTION", ansiReset)
			fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 85))
			for _, r := range s.Rules {
				sevColor := ansiYellow
				if r.Severity == "error" {
					sevColor = ansiRed
				}
				enabledStr := ansiGreen + "yes" + ansiReset
				if !r.Enabled {
					enabledStr = ansiGray + "no" + ansiReset
				}
				fmt.Fprintf(a.stdout, "%-35s %s%-10s%s %-10s %s\n",
					r.Name, sevColor, r.Severity, ansiReset, enabledStr,
					ansiGray+truncate(r.Description, 50)+ansiReset,
				)
			}
			fmt.Fprintln(a.stdout)
			return nil
		},
	}

	// check
	check := &cobra.Command{
		Use:   "check <file.yaml>",
		Short: "Validate a manifest file against active policies",
		Args:  cobra.ExactArgs(1),
		Example: `  kcli policy check deployment.yaml
  kcli policy check -f manifests/ --fail-on=warning
  cat manifest.yaml | kcli policy check -`,
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := loadPolicyStore()
			if err != nil {
				return err
			}

			if len(s.Rules) == 0 {
				fmt.Fprintf(a.stdout, "%sNo policies configured — all manifests pass.%s\n", ansiGreen, ansiReset)
				fmt.Fprintf(a.stdout, "%sAdd policies with: kcli policy add --no-root-containers%s\n\n", ansiGray, ansiReset)
				return nil
			}

			var manifestBytes []byte
			if args[0] == "-" {
				manifestBytes, err = os.ReadFile("/dev/stdin")
			} else {
				manifestBytes, err = os.ReadFile(args[0])
			}
			if err != nil {
				return fmt.Errorf("failed to read %s: %w", args[0], err)
			}

			violations := a.checkManifest(manifestBytes, s.Rules)

			fmt.Fprintf(a.stdout, "\n%s%s Policy Check: %s%s%s\n\n",
				ansiBold, ansiCyan, ansiYellow, args[0], ansiReset)

			if len(violations) == 0 {
				fmt.Fprintf(a.stdout, "%s✓ All policies passed — %d rules checked.%s\n\n",
					ansiGreen, len(s.Rules), ansiReset)
				return nil
			}

			errors := 0
			warnings := 0
			for _, v := range violations {
				sevColor := ansiYellow
				if v.Severity == "error" {
					sevColor = ansiRed
					errors++
				} else {
					warnings++
				}
				fmt.Fprintf(a.stdout, "%s[%-7s]%s %s\n  ↳ %s%s%s\n\n",
					sevColor, strings.ToUpper(v.Severity), ansiReset,
					v.Resource,
					ansiGray, v.Message, ansiReset,
				)
			}

			fmt.Fprintf(a.stdout, "%sSummary: %s%d error(s)%s  %s%d warning(s)%s%s\n\n",
				ansiBold,
				ansiRed, errors, ansiReset,
				ansiYellow, warnings, ansiReset,
				ansiReset,
			)

			if errors > 0 {
				return fmt.Errorf("policy check failed: %d error(s) — manifest should NOT be applied", errors)
			}
			return nil
		},
	}

	// add
	add := &cobra.Command{
		Use:   "add",
		Short: "Add a built-in policy preset",
		Example: `  kcli policy add --no-latest-image-tag
  kcli policy add --require-resource-limits
  kcli policy add --no-root-containers --no-privileged-containers`,
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := loadPolicyStore()
			if err != nil {
				return err
			}

			added := 0
			for name, preset := range builtinPolicies {
				flagName := name
				v, _ := cmd.Flags().GetBool(flagName)
				if !v {
					continue
				}
				// Check if already added
				exists := false
				for _, r := range s.Rules {
					if r.Name == preset.Name {
						exists = true
						break
					}
				}
				if !exists {
					s.Rules = append(s.Rules, preset)
					added++
					fmt.Fprintf(a.stdout, "%s+ Added policy: %s%s\n", ansiGreen, preset.Name, ansiReset)
				} else {
					fmt.Fprintf(a.stdout, "%s~ Policy already active: %s%s\n", ansiYellow, preset.Name, ansiReset)
				}
			}

			if added > 0 {
				if err := savePolicyStore(s); err != nil {
					return err
				}
				fmt.Fprintf(a.stdout, "\n%s%d policy/policies added. Run: kcli policy list%s\n\n",
					ansiGray, added, ansiReset)
			} else {
				fmt.Fprintf(a.stdout, "\n%sNo policies added. Specify at least one flag.%s\n", ansiYellow, ansiReset)
				_ = cmd.Help()
			}
			return nil
		},
	}
	// Add bool flags for each builtin policy preset
	for name := range builtinPolicies {
		add.Flags().Bool(name, false, fmt.Sprintf("Add policy: %s", builtinPolicies[name].Description))
	}

	// remove
	remove := &cobra.Command{
		Use:     "remove <name>",
		Short:   "Remove a policy",
		Aliases: []string{"rm", "delete"},
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := loadPolicyStore()
			if err != nil {
				return err
			}
			name := args[0]
			newRules := make([]policyRule, 0, len(s.Rules))
			found := false
			for _, r := range s.Rules {
				if r.Name == name {
					found = true
					continue
				}
				newRules = append(newRules, r)
			}
			if !found {
				return fmt.Errorf("policy %q not found", name)
			}
			s.Rules = newRules
			if err := savePolicyStore(s); err != nil {
				return err
			}
			fmt.Fprintf(a.stdout, "%s✓ Removed policy: %s%s\n\n", ansiGreen, name, ansiReset)
			return nil
		},
	}

	// import
	importCmd := &cobra.Command{
		Use:   "import <dir>",
		Short: "Import custom policies from a directory of YAML files",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			dir := args[0]
			entries, err := os.ReadDir(dir)
			if err != nil {
				return fmt.Errorf("failed to read directory %s: %w", dir, err)
			}

			s, err := loadPolicyStore()
			if err != nil {
				return err
			}

			imported := 0
			for _, e := range entries {
				if e.IsDir() {
					continue
				}
				if !regexp.MustCompile(`\.(yaml|yml|json)$`).MatchString(e.Name()) {
					continue
				}
				b, err := os.ReadFile(filepath.Join(dir, e.Name()))
				if err != nil {
					continue
				}
				var rule policyRule
				if err := yaml.Unmarshal(b, &rule); err != nil {
					continue
				}
				if rule.Name == "" {
					rule.Name = strings.TrimSuffix(e.Name(), filepath.Ext(e.Name()))
				}
				rule.Enabled = true
				s.Rules = append(s.Rules, rule)
				imported++
				fmt.Fprintf(a.stdout, "%s+ Imported: %s%s\n", ansiGreen, rule.Name, ansiReset)
			}

			if imported > 0 {
				if err := savePolicyStore(s); err != nil {
					return err
				}
				fmt.Fprintf(a.stdout, "\n%s%d policy/policies imported.%s\n\n", ansiGray, imported, ansiReset)
			} else {
				fmt.Fprintf(a.stdout, "%sNo policy files found in %s%s\n\n", ansiYellow, dir, ansiReset)
			}
			return nil
		},
	}

	cmd.AddCommand(list, check, add, remove, importCmd)
	return cmd
}
