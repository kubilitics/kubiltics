package server

// handlers_inspect.go — composite inspect_<kind> handlers.
//
// Each handler folds the existing observe_<kind>_detailed +
// observe_<kind>_events + observe_<kind>_ownership_chain (for kinds that
// have one) into a single call. They fan out to the existing handlers in
// parallel via sync.WaitGroup and return a bounded JSON with
// {detailed, events, ownership_chain, _summary}.
//
// The underlying handlers are intentionally NOT deleted — they stay in
// the codebase for direct invocation (tests, retries, safety-net). Only
// the LLM-facing taxonomy entries are retired by the same commit that
// adds these composites.

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/vellankikoti/kubilitics/brain/internal/logpattern"
	"github.com/vellankikoti/kubilitics/brain/internal/triage"
)

// inspectResult is the shape every inspect_<kind> handler returns.
// Fields that weren't fetched for this kind stay nil so the LLM can tell
// "we didn't try" apart from "we tried and got nothing". The _summary
// line is a plain-English one-liner the LLM can quote directly.
type inspectResult struct {
	Kind           string      `json:"kind"`
	Namespace      string      `json:"namespace,omitempty"`
	Name           string      `json:"name"`
	Detailed       interface{} `json:"detailed,omitempty"`
	DetailedError  string      `json:"detailed_error,omitempty"`
	Events         interface{} `json:"events,omitempty"`
	EventsError    string      `json:"events_error,omitempty"`
	OwnershipChain interface{} `json:"ownership_chain,omitempty"`
	OwnershipError string      `json:"ownership_error,omitempty"`
	Summary        string      `json:"_summary"`
}

// handlerFn is the common signature of every underlying observe_* handler.
type handlerFn func(ctx context.Context, args map[string]interface{}) (interface{}, error)

// fanOut runs up to three handlers in parallel and collects their results.
// A nil fn is treated as "this kind doesn't have that underlying handler"
// and contributes a note to the summary.
func (s *mcpServerImpl) fanOut(
	ctx context.Context,
	args map[string]interface{},
	detailed, events, ownership handlerFn,
) (detailedOut, eventsOut, ownershipOut interface{}, detailedErr, eventsErr, ownershipErr error) {
	var wg sync.WaitGroup

	if detailed != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			detailedOut, detailedErr = detailed(ctx, args)
		}()
	}
	if events != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			eventsOut, eventsErr = events(ctx, args)
		}()
	}
	if ownership != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ownershipOut, ownershipErr = ownership(ctx, args)
		}()
	}
	wg.Wait()
	return
}

// buildInspectResult assembles the final bounded JSON.
func buildInspectResult(
	kind, namespace, name string,
	detailed, events, ownership interface{},
	detailedErr, eventsErr, ownershipErr error,
	missing []string,
) interface{} {
	res := inspectResult{
		Kind:           kind,
		Namespace:      namespace,
		Name:           name,
		Detailed:       detailed,
		Events:         events,
		OwnershipChain: ownership,
	}
	if detailedErr != nil {
		res.DetailedError = detailedErr.Error()
	}
	if eventsErr != nil {
		res.EventsError = eventsErr.Error()
	}
	if ownershipErr != nil {
		res.OwnershipError = ownershipErr.Error()
	}

	// _summary: compact one-liner the LLM can use directly.
	var parts []string
	if detailed != nil {
		parts = append(parts, "detailed=ok")
	} else if detailedErr != nil {
		parts = append(parts, "detailed=err")
	}
	if events != nil {
		parts = append(parts, "events=ok")
	} else if eventsErr != nil {
		parts = append(parts, "events=err")
	}
	if ownership != nil {
		parts = append(parts, "ownership=ok")
	} else if ownershipErr != nil {
		parts = append(parts, "ownership=err")
	}
	if len(missing) > 0 {
		parts = append(parts, "not_applicable="+strings.Join(missing, ","))
	}
	target := name
	if namespace != "" {
		target = namespace + "/" + name
	}
	res.Summary = fmt.Sprintf("inspect_%s %s: %s", strings.ToLower(kind), target, strings.Join(parts, " "))

	// Pass through the same list-trimmer + output-cap the rest of the
	// observation handlers use so one fat composite can't blow the budget.
	return capListOutput(summarizeListForLLM(res))
}

