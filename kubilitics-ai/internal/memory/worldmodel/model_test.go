package worldmodel

import (
	"context"
	"testing"

	pb "github.com/kubilitics/kubilitics-ai/api/proto/v1"
)

func TestNewWorldModel(t *testing.T) {
	wm := NewWorldModel()

	if wm == nil {
		t.Fatal("Expected non-nil World Model")
	}

	if wm.IsBootstrapped() {
		t.Error("Expected World Model to not be bootstrapped initially")
	}

	if wm.GetResourceCount() != 0 {
		t.Errorf("Expected resource count 0, got %d", wm.GetResourceCount())
	}
}

func TestBootstrap(t *testing.T) {
	wm := NewWorldModel()
	ctx := context.Background()

	resources := []*pb.Resource{
		{
			Kind:      "Pod",
			Namespace: "default",
			Name:      "pod-1",
		},
		{
			Kind:      "Pod",
			Namespace: "default",
			Name:      "pod-2",
		},
		{
			Kind:      "Service",
			Namespace: "default",
			Name:      "svc-1",
		},
	}

	err := wm.Bootstrap(ctx, resources)
	if err != nil {
		t.Fatalf("Bootstrap failed: %v", err)
	}

	if !wm.IsBootstrapped() {
		t.Error("Expected World Model to be bootstrapped")
	}

	if wm.GetResourceCount() != 3 {
		t.Errorf("Expected resource count 3, got %d", wm.GetResourceCount())
	}
}

func TestGetResource(t *testing.T) {
	wm := NewWorldModel()
	ctx := context.Background()

	resources := []*pb.Resource{
		{
			Kind:      "Pod",
			Namespace: "default",
			Name:      "test-pod",
			Uid:       "uid-123",
		},
	}

	wm.Bootstrap(ctx, resources)

	// Test existing resource
	resource, err := wm.GetResource(ctx, "Pod", "default", "test-pod")
	if err != nil {
		t.Fatalf("GetResource failed: %v", err)
	}

	if resource.Name != "test-pod" {
		t.Errorf("Expected name 'test-pod', got '%s'", resource.Name)
	}

	if resource.Uid != "uid-123" {
		t.Errorf("Expected UID 'uid-123', got '%s'", resource.Uid)
	}

	// Test non-existent resource
	_, err = wm.GetResource(ctx, "Pod", "default", "nonexistent")
	if err == nil {
		t.Error("Expected error for non-existent resource")
	}
}

func TestListResources(t *testing.T) {
	wm := NewWorldModel()
	ctx := context.Background()

	resources := []*pb.Resource{
		{Kind: "Pod", Namespace: "default", Name: "pod-1"},
		{Kind: "Pod", Namespace: "default", Name: "pod-2"},
		{Kind: "Pod", Namespace: "kube-system", Name: "pod-3"},
		{Kind: "Service", Namespace: "default", Name: "svc-1"},
	}

	wm.Bootstrap(ctx, resources)

	// Test list by kind
	pods, err := wm.ListResources(ctx, "Pod", "")
	if err != nil {
		t.Fatalf("ListResources failed: %v", err)
	}
	if len(pods) != 3 {
		t.Errorf("Expected 3 pods, got %d", len(pods))
	}

	// Test list by kind and namespace
	defaultPods, err := wm.ListResources(ctx, "Pod", "default")
	if err != nil {
		t.Fatalf("ListResources failed: %v", err)
	}
	if len(defaultPods) != 2 {
		t.Errorf("Expected 2 pods in default namespace, got %d", len(defaultPods))
	}

	// Test list by namespace only
	defaultResources, err := wm.ListResources(ctx, "", "default")
	if err != nil {
		t.Fatalf("ListResources failed: %v", err)
	}
	if len(defaultResources) != 3 {
		t.Errorf("Expected 3 resources in default namespace, got %d", len(defaultResources))
	}

	// Test list all
	allResources, err := wm.ListResources(ctx, "", "")
	if err != nil {
		t.Fatalf("ListResources failed: %v", err)
	}
	if len(allResources) != 4 {
		t.Errorf("Expected 4 total resources, got %d", len(allResources))
	}
}

