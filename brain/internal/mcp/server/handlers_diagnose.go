package server

// handlers_diagnose.go — Phase 3 Category 2 root-cause diagnostic tools.
//
// Ten focused diagnostics, each taking a specific subject (pod / service /
// pvc / ingress / deployment / cronjob / node / hpa / networkpolicy /
// namespace) and returning findings + a plain-English probable-cause field.
//
// Each handler composes 2-3 backend calls and correlates. All degrade
// gracefully: on any backend error the handler still returns a result
// object with a `note` field describing what couldn't be fetched.

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// diagnosticResult is the common envelope for every diagnose_ tool.
type diagnosticResult struct {
	Subject       string   `json:"subject"`
	Namespace     string   `json:"namespace,omitempty"`
	Healthy       bool     `json:"healthy"`
	ProbableCause string   `json:"probable_cause,omitempty"`
	Findings      []string `json:"findings"`
	Note          string   `json:"note,omitempty"`
}

func newDiag(subject, ns string) *diagnosticResult {
	return &diagnosticResult{Subject: subject, Namespace: ns, Findings: []string{}, Healthy: true}
}

func (d *diagnosticResult) addFinding(msg string) {
	d.Findings = append(d.Findings, msg)
	d.Healthy = false
}

// handleDiagnosePodNotReady inspects a single pod and explains which of
// {Pending, CrashLoopBackOff, OOMKilled, ImagePullBackOff, ProbeFailure} it is.
func (s *mcpServerImpl) handleDiagnosePodNotReady(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	ns := strArg(args, "namespace")
	name := strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("diagnose_pod_not_ready: namespace and name are required")
	}
	d := newDiag(name, ns)
	var pod map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/pods/"+url.PathEscape(ns)+"/"+url.PathEscape(name)), &pod); err != nil {
		d.Note = fmt.Sprintf("pod fetch failed: %v", err)
		return d, nil
	}
	status, _ := pod["status"].(map[string]interface{})
	phase, _ := status["phase"].(string)
	if phase == "Running" || phase == "Succeeded" {
		for _, cs := range containerStatuses(status) {
			if ready, _ := cs["ready"].(bool); !ready {
				d.addFinding(fmt.Sprintf("container %v is not ready", cs["name"]))
			}
		}
	} else {
		d.addFinding("pod phase: " + phase)
	}
	for _, cs := range containerStatuses(status) {
		waiting, _ := cs["state"].(map[string]interface{})["waiting"].(map[string]interface{})
		if waiting != nil {
			reason, _ := waiting["reason"].(string)
			if reason != "" {
				d.addFinding(fmt.Sprintf("container %v waiting: %s", cs["name"], reason))
				if d.ProbableCause == "" {
					d.ProbableCause = reason
				}
			}
		}
		terminated, _ := cs["state"].(map[string]interface{})["terminated"].(map[string]interface{})
		if terminated != nil {
			reason, _ := terminated["reason"].(string)
			if reason == "OOMKilled" || strings.Contains(reason, "Error") {
				d.addFinding(fmt.Sprintf("container %v terminated: %s", cs["name"], reason))
				if d.ProbableCause == "" {
					d.ProbableCause = reason
				}
			}
		}
		if rc := intField(cs, "restartCount"); rc >= 3 {
			d.addFinding(fmt.Sprintf("container %v restartCount=%d (CrashLoopBackOff candidate)", cs["name"], rc))
			if d.ProbableCause == "" {
				d.ProbableCause = "CrashLoopBackOff"
			}
		}
	}
	return d, nil
}

func containerStatuses(status map[string]interface{}) []map[string]interface{} {
	list, _ := status["containerStatuses"].([]interface{})
	out := make([]map[string]interface{}, 0, len(list))
	for _, cs := range list {
		if m, ok := cs.(map[string]interface{}); ok {
			out = append(out, m)
		}
	}
	return out
}

