package events

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"sync"
	"time"
)

// CausalLink represents an inferred cause-effect relationship between two events.
type CausalLink struct {
	CausedByEventID string  `json:"caused_by_event_id"`
	Confidence      float64 `json:"confidence"`
	Rule            string  `json:"rule"`
}

// CausalityEngine infers cause-effect relationships between events using a
// set of deterministic rules. Each rule queries the store for recent events
// matching a known failure pattern.
type CausalityEngine struct {
	store *Store
	// Dedup: event_id -> timestamp of last causal assignment.
	// Prevents the same event from being re-assigned within 60 seconds.
	assigned map[string]int64
	mu       sync.Mutex
}

// NewCausalityEngine creates a new causality engine.
func NewCausalityEngine(store *Store) *CausalityEngine {
	return &CausalityEngine{
		store:    store,
		assigned: make(map[string]int64),
	}
}

// InferCause runs all causality rules against the given event and returns
// the first match (highest confidence). Returns nil if no cause is found.
// A deduplication window prevents the same event from being re-assigned
// within 60 seconds of a previous causal assignment.
func (ce *CausalityEngine) InferCause(ctx context.Context, event *WideEvent) *CausalLink {
	// Dedup check: skip if this event was already assigned within 60 seconds.
	ce.mu.Lock()
	if lastAssign, ok := ce.assigned[event.EventID]; ok {
		if event.Timestamp-lastAssign < 60000 { // 60 seconds in ms
			ce.mu.Unlock()
			return nil
		}
	}
	ce.mu.Unlock()

	// Rules ordered by priority:
	// Priority 1: Node-level rules (if node-level matches, skip pod-level)
	// Priority 2: Pod-level rules (common K8s failure chains)
	// Priority 3: Namespace/config-level rules
	nodeRules := []func(context.Context, *WideEvent) *CausalLink{
		ce.ruleNodeCausesEviction, // node-level
	}
	podRules := []func(context.Context, *WideEvent) *CausalLink{
		ce.ruleImagePullCausesBackOff,    // Failed(ErrImagePull) → BackOff(ImagePullBackOff)
		ce.ruleCrashLoopBackOff,          // Started/Created → BackOff(CrashLoopBackOff)
		ce.ruleOOMCausesCrashLoop,        // OOMKilling → BackOff(CrashLoopBackOff)
		ce.ruleFailedCausesBackOff,       // Generic: Failed → BackOff on same pod
		ce.rulePullingCausesFailed,       // Pulling → Failed on same pod (image pull error)
		ce.ruleDeploymentCausesPodEvent,  // Deployment ScalingReplicaSet → Pod events
	}
	otherRules := []func(context.Context, *WideEvent) *CausalLink{
		ce.ruleConfigCausesRestart,   // config-level
		ce.ruleScaleDownCausesSPOF,   // scaling
		ce.ruleQuotaCausesScheduling, // quota
	}
	transitiveRules := []func(context.Context, *WideEvent) *CausalLink{
		ce.ruleRolloutCascade,    // Deployment ScalingReplicaSet → Pod BackOff/Failed
		ce.ruleOwnerPropagation,  // child resource failing → owner resource degraded
		ce.ruleServiceDisruption, // Deployment/RS degraded → Service endpoints reduced
	}

	// Run node-level rules first; if matched, skip pod-level for this event.
	for _, rule := range nodeRules {
		if link := rule(ctx, event); link != nil {
			ce.recordAssignment(event)
			return link
		}
	}
	for _, rule := range podRules {
		if link := rule(ctx, event); link != nil {
			ce.recordAssignment(event)
			return link
		}
	}
	for _, rule := range otherRules {
		if link := rule(ctx, event); link != nil {
			ce.recordAssignment(event)
			return link
		}
	}
	for _, rule := range transitiveRules {
		if link := rule(ctx, event); link != nil {
			ce.recordAssignment(event)
			return link
		}
	}
	return nil
}