// ─── namespaced composites with detailed+events+ownership ────────────────

func (s *mcpServerImpl) handleInspectPod(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	ns, name := strArg(args, "namespace"), strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("inspect_pod: 'namespace' and 'name' are required")
	}
	d, e, o, de, ee, oe := s.fanOut(ctx, args, s.handlePodDetailed, s.handlePodEvents, s.handlePodOwnershipChain)
	return buildInspectResult("Pod", ns, name, d, e, o, de, ee, oe, nil), nil
}

func (s *mcpServerImpl) handleInspectDeployment(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	ns, name := strArg(args, "namespace"), strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("inspect_deployment: 'namespace' and 'name' are required")
	}
	d, e, o, de, ee, oe := s.fanOut(ctx, args, s.handleDeploymentDetailed, s.handleDeploymentEvents, s.handleDeploymentOwnershipChain)
	return buildInspectResult("Deployment", ns, name, d, e, o, de, ee, oe, nil), nil
}

func (s *mcpServerImpl) handleInspectReplicaSet(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	ns, name := strArg(args, "namespace"), strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("inspect_replicaset: 'namespace' and 'name' are required")
	}
	d, e, o, de, ee, oe := s.fanOut(ctx, args, s.handleReplicaSetDetailed, s.handleReplicaSetEvents, s.handleReplicaSetOwnershipChain)
	return buildInspectResult("ReplicaSet", ns, name, d, e, o, de, ee, oe, nil), nil
}

func (s *mcpServerImpl) handleInspectStatefulSet(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	ns, name := strArg(args, "namespace"), strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("inspect_statefulset: 'namespace' and 'name' are required")
	}
	d, e, o, de, ee, oe := s.fanOut(ctx, args, s.handleStatefulSetDetailed, s.handleStatefulSetEvents, s.handleStatefulSetOwnershipChain)
	return buildInspectResult("StatefulSet", ns, name, d, e, o, de, ee, oe, nil), nil
}

func (s *mcpServerImpl) handleInspectDaemonSet(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	ns, name := strArg(args, "namespace"), strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("inspect_daemonset: 'namespace' and 'name' are required")
	}
	d, e, o, de, ee, oe := s.fanOut(ctx, args, s.handleDaemonSetDetailed, s.handleDaemonSetEvents, s.handleDaemonSetOwnershipChain)
	return buildInspectResult("DaemonSet", ns, name, d, e, o, de, ee, oe, nil), nil
}

func (s *mcpServerImpl) handleInspectJob(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	ns, name := strArg(args, "namespace"), strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("inspect_job: 'namespace' and 'name' are required")
	}
	d, e, o, de, ee, oe := s.fanOut(ctx, args, s.handleJobDetailed, s.handleJobEvents, s.handleJobOwnershipChain)
	return buildInspectResult("Job", ns, name, d, e, o, de, ee, oe, nil), nil
}

func (s *mcpServerImpl) handleInspectCronJob(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	ns, name := strArg(args, "namespace"), strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("inspect_cronjob: 'namespace' and 'name' are required")
	}
	d, e, o, de, ee, oe := s.fanOut(ctx, args, s.handleCronJobDetailed, s.handleCronJobEvents, s.handleCronJobOwnershipChain)
	return buildInspectResult("CronJob", ns, name, d, e, o, de, ee, oe, nil), nil
}

// ─── namespaced composites with only detailed+events (no ownership) ──────

func (s *mcpServerImpl) handleInspectService(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	ns, name := strArg(args, "namespace"), strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("inspect_service: 'namespace' and 'name' are required")
	}
	d, e, _, de, ee, _ := s.fanOut(ctx, args, s.handleServiceDetailed, s.handleServiceEvents, nil)
	return buildInspectResult("Service", ns, name, d, e, nil, de, ee, nil, []string{"ownership_chain"}), nil
}