// handleDiagnoseServiceNoEndpoints: fetches svc + its endpoints and
// explains the mismatch (bad selector / no pods running / no ports matched).
func (s *mcpServerImpl) handleDiagnoseServiceNoEndpoints(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	ns := strArg(args, "namespace")
	name := strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("diagnose_service_no_endpoints: namespace and name required")
	}
	d := newDiag(name, ns)
	var svc map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/services/"+url.PathEscape(ns)+"/"+url.PathEscape(name)), &svc); err != nil {
		d.Note = fmt.Sprintf("service fetch failed: %v", err)
		return d, nil
	}
	spec, _ := svc["spec"].(map[string]interface{})
	selector, _ := spec["selector"].(map[string]interface{})
	if len(selector) == 0 {
		d.addFinding("service has no selector (headless or externalName?)")
		d.ProbableCause = "no_selector"
		return d, nil
	}
	// Fetch endpoints
	var eps map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/endpoints/"+url.PathEscape(ns)+"/"+url.PathEscape(name)), &eps); err != nil {
		d.Note = fmt.Sprintf("endpoints fetch failed: %v", err)
	} else {
		subsets, _ := eps["subsets"].([]interface{})
		ready := 0
		for _, sub := range subsets {
			sm, _ := sub.(map[string]interface{})
			addrs, _ := sm["addresses"].([]interface{})
			ready += len(addrs)
		}
		if ready == 0 {
			d.addFinding("endpoints ready=0 — no pods backing this service")
			d.ProbableCause = "selector_matches_no_ready_pods"
		}
	}
	// List matching pods to refine diagnosis
	sb := make([]string, 0, len(selector))
	for k, v := range selector {
		sb = append(sb, fmt.Sprintf("%s=%v", k, v))
	}
	q := url.Values{}
	q.Set("namespace", ns)
	q.Set("labelSelector", strings.Join(sb, ","))
	var podList interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pods?"+q.Encode()), &podList)
	pods := extractResourceItems(podList)
	if len(pods) == 0 {
		d.addFinding("no pods match service selector — selector typo or pods deleted")
		d.ProbableCause = "selector_mismatch"
	}
	return d, nil
}

// handleDiagnosePVCPending: PVC bind failures — missing storage class,
// no matching PV, provisioner errors in events.
func (s *mcpServerImpl) handleDiagnosePVCPending(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	ns := strArg(args, "namespace")
	name := strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("diagnose_pvc_pending: namespace and name required")
	}
	d := newDiag(name, ns)
	var pvc map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/pvcs/"+url.PathEscape(ns)+"/"+url.PathEscape(name)), &pvc); err != nil {
		d.Note = fmt.Sprintf("pvc fetch failed: %v", err)
		return d, nil
	}
	status, _ := pvc["status"].(map[string]interface{})
	phase, _ := status["phase"].(string)
	if phase == "Bound" {
		return d, nil
	}
	d.addFinding("phase: " + phase)
	spec, _ := pvc["spec"].(map[string]interface{})
	sc, _ := spec["storageClassName"].(string)
	if sc == "" {
		d.addFinding("no storageClassName set — cluster default may not exist")
		d.ProbableCause = "no_storage_class"
	} else {
		var scObj map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/storageclasses/"+url.PathEscape(sc)), &scObj); err != nil {
			d.addFinding("storageClass '" + sc + "' not found")
			d.ProbableCause = "missing_storage_class"
		}
	}
	// Look for provisioner events
	eq := url.Values{}
	eq.Set("namespace", ns)
	eq.Set("limit", "200")
	var rawEv interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+eq.Encode()), &rawEv); err == nil {
		for _, ev := range extractResourceItems(rawEv) {
			kind, evName, _ := eventInvolvedObject(ev)
			if !strings.EqualFold(kind, "PersistentVolumeClaim") || evName != name {
				continue
			}
			reason, _ := ev["reason"].(string)
			if strings.Contains(strings.ToLower(reason), "provision") || strings.Contains(strings.ToLower(reason), "fail") {
				msg, _ := ev["message"].(string)
				d.addFinding(reason + ": " + msg)
				if d.ProbableCause == "" {
					d.ProbableCause = reason
				}
			}
		}
	}
	return d, nil
}