// recordAssignment marks an event as assigned and cleans up stale entries.
func (ce *CausalityEngine) recordAssignment(event *WideEvent) {
	ce.mu.Lock()
	defer ce.mu.Unlock()
	ce.assigned[event.EventID] = event.Timestamp
	// Cleanup entries older than 5 minutes.
	cutoff := event.Timestamp - 300000
	for id, ts := range ce.assigned {
		if ts < cutoff {
			delete(ce.assigned, id)
		}
	}
}

// ---------------------------------------------------------------------------
// Pod-level causal rules — match common K8s failure chains
// ---------------------------------------------------------------------------

// Rule: Image pull failure causes BackOff
// Failed(ErrImagePull/ImagePullBackOff) → BackOff on same pod within 5 min.
// Also matches: BackOff with message containing "ImagePullBackOff".
func (ce *CausalityEngine) ruleImagePullCausesBackOff(ctx context.Context, event *WideEvent) *CausalLink {
	if event.ResourceKind != "Pod" {
		return nil
	}

	// Target: BackOff with ImagePullBackOff in the message, or reason=ImagePullBackOff
	isImagePullBackOff := event.Reason == "BackOff" && strings.Contains(event.Message, "ImagePullBackOff")
	isImagePullBackOffReason := event.Reason == "ImagePullBackOff"
	if !isImagePullBackOff && !isImagePullBackOffReason {
		return nil
	}

	// Look for a preceding Failed event with ErrImagePull or ImagePull in message on the same pod.
	cause, err := ce.findRecentEventOnSameResource(ctx,
		event.ClusterID, event.ResourceKind, event.ResourceName, event.ResourceNamespace,
		"Failed", event.Timestamp, 5*time.Minute,
	)
	if err != nil || cause == nil {
		return nil
	}

	// Verify the Failed event is related to image pulling.
	if strings.Contains(cause.Message, "ImagePull") || strings.Contains(cause.Message, "ErrImagePull") ||
		strings.Contains(cause.Message, "pulling image") || strings.Contains(cause.Message, "pull image") {
		return &CausalLink{
			CausedByEventID: cause.EventID,
			Confidence:      0.95,
			Rule:            "image_pull_causes_backoff",
		}
	}

	// Even without image keywords, Failed → BackOff on same pod is a causal link.
	return &CausalLink{
		CausedByEventID: cause.EventID,
		Confidence:      0.80,
		Rule:            "image_pull_causes_backoff",
	}
}

// Rule: Container crash causes CrashLoopBackOff
// Started/Created → BackOff(CrashLoopBackOff) on same pod within 5 min.
func (ce *CausalityEngine) ruleCrashLoopBackOff(ctx context.Context, event *WideEvent) *CausalLink {
	if event.ResourceKind != "Pod" {
		return nil
	}

	// Target: BackOff with CrashLoopBackOff in message, or reason=CrashLoopBackOff.
	isCrashLoop := (event.Reason == "BackOff" && strings.Contains(event.Message, "CrashLoopBackOff")) ||
		event.Reason == "CrashLoopBackOff"
	if !isCrashLoop {
		return nil
	}

	// Look for a preceding Started event on the same pod — this shows the container
	// did start before crashing.
	cause, err := ce.findRecentEventOnSameResource(ctx,
		event.ClusterID, event.ResourceKind, event.ResourceName, event.ResourceNamespace,
		"Started", event.Timestamp, 5*time.Minute,
	)
	if err != nil || cause == nil {
		// Fallback: look for Created event.
		cause, err = ce.findRecentEventOnSameResource(ctx,
			event.ClusterID, event.ResourceKind, event.ResourceName, event.ResourceNamespace,
			"Created", event.Timestamp, 5*time.Minute,
		)
		if err != nil || cause == nil {
			return nil
		}
	}

	return &CausalLink{
		CausedByEventID: cause.EventID,
		Confidence:      0.90,
		Rule:            "crash_loop_backoff",
	}
}