func (s *mcpServerImpl) handleInspectIngress(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	ns, name := strArg(args, "namespace"), strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("inspect_ingress: 'namespace' and 'name' are required")
	}
	d, e, _, de, ee, _ := s.fanOut(ctx, args, s.handleIngressDetailed, s.handleIngressEvents, nil)
	return buildInspectResult("Ingress", ns, name, d, e, nil, de, ee, nil, []string{"ownership_chain"}), nil
}

func (s *mcpServerImpl) handleInspectConfigMap(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	ns, name := strArg(args, "namespace"), strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("inspect_configmap: 'namespace' and 'name' are required")
	}
	d, e, _, de, ee, _ := s.fanOut(ctx, args, s.handleConfigMapDetailed, s.handleConfigMapEvents, nil)
	return buildInspectResult("ConfigMap", ns, name, d, e, nil, de, ee, nil, []string{"ownership_chain"}), nil
}

func (s *mcpServerImpl) handleInspectSecret(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	ns, name := strArg(args, "namespace"), strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("inspect_secret: 'namespace' and 'name' are required")
	}
	d, e, _, de, ee, _ := s.fanOut(ctx, args, s.handleSecretDetailed, s.handleSecretEvents, nil)
	return buildInspectResult("Secret", ns, name, d, e, nil, de, ee, nil, []string{"ownership_chain"}), nil
}

func (s *mcpServerImpl) handleInspectNetworkPolicy(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	ns, name := strArg(args, "namespace"), strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("inspect_networkpolicy: 'namespace' and 'name' are required")
	}
	d, e, _, de, ee, _ := s.fanOut(ctx, args, s.handleNetworkPolicyDetailed, s.handleNetworkPolicyEvents, nil)
	return buildInspectResult("NetworkPolicy", ns, name, d, e, nil, de, ee, nil, []string{"ownership_chain"}), nil
}

func (s *mcpServerImpl) handleInspectPVC(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	ns, name := strArg(args, "namespace"), strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("inspect_pvc: 'namespace' and 'name' are required")
	}
	d, e, _, de, ee, _ := s.fanOut(ctx, args, s.handlePvcDetailed, s.handlePvcEvents, nil)
	return buildInspectResult("PersistentVolumeClaim", ns, name, d, e, nil, de, ee, nil, []string{"ownership_chain"}), nil
}

func (s *mcpServerImpl) handleInspectHPA(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	ns, name := strArg(args, "namespace"), strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("inspect_hpa: 'namespace' and 'name' are required")
	}
	d, e, _, de, ee, _ := s.fanOut(ctx, args, s.handleHPADetailed, s.handleHPAEvents, nil)
	return buildInspectResult("HorizontalPodAutoscaler", ns, name, d, e, nil, de, ee, nil, []string{"ownership_chain"}), nil
}

func (s *mcpServerImpl) handleInspectVPA(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	ns, name := strArg(args, "namespace"), strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("inspect_vpa: 'namespace' and 'name' are required")
	}
	d, e, _, de, ee, _ := s.fanOut(ctx, args, s.handleVPADetailed, s.handleVPAEvents, nil)
	return buildInspectResult("VerticalPodAutoscaler", ns, name, d, e, nil, de, ee, nil, []string{"ownership_chain"}), nil
}

func (s *mcpServerImpl) handleInspectPDB(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	ns, name := strArg(args, "namespace"), strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("inspect_pdb: 'namespace' and 'name' are required")
	}
	d, e, _, de, ee, _ := s.fanOut(ctx, args, s.handlePDBDetailed, s.handlePDBEvents, nil)
	return buildInspectResult("PodDisruptionBudget", ns, name, d, e, nil, de, ee, nil, []string{"ownership_chain"}), nil
}

func (s *mcpServerImpl) handleInspectRole(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	ns, name := strArg(args, "namespace"), strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("inspect_role: 'namespace' and 'name' are required")
	}
	d, e, _, de, ee, _ := s.fanOut(ctx, args, s.handleRoleDetailed, s.handleRoleEvents, nil)
	return buildInspectResult("Role", ns, name, d, e, nil, de, ee, nil, []string{"ownership_chain"}), nil
}