// handleDiagnoseIngress404: walks ingress backend service → endpoints → pods,
// reports which link is broken.
func (s *mcpServerImpl) handleDiagnoseIngress404(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	ns := strArg(args, "namespace")
	name := strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("diagnose_ingress_404: namespace and name required")
	}
	d := newDiag(name, ns)
	var ing map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/ingresses/"+url.PathEscape(ns)+"/"+url.PathEscape(name)), &ing); err != nil {
		d.Note = fmt.Sprintf("ingress fetch failed: %v", err)
		return d, nil
	}
	spec, _ := ing["spec"].(map[string]interface{})
	rules, _ := spec["rules"].([]interface{})
	if len(rules) == 0 {
		d.addFinding("ingress has no rules")
		d.ProbableCause = "no_rules"
		return d, nil
	}
	for _, r := range rules {
		rm, _ := r.(map[string]interface{})
		http, _ := rm["http"].(map[string]interface{})
		paths, _ := http["paths"].([]interface{})
		for _, p := range paths {
			pm, _ := p.(map[string]interface{})
			backend, _ := pm["backend"].(map[string]interface{})
			svcBlock, _ := backend["service"].(map[string]interface{})
			svcName, _ := svcBlock["name"].(string)
			if svcName == "" {
				continue
			}
			var svc map[string]interface{}
			if err := c.get(ctx, c.clusterPath(clusterID, "/resources/services/"+url.PathEscape(ns)+"/"+url.PathEscape(svcName)), &svc); err != nil {
				d.addFinding("backend service '" + svcName + "' missing")
				d.ProbableCause = "backend_service_missing"
				continue
			}
			var eps map[string]interface{}
			if err := c.get(ctx, c.clusterPath(clusterID, "/resources/endpoints/"+url.PathEscape(ns)+"/"+url.PathEscape(svcName)), &eps); err == nil {
				ready := 0
				for _, sub := range mapSlice(eps, "subsets") {
					ready += len(mapSlice(sub, "addresses"))
				}
				if ready == 0 {
					d.addFinding("backend service '" + svcName + "' has 0 ready endpoints")
					d.ProbableCause = "backend_endpoints_empty"
				}
			}
		}
	}
	return d, nil
}

func mapSlice(m map[string]interface{}, key string) []map[string]interface{} {
	raw, _ := m[key].([]interface{})
	out := make([]map[string]interface{}, 0, len(raw))
	for _, it := range raw {
		if mm, ok := it.(map[string]interface{}); ok {
			out = append(out, mm)
		}
	}
	return out
}

// handleDiagnoseDeploymentRollbackNeeded: compares current revision to
// previous; reports whether current has CrashLoop/OOM/Unhealthy pods while
// previous didn't (by reading rollout-history).
func (s *mcpServerImpl) handleDiagnoseDeploymentRollbackNeeded(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	ns := strArg(args, "namespace")
	name := strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("diagnose_deployment_rollback_needed: namespace and name required")
	}
	d := newDiag(name, ns)
	var dep map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/deployments/"+url.PathEscape(ns)+"/"+url.PathEscape(name)), &dep); err != nil {
		d.Note = fmt.Sprintf("deployment fetch failed: %v", err)
		return d, nil
	}
	status, _ := dep["status"].(map[string]interface{})
	ready := intField(status, "readyReplicas")
	desired := intField(status, "replicas")
	if desired > 0 && ready < desired {
		d.addFinding(fmt.Sprintf("ready=%d desired=%d", ready, desired))
	}
	// Rollout history
	var hist map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/deployments/"+url.PathEscape(ns)+"/"+url.PathEscape(name)+"/rollout-history"), &hist); err == nil {
		revs := extractRolloutRevisions(hist)
		if len(revs) >= 2 {
			prevCause := strOr(revs[1], "cause", "change_cause", "changeCause", "message")
			curCause := strOr(revs[0], "cause", "change_cause", "changeCause", "message")
			d.addFinding(fmt.Sprintf("current rev cause: %q; previous rev cause: %q", curCause, prevCause))
			if d.ProbableCause == "" && !d.Healthy {
				d.ProbableCause = "current_revision_degraded"
			}
		}
	}
	if d.Healthy {
		d.addFinding("deployment healthy — no rollback needed")
		d.Healthy = true
	}
	return d, nil
}