func TestListResourcesByLabels(t *testing.T) {
	wm := NewWorldModel()
	ctx := context.Background()

	resources := []*pb.Resource{
		{
			Kind:      "Pod",
			Namespace: "default",
			Name:      "pod-1",
			Labels:    map[string]string{"app": "web", "env": "prod"},
		},
		{
			Kind:      "Pod",
			Namespace: "default",
			Name:      "pod-2",
			Labels:    map[string]string{"app": "web", "env": "dev"},
		},
		{
			Kind:      "Pod",
			Namespace: "default",
			Name:      "pod-3",
			Labels:    map[string]string{"app": "api", "env": "prod"},
		},
	}

	wm.Bootstrap(ctx, resources)

	// Test label selector
	webPods, err := wm.ListResourcesByLabels(ctx, "Pod", "default", map[string]string{"app": "web"})
	if err != nil {
		t.Fatalf("ListResourcesByLabels failed: %v", err)
	}
	if len(webPods) != 2 {
		t.Errorf("Expected 2 web pods, got %d", len(webPods))
	}

	// Test multiple label selectors
	webProdPods, err := wm.ListResourcesByLabels(ctx, "Pod", "default", map[string]string{"app": "web", "env": "prod"})
	if err != nil {
		t.Fatalf("ListResourcesByLabels failed: %v", err)
	}
	if len(webProdPods) != 1 {
		t.Errorf("Expected 1 web+prod pod, got %d", len(webProdPods))
	}

	// Test no matching labels
	noMatch, err := wm.ListResourcesByLabels(ctx, "Pod", "default", map[string]string{"app": "nonexistent"})
	if err != nil {
		t.Fatalf("ListResourcesByLabels failed: %v", err)
	}
	if len(noMatch) != 0 {
		t.Errorf("Expected 0 matching pods, got %d", len(noMatch))
	}
}

func TestApplyUpdate(t *testing.T) {
	wm := NewWorldModel()
	ctx := context.Background()

	// Bootstrap with initial resource
	resources := []*pb.Resource{
		{Kind: "Pod", Namespace: "default", Name: "pod-1", ResourceVersion: "1"},
	}
	wm.Bootstrap(ctx, resources)

	// Test ADDED
	addUpdate := &pb.StateUpdate{
		UpdateType: "ADDED",
		Resource: &pb.Resource{
			Kind:            "Pod",
			Namespace:       "default",
			Name:            "pod-2",
			ResourceVersion: "1",
		},
	}

	err := wm.ApplyUpdate(ctx, addUpdate)
	if err != nil {
		t.Fatalf("ApplyUpdate (ADDED) failed: %v", err)
	}

	if wm.GetResourceCount() != 2 {
		t.Errorf("Expected 2 resources after ADDED, got %d", wm.GetResourceCount())
	}

	// Test MODIFIED
	modifyUpdate := &pb.StateUpdate{
		UpdateType: "MODIFIED",
		Resource: &pb.Resource{
			Kind:            "Pod",
			Namespace:       "default",
			Name:            "pod-1",
			ResourceVersion: "2",
		},
	}

	err = wm.ApplyUpdate(ctx, modifyUpdate)
	if err != nil {
		t.Fatalf("ApplyUpdate (MODIFIED) failed: %v", err)
	}

	resource, _ := wm.GetResource(ctx, "Pod", "default", "pod-1")
	if resource.ResourceVersion != "2" {
		t.Errorf("Expected resource version '2', got '%s'", resource.ResourceVersion)
	}

	// Test DELETED
	deleteUpdate := &pb.StateUpdate{
		UpdateType: "DELETED",
		Resource: &pb.Resource{
			Kind:      "Pod",
			Namespace: "default",
			Name:      "pod-2",
		},
	}

	err = wm.ApplyUpdate(ctx, deleteUpdate)
	if err != nil {
		t.Fatalf("ApplyUpdate (DELETED) failed: %v", err)
	}

	if wm.GetResourceCount() != 1 {
		t.Errorf("Expected 1 resource after DELETED, got %d", wm.GetResourceCount())
	}

	_, err = wm.GetResource(ctx, "Pod", "default", "pod-2")
	if err == nil {
		t.Error("Expected error when getting deleted resource")
	}
}

func TestApplyUpdateWithoutBootstrap(t *testing.T) {
	wm := NewWorldModel()
	ctx := context.Background()

	update := &pb.StateUpdate{
		UpdateType: "ADDED",
		Resource:   &pb.Resource{Kind: "Pod", Namespace: "default", Name: "pod-1"},
	}

	err := wm.ApplyUpdate(ctx, update)
	if err == nil {
		t.Error("Expected error when applying update without bootstrap")
	}

	if err.Error() != "world model not bootstrapped" {
		t.Errorf("Expected 'world model not bootstrapped' error, got: %v", err)
	}
}

