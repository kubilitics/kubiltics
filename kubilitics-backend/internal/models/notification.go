package models

import "time"

// NotificationChannelType identifies the transport format for a notification channel.
type NotificationChannelType string

const (
	NotificationChannelWebhook NotificationChannelType = "webhook"
	NotificationChannelSlack   NotificationChannelType = "slack"
)

// NotificationChannel is a configured endpoint that receives addon lifecycle events.
type NotificationChannel struct {
	ID   string                  `json:"id"         db:"id"`
	Name string                  `json:"name"       db:"name"`
	Type NotificationChannelType `json:"type"       db:"type"`
	URL  string                  `json:"url"        db:"url"`
	// Events is the set of event names this channel subscribes to.
	// Recognised values: "install", "upgrade", "uninstall", "failed", "health_change".
	Events    []string  `json:"events"     db:"-"`
	EventsRaw string    `json:"-"          db:"events"` // JSON-encoded, stored in DB
	Enabled   bool      `json:"enabled"    db:"-"`
	EnabledDB int       `json:"-"          db:"enabled"` // 0/1 in SQLite
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// NotifyEvent is the payload delivered to each registered channel.
type NotifyEvent struct {
	// EventType is the short name, e.g. "install", "upgrade", "failed".
	EventType   string `json:"event_type"`
	AddonID     string `json:"addon_id"`
	ClusterID   string `json:"cluster_id"`
	ReleaseName string `json:"release_name,omitempty"`
	Namespace   string `json:"namespace,omitempty"`
	Version     string `json:"version,omitempty"`
	Actor       string `json:"actor,omitempty"`
	Message     string `json:"message,omitempty"`
	// OccurredAt is the server-side timestamp of the event.
	OccurredAt string `json:"occurred_at"`
}