// handleDiagnoseCronJobMissingRuns: inspects a CronJob for missed schedules.
func (s *mcpServerImpl) handleDiagnoseCronJobMissingRuns(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	ns := strArg(args, "namespace")
	name := strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("diagnose_cronjob_missing_runs: namespace and name required")
	}
	d := newDiag(name, ns)
	var cj map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/cronjobs/"+url.PathEscape(ns)+"/"+url.PathEscape(name)), &cj); err != nil {
		d.Note = fmt.Sprintf("cronjob fetch failed: %v", err)
		return d, nil
	}
	spec, _ := cj["spec"].(map[string]interface{})
	if suspend, _ := spec["suspend"].(bool); suspend {
		d.addFinding("cronjob is suspended")
		d.ProbableCause = "suspended"
	}
	if cp, _ := spec["concurrencyPolicy"].(string); cp == "Forbid" {
		d.addFinding("concurrencyPolicy=Forbid — prior run may still be active")
	}
	status, _ := cj["status"].(map[string]interface{})
	lastSched, _ := status["lastScheduleTime"].(string)
	schedule, _ := spec["schedule"].(string)
	if lastSched == "" {
		d.addFinding("never scheduled (schedule='" + schedule + "')")
		if d.ProbableCause == "" {
			d.ProbableCause = "never_scheduled"
		}
	}
	return d, nil
}

// handleDiagnoseNodeUnschedulable: taints, pressure, maxPods vs pod count.
func (s *mcpServerImpl) handleDiagnoseNodeUnschedulable(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	name := strArg(args, "name")
	if name == "" {
		return nil, fmt.Errorf("diagnose_node_unschedulable: name required")
	}
	d := newDiag(name, "")
	var node map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/nodes/"+url.PathEscape(name)), &node); err != nil {
		d.Note = fmt.Sprintf("node fetch failed: %v", err)
		return d, nil
	}
	spec, _ := node["spec"].(map[string]interface{})
	if unsched, _ := spec["unschedulable"].(bool); unsched {
		d.addFinding("spec.unschedulable=true (cordoned)")
		d.ProbableCause = "cordoned"
	}
	for _, t := range mapSlice(spec, "taints") {
		effect, _ := t["effect"].(string)
		if effect == "NoSchedule" || effect == "NoExecute" {
			d.addFinding(fmt.Sprintf("taint %v=%v:%s", t["key"], t["value"], effect))
		}
	}
	status, _ := node["status"].(map[string]interface{})
	for _, cnd := range mapSlice(status, "conditions") {
		t, _ := cnd["type"].(string)
		st, _ := cnd["status"].(string)
		if (t == "MemoryPressure" || t == "DiskPressure" || t == "PIDPressure" || t == "NetworkUnavailable") && st == "True" {
			d.addFinding("condition " + t + "=True")
			if d.ProbableCause == "" {
				d.ProbableCause = t
			}
		}
		if t == "Ready" && st != "True" {
			d.addFinding("Ready=" + st)
			if d.ProbableCause == "" {
				d.ProbableCause = "not_ready"
			}
		}
	}
	return d, nil
}

// handleDiagnoseHPANotScaling: metrics source, minReplicas=maxReplicas,
// current vs target utilization.
func (s *mcpServerImpl) handleDiagnoseHPANotScaling(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	ns := strArg(args, "namespace")
	name := strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("diagnose_hpa_not_scaling: namespace and name required")
	}
	d := newDiag(name, ns)
	var hpa map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/hpas/"+url.PathEscape(ns)+"/"+url.PathEscape(name)), &hpa); err != nil {
		d.Note = fmt.Sprintf("hpa fetch failed: %v", err)
		return d, nil
	}
	spec, _ := hpa["spec"].(map[string]interface{})
	minR := intField(spec, "minReplicas")
	maxR := intField(spec, "maxReplicas")
	if minR == maxR && minR > 0 {
		d.addFinding(fmt.Sprintf("minReplicas == maxReplicas (%d) — no scaling room", minR))
		d.ProbableCause = "min_equals_max"
	}
	status, _ := hpa["status"].(map[string]interface{})
	for _, cnd := range mapSlice(status, "conditions") {
		t, _ := cnd["type"].(string)
		st, _ := cnd["status"].(string)
		if t == "ScalingActive" && st != "True" {
			reason, _ := cnd["reason"].(string)
			msg, _ := cnd["message"].(string)
			d.addFinding("ScalingActive=" + st + " reason=" + reason + ": " + msg)
			if d.ProbableCause == "" {
				d.ProbableCause = reason
			}
		}
		if t == "AbleToScale" && st != "True" {
			reason, _ := cnd["reason"].(string)
			d.addFinding("AbleToScale=" + st + " reason=" + reason)
		}
	}
	return d, nil
}

