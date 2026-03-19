package events

import (
	"context"
	"fmt"
	"testing"
	"time"

	pb "github.com/kubilitics/kubilitics-ai/api/proto/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestNewEventHandler_NotNil(t *testing.T) {
	h := NewEventHandler()
	if h == nil {
		t.Fatal("NewEventHandler returned nil")
	}
}

func TestHandleEvent_NormalProtoEvent(t *testing.T) {
	h := NewEventHandler()
	ev := &pb.KubernetesEvent{
		Type:    "Normal",
		Reason:  "Started",
		Message: "Pod started successfully",
		InvolvedObject: &pb.ResourceRequest{
			Kind:      "Pod",
			Namespace: "default",
			Name:      "my-pod",
		},
		Count:          1,
		FirstTimestamp: timestamppb.Now(),
		LastTimestamp:  timestamppb.Now(),
	}
	if err := h.HandleEvent(context.Background(), ev); err != nil {
		t.Fatalf("HandleEvent error: %v", err)
	}
	evts, err := h.GetRecentEvents(context.Background(), "default", "Pod", 10)
	if err != nil {
		t.Fatalf("GetRecentEvents error: %v", err)
	}
	if len(evts) == 0 {
		t.Error("Expected at least 1 recent event")
	}
}

func TestHandleEvent_CrashLoopTriggersAnomaly(t *testing.T) {
	h := NewEventHandler()
	ev := &pb.KubernetesEvent{
		Type:    "Warning",
		Reason:  "BackOff",
		Message: "Back-off restarting failed container crashloopbackoff",
		InvolvedObject: &pb.ResourceRequest{
			Kind:      "Pod",
			Namespace: "production",
			Name:      "api-server-0",
		},
		Count:         5,
		LastTimestamp: timestamppb.Now(),
	}
	if err := h.HandleEvent(context.Background(), ev); err != nil {
		t.Fatalf("HandleEvent error: %v", err)
	}
	statsRaw, err := h.GetEventStats(context.Background())
	if err != nil {
		t.Fatalf("GetEventStats error: %v", err)
	}
	stats, ok := statsRaw.(*EventStats)
	if !ok {
		t.Fatalf("Expected *EventStats, got %T", statsRaw)
	}
	if stats.AnomalyCount == 0 {
		t.Error("Expected anomaly to be detected for crashloopbackoff event")
	}
}

func TestHandleEvent_MapEvent(t *testing.T) {
	h := NewEventHandler()
	ev := map[string]interface{}{
		"type":      "Warning",
		"reason":    "OOMKilled",
		"message":   "Container killed due to OOM",
		"namespace": "staging",
		"kind":      "Pod",
		"name":      "worker-pod",
		"count":     int(1),
	}
	if err := h.HandleEvent(context.Background(), ev); err != nil {
		t.Fatalf("HandleEvent map event error: %v", err)
	}
	evts, err := h.GetRecentEvents(context.Background(), "staging", "", 10)
	if err != nil {
		t.Fatalf("GetRecentEvents error: %v", err)
	}
	if len(evts) == 0 {
		t.Error("Expected at least 1 event in staging")
	}
}

func TestGetRecentEvents_Filtering(t *testing.T) {
	h := NewEventHandler()
	for _, ns := range []string{"default", "staging", "production"} {
		ev := map[string]interface{}{
			"type":      "Warning",
			"reason":    "Unhealthy",
			"message":   "Probe failed",
			"namespace": ns,
			"kind":      "Pod",
			"name":      "probe-pod",
		}
		_ = h.HandleEvent(context.Background(), ev)
	}
	evts, _ := h.GetRecentEvents(context.Background(), "staging", "", 100)
	for _, e := range evts {
		if pe, ok := e.(*ProcessedEvent); ok {
			if pe.Namespace != "staging" {
				t.Errorf("Expected namespace=staging, got %s", pe.Namespace)
			}
		}
	}
}

func TestSetAnomalyThreshold(t *testing.T) {
	h := NewEventHandler()
	if err := h.SetAnomalyThreshold(context.Background(), "Pod", 5); err != nil {
		t.Errorf("SetAnomalyThreshold error: %v", err)
	}
	if err := h.SetAnomalyThreshold(context.Background(), "Pod", 0); err == nil {
		t.Error("Expected error for threshold=0")
	}
}

func TestGetEventTimeline(t *testing.T) {
	h := NewEventHandler()
	_ = h.HandleEvent(context.Background(), map[string]interface{}{
		"type": "Warning", "reason": "Evicted", "namespace": "default",
		"kind": "Pod", "name": "pod-1",
	})
	start := time.Now().Add(-1 * time.Minute)
	end := time.Now().Add(1 * time.Minute)
	timeline, err := h.GetEventTimeline(context.Background(), "default", start, end)
	if err != nil {
		t.Fatalf("GetEventTimeline error: %v", err)
	}
	if len(timeline) == 0 {
		t.Error("Expected events in timeline")
	}
}

func TestInvestigationTrigger(t *testing.T) {
	triggered := false
	trigger := func(ctx context.Context, desc, kind, ns, name string) (string, error) {
		triggered = true
		return "inv-001", nil
	}
	h := NewEventHandlerWithTrigger(trigger)
	ev := &pb.KubernetesEvent{
		Type:    "Warning",
		Reason:  "CrashLoopBackOff",
		Message: "Container is in CrashLoopBackOff",
		InvolvedObject: &pb.ResourceRequest{
			Kind: "Pod", Namespace: "prod", Name: "api",
		},
		Count:         3,
		LastTimestamp: timestamppb.Now(),
	}
	if err := h.HandleEvent(context.Background(), ev); err != nil {
		t.Fatalf("HandleEvent error: %v", err)
	}
	if !triggered {
		t.Error("Expected investigation trigger to be called for CrashLoopBackOff")
	}
}

func TestRingBuffer_Overflow(t *testing.T) {
	rb := newRingBuffer(5)
	for i := 0; i < 10; i++ {
		rb.Push(&ProcessedEvent{ID: fmt.Sprintf("ev-%d", i), Reason: "test"})
	}
	snap := rb.Snapshot()
	if len(snap) != 5 {
		t.Errorf("Expected ring size=5 after 10 pushes, got %d", len(snap))
	}
	// The 5 most recent items should be ev-5 through ev-9
	if snap[len(snap)-1].ID != "ev-9" {
		t.Errorf("Expected last item=ev-9, got %s", snap[len(snap)-1].ID)
	}
}

func TestGetEventStats_Counts(t *testing.T) {
	h := NewEventHandler()
	eventsToSend := []interface{}{
		map[string]interface{}{"type": "Normal", "reason": "Started", "namespace": "default", "kind": "Pod", "name": "p1"},
		map[string]interface{}{"type": "Warning", "reason": "Unhealthy", "namespace": "default", "kind": "Pod", "name": "p2"},
		map[string]interface{}{"type": "Warning", "reason": "Unhealthy", "namespace": "staging", "kind": "Pod", "name": "p3"},
	}
	for _, e := range eventsToSend {
		_ = h.HandleEvent(context.Background(), e)
	}
	rawStats, _ := h.GetEventStats(context.Background())
	stats := rawStats.(*EventStats)
	if stats.TotalEvents != 3 {
		t.Errorf("Expected 3 total events, got %d", stats.TotalEvents)
	}
	if stats.WarningEvents != 2 {
		t.Errorf("Expected 2 warning events, got %d", stats.WarningEvents)
	}
}