// Rule: OOMKilled causes CrashLoopBackOff
// Any event with "OOMKilled" or "OOMKilling" in reason or message →
// subsequent BackOff on the same pod within 5 min.
func (ce *CausalityEngine) ruleOOMCausesCrashLoop(ctx context.Context, event *WideEvent) *CausalLink {
	if event.ResourceKind != "Pod" {
		return nil
	}

	// Target: BackOff or CrashLoopBackOff event.
	isBackOff := event.Reason == "BackOff" || event.Reason == "CrashLoopBackOff"
	if !isBackOff {
		return nil
	}

	// Look for OOMKilled/OOMKilling event on the same pod.
	cause, err := ce.findRecentEventByMessagePattern(ctx,
		event.ClusterID, event.ResourceKind, event.ResourceName, event.ResourceNamespace,
		"OOMKill", event.Timestamp, 5*time.Minute,
	)
	if err != nil || cause == nil {
		return nil
	}

	return &CausalLink{
		CausedByEventID: cause.EventID,
		Confidence:      0.95,
		Rule:            "oom_causes_crashloop",
	}
}

// Rule: Generic Failed → BackOff on same pod.
// Any Failed event followed by BackOff on the same pod within 5 min.
func (ce *CausalityEngine) ruleFailedCausesBackOff(ctx context.Context, event *WideEvent) *CausalLink {
	if event.ResourceKind != "Pod" {
		return nil
	}
	if event.Reason != "BackOff" {
		return nil
	}

	cause, err := ce.findRecentEventOnSameResource(ctx,
		event.ClusterID, event.ResourceKind, event.ResourceName, event.ResourceNamespace,
		"Failed", event.Timestamp, 5*time.Minute,
	)
	if err != nil || cause == nil {
		return nil
	}

	return &CausalLink{
		CausedByEventID: cause.EventID,
		Confidence:      0.85,
		Rule:            "failed_causes_backoff",
	}
}

// Rule: Pulling → Failed on same pod (image pull error chain).
// Pulling event followed by Failed with image-related message.
func (ce *CausalityEngine) rulePullingCausesFailed(ctx context.Context, event *WideEvent) *CausalLink {
	if event.ResourceKind != "Pod" {
		return nil
	}
	if event.Reason != "Failed" {
		return nil
	}
	// Only match image-pull-related failures.
	if !strings.Contains(event.Message, "ImagePull") && !strings.Contains(event.Message, "ErrImagePull") &&
		!strings.Contains(event.Message, "pull image") && !strings.Contains(event.Message, "pulling image") {
		return nil
	}

	cause, err := ce.findRecentEventOnSameResource(ctx,
		event.ClusterID, event.ResourceKind, event.ResourceName, event.ResourceNamespace,
		"Pulling", event.Timestamp, 5*time.Minute,
	)
	if err != nil || cause == nil {
		return nil
	}

	return &CausalLink{
		CausedByEventID: cause.EventID,
		Confidence:      0.90,
		Rule:            "pulling_causes_failed",
	}
}

// Rule: Deployment rollout causes Pod events
// If a Pod event occurs within 5 min of its owning Deployment's rollout event, link them.
func (ce *CausalityEngine) ruleDeploymentCausesPodEvent(ctx context.Context, event *WideEvent) *CausalLink {
	if event.ResourceKind != "Pod" {
		return nil
	}

	// Infer the deployment name from the pod owner
	deployName := event.OwnerName
	if deployName == "" {
		// Try to infer from pod name (strip replicaset + pod hash)
		parts := strings.Split(event.ResourceName, "-")
		if len(parts) >= 3 {
			deployName = strings.Join(parts[:len(parts)-2], "-")
		}
	}
	if deployName == "" {
		return nil
	}

	cause, err := ce.findRecentEventInWindow(ctx,
		event.ClusterID, "Deployment", deployName, event.ResourceNamespace,
		"ScalingReplicaSet", event.Timestamp, 5*time.Minute,
	)
	if err != nil || cause == nil {
		return nil
	}

	return &CausalLink{
		CausedByEventID: cause.EventID,
		Confidence:      0.90,
		Rule:            "deployment_causes_pod_event",
	}
}

