package worldmodel

import (
	"context"
	"fmt"
	"sync"
	"time"

	pb "github.com/kubilitics/kubilitics-ai/api/proto/v1"
)

// ResourceID uniquely identifies a Kubernetes resource
type ResourceID struct {
	Kind      string
	Namespace string
	Name      string
}

// String returns a string representation of the ResourceID
func (r ResourceID) String() string {
	if r.Namespace == "" {
		return fmt.Sprintf("%s/%s", r.Kind, r.Name)
	}
	return fmt.Sprintf("%s/%s/%s", r.Kind, r.Namespace, r.Name)
}

// WorldModel represents the in-memory cluster state
type WorldModel struct {
	mu sync.RWMutex

	// Current cluster state
	resources map[ResourceID]*pb.Resource

	// Index by kind for efficient queries
	kindIndex map[string]map[ResourceID]*pb.Resource

	// Index by namespace for efficient queries
	namespaceIndex map[string]map[ResourceID]*pb.Resource

	// Metadata
	lastSync      time.Time
	bootstrapped  bool
	resourceCount int64
}

// NewWorldModel creates a new World Model
func NewWorldModel() *WorldModel {
	return &WorldModel{
		resources:      make(map[ResourceID]*pb.Resource),
		kindIndex:      make(map[string]map[ResourceID]*pb.Resource),
		namespaceIndex: make(map[string]map[ResourceID]*pb.Resource),
		bootstrapped:   false,
	}
}

// Bootstrap performs initial full sync from backend
func (wm *WorldModel) Bootstrap(ctx context.Context, resources []*pb.Resource) error {
	wm.mu.Lock()
	defer wm.mu.Unlock()

	// Clear existing state
	wm.resources = make(map[ResourceID]*pb.Resource)
	wm.kindIndex = make(map[string]map[ResourceID]*pb.Resource)
	wm.namespaceIndex = make(map[string]map[ResourceID]*pb.Resource)

	// Add all resources
	for _, resource := range resources {
		wm.addResourceLocked(resource)
	}

	wm.bootstrapped = true
	wm.lastSync = time.Now()

	return nil
}

// ApplyUpdate applies an incremental update to the World Model
func (wm *WorldModel) ApplyUpdate(ctx context.Context, update *pb.StateUpdate) error {
	wm.mu.Lock()
	defer wm.mu.Unlock()

	if !wm.bootstrapped {
		return fmt.Errorf("world model not bootstrapped")
	}

	resource := update.Resource
	id := ResourceID{
		Kind:      resource.Kind,
		Namespace: resource.Namespace,
		Name:      resource.Name,
	}

	switch update.UpdateType {
	case "ADDED", "MODIFIED":
		wm.addOrUpdateResourceLocked(id, resource)
	case "DELETED":
		wm.deleteResourceLocked(id)
	default:
		return fmt.Errorf("unknown update type: %s", update.UpdateType)
	}

	wm.lastSync = time.Now()
	return nil
}

// GetResource retrieves a specific resource
func (wm *WorldModel) GetResource(ctx context.Context, kind, namespace, name string) (*pb.Resource, error) {
	wm.mu.RLock()
	defer wm.mu.RUnlock()

	id := ResourceID{
		Kind:      kind,
		Namespace: namespace,
		Name:      name,
	}

	resource, exists := wm.resources[id]
	if !exists {
		return nil, fmt.Errorf("resource not found: %s", id.String())
	}

	return resource, nil
}

// ListResources lists all resources of a given kind in a namespace
func (wm *WorldModel) ListResources(ctx context.Context, kind, namespace string) ([]*pb.Resource, error) {
	wm.mu.RLock()
	defer wm.mu.RUnlock()

	var results []*pb.Resource

	// If kind is specified, use kind index
	if kind != "" {
		kindMap, exists := wm.kindIndex[kind]
		if !exists {
			return results, nil // Empty result
		}

		for _, resource := range kindMap {
			if namespace == "" || resource.Namespace == namespace {
				results = append(results, resource)
			}
		}
		return results, nil
	}

	// If only namespace is specified, use namespace index
	if namespace != "" {
		nsMap, exists := wm.namespaceIndex[namespace]
		if !exists {
			return results, nil
		}

		for _, resource := range nsMap {
			results = append(results, resource)
		}
		return results, nil
	}

	// Return all resources
	for _, resource := range wm.resources {
		results = append(results, resource)
	}

	return results, nil
}

