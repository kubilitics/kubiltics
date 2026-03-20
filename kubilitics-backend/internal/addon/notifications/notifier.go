// Package notifications implements the webhook notification system for the Kubilitics
// Add-on Platform (T8.11). It fires JSON POST requests to registered endpoints whenever
// an addon install, upgrade, uninstall, failure, or health change occurs.
package notifications

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// Notifier delivers NotifyEvent payloads to all enabled channels that have subscribed
// to the event type. Deliveries are fire-and-forget in a goroutine so they never block
// the calling operation.
type Notifier struct {
	channels func(ctx context.Context) ([]models.NotificationChannel, error)
	client   *http.Client
	logger   *slog.Logger
}

// NewNotifier creates a Notifier backed by the given channel loader (typically the
// notification repository ListChannels method).
func NewNotifier(
	channelLoader func(ctx context.Context) ([]models.NotificationChannel, error),
	logger *slog.Logger,
) *Notifier {
	if logger == nil {
		logger = slog.Default()
	}
	return &Notifier{
		channels: channelLoader,
		client:   &http.Client{Timeout: 5 * time.Second},
		logger:   logger,
	}
}

// Notify dispatches the event to all enabled channels that subscribe to ev.EventType.
// Delivery is asynchronous — this method returns immediately.
func (n *Notifier) Notify(ev models.NotifyEvent) {
	if ev.OccurredAt == "" {
		ev.OccurredAt = time.Now().UTC().Format(time.RFC3339)
	}
	go n.deliver(ev)
}

// deliver is the internal synchronous delivery routine, called from a goroutine.
func (n *Notifier) deliver(ev models.NotifyEvent) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	channels, err := n.channels(ctx)
	if err != nil {
		n.logger.Warn("notifications: failed to load channels", "err", err)
		return
	}

	for _, ch := range channels {
		if !ch.Enabled {
			continue
		}
		if !subscribes(ch.Events, ev.EventType) {
			continue
		}
		if err := n.send(ctx, ch, ev); err != nil {
			n.logger.Warn("notifications: delivery failed",
				"channel_id", ch.ID,
				"channel_type", ch.Type,
				"event_type", ev.EventType,
				"err", err,
			)
		}
	}
}

// send posts the event to a single channel, adapting the payload format for Slack vs generic.
func (n *Notifier) send(ctx context.Context, ch models.NotificationChannel, ev models.NotifyEvent) error {
	var payload interface{}

	switch ch.Type {
	case models.NotificationChannelSlack:
		// Slack expects {"text": "..."} with optional markdown.
		text := fmt.Sprintf("*[Kubilitics/%s]* `%s` on cluster `%s`", ev.EventType, ev.AddonID, ev.ClusterID)
		if ev.Message != "" {
			text += "\n> " + ev.Message
		}
		payload = map[string]string{"text": text}

	default: // "webhook" — send the full NotifyEvent JSON.
		payload = ev
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ch.URL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Kubilitics-Notifier/1.0")

	resp, err := n.client.Do(req)
	if err != nil {
		return fmt.Errorf("http post: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("unexpected status %d from webhook", resp.StatusCode)
	}
	return nil
}

// subscribes returns true if the events list contains the given eventType,
// or if the list is empty (meaning "all events").
func subscribes(events []string, eventType string) bool {
	if len(events) == 0 {
		return true
	}
	for _, e := range events {
		if e == eventType || e == "*" {
			return true
		}
	}
	return false
}
