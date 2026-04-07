package events

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"
)

// AlertNotifier is an optional interface that the InsightsEngine calls whenever
// a new insight is detected.  It decouples the events package from the addon
// notifications package so there is no direct import dependency.
type AlertNotifier interface {
	NotifyInsight(ctx context.Context, insight *Insight) error
}

// InsightsEngine runs anomaly detection rules periodically.
type InsightsEngine struct {
	store     *Store
	clusterID string
	rules     []InsightRule
	notifier  AlertNotifier // optional — fires webhook/Slack/in-app alerts
	stopCh    chan struct{}
}

// SetNotifier attaches an AlertNotifier that is called for every new insight.
func (e *InsightsEngine) SetNotifier(n AlertNotifier) {
	e.notifier = n
}

// InsightRule defines a single anomaly detection rule.
type InsightRule struct {
	Name     string
	Evaluate func(ctx context.Context, store *Store, clusterID string) *Insight
}

// NewInsightsEngine creates a new InsightsEngine with all built-in rules.
func NewInsightsEngine(store *Store, clusterID string) *InsightsEngine {
	e := &InsightsEngine{
		store:     store,
		clusterID: clusterID,
		stopCh:    make(chan struct{}),
	}

	e.rules = []InsightRule{
		{Name: "crashLoopDetected", Evaluate: crashLoopDetected},
		{Name: "imagePullFailure", Evaluate: imagePullFailure},
		{Name: "oomKillDetected", Evaluate: oomKillDetected},
		{Name: "schedulingFailures", Evaluate: schedulingFailures},
		{Name: "restartStorm", Evaluate: restartStorm},
		{Name: "cascadingFailures", Evaluate: cascadingFailures},
		{Name: "healthDrift", Evaluate: healthDrift},
	}

	return e
}

// Start runs all rules every 30 seconds in a goroutine. The provided context
// is used for all database operations; cancelling it causes the goroutine to
// exit. Reduced from 60s to 30s for faster insight detection.
func (e *InsightsEngine) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-e.stopCh:
				return
			case <-ticker.C:
				insights := e.RunRules(ctx)
				for i := range insights {
					if err := e.store.InsertInsight(ctx, &insights[i]); err != nil {
						log.Printf("events/insights: failed to store insight %s: %v", insights[i].InsightID, err)
						continue
					}
					// Fire webhook/Slack/in-app notification for the new insight.
					if e.notifier != nil {
						if err := e.notifier.NotifyInsight(ctx, &insights[i]); err != nil {
							log.Printf("events/insights: notifier error for %s: %v", insights[i].InsightID, err)
						}
					}
				}
			}
		}
	}()
}

// Stop stops the insights engine. Safe to call multiple times.
func (e *InsightsEngine) Stop() {
	select {
	case <-e.stopCh:
		return // already closed
	default:
		close(e.stopCh)
	}
}

// maxActivePerRule caps how many active insights of each rule type are kept.
// Older ones are auto-resolved to prevent unbounded accumulation.
const maxActivePerRule = 3

// RunRules executes all rules and returns any new insights.
// Also auto-resolves stale insights that exceed the per-rule cap.
func (e *InsightsEngine) RunRules(ctx context.Context) []Insight {
	var results []Insight
	for _, rule := range e.rules {
		insight := rule.Evaluate(ctx, e.store, e.clusterID)
		if insight != nil {
			results = append(results, *insight)
		}
	}

	// Auto-resolve excess insights: keep only the newest maxActivePerRule per rule.
	e.pruneStaleInsights(ctx)

	return results
}

// pruneStaleInsights resolves old active insights beyond the per-rule cap.
func (e *InsightsEngine) pruneStaleInsights(ctx context.Context) {
	active, err := e.store.GetActiveInsights(ctx, e.clusterID)
	if err != nil || len(active) == 0 {
		return
	}
	// Count per rule, dismiss oldest beyond cap
	byRule := make(map[string][]string) // rule -> []insightID (newest first from DB)
	for _, ins := range active {
		byRule[ins.Rule] = append(byRule[ins.Rule], ins.InsightID)
	}
	for _, ids := range byRule {
		if len(ids) <= maxActivePerRule {
			continue
		}
		// Dismiss all beyond the cap (ids are newest-first from query)
		for _, id := range ids[maxActivePerRule:] {
			_ = e.store.DismissInsight(ctx, id)
		}
	}
}

// ---------------------------------------------------------------------------
// Built-in rules — lowered thresholds for real K8s failures
// ---------------------------------------------------------------------------

