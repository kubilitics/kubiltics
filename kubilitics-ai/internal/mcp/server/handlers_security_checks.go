package server

// handlers_security_checks.go — Phase 3 Category 4 compliance/hygiene checks.
//
// Ten deterministic `check_*` tools. Unlike recommend_/plan_ tools these do
// their own rule evaluation and return structured {findings, summary} rather
// than pass raw data to the LLM. That makes them pair well with narrative
// tools downstream.

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"
)

type securityFinding struct {
	Namespace string `json:"namespace,omitempty"`
	Pod       string `json:"pod,omitempty"`
	Container string `json:"container,omitempty"`
	Resource  string `json:"resource,omitempty"`
	Reason    string `json:"reason"`
}

type securityCheckResult struct {
	Check    string            `json:"check"`
	Findings []securityFinding `json:"findings"`
	Summary  string            `json:"summary"`
	Note     string            `json:"note,omitempty"`
}

// routeSecurityCheck dispatches check_* tools. Called from routeSecurityTool's
// default fallback.
func (s *mcpServerImpl) routeSecurityCheck(ctx context.Context, name string, args map[string]interface{}) (interface{}, bool, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, true, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	switch name {
	case "check_privileged_containers":
		return s.checkContainerField(ctx, c, clusterID, qs, name, func(c map[string]interface{}) string {
			sc, _ := c["securityContext"].(map[string]interface{})
			if priv, _ := sc["privileged"].(bool); priv {
				return "privileged=true"
			}
			return ""
		}, "privileged / hostPID / hostNetwork container")

	case "check_root_containers":
		return s.checkContainerField(ctx, c, clusterID, qs, name, func(c map[string]interface{}) string {
			sc, _ := c["securityContext"].(map[string]interface{})
			if nonRoot, set := sc["runAsNonRoot"].(bool); set && nonRoot {
				return ""
			}
			if u, ok := sc["runAsUser"].(float64); ok && int(u) != 0 {
				return ""
			}
			return "container may run as root (runAsNonRoot unset and runAsUser != nonzero)"
		}, "root container")

	case "check_writable_root_fs":
		return s.checkContainerField(ctx, c, clusterID, qs, name, func(c map[string]interface{}) string {
			sc, _ := c["securityContext"].(map[string]interface{})
			if ro, set := sc["readOnlyRootFilesystem"].(bool); set && ro {
				return ""
			}
			return "readOnlyRootFilesystem not set to true"
		}, "writable root filesystem")

	case "check_capabilities_all_added":
		return s.checkContainerField(ctx, c, clusterID, qs, name, func(c map[string]interface{}) string {
			sc, _ := c["securityContext"].(map[string]interface{})
			caps, _ := sc["capabilities"].(map[string]interface{})
			added, _ := caps["add"].([]interface{})
			for _, a := range added {
				if astr, ok := a.(string); ok {
					au := strings.ToUpper(astr)
					if au == "ALL" || au == "SYS_ADMIN" {
						return "cap added: " + astr
					}
				}
			}
			return ""
		}, "dangerous capability added")

	case "check_host_path_mounts":
		return s.checkPodSpec(ctx, c, clusterID, qs, name, func(pod map[string]interface{}) []securityFinding {
			var out []securityFinding
			spec, _ := pod["spec"].(map[string]interface{})
			vols, _ := spec["volumes"].([]interface{})
			meta, _ := pod["metadata"].(map[string]interface{})
			ns, _ := meta["namespace"].(string)
			name, _ := meta["name"].(string)
			for _, v := range vols {
				vm, _ := v.(map[string]interface{})
				if hp, _ := vm["hostPath"].(map[string]interface{}); hp != nil {
					path, _ := hp["path"].(string)
					out = append(out, securityFinding{Namespace: ns, Pod: name, Reason: "hostPath mount: " + path})
				}
			}
			return out
		})

	case "check_default_service_accounts_in_use":
		return s.checkPodSpec(ctx, c, clusterID, qs, name, func(pod map[string]interface{}) []securityFinding {
			spec, _ := pod["spec"].(map[string]interface{})
			sa, _ := spec["serviceAccountName"].(string)
			if sa == "" || sa == "default" {
				meta, _ := pod["metadata"].(map[string]interface{})
				ns, _ := meta["namespace"].(string)
				name, _ := meta["name"].(string)
				return []securityFinding{{Namespace: ns, Pod: name, Reason: "using 'default' service account"}}
			}
			return nil
		})

	case "check_secrets_in_env":
		return s.checkContainerField(ctx, c, clusterID, qs, name, func(c map[string]interface{}) string {
			envs, _ := c["env"].([]interface{})
			for _, e := range envs {
				em, _ := e.(map[string]interface{})
				if vf, _ := em["valueFrom"].(map[string]interface{}); vf != nil {
					if _, ok := vf["secretKeyRef"]; ok {
						return "secret referenced via env — prefer file mount"
					}
				}
			}
			return ""
		}, "secret in env var")

	case "check_image_tag_latest":
		return s.checkContainerField(ctx, c, clusterID, qs, name, func(c map[string]interface{}) string {
			img, _ := c["image"].(string)
			if img == "" {
				return ""
			}
			if strings.HasSuffix(img, ":latest") || !strings.Contains(img, ":") {
				return "image without pinned tag: " + img
			}
			return ""
		}, "latest-tagged image")

	case "check_ingress_tls_expiry_30d":
		return s.checkIngressTLSExpiry(ctx, c, clusterID, qs, name)

	case "check_rbac_wildcards":
		return s.checkRBACWildcards(ctx, c, clusterID, qs, name)
	}
	return nil, false, nil
}

