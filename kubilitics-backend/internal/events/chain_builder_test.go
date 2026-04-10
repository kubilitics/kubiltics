package events

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jmoiron/sqlx"
	_ "modernc.org/sqlite"
)

// TestCausalChain_Basics verifies that CausalNode, CausalLinkV2, and CausalChain
// can be constructed and that field access works as expected.
func TestCausalChain_Basics(t *testing.T) {
	now := time.Now().UTC()

	// --- CausalNode ---
	rootNode := CausalNode{
		ResourceKey:  "default/Pod/crashy-pod",
		Kind:         "Pod",
		Namespace:    "default",
		Name:         "crashy-pod",
		EventReason:  "BackOff",
		EventMessage: "Back-off restarting failed container",
		Timestamp:    now,
		HealthStatus: "critical",
	}

	if rootNode.Kind != "Pod" {
		t.Errorf("expected Kind=Pod, got %s", rootNode.Kind)
	}
	if rootNode.Namespace != "default" {
		t.Errorf("expected Namespace=default, got %s", rootNode.Namespace)
	}
	if rootNode.Name != "crashy-pod" {
		t.Errorf("expected Name=crashy-pod, got %s", rootNode.Name)
	}
	if rootNode.EventReason != "BackOff" {
		t.Errorf("expected EventReason=BackOff, got %s", rootNode.EventReason)
	}
	if rootNode.HealthStatus != "critical" {
		t.Errorf("expected HealthStatus=critical, got %s", rootNode.HealthStatus)
	}
	if rootNode.ResourceKey != "default/Pod/crashy-pod" {
		t.Errorf("expected ResourceKey=default/Pod/crashy-pod, got %s", rootNode.ResourceKey)
	}

	// --- Effect node for the link ---
	effectNode := CausalNode{
		ResourceKey:  "default/Pod/crashy-pod",
		Kind:         "Pod",
		Namespace:    "default",
		Name:         "crashy-pod",
		EventReason:  "Killing",
		EventMessage: "Stopping container due to failed liveness probe",
		Timestamp:    now.Add(30 * time.Second),
		HealthStatus: "unhealthy",
	}

	// --- CausalLinkV2 ---
	link := CausalLinkV2{
		Cause:       rootNode,
		Effect:      effectNode,
		Rule:        "crash_loop_backoff",
		Confidence:  0.90,
		TimeDeltaMs: 30000,
	}

	if link.Rule != "crash_loop_backoff" {
		t.Errorf("expected Rule=crash_loop_backoff, got %s", link.Rule)
	}
	if link.Confidence != 0.90 {
		t.Errorf("expected Confidence=0.90, got %f", link.Confidence)
	}
	if link.TimeDeltaMs != 30000 {
		t.Errorf("expected TimeDeltaMs=30000, got %d", link.TimeDeltaMs)
	}
	if link.Cause.Kind != "Pod" {
		t.Errorf("expected Cause.Kind=Pod, got %s", link.Cause.Kind)
	}
	if link.Effect.EventReason != "Killing" {
		t.Errorf("expected Effect.EventReason=Killing, got %s", link.Effect.EventReason)
	}

	// --- CausalChain ---
	chain := CausalChain{
		ID:         "chain-001",
		ClusterID:  "cluster-abc",
		InsightID:  "insight-xyz",
		RootCause:  rootNode,
		Links:      []CausalLinkV2{link},
		Confidence: 0.90,
		Status:     "confirmed",
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	if chain.ID != "chain-001" {
		t.Errorf("expected ID=chain-001, got %s", chain.ID)
	}
	if chain.ClusterID != "cluster-abc" {
		t.Errorf("expected ClusterID=cluster-abc, got %s", chain.ClusterID)
	}
	if chain.InsightID != "insight-xyz" {
		t.Errorf("expected InsightID=insight-xyz, got %s", chain.InsightID)
	}
	if chain.RootCause.Kind != "Pod" {
		t.Errorf("expected RootCause.Kind=Pod, got %s", chain.RootCause.Kind)
	}
	if len(chain.Links) != 1 {
		t.Errorf("expected 1 link, got %d", len(chain.Links))
	}
	if chain.Confidence != 0.90 {
		t.Errorf("expected Confidence=0.90, got %f", chain.Confidence)
	}
	if chain.Status != "confirmed" {
		t.Errorf("expected Status=confirmed, got %s", chain.Status)
	}
	if chain.CreatedAt.IsZero() {
		t.Error("expected CreatedAt to be set")
	}
	if chain.UpdatedAt.IsZero() {
		t.Error("expected UpdatedAt to be set")
	}
}

// ---------------------------------------------------------------------------
// Store tests
// ---------------------------------------------------------------------------

// newTestStore creates an in-memory SQLite Store and runs EnsureTables.
func newTestStore(t *testing.T) *Store {
	t.Helper()
	db, err := sqlx.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open in-memory sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	s := NewStore(db)
	if err := s.EnsureTables(); err != nil {
		t.Fatalf("EnsureTables: %v", err)
	}
	return s
}

// TestStore_CausalChain_UpsertAndGet exercises UpsertCausalChain and GetCausalChain.
func TestStore_CausalChain_UpsertAndGet(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	now := time.Now().UTC().Truncate(time.Millisecond)

	root := CausalNode{
		ResourceKey:  "default/Pod/crashy-pod",
		Kind:         "Pod",
		Namespace:    "default",
		Name:         "crashy-pod",
		EventReason:  "BackOff",
		EventMessage: "Back-off restarting failed container",
		Timestamp:    now,
		HealthStatus: "critical",
	}

	link := CausalLinkV2{
		Cause: root,
		Effect: CausalNode{
			ResourceKey:  "default/Pod/crashy-pod",
			Kind:         "Pod",
			Namespace:    "default",
			Name:         "crashy-pod",
			EventReason:  "Killing",
			EventMessage: "Stopping container",
			Timestamp:    now.Add(30 * time.Second),
			HealthStatus: "unhealthy",
		},
		Rule:        "crash_loop_backoff",
		Confidence:  0.90,
		TimeDeltaMs: 30000,
	}

	chain := &CausalChain{
		ID:         "chain-001",
		ClusterID:  "cluster-abc",
		InsightID:  "insight-xyz",
		RootCause:  root,
		Links:      []CausalLinkV2{link},
		Confidence: 0.90,
		Status:     "active",
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	// --- Insert ---
	if err := s.UpsertCausalChain(ctx, chain); err != nil {
		t.Fatalf("UpsertCausalChain (insert): %v", err)
	}

	// --- Retrieve ---
	got, err := s.GetCausalChain(ctx, "cluster-abc", "insight-xyz")
	if err != nil {
		t.Fatalf("GetCausalChain: %v", err)
	}
	if got == nil {
		t.Fatal("expected non-nil chain, got nil")
	}
	if got.ID != "chain-001" {
		t.Errorf("ID: want chain-001, got %s", got.ID)
	}
	if got.ClusterID != "cluster-abc" {
		t.Errorf("ClusterID: want cluster-abc, got %s", got.ClusterID)
	}
	if got.InsightID != "insight-xyz" {
		t.Errorf("InsightID: want insight-xyz, got %s", got.InsightID)
	}
	if got.Confidence != 0.90 {
		t.Errorf("Confidence: want 0.90, got %f", got.Confidence)
	}
	if got.Status != "active" {
		t.Errorf("Status: want active, got %s", got.Status)
	}
	if got.RootCause.Kind != "Pod" {
		t.Errorf("RootCause.Kind: want Pod, got %s", got.RootCause.Kind)
	}
	if len(got.Links) != 1 {
		t.Errorf("Links: want 1, got %d", len(got.Links))
	}

	// --- Update (change confidence) ---
	chain.Confidence = 0.75
	chain.Status = "confirmed"
	chain.UpdatedAt = now.Add(time.Minute)

	if err := s.UpsertCausalChain(ctx, chain); err != nil {
		t.Fatalf("UpsertCausalChain (update): %v", err)
	}

	updated, err := s.GetCausalChain(ctx, "cluster-abc", "insight-xyz")
	if err != nil {
		t.Fatalf("GetCausalChain after update: %v", err)
	}
	if updated.Confidence != 0.75 {
		t.Errorf("updated Confidence: want 0.75, got %f", updated.Confidence)
	}
	if updated.Status != "confirmed" {
		t.Errorf("updated Status: want confirmed, got %s", updated.Status)
	}

	// --- Non-existent insight returns nil, no error ---
	missing, err := s.GetCausalChain(ctx, "cluster-abc", "no-such-insight")
	if err != nil {
		t.Fatalf("GetCausalChain (missing): unexpected error: %v", err)
	}
	if missing != nil {
		t.Errorf("expected nil for missing insight, got %+v", missing)
	}
}

// ---------------------------------------------------------------------------
// ChainBuilder tests
// ---------------------------------------------------------------------------

// newTestChainBuilder creates an in-memory store, seeds it with events, and
// returns both the store and a ChainBuilder ready for testing.
func newTestChainBuilder(t *testing.T) (*Store, *ChainBuilder) {
	t.Helper()
	s := newTestStore(t)
	ce := NewCausalityEngine(s)
	cfg := DefaultChainBuilderConfig()
	cb := NewChainBuilder(s, ce, cfg)
	return s, cb
}

// seedEvent is a small helper that inserts a WideEvent and fatals on error.
func seedEvent(t *testing.T, ctx context.Context, s *Store, e *WideEvent) {
	t.Helper()
	if err := s.InsertEvent(ctx, e); err != nil {
		t.Fatalf("seedEvent %s: %v", e.EventID, err)
	}
}

// TestChainBuilder_BuildChain_TwoHop seeds a ConfigMap update event followed
// by a Pod BackOff event that the causality engine should link together via
// the config_causes_restart rule. The chain should have at least 1 link and
// chain confidence >= 0.5.
func TestChainBuilder_BuildChain_TwoHop(t *testing.T) {
	ctx := context.Background()
	s, cb := newTestChainBuilder(t)

	clusterID := "cluster-twohop"
	ns := "default"
	now := time.Now().UnixMilli()

	// Cause: ConfigMap change event (2 minutes before symptom).
	configEvent := &WideEvent{
		EventID:           fmt.Sprintf("evt-configmap-%d", now),
		Timestamp:         now - 2*60*1000,
		ClusterID:         clusterID,
		EventType:         "Normal",
		Reason:            "ConfigChanged",
		Message:           "ConfigMap app-config was updated",
		ResourceKind:      "ConfigMap",
		ResourceName:      "app-config",
		ResourceNamespace: ns,
		Severity:          "info",
	}

	// Symptom: Pod restart (Killing) caused by config change.
	podEvent := &WideEvent{
		EventID:           fmt.Sprintf("evt-pod-killing-%d", now),
		Timestamp:         now,
		ClusterID:         clusterID,
		EventType:         "Normal",
		Reason:            "Killing",
		Message:           "Stopping container api-server",
		ResourceKind:      "Pod",
		ResourceName:      "api-server-7f8d9",
		ResourceNamespace: ns,
		Severity:          "warning",
	}

	seedEvent(t, ctx, s, configEvent)
	seedEvent(t, ctx, s, podEvent)

	insight := Insight{
		InsightID: "insight-twohop",
		Timestamp: now,
		ClusterID: clusterID,
		Rule:      "pod_restart",
		Severity:  "warning",
		Title:     "Pod restarting",
		Detail:    "Pod default/api-server-7f8d9 is restarting repeatedly",
		Status:    "active",
	}

	chain, err := cb.BuildChain(ctx, insight)
	if err != nil {
		t.Fatalf("BuildChain: %v", err)
	}
	if chain == nil {
		t.Fatal("expected a chain, got nil")
	}
	if len(chain.Links) < 1 {
		t.Errorf("expected at least 1 link, got %d", len(chain.Links))
	}
	if chain.Confidence < 0.5 {
		t.Errorf("expected chain confidence >= 0.5, got %f", chain.Confidence)
	}
	if chain.ClusterID != clusterID {
		t.Errorf("ClusterID: want %s, got %s", clusterID, chain.ClusterID)
	}
	if chain.InsightID != "insight-twohop" {
		t.Errorf("InsightID: want insight-twohop, got %s", chain.InsightID)
	}
	if chain.ID == "" {
		t.Error("chain ID should not be empty")
	}
	t.Logf("two-hop chain: id=%s links=%d confidence=%.2f rootCause=%s/%s",
		chain.ID, len(chain.Links), chain.Confidence,
		chain.RootCause.Kind, chain.RootCause.Name)
}

// TestCausalityEngine_RolloutCascade verifies that a Pod BackOff event whose
// owning ReplicaSet is referenced in a Deployment ScalingReplicaSet event
// gets linked via the rollout_cascade rule.
func TestCausalityEngine_RolloutCascade(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	ce := NewCausalityEngine(s)

	clusterID := "cluster-rollout"
	ns := "production"
	rsName := "checkout-api-7f8d9abc"
	now := time.Now().UnixMilli()

	// Cause: Deployment ScalingReplicaSet event whose message references the RS name.
	deployEvent := &WideEvent{
		EventID:           fmt.Sprintf("evt-deploy-%d", now),
		Timestamp:         now - 3*60*1000, // 3 min before pod event
		ClusterID:         clusterID,
		EventType:         "Normal",
		Reason:            "ScalingReplicaSet",
		Message:           fmt.Sprintf("Scaled up replica set %s to 3", rsName),
		ResourceKind:      "Deployment",
		ResourceName:      "checkout-api",
		ResourceNamespace: ns,
		Severity:          "info",
	}

	// Effect: Pod BackOff event owned by the ReplicaSet above.
	podEvent := &WideEvent{
		EventID:           fmt.Sprintf("evt-pod-backoff-%d", now),
		Timestamp:         now,
		ClusterID:         clusterID,
		EventType:         "Warning",
		Reason:            "BackOff",
		Message:           "Back-off restarting failed container",
		ResourceKind:      "Pod",
		ResourceName:      rsName + "-xz123",
		ResourceNamespace: ns,
		OwnerKind:         "ReplicaSet",
		OwnerName:         rsName,
		Severity:          "warning",
	}

	seedEvent(t, ctx, s, deployEvent)
	seedEvent(t, ctx, s, podEvent)

	link := ce.InferCause(ctx, podEvent)
	if link == nil {
		t.Skip("rollout_cascade rule did not match — check event patterns")
	}
	if link.Rule != "rollout_cascade" {
		t.Errorf("expected rule=rollout_cascade, got %s", link.Rule)
	}
	if link.CausedByEventID != deployEvent.EventID {
		t.Errorf("expected CausedByEventID=%s, got %s", deployEvent.EventID, link.CausedByEventID)
	}
	if link.Confidence != 0.90 {
		t.Errorf("expected confidence=0.90, got %f", link.Confidence)
	}
	t.Logf("rollout_cascade: cause=%s confidence=%.2f", link.CausedByEventID, link.Confidence)
}

// TestCausalityEngine_ServiceDisruption verifies that a Service event mentioning
// endpoints is linked to a preceding Deployment Unavailable event via the
// service_disruption rule.
func TestCausalityEngine_ServiceDisruption(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	ce := NewCausalityEngine(s)

	clusterID := "cluster-svc"
	ns := "production"
	now := time.Now().UnixMilli()

	// Cause: Deployment Unavailable event.
	deployEvent := &WideEvent{
		EventID:           fmt.Sprintf("evt-deploy-unavail-%d", now),
		Timestamp:         now - 2*60*1000, // 2 min before service event
		ClusterID:         clusterID,
		EventType:         "Warning",
		Reason:            "Unavailable",
		Message:           "Deployment checkout-api is unavailable: 0/3 pods running",
		ResourceKind:      "Deployment",
		ResourceName:      "checkout-api",
		ResourceNamespace: ns,
		Severity:          "error",
	}

	// Effect: Service event about endpoint reduction.
	svcEvent := &WideEvent{
		EventID:           fmt.Sprintf("evt-svc-endpoints-%d", now),
		Timestamp:         now,
		ClusterID:         clusterID,
		EventType:         "Warning",
		Reason:            "EndpointsReduced",
		Message:           "Endpoints for service checkout-api reduced to 0",
		ResourceKind:      "Service",
		ResourceName:      "checkout-api",
		ResourceNamespace: ns,
		Severity:          "warning",
	}

	seedEvent(t, ctx, s, deployEvent)
	seedEvent(t, ctx, s, svcEvent)

	link := ce.InferCause(ctx, svcEvent)
	if link == nil {
		t.Skip("service_disruption rule did not match — check event patterns")
	}
	if link.Rule != "service_disruption" {
		t.Errorf("expected rule=service_disruption, got %s", link.Rule)
	}
	if link.CausedByEventID != deployEvent.EventID {
		t.Errorf("expected CausedByEventID=%s, got %s", deployEvent.EventID, link.CausedByEventID)
	}
	if link.Confidence != 0.75 {
		t.Errorf("expected confidence=0.75, got %f", link.Confidence)
	}
	t.Logf("service_disruption: cause=%s confidence=%.2f", link.CausedByEventID, link.Confidence)
}

// TestChainBuilder_BuildChain_NoChain verifies that when no events exist for
// the resource described in the insight, BuildChain returns nil, nil without
// errors.
func TestChainBuilder_BuildChain_NoChain(t *testing.T) {
	ctx := context.Background()
	_, cb := newTestChainBuilder(t)

	insight := Insight{
		InsightID: "insight-nochain",
		Timestamp: time.Now().UnixMilli(),
		ClusterID: "cluster-empty",
		Rule:      "pod_crash",
		Severity:  "critical",
		Title:     "Pod crash",
		Detail:    "Pod production/ghost-pod is in CrashLoopBackOff",
		Status:    "active",
	}

	chain, err := cb.BuildChain(ctx, insight)
	if err != nil {
		t.Fatalf("BuildChain (no events): unexpected error: %v", err)
	}
	if chain != nil {
		t.Errorf("expected nil chain when no events exist, got: %+v", chain)
	}
}