// crashLoopDetected triggers immediately when any CrashLoopBackOff event exists
// in the last 10 minutes. K8s emits reason=BackOff with "CrashLoopBackOff" in
// the message, or reason=CrashLoopBackOff directly.
func crashLoopDetected(ctx context.Context, store *Store, clusterID string) *Insight {
	tenMinAgo := UnixMillis() - 10*60*1000

	// Check for reason=BackOff events (K8s standard).
	backoffEvents, err := store.QueryEvents(ctx, EventQuery{
		ClusterID: clusterID,
		Reason:    "BackOff",
		Since:     &tenMinAgo,
		Limit:     100,
	})
	if err != nil {
		return nil
	}

	// Also check for reason=CrashLoopBackOff (some K8s versions).
	crashEvents, err := store.QueryEvents(ctx, EventQuery{
		ClusterID: clusterID,
		Reason:    "CrashLoopBackOff",
		Since:     &tenMinAgo,
		Limit:     100,
	})
	if err != nil {
		return nil
	}

	// Filter for CrashLoopBackOff in message.
	var crashLoopPods []string
	seen := make(map[string]bool)
	for _, e := range backoffEvents {
		if strings.Contains(e.Message, "CrashLoopBackOff") || strings.Contains(e.Message, "crash") {
			podKey := e.ResourceNamespace + "/" + e.ResourceName
			if !seen[podKey] {
				seen[podKey] = true
				crashLoopPods = append(crashLoopPods, podKey)
			}
		}
	}
	for _, e := range crashEvents {
		podKey := e.ResourceNamespace + "/" + e.ResourceName
		if !seen[podKey] {
			seen[podKey] = true
			crashLoopPods = append(crashLoopPods, podKey)
		}
	}

	if len(crashLoopPods) == 0 {
		return nil
	}

	// Deduplicate: check if we already generated this insight recently.
	recentInsight := hasRecentInsight(ctx, store, clusterID, "crashLoopDetected", 10*60*1000)
	if recentInsight {
		return nil
	}

	detail := fmt.Sprintf("%d pod(s) in CrashLoopBackOff: %s", len(crashLoopPods), strings.Join(crashLoopPods, ", "))
	if len(detail) > 500 {
		detail = detail[:497] + "..."
	}

	return &Insight{
		InsightID: fmt.Sprintf("ins_%d_crashLoop", time.Now().UnixNano()),
		Timestamp: UnixMillis(),
		ClusterID: clusterID,
		Rule:      "crashLoopDetected",
		Severity:  "critical",
		Title:     "CrashLoopBackOff detected",
		Detail:    detail,
		Status:    "active",
	}
}

// imagePullFailure triggers when any image pull failure event exists in the
// last 10 minutes. Matches reason=Failed with ImagePull/ErrImagePull in message,
// or reason=ImagePullBackOff, or BackOff with ImagePullBackOff in message.
func imagePullFailure(ctx context.Context, store *Store, clusterID string) *Insight {
	tenMinAgo := UnixMillis() - 10*60*1000

	// Get all Warning events in the window.
	events, err := store.QueryEvents(ctx, EventQuery{
		ClusterID: clusterID,
		EventType: "Warning",
		Since:     &tenMinAgo,
		Limit:     200,
	})
	if err != nil {
		return nil
	}

	var affectedPods []string
	seen := make(map[string]bool)
	for _, e := range events {
		isImagePull := false
		// Check reason.
		if e.Reason == "ImagePullBackOff" || e.Reason == "ErrImagePull" {
			isImagePull = true
		}
		// Check message for image pull keywords.
		msg := strings.ToLower(e.Message)
		if strings.Contains(msg, "imagepullbackoff") || strings.Contains(msg, "errimagepull") ||
			strings.Contains(msg, "pull access denied") || strings.Contains(msg, "manifest unknown") ||
			strings.Contains(msg, "repository does not exist") {
			isImagePull = true
		}
		// Check reason=Failed with image pull message.
		if e.Reason == "Failed" && (strings.Contains(msg, "imagepull") || strings.Contains(msg, "pull image")) {
			isImagePull = true
		}
		// Check reason=BackOff with ImagePullBackOff in message.
		if e.Reason == "BackOff" && strings.Contains(msg, "imagepullbackoff") {
			isImagePull = true
		}

		if isImagePull {
			podKey := e.ResourceNamespace + "/" + e.ResourceName
			if !seen[podKey] {
				seen[podKey] = true
				affectedPods = append(affectedPods, podKey)
			}
		}
	}

	if len(affectedPods) == 0 {
		return nil
	}

	recentInsight := hasRecentInsight(ctx, store, clusterID, "imagePullFailure", 10*60*1000)
	if recentInsight {
		return nil
	}

	detail := fmt.Sprintf("%d pod(s) with image pull failures: %s", len(affectedPods), strings.Join(affectedPods, ", "))
	if len(detail) > 500 {
		detail = detail[:497] + "..."
	}

	return &Insight{
		InsightID: fmt.Sprintf("ins_%d_imagePull", time.Now().UnixNano()),
		Timestamp: UnixMillis(),
		ClusterID: clusterID,
		Rule:      "imagePullFailure",
		Severity:  "warning",
		Title:     "Image pull failure detected",
		Detail:    detail,
		Status:    "active",
	}
}