// checkContainerField walks all pods and, for each container, calls the rule.
// Non-empty rule result becomes a finding.
func (s *mcpServerImpl) checkContainerField(ctx context.Context, c *backendHTTP, clusterID, qs, checkName string,
	rule func(map[string]interface{}) string, label string) (interface{}, bool, error) {
	res := &securityCheckResult{Check: checkName, Findings: []securityFinding{}}
	var raw interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &raw); err != nil {
		res.Note = fmt.Sprintf("pods endpoint unavailable: %v", err)
		res.Summary = "check skipped"
		return res, true, nil
	}
	for _, p := range extractResourceItems(raw) {
		meta, _ := p["metadata"].(map[string]interface{})
		ns, _ := meta["namespace"].(string)
		name, _ := meta["name"].(string)
		spec, _ := p["spec"].(map[string]interface{})
		hostNetwork, _ := spec["hostNetwork"].(bool)
		hostPID, _ := spec["hostPID"].(bool)
		if checkName == "check_privileged_containers" && (hostNetwork || hostPID) {
			reason := ""
			if hostNetwork {
				reason = "hostNetwork=true"
			}
			if hostPID {
				if reason != "" {
					reason += ", "
				}
				reason += "hostPID=true"
			}
			res.Findings = append(res.Findings, securityFinding{Namespace: ns, Pod: name, Reason: reason})
		}
		for _, cnt := range containerList(spec) {
			if reason := rule(cnt); reason != "" {
				cname, _ := cnt["name"].(string)
				res.Findings = append(res.Findings, securityFinding{Namespace: ns, Pod: name, Container: cname, Reason: reason})
			}
		}
	}
	res.Summary = fmt.Sprintf("%d %s finding(s).", len(res.Findings), label)
	return res, true, nil
}

func containerList(spec map[string]interface{}) []map[string]interface{} {
	out := []map[string]interface{}{}
	if cs, ok := spec["containers"].([]interface{}); ok {
		for _, c := range cs {
			if m, ok := c.(map[string]interface{}); ok {
				out = append(out, m)
			}
		}
	}
	if cs, ok := spec["initContainers"].([]interface{}); ok {
		for _, c := range cs {
			if m, ok := c.(map[string]interface{}); ok {
				out = append(out, m)
			}
		}
	}
	return out
}