func TestGetStats(t *testing.T) {
	wm := NewWorldModel()
	ctx := context.Background()

	resources := []*pb.Resource{
		{Kind: "Pod", Namespace: "default", Name: "pod-1"},
		{Kind: "Pod", Namespace: "default", Name: "pod-2"},
		{Kind: "Pod", Namespace: "kube-system", Name: "pod-3"},
		{Kind: "Service", Namespace: "default", Name: "svc-1"},
		{Kind: "Node", Namespace: "", Name: "node-1"},
	}

	wm.Bootstrap(ctx, resources)

	stats := wm.GetStats()

	if stats["bootstrapped"] != true {
		t.Error("Expected bootstrapped to be true")
	}

	if stats["total_resources"] != 5 {
		t.Errorf("Expected total_resources 5, got %v", stats["total_resources"])
	}

	kindCounts := stats["kind_counts"].(map[string]int)
	if kindCounts["Pod"] != 3 {
		t.Errorf("Expected 3 Pods, got %d", kindCounts["Pod"])
	}
	if kindCounts["Service"] != 1 {
		t.Errorf("Expected 1 Service, got %d", kindCounts["Service"])
	}

	namespaceCounts := stats["namespace_counts"].(map[string]int)
	if namespaceCounts["default"] != 3 {
		t.Errorf("Expected 3 resources in default namespace, got %d", namespaceCounts["default"])
	}
}

func TestClear(t *testing.T) {
	wm := NewWorldModel()
	ctx := context.Background()

	resources := []*pb.Resource{
		{Kind: "Pod", Namespace: "default", Name: "pod-1"},
		{Kind: "Service", Namespace: "default", Name: "svc-1"},
	}

	wm.Bootstrap(ctx, resources)

	if wm.GetResourceCount() != 2 {
		t.Errorf("Expected 2 resources before clear, got %d", wm.GetResourceCount())
	}

	wm.Clear()

	if wm.GetResourceCount() != 0 {
		t.Errorf("Expected 0 resources after clear, got %d", wm.GetResourceCount())
	}

	if wm.IsBootstrapped() {
		t.Error("Expected World Model to not be bootstrapped after clear")
	}
}

func TestResourceIDString(t *testing.T) {
	tests := []struct {
		id       ResourceID
		expected string
	}{
		{
			id:       ResourceID{Kind: "Pod", Namespace: "default", Name: "test"},
			expected: "Pod/default/test",
		},
		{
			id:       ResourceID{Kind: "Node", Namespace: "", Name: "node-1"},
			expected: "Node/node-1",
		},
	}

	for _, tt := range tests {
		result := tt.id.String()
		if result != tt.expected {
			t.Errorf("Expected %s, got %s", tt.expected, result)
		}
	}
}

func TestConcurrentAccess(t *testing.T) {
	wm := NewWorldModel()
	ctx := context.Background()

	resources := []*pb.Resource{
		{Kind: "Pod", Namespace: "default", Name: "pod-1"},
	}
	wm.Bootstrap(ctx, resources)

	// Spawn multiple goroutines to test concurrent access
	done := make(chan bool, 10)

	for i := 0; i < 5; i++ {
		go func() {
			for j := 0; j < 100; j++ {
				wm.GetResource(ctx, "Pod", "default", "pod-1")
			}
			done <- true
		}()
	}

	for i := 0; i < 5; i++ {
		go func(id int) {
			for j := 0; j < 100; j++ {
				update := &pb.StateUpdate{
					UpdateType: "MODIFIED",
					Resource: &pb.Resource{
						Kind:            "Pod",
						Namespace:       "default",
						Name:            "pod-1",
						ResourceVersion: "updated",
					},
				}
				wm.ApplyUpdate(ctx, update)
			}
			done <- true
		}(i)
	}

	// Wait for all goroutines to complete
	for i := 0; i < 10; i++ {
		<-done
	}

	// Verify state is still consistent
	if wm.GetResourceCount() != 1 {
		t.Errorf("Expected 1 resource after concurrent access, got %d", wm.GetResourceCount())
	}
}