// oomKillDetected triggers when any OOMKilled/OOMKilling event exists in the
// last 10 minutes. K8s puts OOMKilled info in the message, not always the reason.
func oomKillDetected(ctx context.Context, store *Store, clusterID string) *Insight {
	tenMinAgo := UnixMillis() - 10*60*1000

	// Get all Warning events in the window and scan for OOM keywords.
	events, err := store.QueryEvents(ctx, EventQuery{
		ClusterID: clusterID,
		EventType: "Warning",
		Since:     &tenMinAgo,
		Limit:     200,
	})
	if err != nil {
		return nil
	}

	// Also check reason=OOMKilled or OOMKilling directly.
	oomByReason, err := store.QueryEvents(ctx, EventQuery{
		ClusterID: clusterID,
		Reason:    "OOMKilling",
		Since:     &tenMinAgo,
		Limit:     100,
	})
	if err == nil {
		events = append(events, oomByReason...)
	}

	var affectedPods []string
	seen := make(map[string]bool)
	for _, e := range events {
		isOOM := e.Reason == "OOMKilled" || e.Reason == "OOMKilling"
		if !isOOM {
			msg := strings.ToLower(e.Message)
			isOOM = strings.Contains(msg, "oomkill") || strings.Contains(msg, "oom kill") ||
				strings.Contains(msg, "out of memory") || strings.Contains(msg, "memory limit")
		}
		if isOOM {
			podKey := e.ResourceNamespace + "/" + e.ResourceName
			if !seen[podKey] {
				seen[podKey] = true
				affectedPods = append(affectedPods, podKey)
			}
		}
	}

	if len(affectedPods) == 0 {
		return nil
	}

	recentInsight := hasRecentInsight(ctx, store, clusterID, "oomKillDetected", 10*60*1000)
	if recentInsight {
		return nil
	}

	return &Insight{
		InsightID: fmt.Sprintf("ins_%d_oomKill", time.Now().UnixNano()),
		Timestamp: UnixMillis(),
		ClusterID: clusterID,
		Rule:      "oomKillDetected",
		Severity:  "critical",
		Title:     "OOMKilled detected",
		Detail:    fmt.Sprintf("%d pod(s) killed due to memory limits: %s", len(affectedPods), strings.Join(affectedPods, ", ")),
		Status:    "active",
	}
}

// schedulingFailures detects >=1 FailedScheduling events in 10 minutes.
// Lowered from >5 to >=1 — even one scheduling failure is actionable.
func schedulingFailures(ctx context.Context, store *Store, clusterID string) *Insight {
	tenMinAgo := UnixMillis() - 10*60*1000

	events, err := store.QueryEvents(ctx, EventQuery{
		ClusterID: clusterID,
		Reason:    "FailedScheduling",
		Since:     &tenMinAgo,
		Limit:     200,
	})
	if err != nil {
		return nil
	}

	if len(events) == 0 {
		return nil
	}

	recentInsight := hasRecentInsight(ctx, store, clusterID, "schedulingFailures", 10*60*1000)
	if recentInsight {
		return nil
	}

	// Collect affected pods.
	var pods []string
	seen := make(map[string]bool)
	for _, e := range events {
		podKey := e.ResourceNamespace + "/" + e.ResourceName
		if !seen[podKey] {
			seen[podKey] = true
			pods = append(pods, podKey)
		}
	}

	return &Insight{
		InsightID: fmt.Sprintf("ins_%d_schedulingFailures", time.Now().UnixNano()),
		Timestamp: UnixMillis(),
		ClusterID: clusterID,
		Rule:      "schedulingFailures",
		Severity:  "warning",
		Title:     "Scheduling failures detected",
		Detail:    fmt.Sprintf("%d FailedScheduling events in 10 minutes affecting %d pod(s): %s — possible resource constraints", len(events), len(pods), strings.Join(pods, ", ")),
		Status:    "active",
	}
}

