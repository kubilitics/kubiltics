package reports

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

const webhookTimeout = 10 * time.Second

// DeliverWebhook sends a resilience report to the given webhook URL.
// It formats the payload based on webhookType ("slack", "teams", "generic").
// Delivery is fire-and-forget with a 10s timeout.
func DeliverWebhook(webhookURL, webhookType string, report *ResilienceReport) error {
	var payload []byte
	var err error

	switch webhookType {
	case "slack":
		payload, err = formatSlack(report)
	case "teams":
		payload, err = formatTeams(report)
	default:
		payload, err = formatGeneric(report)
	}
	if err != nil {
		return fmt.Errorf("formatting %s payload: %w", webhookType, err)
	}

	client := &http.Client{Timeout: webhookTimeout}
	resp, err := client.Post(webhookURL, "application/json", bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("webhook POST failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 300 {
		slog.Warn("webhook returned non-2xx status",
			"url", webhookURL,
			"status", resp.StatusCode,
			"type", webhookType,
		)
		return fmt.Errorf("webhook returned status %d", resp.StatusCode)
	}

	return nil
}

// formatSlack creates a Slack Block Kit payload for the report.
func formatSlack(report *ResilienceReport) ([]byte, error) {
	title := fmt.Sprintf("Kubilitics Resilience Report — %s", report.ClusterName)
	summary := fmt.Sprintf(
		"Health Score: *%d/100* (%s)\nSPOFs: *%d* (%d critical)\nNamespaces at Risk: *%d*",
		report.HealthScore,
		report.HealthLabel,
		report.SPOFCount,
		report.CriticalSPOFs,
		report.NamespacesRisk,
	)

	payload := map[string]interface{}{
		"text": title,
		"blocks": []map[string]interface{}{
			{
				"type": "header",
				"text": map[string]interface{}{
					"type": "plain_text",
					"text": "Resilience Report",
				},
			},
			{
				"type": "section",
				"text": map[string]interface{}{
					"type": "mrkdwn",
					"text": summary,
				},
			},
		},
	}

	return json.Marshal(payload)
}

// formatTeams creates a Microsoft Teams MessageCard payload for the report.
func formatTeams(report *ResilienceReport) ([]byte, error) {
	payload := map[string]interface{}{
		"@type":   "MessageCard",
		"summary": "Kubilitics Resilience Report",
		"themeColor": healthColor(report.HealthScore),
		"sections": []map[string]interface{}{
			{
				"activityTitle": fmt.Sprintf("Resilience Report — %s", report.ClusterName),
				"facts": []map[string]interface{}{
					{"name": "Health Score", "value": fmt.Sprintf("%d/100 (%s)", report.HealthScore, report.HealthLabel)},
					{"name": "SPOFs", "value": fmt.Sprintf("%d (%d critical)", report.SPOFCount, report.CriticalSPOFs)},
					{"name": "Namespaces at Risk", "value": fmt.Sprintf("%d", report.NamespacesRisk)},
				},
			},
		},
	}

	return json.Marshal(payload)
}

// formatGeneric posts the full ResilienceReport JSON.
func formatGeneric(report *ResilienceReport) ([]byte, error) {
	return json.Marshal(report)
}

// healthColor returns a hex color for Teams theme based on health score.
func healthColor(score int) string {
	if score >= 80 {
		return "00CC00" // green
	}
	if score >= 50 {
		return "FFAA00" // amber
	}
	return "CC0000" // red
}