// handleDiagnoseNetworkPolicyBlocking: list policies in namespace, for each
// check if it would deny the given from→to pair.
func (s *mcpServerImpl) handleDiagnoseNetworkPolicyBlocking(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	ns := strArg(args, "namespace")
	fromPod := strArg(args, "from_pod")
	toPod := strArg(args, "to_pod")
	if ns == "" {
		return nil, fmt.Errorf("diagnose_networkpolicy_blocking: namespace required")
	}
	d := newDiag(fromPod+"->"+toPod, ns)
	var raw interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/networkpolicies?namespace="+url.QueryEscape(ns)), &raw); err != nil {
		d.Note = fmt.Sprintf("networkpolicies fetch failed: %v", err)
		return d, nil
	}
	items := extractResourceItems(raw)
	if len(items) == 0 {
		d.addFinding("no networkpolicies in namespace — no policy-based blocking possible")
		d.Healthy = true
		return d, nil
	}
	// Default-deny detection: any policy with podSelector={} and no ingress rules
	for _, np := range items {
		meta, _ := np["metadata"].(map[string]interface{})
		npName, _ := meta["name"].(string)
		spec, _ := np["spec"].(map[string]interface{})
		ps, _ := spec["podSelector"].(map[string]interface{})
		ingress, _ := spec["ingress"].([]interface{})
		if len(ps) == 0 && len(ingress) == 0 {
			d.addFinding("policy '" + npName + "' is default-deny for all pods")
			d.ProbableCause = "default_deny_policy:" + npName
		}
	}
	if d.ProbableCause == "" && len(d.Findings) == 0 {
		d.addFinding(fmt.Sprintf("%d policy/policies present — manual review required", len(items)))
		d.Note = "per-pod policy evaluation requires network-policy simulator not yet in backend"
	}
	return d, nil
}

// handleDiagnoseCertificateFailures: cert-manager Certificate resources with
// conditions Ready=False or events with CertificateRequestIssuanceFailed.
func (s *mcpServerImpl) handleDiagnoseCertificateFailures(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	ns := strArg(args, "namespace")
	window := intArg(args, "window_minutes", 1440) // last 24h
	cutoff := time.Now().Add(-time.Duration(window) * time.Minute)
	d := newDiag("certificates", ns)

	// Events-based path (cert-manager emits on the Certificate object).
	eq := url.Values{}
	eq.Set("limit", "500")
	if ns != "" {
		eq.Set("namespace", ns)
	}
	var rawEv interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+eq.Encode()), &rawEv); err != nil {
		d.Note = fmt.Sprintf("events fetch failed: %v", err)
		return d, nil
	}
	for _, ev := range extractResourceItems(rawEv) {
		ts := eventTimestamp(ev)
		if ts.IsZero() || ts.Before(cutoff) {
			continue
		}
		kind, name, evNs := eventInvolvedObject(ev)
		if !strings.EqualFold(kind, "Certificate") && !strings.EqualFold(kind, "CertificateRequest") {
			continue
		}
		reason, _ := ev["reason"].(string)
		rl := strings.ToLower(reason)
		if strings.Contains(rl, "fail") || strings.Contains(rl, "error") {
			msg, _ := ev["message"].(string)
			d.addFinding(fmt.Sprintf("[%s/%s] %s: %s", evNs, name, reason, msg))
			if d.ProbableCause == "" {
				d.ProbableCause = reason
			}
		}
	}
	if len(d.Findings) == 0 {
		d.Healthy = true
		d.addFinding("no certificate failures in window")
	}
	return d, nil
}
