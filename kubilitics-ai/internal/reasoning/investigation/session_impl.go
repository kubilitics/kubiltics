package investigation

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/kubilitics/kubilitics-ai/internal/audit"
)

// investigationSessionImpl implements InvestigationSession interface
type investigationSessionImpl struct {
	auditLog audit.Logger

	// In-memory storage for investigations
	mu             sync.RWMutex
	investigations map[string]*Investigation
}

// ToolCall represents a single tool invocation during investigation
type ToolCall struct {
	ToolName  string        `json:"tool_name"`
	Args      interface{}   `json:"args"`
	Result    interface{}   `json:"result"`
	Timestamp time.Time     `json:"timestamp"`
	Duration  time.Duration `json:"duration"`
}

// Finding represents a single finding with evidence
type Finding struct {
	Statement  string      `json:"statement"`
	Evidence   interface{} `json:"evidence"`
	Confidence int         `json:"confidence"`
	Timestamp  time.Time   `json:"timestamp"`
}

// Hypothesis represents a hypothesis being investigated
type Hypothesis struct {
	Statement  string    `json:"statement"`
	Confidence int       `json:"confidence"`
	Rationale  string    `json:"rationale"`
	Timestamp  time.Time `json:"timestamp"`
}

// Conclusion represents the final analysis
type Conclusion struct {
	RootCause  string    `json:"root_cause"`
	Impact     string    `json:"impact"`
	Evidence   []Finding `json:"evidence"`
	Confidence int       `json:"confidence"`
	Timestamp  time.Time `json:"timestamp"`
}

// NewInvestigationSession creates a new investigation session manager
func NewInvestigationSession(auditLog audit.Logger) InvestigationSession {
	if auditLog == nil {
		panic("audit logger is required")
	}

	return &investigationSessionImpl{
		auditLog:       auditLog,
		investigations: make(map[string]*Investigation),
	}
}

// CreateInvestigation initializes a new investigation session
func (s *investigationSessionImpl) CreateInvestigation(ctx context.Context, itype InvestigationType, description string, userID string) (*Investigation, error) {
	if description == "" {
		return nil, fmt.Errorf("description is required")
	}

	id := uuid.New().String()
	now := time.Now()

	inv := &Investigation{
		ID:             id,
		Type:           itype,
		State:          StateCreated,
		CreatedAt:      now,
		UserID:         userID,
		Description:    description,
		ToolCalls:      make([]interface{}, 0),
		Findings:       make([]interface{}, 0),
		Actions:        make([]interface{}, 0),
		TimeoutSeconds: 300, // 5 minutes default
		CorrelationID:  audit.GenerateCorrelationID(),
	}

	s.mu.Lock()
	s.investigations[id] = inv
	s.mu.Unlock()

	// Log to audit
	s.auditLog.Log(ctx, audit.NewEvent(audit.EventInvestigationStarted).
		WithCorrelationID(inv.CorrelationID).
		WithDescription(fmt.Sprintf("Investigation %s created: %s", id, description)).
		WithResult(audit.ResultSuccess))

	return inv, nil
}

// GetInvestigation retrieves investigation by ID
func (s *investigationSessionImpl) GetInvestigation(ctx context.Context, id string) (*Investigation, error) {
	s.mu.RLock()
	inv, exists := s.investigations[id]
	s.mu.RUnlock()

	if !exists {
		return nil, fmt.Errorf("investigation not found: %s", id)
	}

	return inv, nil
}

// UpdateState transitions investigation to a new state
func (s *investigationSessionImpl) UpdateState(ctx context.Context, id string, newState InvestigationState) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	inv, exists := s.investigations[id]
	if !exists {
		return fmt.Errorf("investigation not found: %s", id)
	}

	// Validate state transition
	if err := validateStateTransition(inv.State, newState); err != nil {
		return err
	}

	oldState := inv.State
	inv.State = newState

	// Update timestamps based on state
	switch newState {
	case StateInvestigating:
		inv.StartedAt = time.Now()
	case StateConcluded, StateCancelled:
		inv.ConcludedAt = time.Now()
	}

	// Log state change
	s.auditLog.Log(ctx, audit.NewEvent(audit.EventInvestigationCompleted).
		WithCorrelationID(inv.CorrelationID).
		WithDescription(fmt.Sprintf("Investigation %s state: %s → %s", id, oldState, newState)).
		WithResult(audit.ResultSuccess))

	return nil
}