// restartStorm detects >3 pod restarts (reason=BackOff or Started) in the
// same namespace within 5 minutes. Lowered from >10 to >3.
func restartStorm(ctx context.Context, store *Store, clusterID string) *Insight {
	fiveMinAgo := UnixMillis() - 5*60*1000

	// Check BackOff events.
	backoffEvents, err := store.QueryEvents(ctx, EventQuery{
		ClusterID: clusterID,
		Reason:    "BackOff",
		Since:     &fiveMinAgo,
		Limit:     200,
	})
	if err != nil {
		return nil
	}

	startedEvents, err := store.QueryEvents(ctx, EventQuery{
		ClusterID: clusterID,
		Reason:    "Started",
		Since:     &fiveMinAgo,
		Limit:     200,
	})
	if err != nil {
		return nil
	}

	// Group by namespace.
	nsCounts := make(map[string]int)
	for _, e := range backoffEvents {
		nsCounts[e.ResourceNamespace]++
	}
	for _, e := range startedEvents {
		nsCounts[e.ResourceNamespace]++
	}

	for ns, count := range nsCounts {
		if count > 3 {
			recentInsight := hasRecentInsight(ctx, store, clusterID, "restartStorm", 5*60*1000)
			if recentInsight {
				return nil
			}

			return &Insight{
				InsightID: fmt.Sprintf("ins_%d_restartStorm", time.Now().UnixNano()),
				Timestamp: UnixMillis(),
				ClusterID: clusterID,
				Rule:      "restartStorm",
				Severity:  "warning",
				Title:     fmt.Sprintf("Restart storm in namespace %s", ns),
				Detail:    fmt.Sprintf("%d pod restart events in 5 minutes in namespace %s", count, ns),
				Status:    "active",
			}
		}
	}

	return nil
}

// cascadingFailures detects >3 different resources in the same correlation group.
func cascadingFailures(ctx context.Context, store *Store, clusterID string) *Insight {
	thirtyMinAgo := UnixMillis() - 30*60*1000

	events, err := store.QueryEvents(ctx, EventQuery{
		ClusterID: clusterID,
		EventType: "Warning",
		Since:     &thirtyMinAgo,
		Limit:     500,
	})
	if err != nil {
		return nil
	}

	// Group by correlation_group_id and count unique resources.
	type groupInfo struct {
		resources map[string]struct{}
	}
	groups := make(map[string]*groupInfo)

	for _, e := range events {
		if e.CorrelationGroupID == "" {
			continue
		}
		gi, ok := groups[e.CorrelationGroupID]
		if !ok {
			gi = &groupInfo{resources: make(map[string]struct{})}
			groups[e.CorrelationGroupID] = gi
		}
		resourceKey := fmt.Sprintf("%s/%s", e.ResourceKind, e.ResourceName)
		gi.resources[resourceKey] = struct{}{}
	}

	for groupID, gi := range groups {
		if len(gi.resources) > 3 {
			recentInsight := hasRecentInsight(ctx, store, clusterID, "cascadingFailures", 30*60*1000)
			if recentInsight {
				return nil
			}

			return &Insight{
				InsightID: fmt.Sprintf("ins_%d_cascadingFailures", time.Now().UnixNano()),
				Timestamp: UnixMillis(),
				ClusterID: clusterID,
				Rule:      "cascadingFailures",
				Severity:  "critical",
				Title:     "Cascading failure detected",
				Detail:    fmt.Sprintf("Correlation group %s has %d affected resources — failure is spreading", groupID, len(gi.resources)),
				Status:    "active",
			}
		}
	}

	return nil
}

// healthDrift detects health score trending down >5 points over 1 hour.
func healthDrift(ctx context.Context, store *Store, clusterID string) *Insight {
	now := UnixMillis()
	oneHourAgo := now - 60*60*1000

	// Get the oldest snapshot in the window.
	oldest, err := store.GetSnapshotAt(ctx, clusterID, oneHourAgo)
	if err != nil {
		return nil
	}

	// Get the newest snapshot.
	newest, err := store.GetSnapshotAt(ctx, clusterID, now)
	if err != nil {
		return nil
	}

	if oldest.SnapshotID == newest.SnapshotID {
		return nil // same snapshot, no comparison possible
	}

	drift := oldest.HealthScore - newest.HealthScore
	if drift > 5 {
		recentInsight := hasRecentInsight(ctx, store, clusterID, "healthDrift", 60*60*1000)
		if recentInsight {
			return nil
		}

		return &Insight{
			InsightID: fmt.Sprintf("ins_%d_healthDrift", time.Now().UnixNano()),
			Timestamp: UnixMillis(),
			ClusterID: clusterID,
			Rule:      "healthDrift",
			Severity:  "info",
			Title:     "Health score drifting down",
			Detail:    fmt.Sprintf("Health score dropped %.1f points in the last hour (%.1f → %.1f)", drift, oldest.HealthScore, newest.HealthScore),
			Status:    "active",
		}
	}

	return nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// hasRecentInsight checks if an insight with the given rule was already generated
// within the specified window (in milliseconds) to avoid duplicates.
func hasRecentInsight(ctx context.Context, store *Store, clusterID, rule string, windowMs int64) bool {
	insights, err := store.GetRecentInsights(ctx, clusterID, rule, windowMs)
	if err != nil {
		// If the query fails (e.g. method not implemented), don't block insight generation.
		return false
	}
	return len(insights) > 0
}