func (s *mcpServerImpl) handleInspectRoleBinding(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	ns, name := strArg(args, "namespace"), strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("inspect_rolebinding: 'namespace' and 'name' are required")
	}
	d, e, _, de, ee, _ := s.fanOut(ctx, args, s.handleRoleBindingDetailed, s.handleRoleBindingEvents, nil)
	return buildInspectResult("RoleBinding", ns, name, d, e, nil, de, ee, nil, []string{"ownership_chain"}), nil
}

func (s *mcpServerImpl) handleInspectLimitRange(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	ns, name := strArg(args, "namespace"), strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("inspect_limitrange: 'namespace' and 'name' are required")
	}
	d, e, _, de, ee, _ := s.fanOut(ctx, args, s.handleLimitRangeDetailed, s.handleLimitRangeEvents, nil)
	return buildInspectResult("LimitRange", ns, name, d, e, nil, de, ee, nil, []string{"ownership_chain"}), nil
}

func (s *mcpServerImpl) handleInspectResourceQuota(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	ns, name := strArg(args, "namespace"), strArg(args, "name")
	if ns == "" || name == "" {
		return nil, fmt.Errorf("inspect_resourcequota: 'namespace' and 'name' are required")
	}
	d, e, _, de, ee, _ := s.fanOut(ctx, args, s.handleResourceQuotaDetailed, s.handleResourceQuotaEvents, nil)
	return buildInspectResult("ResourceQuota", ns, name, d, e, nil, de, ee, nil, []string{"ownership_chain"}), nil
}

// ─── cluster-scoped composites (name only) ──────────────────────────────

func (s *mcpServerImpl) handleInspectNode(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	name := strArg(args, "name")
	if name == "" {
		return nil, fmt.Errorf("inspect_node: 'name' is required")
	}
	d, e, _, de, ee, _ := s.fanOut(ctx, args, s.handleNodeDetailed, s.handleNodeEvents, nil)
	return buildInspectResult("Node", "", name, d, e, nil, de, ee, nil, []string{"ownership_chain"}), nil
}

func (s *mcpServerImpl) handleInspectNamespace(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	name := strArg(args, "name")
	if name == "" {
		return nil, fmt.Errorf("inspect_namespace: 'name' is required")
	}
	d, e, _, de, ee, _ := s.fanOut(ctx, args, s.handleNamespaceDetailed, s.handleNamespaceEvents, nil)
	return buildInspectResult("Namespace", "", name, d, e, nil, de, ee, nil, []string{"ownership_chain"}), nil
}

func (s *mcpServerImpl) handleInspectPV(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	name := strArg(args, "name")
	if name == "" {
		return nil, fmt.Errorf("inspect_pv: 'name' is required")
	}
	d, e, _, de, ee, _ := s.fanOut(ctx, args, s.handlePvDetailed, s.handlePvEvents, nil)
	return buildInspectResult("PersistentVolume", "", name, d, e, nil, de, ee, nil, []string{"ownership_chain"}), nil
}

func (s *mcpServerImpl) handleInspectStorageClass(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	name := strArg(args, "name")
	if name == "" {
		return nil, fmt.Errorf("inspect_storageclass: 'name' is required")
	}
	d, e, _, de, ee, _ := s.fanOut(ctx, args, s.handleStorageClassDetailed, s.handleStorageClassEvents, nil)
	return buildInspectResult("StorageClass", "", name, d, e, nil, de, ee, nil, []string{"ownership_chain"}), nil
}

func (s *mcpServerImpl) handleInspectClusterRole(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	name := strArg(args, "name")
	if name == "" {
		return nil, fmt.Errorf("inspect_clusterrole: 'name' is required")
	}
	d, e, _, de, ee, _ := s.fanOut(ctx, args, s.handleClusterRoleDetailed, s.handleClusterRoleEvents, nil)
	return buildInspectResult("ClusterRole", "", name, d, e, nil, de, ee, nil, []string{"ownership_chain"}), nil
}

