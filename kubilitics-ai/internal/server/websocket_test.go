package server

import (
	"testing"

	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
)

func TestBuildMessagesWithHistory_NilStore(t *testing.T) {
	incoming := []types.Message{{Role: "user", Content: "hello"}}
	result := buildMessagesWithHistory(nil, "conv-1", incoming)
	if len(result) != 1 {
		t.Errorf("expected 1 msg, got %d", len(result))
	}
	if result[0].Content != "hello" {
		t.Errorf("expected 'hello', got %q", result[0].Content)
	}
}

func TestBuildMessagesWithHistory_EmptyHistory(t *testing.T) {
	cs := NewConversationStore()
	incoming := []types.Message{{Role: "user", Content: "hello"}}
	result := buildMessagesWithHistory(cs, "nonexistent", incoming)
	if len(result) != 1 || result[0].Content != "hello" {
		t.Errorf("unexpected result: %+v", result)
	}
}

func TestBuildMessagesWithHistory_PrependsPriorTurns(t *testing.T) {
	cs := NewConversationStore()
	conv := cs.CreateConversation(nil)
	_ = cs.AddMessage(conv.ID, "user", "what is a pod?", nil)
	_ = cs.AddMessage(conv.ID, "assistant", "A pod is the smallest deployable unit in Kubernetes.", nil)
	// Simulate: user just added their new message
	_ = cs.AddMessage(conv.ID, "user", "and a deployment?", nil)

	incoming := []types.Message{{Role: "user", Content: "and a deployment?"}}
	result := buildMessagesWithHistory(cs, conv.ID, incoming)

	// Should have: [user: what is a pod?, assistant: A pod is..., user: and a deployment?]
	if len(result) != 3 {
		t.Errorf("expected 3 messages (2 history + 1 incoming), got %d: %+v", len(result), result)
	}
	if result[0].Role != "user" || result[0].Content != "what is a pod?" {
		t.Errorf("unexpected first message: %+v", result[0])
	}
	if result[1].Role != "assistant" {
		t.Errorf("unexpected second message: %+v", result[1])
	}
	if result[2].Content != "and a deployment?" {
		t.Errorf("unexpected last message: %+v", result[2])
	}
}

func TestBuildMessagesWithHistory_RollingWindowCap(t *testing.T) {
	cs := NewConversationStore()
	conv := cs.CreateConversation(nil)

	// Add maxHistoryMessages+5 messages (11+5=16 message turns before the new user msg)
	for i := 0; i < maxHistoryMessages+5; i++ {
		_ = cs.AddMessage(conv.ID, "user", "message", nil)
		_ = cs.AddMessage(conv.ID, "assistant", "response", nil)
	}
	// The last entry in history will be an assistant message, then we add a new user
	_ = cs.AddMessage(conv.ID, "user", "new question", nil)

	incoming := []types.Message{{Role: "user", Content: "new question"}}
	result := buildMessagesWithHistory(cs, conv.ID, incoming)

	// Should be capped: at most maxHistoryMessages history msgs + 1 incoming
	if len(result) > maxHistoryMessages+1 {
		t.Errorf("expected at most %d messages, got %d", maxHistoryMessages+1, len(result))
	}
}

func TestBuildMessagesWithHistory_CharacterBudget(t *testing.T) {
	cs := NewConversationStore()
	conv := cs.CreateConversation(nil)

	// Add messages that together exceed historyCharBudget
	bigContent := string(make([]byte, historyCharBudget/2+1)) // half budget + 1
	_ = cs.AddMessage(conv.ID, "user", bigContent, nil)
	_ = cs.AddMessage(conv.ID, "assistant", bigContent, nil)
	_ = cs.AddMessage(conv.ID, "user", "new question", nil)

	incoming := []types.Message{{Role: "user", Content: "new question"}}
	result := buildMessagesWithHistory(cs, conv.ID, incoming)

	// Total chars of history must not exceed historyCharBudget
	totalChars := 0
	for _, m := range result[:len(result)-1] { // exclude incoming
		totalChars += len(m.Content)
	}
	if totalChars > historyCharBudget {
		t.Errorf("history chars %d exceed budget %d", totalChars, historyCharBudget)
	}
}

func TestConversationStore_CreateAndGet(t *testing.T) {
	cs := NewConversationStore()
	conv := cs.CreateConversation(map[string]interface{}{"namespace": "default"})
	if conv.ID == "" {
		t.Fatal("expected non-empty ID")
	}

	got, err := cs.GetConversation(conv.ID)
	if err != nil {
		t.Fatalf("GetConversation error: %v", err)
	}
	if got.ID != conv.ID {
		t.Errorf("expected ID %s, got %s", conv.ID, got.ID)
	}
}

func TestConversationStore_AddAndListMessages(t *testing.T) {
	cs := NewConversationStore()
	conv := cs.CreateConversation(nil)

	_ = cs.AddMessage(conv.ID, "user", "hello", nil)
	_ = cs.AddMessage(conv.ID, "assistant", "world", nil)

	got, _ := cs.GetConversation(conv.ID)
	if len(got.Messages) != 2 {
		t.Errorf("expected 2 messages, got %d", len(got.Messages))
	}
	if got.Messages[0].Role != "user" || got.Messages[0].Content != "hello" {
		t.Errorf("unexpected message[0]: %+v", got.Messages[0])
	}
}

func TestConversationStore_Delete(t *testing.T) {
	cs := NewConversationStore()
	conv := cs.CreateConversation(nil)
	_ = cs.AddMessage(conv.ID, "user", "test", nil)

	if err := cs.DeleteConversation(conv.ID); err != nil {
		t.Fatalf("DeleteConversation error: %v", err)
	}

	_, err := cs.GetConversation(conv.ID)
	if err == nil {
		t.Error("expected error after deletion, got nil")
	}
}

func TestConversationStore_DeleteNonExistent(t *testing.T) {
	cs := NewConversationStore()
	err := cs.DeleteConversation("does-not-exist")
	if err == nil {
		t.Error("expected error for non-existent conversation")
	}
}

func TestConversationStore_AddMessageNonExistent(t *testing.T) {
	cs := NewConversationStore()
	err := cs.AddMessage("does-not-exist", "user", "hello", nil)
	if err == nil {
		t.Error("expected error for non-existent conversation")
	}
}