// validateStateTransition checks if a state transition is valid
func validateStateTransition(from, to InvestigationState) error {
	validTransitions := map[InvestigationState][]InvestigationState{
		StateCreated:       {StateInvestigating, StateCancelled},
		StateInvestigating: {StateConcluded, StateCancelled},
		StateConcluded:     {StateArchived},
		StateCancelled:     {StateArchived},
		StateArchived:      {}, // Terminal state
	}

	allowedStates, ok := validTransitions[from]
	if !ok {
		return fmt.Errorf("invalid current state: %s", from)
	}

	for _, allowed := range allowedStates {
		if allowed == to {
			return nil
		}
	}

	return fmt.Errorf("invalid state transition: %s → %s", from, to)
}

// AddHypothesis adds a hypothesis to the investigation
func (s *investigationSessionImpl) AddHypothesis(ctx context.Context, id string, hypothesis interface{}) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	inv, exists := s.investigations[id]
	if !exists {
		return fmt.Errorf("investigation not found: %s", id)
	}

	inv.Hypothesis = hypothesis

	s.auditLog.Log(ctx, audit.NewEvent(audit.EventInvestigationStarted).
		WithCorrelationID(inv.CorrelationID).
		WithDescription(fmt.Sprintf("Investigation %s hypothesis updated", id)).
		WithResult(audit.ResultSuccess))

	return nil
}

// AddToolCall records a tool call
func (s *investigationSessionImpl) AddToolCall(ctx context.Context, id string, toolName string, args interface{}, result interface{}) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	inv, exists := s.investigations[id]
	if !exists {
		return fmt.Errorf("investigation not found: %s", id)
	}

	toolCall := ToolCall{
		ToolName:  toolName,
		Args:      args,
		Result:    result,
		Timestamp: time.Now(),
	}

	inv.ToolCalls = append(inv.ToolCalls, toolCall)

	return nil
}

// AddFinding records a finding with evidence and confidence
func (s *investigationSessionImpl) AddFinding(ctx context.Context, id string, statement string, evidence interface{}, confidence int) error {
	if confidence < 0 || confidence > 100 {
		return fmt.Errorf("confidence must be between 0 and 100, got %d", confidence)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	inv, exists := s.investigations[id]
	if !exists {
		return fmt.Errorf("investigation not found: %s", id)
	}

	finding := Finding{
		Statement:  statement,
		Evidence:   evidence,
		Confidence: confidence,
		Timestamp:  time.Now(),
	}

	inv.Findings = append(inv.Findings, finding)

	s.auditLog.Log(ctx, audit.NewEvent(audit.EventInvestigationStarted).
		WithCorrelationID(inv.CorrelationID).
		WithDescription(fmt.Sprintf("Investigation %s finding added: %s (confidence: %d%%)", id, statement, confidence)).
		WithResult(audit.ResultSuccess))

	return nil
}

// SetConclusion sets the final conclusion
func (s *investigationSessionImpl) SetConclusion(ctx context.Context, id string, conclusion interface{}, confidence int) error {
	if confidence < 0 || confidence > 100 {
		return fmt.Errorf("confidence must be between 0 and 100, got %d", confidence)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	inv, exists := s.investigations[id]
	if !exists {
		return fmt.Errorf("investigation not found: %s", id)
	}

	inv.Conclusion = conclusion
	inv.Confidence = confidence

	s.auditLog.Log(ctx, audit.NewEvent(audit.EventInvestigationCompleted).
		WithCorrelationID(inv.CorrelationID).
		WithDescription(fmt.Sprintf("Investigation %s concluded (confidence: %d%%)", id, confidence)).
		WithResult(audit.ResultSuccess))

	return nil
}

// AddAction associates an action with the investigation
func (s *investigationSessionImpl) AddAction(ctx context.Context, id string, actionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	inv, exists := s.investigations[id]
	if !exists {
		return fmt.Errorf("investigation not found: %s", id)
	}

	inv.Actions = append(inv.Actions, actionID)

	s.auditLog.Log(ctx, audit.NewEvent(audit.EventActionProposed).
		WithCorrelationID(inv.CorrelationID).
		WithDescription(fmt.Sprintf("Investigation %s action proposed: %s", id, actionID)).
		WithResult(audit.ResultSuccess))

	return nil
}

// CancelInvestigation cancels an in-progress investigation
func (s *investigationSessionImpl) CancelInvestigation(ctx context.Context, id string) error {
	return s.UpdateState(ctx, id, StateCancelled)
}

// ArchiveInvestigation moves investigation to archived state
func (s *investigationSessionImpl) ArchiveInvestigation(ctx context.Context, id string) error {
	return s.UpdateState(ctx, id, StateArchived)
}

// ListInvestigations returns investigations matching filter criteria
func (s *investigationSessionImpl) ListInvestigations(ctx context.Context, filter interface{}) ([]Investigation, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]Investigation, 0, len(s.investigations))
	for _, inv := range s.investigations {
		// TODO: Apply filter when filter type is defined
		result = append(result, *inv)
	}

	return result, nil
}