func (s *mcpServerImpl) handleInspectClusterRoleBinding(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	name := strArg(args, "name")
	if name == "" {
		return nil, fmt.Errorf("inspect_clusterrolebinding: 'name' is required")
	}
	d, e, _, de, ee, _ := s.fanOut(ctx, args, s.handleClusterRoleBindingDetailed, s.handleClusterRoleBindingEvents, nil)
	return buildInspectResult("ClusterRoleBinding", "", name, d, e, nil, de, ee, nil, []string{"ownership_chain"}), nil
}

func (s *mcpServerImpl) handleInspectCRD(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	name := strArg(args, "name")
	if name == "" {
		return nil, fmt.Errorf("inspect_crd: 'name' is required")
	}
	d, e, _, de, ee, _ := s.fanOut(ctx, args, s.handleCRDDetailed, s.handleCRDEvents, nil)
	return buildInspectResult("CustomResourceDefinition", "", name, d, e, nil, de, ee, nil, []string{"ownership_chain"}), nil
}

// ─── Week 1 composites ────────────────────────────────────────────────────

// handleTriageCluster: zero-config "I just got paged" narrative triage.
// Fans out cluster overview + node status + workload health + recent events,
// feeds structured snapshots into triage.RankCluster, emits the envelope.
func (s *mcpServerImpl) handleTriageCluster(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	clusterID := strArg(args, "cluster_id")
	// cluster_id is optional; lower layers fall back to session focus_cluster_id.

	// Inject a 15m window on the events sub-call if caller didn't pass one.
	eventArgs := copyArgs(args)
	if eventArgs["since"] == nil || eventArgs["since"] == "" {
		eventArgs["since"] = "15m"
	}

	tcOverview := s.timedCall(ctx, "observe_cluster_overview", args, s.handleClusterOverview)
	tcNodes := s.timedCall(ctx, "observe_node_status", args, s.handleNodeStatus)
	tcWorkloads := s.timedCall(ctx, "observe_workload_health", args, s.handleWorkloadHealth)
	tcEvents := s.timedCall(ctx, "observe_events", eventArgs, s.handleEvents)

	results := []timedResult{tcOverview, tcNodes, tcWorkloads, tcEvents}

	// Shape upstream results into triage.ClusterInput. The shaping uses
	// lenient coercion — if an upstream handler returned a different shape
	// than expected, that axis contributes zero signal rather than crashing
	// the whole tool.
	in := shapeClusterInput(tcOverview.out, tcNodes.out, tcWorkloads.out, tcEvents.out)
	ranking := triage.RankCluster(in)

	var sources []compositeSource
	errs := map[string]error{}
	for _, r := range results {
		sources = append(sources, compositeSource{Tool: r.name, MS: r.ms})
		if r.err != nil {
			errs[r.name] = r.err
		}
	}

	summary := narrateCluster(ranking)
	return buildComposableResult("TriageCluster", clusterID, summary, ranking, sources, errs), nil
}

func narrateCluster(r triage.ClusterRanking) string {
	if r.ClusterHealth == "healthy" {
		return "Cluster healthy, no active issues."
	}
	if len(r.TopProblems) == 0 {
		return fmt.Sprintf("Cluster %s but no specific pod problems ranked; check node pressure.", r.ClusterHealth)
	}
	top := r.TopProblems[0]
	bits := []string{fmt.Sprintf("Cluster %s:", r.ClusterHealth)}
	bits = append(bits, fmt.Sprintf("top problem %s/%s (%s, severity %.2f)", top.Namespace, top.Name, top.Reason, top.Severity))
	if len(r.TopProblems) > 1 {
		bits = append(bits, fmt.Sprintf("plus %d other(s)", len(r.TopProblems)-1))
	}
	if len(r.NodePressure) > 0 {
		np := r.NodePressure[0]
		bits = append(bits, fmt.Sprintf("node %s at %.0f%% %s", np.Node, np.Pct, np.Kind))
	}
	return strings.Join(bits, "; ") + "."
}

// ─── Week-1 shared helpers ────────────────────────────────────────────────

// timedResult records a sub-handler call's identity, output, latency, and
// error. Returned by timedCall; consumed by Week-1 composite handlers.
type timedResult struct {
	name string
	out  interface{}
	ms   int64
	err  error
}

