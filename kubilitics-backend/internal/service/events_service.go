package service

import (
	"context"
	"fmt"
	"sort"
	"sync"

	"golang.org/x/sync/errgroup"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// EventsService provides access to Kubernetes events
type EventsService interface {
	ListEvents(ctx context.Context, clusterID, namespace string, opts metav1.ListOptions) (*metav1.List, []*models.Event, error)
	ListEventsAllNamespaces(ctx context.Context, clusterID string, limit int) ([]*models.Event, error)
	GetResourceEvents(ctx context.Context, clusterID, namespace, resourceKind, resourceName string) ([]*models.Event, error)
	WatchEvents(ctx context.Context, clusterID, namespace string, eventChan chan<- *models.Event, errChan chan<- error)
}

type eventsService struct {
	clusterService *clusterService
	repo           *repository.SQLiteRepository // optional — nil if no DB
}

// NewEventsService creates a new events service (no persistence)
func NewEventsService(cs ClusterService) EventsService {
	return &eventsService{
		clusterService: cs.(*clusterService),
	}
}

// NewEventsServiceWithRepo creates an events service with SQLite persistence.
// Events are stored so they survive K8s event TTL (~1 hour).
func NewEventsServiceWithRepo(cs ClusterService, repo *repository.SQLiteRepository) EventsService {
	return &eventsService{
		clusterService: cs.(*clusterService),
		repo:           repo,
	}
}

// ListEvents lists events with pagination support (BE-FUNC-002). Returns list metadata and events.
func (s *eventsService) ListEvents(ctx context.Context, clusterID, namespace string, opts metav1.ListOptions) (*metav1.List, []*models.Event, error) {
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, nil, err
	}

	eventList, err := client.Clientset.CoreV1().Events(namespace).List(ctx, opts)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to list events: %w", err)
	}

	events := make([]*models.Event, 0, len(eventList.Items))
	for _, event := range eventList.Items {
		events = append(events, k8sEventToModel(&event))
	}

	listMeta := &metav1.List{
		TypeMeta:      eventList.TypeMeta,
		ListMeta:      eventList.ListMeta,
	}
	return listMeta, events, nil
}

// ListEventsAllNamespaces lists events from all namespaces, merged and sorted by LastTimestamp descending, limited to limit.
func (s *eventsService) ListEventsAllNamespaces(ctx context.Context, clusterID string, limit int) ([]*models.Event, error) {
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, err
	}

	nsList, err := client.Clientset.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list namespaces: %w", err)
	}

	perNamespaceLimit := 100
	if limit > 0 && len(nsList.Items) > 0 {
		perNamespaceLimit = (limit / len(nsList.Items)) + 50
		if perNamespaceLimit < 20 {
			perNamespaceLimit = 20
		}
	}

	var mu sync.Mutex
	var all []*models.Event

	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(10) // Bound concurrent K8s API calls

	for _, ns := range nsList.Items {
		nsName := ns.Name
		g.Go(func() error {
			listOpts := metav1.ListOptions{}
			if perNamespaceLimit > 0 {
				listOpts.Limit = int64(perNamespaceLimit)
			}
			eventList, err := client.Clientset.CoreV1().Events(nsName).List(gctx, listOpts)
			if err != nil {
				return nil // Skip namespace on error (same as sequential version)
			}
			batch := make([]*models.Event, 0, len(eventList.Items))
			for i := range eventList.Items {
				batch = append(batch, k8sEventToModel(&eventList.Items[i]))
			}
			mu.Lock()
			all = append(all, batch...)
			mu.Unlock()
			return nil
		})
	}
	_ = g.Wait()

	sort.Slice(all, func(i, j int) bool {
		return all[i].LastTimestamp.After(all[j].LastTimestamp)
	})
	if limit > 0 && len(all) > limit {
		all = all[:limit]
	}
	return all, nil
}

func k8sEventToModel(event *corev1.Event) *models.Event {
	sourceComponent := ""
	if event.Source.Component != "" {
		sourceComponent = event.Source.Component
	}
	// Kubernetes events have multiple timestamp fields:
	// - FirstTimestamp/LastTimestamp: legacy (v1 events), populated by most controllers
	// - EventTime: newer (events.k8s.io/v1), used by scheduler and some controllers
	// - CreationTimestamp: always set by API server
	// Use the first non-zero timestamp found.
	firstTS := event.FirstTimestamp.Time
	lastTS := event.LastTimestamp.Time
	if firstTS.IsZero() && !event.EventTime.IsZero() {
		firstTS = event.EventTime.Time
	}
	if firstTS.IsZero() && !event.CreationTimestamp.IsZero() {
		firstTS = event.CreationTimestamp.Time
	}
	if lastTS.IsZero() {
		lastTS = firstTS
	}

	return &models.Event{
		ID:               string(event.UID),
		Name:             event.Name,
		EventNamespace:   event.Namespace,
		Type:             event.Type,
		Reason:           event.Reason,
		Message:          event.Message,
		ResourceKind:     event.InvolvedObject.Kind,
		ResourceName:     event.InvolvedObject.Name,
		Namespace:        event.InvolvedObject.Namespace,
		FirstTimestamp:   firstTS,
		LastTimestamp:    lastTS,
		Count:            event.Count,
		SourceComponent:  sourceComponent,
	}
}

func (s *eventsService) GetResourceEvents(ctx context.Context, clusterID, namespace, resourceKind, resourceName string) ([]*models.Event, error) {
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, err
	}

	fieldSelector := fmt.Sprintf("involvedObject.kind=%s,involvedObject.name=%s", resourceKind, resourceName)
	listOpts := metav1.ListOptions{
		FieldSelector: fieldSelector,
	}

	eventList, err := client.Clientset.CoreV1().Events(namespace).List(ctx, listOpts)
	if err != nil {
		return nil, fmt.Errorf("failed to list resource events: %w", err)
	}

	events := make([]*models.Event, 0, len(eventList.Items))
	for i := range eventList.Items {
		events = append(events, k8sEventToModel(&eventList.Items[i]))
	}

	// Persist live events to SQLite for future reference (non-blocking)
	if s.repo != nil && len(events) > 0 {
		go func() {
			_ = s.repo.UpsertEvents(clusterID, events)
		}()
	}

	// If K8s returned no events (expired), fall back to stored events
	if len(events) == 0 && s.repo != nil {
		stored, err := s.repo.GetStoredEvents(clusterID, namespace, resourceKind, resourceName, 10)
		if err == nil && len(stored) > 0 {
			return stored, nil
		}
	}

	return events, nil
}


func (s *eventsService) WatchEvents(ctx context.Context, clusterID, namespace string, eventChan chan<- *models.Event, errChan chan<- error) {
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		errChan <- err
		return
	}

	watcher, err := client.Clientset.CoreV1().Events(namespace).Watch(ctx, metav1.ListOptions{})
	if err != nil {
		errChan <- fmt.Errorf("failed to watch events: %w", err)
		return
	}
	defer watcher.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-watcher.ResultChan():
			if !ok {
				return
			}

			if k8sEvent, ok := event.Object.(*corev1.Event); ok {
				eventChan <- k8sEventToModel(k8sEvent)
			}
		}
	}
}