// ---------------------------------------------------------------------------
// Node-level causal rules
// ---------------------------------------------------------------------------

// Rule: Node condition causes Pod eviction/killing.
// If Pod eviction/killing follows a node condition event (NotReady, MemoryPressure,
// DiskPressure, PIDPressure) on the same node within 10 min.
func (ce *CausalityEngine) ruleNodeCausesEviction(ctx context.Context, event *WideEvent) *CausalLink {
	if event.ResourceKind != "Pod" {
		return nil
	}
	// Match eviction-related reasons.
	switch event.Reason {
	case "Evicted", "Preempting", "Killing", "EvictionThresholdMet":
		// proceed
	default:
		return nil
	}
	if event.NodeName == "" {
		return nil
	}

	// Look for node condition events on the same node. K8s uses multiple reason strings.
	nodeReasons := []string{"NodeNotReady", "NodeStatusUnknown", "MemoryPressure", "DiskPressure", "PIDPressure", "Rebooted"}
	for _, reason := range nodeReasons {
		cause, err := ce.findRecentEventInWindow(ctx,
			event.ClusterID, "Node", event.NodeName, "",
			reason, event.Timestamp, 10*time.Minute,
		)
		if err != nil {
			continue
		}
		if cause != nil {
			return &CausalLink{
				CausedByEventID: cause.EventID,
				Confidence:      0.95,
				Rule:            "node_causes_eviction",
			}
		}
	}

	return nil
}

// ---------------------------------------------------------------------------
// Config/scaling/quota rules
// ---------------------------------------------------------------------------

// Rule: ConfigMap/Secret change causes Pod restart
func (ce *CausalityEngine) ruleConfigCausesRestart(ctx context.Context, event *WideEvent) *CausalLink {
	if event.ResourceKind != "Pod" {
		return nil
	}
	if event.Reason != "Killing" && event.Reason != "Started" && event.Reason != "Pulled" {
		return nil
	}

	cause, err := ce.findRecentConfigChange(ctx,
		event.ClusterID, event.ResourceNamespace, event.Timestamp, 2*time.Minute,
	)
	if err != nil || cause == nil {
		return nil
	}

	return &CausalLink{
		CausedByEventID: cause.EventID,
		Confidence:      0.85,
		Rule:            "config_causes_restart",
	}
}

// Rule: Scale-down causes SPOF condition
func (ce *CausalityEngine) ruleScaleDownCausesSPOF(ctx context.Context, event *WideEvent) *CausalLink {
	if event.Reason != "ScalingReplicaSet" {
		return nil
	}
	if !strings.Contains(event.Message, "to 1") && !strings.Contains(event.Message, "Scaled down") {
		return nil
	}

	return &CausalLink{
		CausedByEventID: event.EventID,
		Confidence:      0.90,
		Rule:            "scaledown_causes_spof",
	}
}

// Rule: ResourceQuota exceeded causes FailedScheduling
func (ce *CausalityEngine) ruleQuotaCausesScheduling(ctx context.Context, event *WideEvent) *CausalLink {
	if event.Reason != "FailedScheduling" {
		return nil
	}

	// Check if the FailedScheduling message mentions quota or insufficient resources.
	if strings.Contains(event.Message, "Insufficient") || strings.Contains(event.Message, "quota") ||
		strings.Contains(event.Message, "exceeded") {
		// Self-referential: the event itself explains the cause.
		return &CausalLink{
			CausedByEventID: event.EventID,
			Confidence:      0.85,
			Rule:            "resource_constraint_scheduling",
		}
	}

	// Look for quota exceeded events.
	cause, err := ce.findRecentEventInWindow(ctx,
		event.ClusterID, "ResourceQuota", "", event.ResourceNamespace,
		"FailedCreate", event.Timestamp, 5*time.Minute,
	)
	if err != nil || cause == nil {
		return nil
	}

	return &CausalLink{
		CausedByEventID: cause.EventID,
		Confidence:      0.85,
		Rule:            "quota_causes_scheduling",
	}
}

