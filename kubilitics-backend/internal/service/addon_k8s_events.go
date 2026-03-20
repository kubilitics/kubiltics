package service

// addon_k8s_events.go — live Kubernetes event streaming during Helm install.
//
// streamK8sEventsToProgress watches the CoreV1 Events API for the target namespace
// and forwards any event whose involvedObject name contains the Helm release name to
// the install progress channel. It is launched as a background goroutine by
// ExecuteInstall and cancelled as soon as helmClient.Install returns (success or error).
// All errors here are non-fatal — this is a best-effort UX enhancement.

import (
	"context"
	"fmt"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes"
)

// streamK8sEventsToProgress streams real-time Kubernetes Events to progressCh.
//
// It watches all events in namespace and filters to those whose
// involvedObject.Name contains releaseName (case-insensitive).
// Event deduplication is done by <Kind>/<Name>/<Reason> so that Modified events
// don't produce duplicate log lines.
//
// The goroutine exits cleanly when ctx is cancelled (which ExecuteInstall does
// immediately after helmClient.Install returns).
func streamK8sEventsToProgress(
	ctx context.Context,
	clientset kubernetes.Interface,
	namespace, releaseName, installRunID string,
	progressCh chan<- InstallProgressEvent,
) {
	if progressCh == nil || clientset == nil {
		return
	}

	watcher, err := clientset.CoreV1().Events(namespace).Watch(ctx, metav1.ListOptions{
		Watch: true,
	})
	if err != nil {
		return // best-effort: watcher unavailable, not fatal
	}
	defer watcher.Stop()

	// Deduplicate by <Kind>/<Name>/<Reason> — the Watch stream emits
	// both Added and Modified for the same event.
	seen := make(map[string]bool)
	releasePrefix := strings.ToLower(releaseName)

	for {
		select {
		case <-ctx.Done():
			return

		case ev, ok := <-watcher.ResultChan():
			if !ok {
				return // channel closed (context cancelled or server timeout)
			}
			if ev.Type != watch.Added && ev.Type != watch.Modified {
				continue
			}

			k8sEvent, ok := ev.Object.(*corev1.Event)
			if !ok {
				continue
			}

			// Deduplicate: same event fires as Added then as Modified (count++).
			dedupKey := fmt.Sprintf("%s/%s/%s",
				k8sEvent.InvolvedObject.Kind,
				k8sEvent.InvolvedObject.Name,
				k8sEvent.Reason,
			)
			if seen[dedupKey] {
				continue
			}
			seen[dedupKey] = true

			// Only surface events for objects that belong to this release.
			objName := strings.ToLower(k8sEvent.InvolvedObject.Name)
			if !strings.Contains(objName, releasePrefix) {
				continue
			}

			// Map Warning events to "warning" status (renders amber in the UI).
			status := "running"
			if k8sEvent.Type == corev1.EventTypeWarning {
				status = "warning"
			}

			msg := fmt.Sprintf("[%s] %s/%s: %s",
				k8sEvent.Reason,
				k8sEvent.InvolvedObject.Kind,
				k8sEvent.InvolvedObject.Name,
				k8sEvent.Message,
			)

			// Non-blocking send — if the channel is full we skip rather than block.
			select {
			case progressCh <- InstallProgressEvent{
				Step:         "k8s-event",
				Message:      msg,
				Status:       status,
				Timestamp:    time.Now().UTC(),
				InstallRunID: installRunID,
			}:
			default:
			}
		}
	}
}