// timedCall invokes a sub-handler and records wall-clock latency in ms.
// It reuses the existing handlerFn contract.
func (s *mcpServerImpl) timedCall(ctx context.Context, name string, args map[string]interface{}, fn handlerFn) timedResult {
	start := time.Now()
	out, err := fn(ctx, args)
	return timedResult{name: name, out: out, ms: time.Since(start).Milliseconds(), err: err}
}

// copyArgs returns a shallow copy so sub-handlers can mutate "since" etc.
// without mutating the caller's map.
func copyArgs(a map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(a)+1)
	for k, v := range a {
		out[k] = v
	}
	return out
}

// shapeClusterInput performs lenient coercion of four upstream sub-handler
// outputs into triage.ClusterInput. Each axis is independent — an upstream
// error yields zero contribution from that axis only.
func shapeClusterInput(overviewOut, nodesOut, workloadsOut, eventsOut interface{}) triage.ClusterInput {
	in := triage.ClusterInput{}
	// Pods — extract from workload-health rollup. Tolerant: look for a
	// "pods" array on the map, fall back to empty.
	if m, ok := workloadsOut.(map[string]interface{}); ok {
		if pods, ok := m["pods"].([]interface{}); ok {
			for _, p := range pods {
				np := shapePod(p)
				if np.Name != "" {
					in.Pods = append(in.Pods, np)
				}
			}
		}
	}
	// Nodes — from node_status.
	if m, ok := nodesOut.(map[string]interface{}); ok {
		if nodes, ok := m["nodes"].([]interface{}); ok {
			for _, n := range nodes {
				nn := shapeNode(n)
				if nn.Name != "" {
					in.Nodes = append(in.Nodes, nn)
				}
			}
		}
	}
	// Events — from events output.
	if m, ok := eventsOut.(map[string]interface{}); ok {
		if evs, ok := m["events"].([]interface{}); ok {
			for _, ev := range evs {
				ne := shapeEvent(ev)
				if ne.Name != "" {
					in.Events = append(in.Events, ne)
				}
			}
		}
	}
	_ = overviewOut // reserved — overview currently provides no pod-level detail used here
	return in
}

func shapePod(in interface{}) triage.NamedPodState {
	m, ok := in.(map[string]interface{})
	if !ok {
		return triage.NamedPodState{}
	}
	return triage.NamedPodState{
		Kind:      "Pod",
		Namespace: strFrom(m, "namespace"),
		Name:      strFrom(m, "name"),
		State: triage.PodState{
			Phase:            strFrom(m, "phase"),
			WaitingReason:    strFrom(m, "waiting_reason"),
			LastReason:       strFrom(m, "last_reason"),
			LastExitCode:     intFrom(m, "last_exit_code"),
			RestartCount:     intFrom(m, "restart_count"),
			Ready:            boolFrom(m, "ready"),
			SchedulingFailed: boolFrom(m, "scheduling_failed"),
			FirstSeen:        timeFrom(m, "first_seen"),
		},
	}
}

func shapeNode(in interface{}) triage.NamedNodeState {
	m, ok := in.(map[string]interface{})
	if !ok {
		return triage.NamedNodeState{}
	}
	return triage.NamedNodeState{
		Name: strFrom(m, "name"),
		State: triage.NodeState{
			PressureKind: strFrom(m, "pressure_kind"),
			PressurePct:  floatFrom(m, "pressure_pct"),
		},
	}
}

func shapeEvent(in interface{}) triage.NamedEventState {
	m, ok := in.(map[string]interface{})
	if !ok {
		return triage.NamedEventState{}
	}
	return triage.NamedEventState{
		Kind: "Event",
		Name: strFrom(m, "name"),
		State: triage.EventState{
			Type:      strFrom(m, "type"),
			Reason:    strFrom(m, "reason"),
			FirstSeen: timeFrom(m, "first_seen"),
		},
	}
}

func strFrom(m map[string]interface{}, k string) string {
	if v, ok := m[k].(string); ok {
		return v
	}
	return ""
}