// ---------------------------------------------------------------------------
// Transitive ownership rules — enable multi-hop chain walking
// ---------------------------------------------------------------------------

// Rule: Rollout cascade — Deployment ScalingReplicaSet → Pod BackOff/Failed
// A Pod BackOff or Failed event whose owner is a ReplicaSet is linked to the
// Deployment ScalingReplicaSet event that triggered the rollout, if the
// Deployment event message contains the ReplicaSet name (OwnerName).
func (ce *CausalityEngine) ruleRolloutCascade(ctx context.Context, event *WideEvent) *CausalLink {
	if event.ResourceKind != "Pod" {
		return nil
	}
	if event.Reason != "BackOff" && event.Reason != "Failed" {
		return nil
	}
	if event.OwnerKind != "ReplicaSet" || event.OwnerName == "" {
		return nil
	}

	rsName := event.OwnerName
	since := event.Timestamp - (10 * time.Minute).Milliseconds()

	// Query Deployment ScalingReplicaSet events in the same namespace within 10 min.
	candidates, err := ce.store.QueryEvents(ctx, EventQuery{
		ClusterID:    event.ClusterID,
		Namespace:    event.ResourceNamespace,
		ResourceKind: "Deployment",
		Reason:       "ScalingReplicaSet",
		Since:        &since,
		Until:        &event.Timestamp,
		Limit:        20,
	})
	if err != nil {
		return nil
	}

	// Find a Deployment event whose message references this ReplicaSet.
	for i := range candidates {
		if strings.Contains(candidates[i].Message, rsName) {
			return &CausalLink{
				CausedByEventID: candidates[i].EventID,
				Confidence:      0.90,
				Rule:            "rollout_cascade",
			}
		}
	}
	return nil
}

// Rule: Owner propagation — child resource failing → owner resource degraded
// A ReplicaSet or Deployment event signalling unavailability is linked to a
// preceding child event whose OwnerKind/OwnerName matches this resource.
func (ce *CausalityEngine) ruleOwnerPropagation(ctx context.Context, event *WideEvent) *CausalLink {
	var childKind string
	switch event.ResourceKind {
	case "ReplicaSet":
		childKind = "Pod"
	case "Deployment":
		childKind = "ReplicaSet"
	default:
		return nil
	}

	switch event.Reason {
	case "Unavailable", "FailedCreate", "MinimumReplicasUnavailable":
		// proceed
	default:
		return nil
	}

	since := event.Timestamp - (5 * time.Minute).Milliseconds()

	// Query child events in the 5 min before this event.
	children, err := ce.store.QueryEvents(ctx, EventQuery{
		ClusterID:    event.ClusterID,
		Namespace:    event.ResourceNamespace,
		ResourceKind: childKind,
		Since:        &since,
		Until:        &event.Timestamp,
		Limit:        50,
	})
	if err != nil {
		return nil
	}

	// Find a child event whose OwnerKind+OwnerName match this resource.
	for _, childEvent := range children {
		if childEvent.OwnerKind == event.ResourceKind && childEvent.OwnerName == event.ResourceName {
			return &CausalLink{
				CausedByEventID: childEvent.EventID,
				Confidence:      0.80,
				Rule:            "owner_propagation",
			}
		}
	}
	return nil
}