// checkPodSpec applies a pod-level rule returning any number of findings.
func (s *mcpServerImpl) checkPodSpec(ctx context.Context, c *backendHTTP, clusterID, qs, checkName string,
	rule func(map[string]interface{}) []securityFinding) (interface{}, bool, error) {
	res := &securityCheckResult{Check: checkName, Findings: []securityFinding{}}
	var raw interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &raw); err != nil {
		res.Note = fmt.Sprintf("pods endpoint unavailable: %v", err)
		return res, true, nil
	}
	for _, p := range extractResourceItems(raw) {
		res.Findings = append(res.Findings, rule(p)...)
	}
	res.Summary = fmt.Sprintf("%d finding(s).", len(res.Findings))
	return res, true, nil
}

func (s *mcpServerImpl) checkIngressTLSExpiry(ctx context.Context, c *backendHTTP, clusterID, qs, checkName string) (interface{}, bool, error) {
	res := &securityCheckResult{Check: checkName, Findings: []securityFinding{}}
	var raw interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/ingresses"+qs), &raw); err != nil {
		res.Note = fmt.Sprintf("ingresses endpoint unavailable: %v", err)
		return res, true, nil
	}
	cutoff := time.Now().Add(30 * 24 * time.Hour)
	for _, ing := range extractResourceItems(raw) {
		meta, _ := ing["metadata"].(map[string]interface{})
		ns, _ := meta["namespace"].(string)
		name, _ := meta["name"].(string)
		// Use the new Phase 1 tls-info subresource when available.
		var tlsResp map[string]interface{}
		err := c.get(ctx, c.clusterPath(clusterID, "/resources/ingresses/"+url.PathEscape(ns)+"/"+url.PathEscape(name)+"/tls-info"), &tlsResp)
		if err != nil {
			continue
		}
		entries, _ := tlsResp["tls_entries"].([]interface{})
		for _, e := range entries {
			em, _ := e.(map[string]interface{})
			na, _ := em["not_after"].(string)
			if na == "" {
				continue
			}
			t, err := time.Parse(time.RFC3339, na)
			if err != nil {
				continue
			}
			if t.Before(cutoff) {
				secretName, _ := em["secret_name"].(string)
				days := int(time.Until(t).Hours() / 24)
				res.Findings = append(res.Findings, securityFinding{
					Namespace: ns, Resource: name,
					Reason: fmt.Sprintf("TLS cert in secret %q expires in %d days", secretName, days),
				})
			}
		}
	}
	res.Summary = fmt.Sprintf("%d cert(s) expiring within 30 days.", len(res.Findings))
	return res, true, nil
}

func (s *mcpServerImpl) checkRBACWildcards(ctx context.Context, c *backendHTTP, clusterID, _, checkName string) (interface{}, bool, error) {
	res := &securityCheckResult{Check: checkName, Findings: []securityFinding{}}
	for _, kind := range []string{"clusterroles", "roles"} {
		var raw interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/"+kind), &raw); err != nil {
			continue
		}
		for _, r := range extractResourceItems(raw) {
			meta, _ := r["metadata"].(map[string]interface{})
			name, _ := meta["name"].(string)
			ns, _ := meta["namespace"].(string)
			rules, _ := r["rules"].([]interface{})
			for _, rl := range rules {
				rm, _ := rl.(map[string]interface{})
				if hasWildcard(rm, "verbs") || hasWildcard(rm, "resources") {
					res.Findings = append(res.Findings, securityFinding{
						Namespace: ns, Resource: kind + "/" + name,
						Reason: "rule has wildcard verbs or resources",
					})
					break
				}
			}
		}
	}
	res.Summary = fmt.Sprintf("%d role(s) with wildcard rules.", len(res.Findings))
	return res, true, nil
}

func hasWildcard(rule map[string]interface{}, key string) bool {
	list, _ := rule[key].([]interface{})
	for _, it := range list {
		if s, ok := it.(string); ok && s == "*" {
			return true
		}
	}
	return false
}