// ListResourcesByLabels lists resources matching label selectors
func (wm *WorldModel) ListResourcesByLabels(ctx context.Context, kind, namespace string, labels map[string]string) ([]*pb.Resource, error) {
	// First get all resources of the given kind/namespace
	resources, err := wm.ListResources(ctx, kind, namespace)
	if err != nil {
		return nil, err
	}

	// Filter by labels
	var results []*pb.Resource
	for _, resource := range resources {
		if matchesLabels(resource.Labels, labels) {
			results = append(results, resource)
		}
	}

	return results, nil
}

// GetStats returns statistics about the World Model
func (wm *WorldModel) GetStats() map[string]interface{} {
	wm.mu.RLock()
	defer wm.mu.RUnlock()

	kindCounts := make(map[string]int)
	namespaceCounts := make(map[string]int)

	for _, resource := range wm.resources {
		kindCounts[resource.Kind]++
		if resource.Namespace != "" {
			namespaceCounts[resource.Namespace]++
		}
	}

	return map[string]interface{}{
		"bootstrapped":     wm.bootstrapped,
		"last_sync":        wm.lastSync,
		"total_resources":  len(wm.resources),
		"kind_counts":      kindCounts,
		"namespace_counts": namespaceCounts,
		"total_kinds":      len(wm.kindIndex),
		"total_namespaces": len(wm.namespaceIndex),
	}
}

// IsBootstrapped returns whether the World Model has been bootstrapped
func (wm *WorldModel) IsBootstrapped() bool {
	wm.mu.RLock()
	defer wm.mu.RUnlock()
	return wm.bootstrapped
}

// GetResourceCount returns the total number of resources
func (wm *WorldModel) GetResourceCount() int {
	wm.mu.RLock()
	defer wm.mu.RUnlock()
	return len(wm.resources)
}

// Clear clears all resources from the World Model
func (wm *WorldModel) Clear() {
	wm.mu.Lock()
	defer wm.mu.Unlock()

	wm.resources = make(map[ResourceID]*pb.Resource)
	wm.kindIndex = make(map[string]map[ResourceID]*pb.Resource)
	wm.namespaceIndex = make(map[string]map[ResourceID]*pb.Resource)
	wm.bootstrapped = false
	wm.resourceCount = 0
}

// Internal methods (must be called with lock held)

func (wm *WorldModel) addResourceLocked(resource *pb.Resource) {
	id := ResourceID{
		Kind:      resource.Kind,
		Namespace: resource.Namespace,
		Name:      resource.Name,
	}

	wm.resources[id] = resource

	// Update kind index
	if _, exists := wm.kindIndex[resource.Kind]; !exists {
		wm.kindIndex[resource.Kind] = make(map[ResourceID]*pb.Resource)
	}
	wm.kindIndex[resource.Kind][id] = resource

	// Update namespace index
	if resource.Namespace != "" {
		if _, exists := wm.namespaceIndex[resource.Namespace]; !exists {
			wm.namespaceIndex[resource.Namespace] = make(map[ResourceID]*pb.Resource)
		}
		wm.namespaceIndex[resource.Namespace][id] = resource
	}

	wm.resourceCount++
}

func (wm *WorldModel) addOrUpdateResourceLocked(id ResourceID, resource *pb.Resource) {
	// Check if resource exists
	if _, exists := wm.resources[id]; exists {
		// Update: remove old version first
		wm.deleteResourceLocked(id)
	}

	// Add new version
	wm.addResourceLocked(resource)
}

func (wm *WorldModel) deleteResourceLocked(id ResourceID) {
	resource, exists := wm.resources[id]
	if !exists {
		return
	}

	// Remove from main map
	delete(wm.resources, id)

	// Remove from kind index
	if kindMap, exists := wm.kindIndex[resource.Kind]; exists {
		delete(kindMap, id)
		if len(kindMap) == 0 {
			delete(wm.kindIndex, resource.Kind)
		}
	}

	// Remove from namespace index
	if resource.Namespace != "" {
		if nsMap, exists := wm.namespaceIndex[resource.Namespace]; exists {
			delete(nsMap, id)
			if len(nsMap) == 0 {
				delete(wm.namespaceIndex, resource.Namespace)
			}
		}
	}

	wm.resourceCount--
}

// Helper function to match labels
func matchesLabels(resourceLabels, selectorLabels map[string]string) bool {
	if len(selectorLabels) == 0 {
		return true // No selector means match all
	}

	for key, value := range selectorLabels {
		resourceValue, exists := resourceLabels[key]
		if !exists || resourceValue != value {
			return false
		}
	}

	return true
}
