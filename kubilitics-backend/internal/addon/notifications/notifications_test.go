package notifications

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
)

func TestNotifier_Notify_Webhook(t *testing.T) {
	var wg sync.WaitGroup
	wg.Add(1)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var ev models.NotifyEvent
		json.NewDecoder(r.Body).Decode(&ev)
		assert.Equal(t, "test-addon", ev.AddonID)
		assert.Equal(t, "install", ev.EventType)
		wg.Done()
	}))
	defer server.Close()

	loader := func(ctx context.Context) ([]models.NotificationChannel, error) {
		return []models.NotificationChannel{
			{ID: "ch1", Type: "webhook", URL: server.URL, Enabled: true, Events: []string{"install"}},
		}, nil
	}

	notifier := NewNotifier(loader, nil)
	notifier.Notify(models.NotifyEvent{
		AddonID:   "test-addon",
		EventType: "install",
	})

	if waitTimeout(&wg, 2*time.Second) {
		t.Fatal("timed out waiting for notification delivery")
	}
}

func TestNotifier_Notify_Slack(t *testing.T) {
	var wg sync.WaitGroup
	wg.Add(1)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]string
		json.NewDecoder(r.Body).Decode(&payload)
		assert.Contains(t, payload["text"], "[Kubilitics/upgrade]")
		assert.Contains(t, payload["text"], "test-addon")
		wg.Done()
	}))
	defer server.Close()

	loader := func(ctx context.Context) ([]models.NotificationChannel, error) {
		return []models.NotificationChannel{
			{ID: "ch2", Type: models.NotificationChannelSlack, URL: server.URL, Enabled: true},
		}, nil
	}

	notifier := NewNotifier(loader, nil)
	notifier.Notify(models.NotifyEvent{
		AddonID:   "test-addon",
		EventType: "upgrade",
		ClusterID: "cluster-1",
	})

	if waitTimeout(&wg, 2*time.Second) {
		t.Fatal("timed out waiting for slack notification delivery")
	}
}

func waitTimeout(wg *sync.WaitGroup, timeout time.Duration) bool {
	c := make(chan struct{})
	go func() {
		defer close(c)
		wg.Wait()
	}()
	select {
	case <-c:
		return false // completed normally
	case <-time.After(timeout):
		return true // timed out
	}
}