func intFrom(m map[string]interface{}, k string) int {
	switch v := m[k].(type) {
	case int:
		return v
	case float64:
		return int(v)
	}
	return 0
}

func floatFrom(m map[string]interface{}, k string) float64 {
	switch v := m[k].(type) {
	case float64:
		return v
	case int:
		return float64(v)
	}
	return 0
}

func boolFrom(m map[string]interface{}, k string) bool {
	if v, ok := m[k].(bool); ok {
		return v
	}
	return false
}

func timeFrom(m map[string]interface{}, k string) time.Time {
	s, ok := m[k].(string)
	if !ok {
		return time.Time{}
	}
	t, _ := time.Parse(time.RFC3339, s)
	return t
}

// handleListProblems: typed-filter enumerator over workloads.
func (s *mcpServerImpl) handleListProblems(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	filter := strArg(args, "filter")
	if filter == "" {
		return nil, fmt.Errorf("list_problems: 'filter' is required; accepted: crashlooping, oom, pending, evicted, image_pull_error, unhealthy. To list ALL pods use list_resources(kind=Pod) instead")
	}
	// "all" is a common LLM mistake — redirect clearly rather than erroring.
	if filter == "all" || filter == "any" || filter == "*" {
		return nil, fmt.Errorf("list_problems does not support filter=%q. To list all pods use list_resources(kind=Pod). To find all problem pods call list_problems once per filter: crashlooping, oom, pending, evicted, image_pull_error, unhealthy", filter)
	}
	if problemPredicateName(filter) == "" {
		return nil, fmt.Errorf("list_problems: unknown filter %q; accepted: crashlooping, oom, pending, evicted, image_pull_error, unhealthy. To list ALL pods use list_resources(kind=Pod)", filter)
	}

	limit := intArgDefault(args, "limit", 50)
	if limit > 200 {
		limit = 200
	}
	clusterID := strArg(args, "cluster_id")

	// Delegate to resources_by_query (the broadest pod enumerator).
	queryArgs := copyArgs(args)
	queryArgs["kind"] = "Pod"
	tr := s.timedCall(ctx, "observe_resources_by_query", queryArgs, s.handleResourcesByQuery)
	errs := map[string]error{}
	if tr.err != nil {
		errs["observe_resources_by_query"] = tr.err
	}

	var pods []triage.NamedPodState
	if m, ok := tr.out.(map[string]interface{}); ok {
		if list, ok := m["pods"].([]interface{}); ok {
			for _, p := range list {
				np := shapePod(p)
				if np.Name != "" {
					pods = append(pods, np)
				}
			}
		}
	}
	ranked, truncated := triage.RankProblems(pods, filter, limit)

	summary := fmt.Sprintf("%d pods matching %q", len(ranked), filter)
	if truncated {
		summary += " (truncated to limit)"
	}
	data := map[string]interface{}{
		"filter":    filter,
		"count":     len(ranked),
		"problems":  ranked,
		"truncated": truncated,
	}
	return buildComposableResult("ProblemList", clusterID, summary, data,
		[]compositeSource{{Tool: tr.name, MS: tr.ms}}, errs), nil
}

// problemPredicateName returns a non-empty tag when the filter is known.
// Reused as the validity gate in handleListProblems.
func problemPredicateName(filter string) string {
	switch filter {
	case "crashlooping", "oom", "pending", "evicted", "image_pull_error", "unhealthy":
		return filter
	}
	return ""
}

// intArgDefault parses args[k] as an int; returns def if missing.
func intArgDefault(args map[string]interface{}, k string, def int) int {
	switch v := args[k].(type) {
	case int:
		return v
	case float64:
		return int(v)
	}
	return def
}