// Rule: Service disruption — Deployment/RS degraded → Service endpoints reduced
// A Service event mentioning endpoints is linked to a recent Deployment or
// ReplicaSet event in the same namespace that is degraded/unavailable.
func (ce *CausalityEngine) ruleServiceDisruption(ctx context.Context, event *WideEvent) *CausalLink {
	if event.ResourceKind != "Service" {
		return nil
	}
	// Match Service events that mention endpoint changes.
	hasEndpoint := strings.Contains(event.Reason, "Endpoint") ||
		strings.Contains(event.Message, "Endpoint") ||
		strings.Contains(event.Message, "endpoint") ||
		strings.Contains(event.Message, "Endpoints")
	if !hasEndpoint {
		return nil
	}

	since := event.Timestamp - (5 * time.Minute).Milliseconds()

	// Look for Deployment or ReplicaSet events that are degraded/unavailable.
	for _, ownerKind := range []string{"Deployment", "ReplicaSet"} {
		candidates, err := ce.store.QueryEvents(ctx, EventQuery{
			ClusterID:    event.ClusterID,
			Namespace:    event.ResourceNamespace,
			ResourceKind: ownerKind,
			Since:        &since,
			Until:        &event.Timestamp,
			Limit:        20,
		})
		if err != nil {
			continue
		}
		for i := range candidates {
			c := &candidates[i]
			isDegraded := c.Severity == "error" || c.Severity == "degraded" ||
				c.Reason == "Unavailable" || c.Reason == "MinimumReplicasUnavailable"
			if isDegraded {
				return &CausalLink{
					CausedByEventID: c.EventID,
					Confidence:      0.75,
					Rule:            "service_disruption",
				}
			}
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

// findRecentEventInWindow searches for a recent event within a time window
// before the given timestamp. It returns nil (not an error) if no match is found.
func (ce *CausalityEngine) findRecentEventInWindow(
	ctx context.Context,
	clusterID, resourceKind, resourceName, namespace, reason string,
	timestamp int64, window time.Duration,
) (*WideEvent, error) {
	since := timestamp - window.Milliseconds()
	q := EventQuery{
		ClusterID:    clusterID,
		ResourceKind: resourceKind,
		ResourceName: resourceName,
		Namespace:    namespace,
		Reason:       reason,
		Since:        &since,
		Until:        &timestamp,
		Limit:        1,
	}

	events, err := ce.store.QueryEvents(ctx, q)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if len(events) == 0 {
		return nil, nil
	}
	return &events[0], nil
}

// findRecentEventOnSameResource searches for a recent event on the same
// resource (kind+name+namespace) with a specific reason. This is the primary
// helper for pod-level causal rules.
func (ce *CausalityEngine) findRecentEventOnSameResource(
	ctx context.Context,
	clusterID, resourceKind, resourceName, namespace, reason string,
	timestamp int64, window time.Duration,
) (*WideEvent, error) {
	return ce.findRecentEventInWindow(ctx, clusterID, resourceKind, resourceName, namespace, reason, timestamp, window)
}

// findRecentEventByMessagePattern searches for a recent event on the same
// resource where the reason OR message contains the given pattern.
// This handles K8s events where the key info is in the message, not reason.
func (ce *CausalityEngine) findRecentEventByMessagePattern(
	ctx context.Context,
	clusterID, resourceKind, resourceName, namespace, pattern string,
	timestamp int64, window time.Duration,
) (*WideEvent, error) {
	since := timestamp - window.Milliseconds()

	// First try to find by reason containing the pattern.
	q := EventQuery{
		ClusterID:    clusterID,
		ResourceKind: resourceKind,
		ResourceName: resourceName,
		Namespace:    namespace,
		Since:        &since,
		Until:        &timestamp,
		Limit:        50,
	}

	events, err := ce.store.QueryEvents(ctx, q)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}

	// Search for events where reason or message contains the pattern.
	for i := range events {
		if strings.Contains(events[i].Reason, pattern) || strings.Contains(events[i].Message, pattern) {
			return &events[i], nil
		}
	}

	return nil, nil
}

// findRecentConfigChange looks for ConfigMap or Secret change events
// in the given namespace within the time window.
func (ce *CausalityEngine) findRecentConfigChange(
	ctx context.Context,
	clusterID, namespace string,
	timestamp int64, window time.Duration,
) (*WideEvent, error) {
	// Try ConfigMap first
	cause, err := ce.findRecentEventInWindow(ctx,
		clusterID, "ConfigMap", "", namespace,
		"ConfigChanged", timestamp, window,
	)
	if err != nil {
		return nil, err
	}
	if cause != nil {
		return cause, nil
	}

	// Try Secret
	return ce.findRecentEventInWindow(ctx,
		clusterID, "Secret", "", namespace,
		"SecretChanged", timestamp, window,
	)
}
