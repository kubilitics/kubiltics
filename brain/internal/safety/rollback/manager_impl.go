package rollback

// Package rollback — concrete RollbackManager implementation.

import (
	"context"
	"fmt"
	"sync"
	"time"
)

type monitoringSession struct {
	actionID  string
	action    interface{}
	baseline  interface{}
	status    string
	startedAt time.Time
}

type rollbackEntry struct {
	actionID   string
	reason     string
	rolledBack bool
	timestamp  time.Time
}

type rollbackManagerImpl struct {
	mu         sync.RWMutex
	sessions   map[string]*monitoringSession
	history    []rollbackEntry
	thresholds map[string]float64
}

// NewRollbackManager creates a new rollback manager.
func NewRollbackManager() RollbackManager {
	return &rollbackManagerImpl{
		sessions: make(map[string]*monitoringSession),
		history:  []rollbackEntry{},
		thresholds: map[string]float64{
			"error_rate":   0.05, // 5% error rate increase triggers rollback
			"availability": 0.02, // 2% availability drop
			"latency_p99":  0.20, // 20% latency increase
		},
	}
}

func (m *rollbackManagerImpl) MonitorAction(_ context.Context, actionID string, action interface{}, baseline interface{}) (string, error) {
	sessionID := fmt.Sprintf("monitor-%s-%d", actionID, time.Now().UnixNano())
	m.mu.Lock()
	m.sessions[sessionID] = &monitoringSession{
		actionID:  actionID,
		action:    action,
		baseline:  baseline,
		status:    "monitoring",
		startedAt: time.Now(),
	}
	m.mu.Unlock()
	return sessionID, nil
}

func (m *rollbackManagerImpl) StopMonitoring(_ context.Context, sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.sessions[sessionID]; !ok {
		return fmt.Errorf("monitoring session not found: %s", sessionID)
	}
	m.sessions[sessionID].status = "complete"
	return nil
}

func (m *rollbackManagerImpl) GetMonitoringStatus(_ context.Context, sessionID string) (interface{}, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	session, ok := m.sessions[sessionID]
	if !ok {
		return nil, fmt.Errorf("monitoring session not found: %s", sessionID)
	}
	return map[string]interface{}{
		"session_id": sessionID,
		"action_id":  session.actionID,
		"status":     session.status,
		"started_at": session.startedAt,
		"duration":   time.Since(session.startedAt).String(),
	}, nil
}

func (m *rollbackManagerImpl) TriggerRollback(_ context.Context, actionID string, reason string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.history = append(m.history, rollbackEntry{
		actionID:   actionID,
		reason:     reason,
		rolledBack: false, // actual rollback would call backend
		timestamp:  time.Now(),
	})
	return nil
}

func (m *rollbackManagerImpl) RollbackAction(_ context.Context, actionID string) (bool, string, error) {
	// In a full implementation, this would call the backend proxy to revert the action.
	// For now, record the intent and return a plan description.
	m.mu.Lock()
	m.history = append(m.history, rollbackEntry{
		actionID:   actionID,
		reason:     "manual rollback",
		rolledBack: true,
		timestamp:  time.Now(),
	})
	m.mu.Unlock()
	return true, fmt.Sprintf("Rollback of action %s recorded — execute via kubectl or dashboard", actionID), nil
}

func (m *rollbackManagerImpl) GetRollbackHistory(_ context.Context, limit int) ([]interface{}, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	start := 0
	if limit > 0 && len(m.history) > limit {
		start = len(m.history) - limit
	}
	result := make([]interface{}, 0, len(m.history)-start)
	for _, e := range m.history[start:] {
		result = append(result, map[string]interface{}{
			"action_id":   e.actionID,
			"reason":      e.reason,
			"rolled_back": e.rolledBack,
			"timestamp":   e.timestamp,
		})
	}
	return result, nil
}

func (m *rollbackManagerImpl) AnalyzeRollbackPatterns(_ context.Context) (interface{}, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	reasonCounts := map[string]int{}
	for _, e := range m.history {
		reasonCounts[e.reason]++
	}
	return map[string]interface{}{
		"total_rollbacks":  len(m.history),
		"reason_breakdown": reasonCounts,
	}, nil
}

func (m *rollbackManagerImpl) SetDegradationThreshold(_ context.Context, metric string, threshold float64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.thresholds[metric] = threshold
	return nil
}
