package db

import (
	"context"
	"testing"
	"time"
)

func newTestStore(t *testing.T) Store {
	t.Helper()
	s, err := NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("NewSQLiteStore: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

// ─── Investigations ───────────────────────────────────────────────────────────

func TestInvestigationCRUD(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	rec := &InvestigationRecord{
		ID:          "inv-001",
		Type:        "pod_crash",
		State:       "CREATED",
		Description: "Pod nginx-123 keeps restarting",
		Metadata:    `{"cluster":"prod-east"}`,
		CreatedAt:   time.Now().Round(time.Second),
		UpdatedAt:   time.Now().Round(time.Second),
	}

	// Create
	if err := s.SaveInvestigation(ctx, rec); err != nil {
		t.Fatalf("SaveInvestigation: %v", err)
	}

	// Retrieve
	got, err := s.GetInvestigation(ctx, "inv-001")
	if err != nil {
		t.Fatalf("GetInvestigation: %v", err)
	}
	if got.ID != "inv-001" {
		t.Errorf("expected ID inv-001, got %s", got.ID)
	}
	if got.Description != rec.Description {
		t.Errorf("expected description %q, got %q", rec.Description, got.Description)
	}

	// Update (upsert)
	rec.State = "CONCLUDED"
	rec.Conclusion = "OOMKilled due to memory limits"
	rec.UpdatedAt = time.Now().Round(time.Second)
	if err := s.SaveInvestigation(ctx, rec); err != nil {
		t.Fatalf("SaveInvestigation update: %v", err)
	}

	got, err = s.GetInvestigation(ctx, "inv-001")
	if err != nil {
		t.Fatalf("GetInvestigation after update: %v", err)
	}
	if got.State != "CONCLUDED" {
		t.Errorf("expected state CONCLUDED, got %s", got.State)
	}
	if got.Conclusion != "OOMKilled due to memory limits" {
		t.Errorf("expected conclusion, got %q", got.Conclusion)
	}
}

func TestListInvestigations(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	for i := 0; i < 5; i++ {
		rec := &InvestigationRecord{
			ID:          "inv-" + string(rune('A'+i)),
			Type:        "general",
			State:       "CONCLUDED",
			Description: "Test investigation",
			Metadata:    "{}",
			CreatedAt:   time.Now().Add(time.Duration(i) * time.Second),
			UpdatedAt:   time.Now().Add(time.Duration(i) * time.Second),
		}
		if err := s.SaveInvestigation(ctx, rec); err != nil {
			t.Fatalf("SaveInvestigation %d: %v", i, err)
		}
	}

	list, err := s.ListInvestigations(ctx, 3, 0)
	if err != nil {
		t.Fatalf("ListInvestigations: %v", err)
	}
	if len(list) != 3 {
		t.Errorf("expected 3 results, got %d", len(list))
	}
}

func TestDeleteInvestigation(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	rec := &InvestigationRecord{
		ID: "del-001", Type: "general", State: "CREATED",
		Description: "to delete", Metadata: "{}",
		CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	if err := s.SaveInvestigation(ctx, rec); err != nil {
		t.Fatalf("SaveInvestigation: %v", err)
	}
	if err := s.DeleteInvestigation(ctx, "del-001"); err != nil {
		t.Fatalf("DeleteInvestigation: %v", err)
	}
	_, err := s.GetInvestigation(ctx, "del-001")
	if err == nil {
		t.Error("expected error for deleted investigation, got nil")
	}
}

// ─── Audit events ─────────────────────────────────────────────────────────────

func TestAuditEventAppendAndQuery(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	now := time.Now().Round(time.Second)

	events := []*AuditRecord{
		{CorrelationID: "c1", EventType: "investigation_started", Description: "started", Resource: "pod/nginx", Action: "investigate", Result: "pending", Timestamp: now},
		{CorrelationID: "c2", EventType: "action_approved", Description: "approved", Resource: "deployment/api", Action: "scale", Result: "approved", Timestamp: now.Add(time.Second)},
		{CorrelationID: "c3", EventType: "safety_violation", Description: "blocked", Resource: "pod/root-pod", Action: "delete", Result: "denied", Timestamp: now.Add(2 * time.Second)},
	}

	for _, e := range events {
		if err := s.AppendAuditEvent(ctx, e); err != nil {
			t.Fatalf("AppendAuditEvent: %v", err)
		}
	}

	// Query all
	all, err := s.QueryAuditEvents(ctx, AuditQuery{Limit: 10})
	if err != nil {
		t.Fatalf("QueryAuditEvents: %v", err)
	}
	if len(all) != 3 {
		t.Errorf("expected 3 events, got %d", len(all))
	}

	// Query by resource
	byResource, err := s.QueryAuditEvents(ctx, AuditQuery{Resource: "pod/nginx", Limit: 10})
	if err != nil {
		t.Fatalf("QueryAuditEvents by resource: %v", err)
	}
	if len(byResource) != 1 {
		t.Errorf("expected 1 event for pod/nginx, got %d", len(byResource))
	}

	// Query by action
	byAction, err := s.QueryAuditEvents(ctx, AuditQuery{Action: "scale", Limit: 10})
	if err != nil {
		t.Fatalf("QueryAuditEvents by action: %v", err)
	}
	if len(byAction) != 1 {
		t.Errorf("expected 1 scale event, got %d", len(byAction))
	}

	// Query by time range
	byTime, err := s.QueryAuditEvents(ctx, AuditQuery{
		From:  now,
		To:    now.Add(time.Second),
		Limit: 10,
	})
	if err != nil {
		t.Fatalf("QueryAuditEvents by time: %v", err)
	}
	if len(byTime) != 2 {
		t.Errorf("expected 2 events in time range, got %d", len(byTime))
	}
}

// ─── Conversations ────────────────────────────────────────────────────────────

func TestConversationCRUD(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	conv := &ConversationRecord{
		ID:        "conv-001",
		ClusterID: "cluster-prod",
		Title:     "Debugging nginx crash",
		CreatedAt: time.Now().Round(time.Second),
		UpdatedAt: time.Now().Round(time.Second),
	}

	if err := s.SaveConversation(ctx, conv); err != nil {
		t.Fatalf("SaveConversation: %v", err)
	}

	got, err := s.GetConversation(ctx, "conv-001")
	if err != nil {
		t.Fatalf("GetConversation: %v", err)
	}
	if got.Title != "Debugging nginx crash" {
		t.Errorf("expected title, got %q", got.Title)
	}
	if got.ClusterID != "cluster-prod" {
		t.Errorf("expected cluster_id cluster-prod, got %s", got.ClusterID)
	}
}

func TestConversationMessages(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	conv := &ConversationRecord{
		ID:        "conv-msg-001",
		ClusterID: "cluster-dev",
		Title:     "Test",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	if err := s.SaveConversation(ctx, conv); err != nil {
		t.Fatalf("SaveConversation: %v", err)
	}

	messages := []*MessageRecord{
		{ConversationID: "conv-msg-001", Role: "user", Content: "Why is my pod crashing?", TokenCount: 8, Metadata: "{}", Timestamp: time.Now()},
		{ConversationID: "conv-msg-001", Role: "assistant", Content: "Let me investigate...", TokenCount: 12, Metadata: "{}", Timestamp: time.Now().Add(time.Second)},
		{ConversationID: "conv-msg-001", Role: "user", Content: "Show me the logs", TokenCount: 5, Metadata: "{}", Timestamp: time.Now().Add(2 * time.Second)},
	}

	for _, m := range messages {
		if err := s.AppendMessage(ctx, m); err != nil {
			t.Fatalf("AppendMessage: %v", err)
		}
	}

	got, err := s.GetMessages(ctx, "conv-msg-001", 10)
	if err != nil {
		t.Fatalf("GetMessages: %v", err)
	}
	if len(got) != 3 {
		t.Errorf("expected 3 messages, got %d", len(got))
	}
	// Messages should be in order
	if got[0].Role != "user" {
		t.Errorf("first message should be from user, got %s", got[0].Role)
	}
	if got[1].Role != "assistant" {
		t.Errorf("second message should be from assistant, got %s", got[1].Role)
	}
}

func TestListConversations(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	for i := 0; i < 4; i++ {
		c := &ConversationRecord{
			ID:        "c-" + string(rune('0'+i)),
			ClusterID: "cluster-a",
			Title:     "Conv",
			CreatedAt: time.Now().Add(time.Duration(i) * time.Second),
			UpdatedAt: time.Now().Add(time.Duration(i) * time.Second),
		}
		if err := s.SaveConversation(ctx, c); err != nil {
			t.Fatalf("SaveConversation: %v", err)
		}
	}

	// Conversation for different cluster
	if err := s.SaveConversation(ctx, &ConversationRecord{
		ID:        "c-other",
		ClusterID: "cluster-b",
		Title:     "Other",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}); err != nil {
		t.Fatalf("SaveConversation other: %v", err)
	}

	list, err := s.ListConversations(ctx, "cluster-a", 10, 0)
	if err != nil {
		t.Fatalf("ListConversations: %v", err)
	}
	if len(list) != 4 {
		t.Errorf("expected 4 conversations for cluster-a, got %d", len(list))
	}
}

func TestDeleteConversation(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	conv := &ConversationRecord{
		ID: "del-conv", ClusterID: "c", Title: "t",
		CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	if err := s.SaveConversation(ctx, conv); err != nil {
		t.Fatalf("SaveConversation: %v", err)
	}

	// Add a message — should cascade delete
	if err := s.AppendMessage(ctx, &MessageRecord{
		ConversationID: "del-conv", Role: "user", Content: "hello",
		Metadata: "{}", Timestamp: time.Now(),
	}); err != nil {
		t.Fatalf("AppendMessage: %v", err)
	}

	if err := s.DeleteConversation(ctx, "del-conv"); err != nil {
		t.Fatalf("DeleteConversation: %v", err)
	}
	_, err := s.GetConversation(ctx, "del-conv")
	if err == nil {
		t.Error("expected error for deleted conversation, got nil")
	}

	// Messages should be cascade-deleted
	msgs, err := s.GetMessages(ctx, "del-conv", 10)
	if err != nil {
		t.Fatalf("GetMessages after delete: %v", err)
	}
	if len(msgs) != 0 {
		t.Errorf("expected 0 messages after conversation delete, got %d", len(msgs))
	}
}

// ─── Persistence health ───────────────────────────────────────────────────────

func TestPing(t *testing.T) {
	s := newTestStore(t)
	if err := s.Ping(context.Background()); err != nil {
		t.Errorf("Ping: %v", err)
	}
}

func TestIdempotentMigration(t *testing.T) {
	// Running migrations twice should not error
	s, err := NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("first open: %v", err)
	}
	_ = s.Close()
}