// handleSearchLogs: pattern-clustered log search across pods in a namespace.
func (s *mcpServerImpl) handleSearchLogs(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	namespace := strArg(args, "namespace")
	regex := strArg(args, "regex")
	if namespace == "" {
		return nil, fmt.Errorf("search_logs: 'namespace' is required")
	}
	if regex == "" {
		return nil, fmt.Errorf("search_logs: 'regex' is required")
	}

	maxPods := intArgDefault(args, "max_pods", 10)
	maxLinesPerPod := intArgDefault(args, "max_lines_per_pod", 1000)
	clusterID := strArg(args, "cluster_id")

	// Resolve pod candidates — either the explicit workload or all pods
	// in the namespace.
	queryArgs := copyArgs(args)
	queryArgs["kind"] = "Pod"
	tr := s.timedCall(ctx, "observe_resources_by_query", queryArgs, s.handleResourcesByQuery)
	errs := map[string]error{}
	if tr.err != nil {
		errs["observe_resources_by_query"] = tr.err
	}
	pods := extractPodNames(tr.out)
	podsSkipped := 0
	if len(pods) > maxPods {
		podsSkipped = len(pods) - maxPods
		pods = pods[:maxPods]
	}

	// Fan out log fetches across the selected pods.
	var allLines []logpattern.LogLine
	var mu sync.Mutex
	var wg sync.WaitGroup
	var logSources []compositeSource
	for _, pod := range pods {
		wg.Add(1)
		go func(podName string) {
			defer wg.Done()
			podArgs := copyArgs(args)
			podArgs["pod"] = podName
			podArgs["grep"] = regex
			podArgs["lines"] = maxLinesPerPod
			tr := s.timedCall(ctx, "observe_pod_logs_filtered:"+podName, podArgs, s.handlePodLogs)
			mu.Lock()
			logSources = append(logSources, compositeSource{Tool: tr.name, MS: tr.ms})
			if tr.err != nil {
				errs[tr.name] = tr.err
			} else {
				allLines = append(allLines, extractLogLines(tr.out, podName)...)
			}
			mu.Unlock()
		}(pod)
	}
	wg.Wait()

	result := logpattern.Cluster(allLines)

	// Summarize: "X error patterns across Y pods; most frequent: <template> (N× in K pods)"
	summary := fmt.Sprintf("%d pattern(s) across %d pod(s)", len(result.Patterns), len(pods))
	if len(result.Patterns) > 0 {
		top := result.Patterns[0]
		summary += fmt.Sprintf("; most frequent: %s (%d× in %d pod(s))", top.Template, top.Count, len(top.Pods))
	}

	data := map[string]interface{}{
		"query":                      map[string]interface{}{"namespace": namespace, "workload": strArg(args, "workload"), "regex": regex, "since": strArg(args, "since")},
		"patterns":                   result.Patterns,
		"pods_searched":              len(pods),
		"pods_skipped_due_to_cap":    podsSkipped,
		"unmatched_error_line_count": 0, // reserved; Extract always returns a template
	}
	sources := append([]compositeSource{{Tool: tr.name, MS: tr.ms}}, logSources...)
	return buildComposableResult("LogPatterns", clusterID, summary, data, sources, errs), nil
}

// extractPodNames pulls names out of a generic resources_by_query response.
func extractPodNames(in interface{}) []string {
	m, ok := in.(map[string]interface{})
	if !ok {
		return nil
	}
	list, ok := m["pods"].([]interface{})
	if !ok {
		return nil
	}
	var out []string
	for _, p := range list {
		if pm, ok := p.(map[string]interface{}); ok {
			if n, ok := pm["name"].(string); ok && n != "" {
				out = append(out, n)
			}
		}
	}
	return out
}

// extractLogLines pulls LogLine entries out of the generic pod-logs handler
// output. Tolerant of multiple upstream shapes.
func extractLogLines(in interface{}, pod string) []logpattern.LogLine {
	m, ok := in.(map[string]interface{})
	if !ok {
		return nil
	}
	list, ok := m["lines"].([]interface{})
	if !ok {
		return nil
	}
	var out []logpattern.LogLine
	for _, l := range list {
		switch t := l.(type) {
		case string:
			out = append(out, logpattern.LogLine{Pod: pod, Line: t, Timestamp: time.Now()})
		case map[string]interface{}:
			line, _ := t["line"].(string)
			tsStr, _ := t["ts"].(string)
			ts, _ := time.Parse(time.RFC3339, tsStr)
			out = append(out, logpattern.LogLine{Pod: pod, Line: line, Timestamp: ts})
		}
	}
	return out
}
