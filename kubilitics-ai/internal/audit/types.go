package audit

import "time"

// EventType represents the type of audit event
type EventType string

const (
	// Investigation events
	EventInvestigationStarted   EventType = "investigation.started"
	EventInvestigationCompleted EventType = "investigation.completed"
	EventInvestigationFailed    EventType = "investigation.failed"

	// Action events
	EventActionProposed EventType = "action.proposed"
	EventActionApproved EventType = "action.approved"
	EventActionRejected EventType = "action.rejected"
	EventActionExecuted EventType = "action.executed"
	EventActionFailed   EventType = "action.failed"

	// Configuration events
	EventConfigLoaded  EventType = "config.loaded"
	EventConfigChanged EventType = "config.changed"
	EventConfigReload  EventType = "config.reload"

	// Safety events
	EventSafetyPolicyViolation EventType = "safety.policy_violation"
	EventSafetyRuleEnforced    EventType = "safety.rule_enforced"
	EventAutonomyLevelChanged  EventType = "safety.autonomy_changed"

	// System events
	EventServerStarted  EventType = "system.server_started"
	EventServerShutdown EventType = "system.server_shutdown"
	EventHealthCheck    EventType = "system.health_check"
)

// Result represents the outcome of an audited action
type Result string

const (
	ResultSuccess Result = "success"
	ResultFailure Result = "failure"
	ResultPending Result = "pending"
	ResultDenied  Result = "denied"
)

// Event represents a single audit event
type Event struct {
	// Core fields
	Timestamp     time.Time `json:"timestamp"`
	CorrelationID string    `json:"correlation_id"`
	EventType     EventType `json:"event_type"`
	Result        Result    `json:"result"`

	// Actor information
	User      string `json:"user,omitempty"`
	UserAgent string `json:"user_agent,omitempty"`
	SourceIP  string `json:"source_ip,omitempty"`

	// Resource information
	Resource     string `json:"resource,omitempty"`
	ResourceType string `json:"resource_type,omitempty"`
	Namespace    string `json:"namespace,omitempty"`

	// Action details
	Action      string                 `json:"action,omitempty"`
	Description string                 `json:"description,omitempty"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`

	// Error information
	Error     string `json:"error,omitempty"`
	ErrorCode string `json:"error_code,omitempty"`

	// Duration tracking
	DurationMs int64 `json:"duration_ms,omitempty"`
}

// NewEvent creates a new audit event with default values
func NewEvent(eventType EventType) *Event {
	return &Event{
		Timestamp: time.Now().UTC(),
		EventType: eventType,
		Result:    ResultPending,
		Metadata:  make(map[string]interface{}),
	}
}

// WithCorrelationID sets the correlation ID for event tracking
func (e *Event) WithCorrelationID(id string) *Event {
	e.CorrelationID = id
	return e
}

// WithUser sets the user who triggered the event
func (e *Event) WithUser(user string) *Event {
	e.User = user
	return e
}

// WithResource sets the resource being acted upon
func (e *Event) WithResource(resource, resourceType string) *Event {
	e.Resource = resource
	e.ResourceType = resourceType
	return e
}

// WithAction sets the action being performed
func (e *Event) WithAction(action string) *Event {
	e.Action = action
	return e
}

// WithDescription sets a human-readable description
func (e *Event) WithDescription(desc string) *Event {
	e.Description = desc
	return e
}

// WithResult sets the result of the event
func (e *Event) WithResult(result Result) *Event {
	e.Result = result
	return e
}

// WithError sets error information
func (e *Event) WithError(err error, code string) *Event {
	if err != nil {
		e.Error = err.Error()
		e.ErrorCode = code
		e.Result = ResultFailure
	}
	return e
}

// WithDuration sets the duration in milliseconds
func (e *Event) WithDuration(duration time.Duration) *Event {
	e.DurationMs = duration.Milliseconds()
	return e
}

// WithMetadata adds metadata to the event
func (e *Event) WithMetadata(key string, value interface{}) *Event {
	e.Metadata[key] = value
	return e
}
