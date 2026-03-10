package v2

import "testing"

func TestDeepLinkPath_Namespaced(t *testing.T) {
	got := DeepLinkPath("cluster-1", "Pod", "default", "nginx")
	want := "/topology/cluster-1/resource/pod/default/nginx"
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestDeepLinkPath_ClusterScoped(t *testing.T) {
	got := DeepLinkPath("cluster-1", "Node", "", "worker-1")
	want := "/topology/cluster-1/resource/node/worker-1"
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestParseDeepLink_NamespacedResource(t *testing.T) {
	dl, err := ParseDeepLink("/topology/cluster-1/resource/pod/default/nginx")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dl.ClusterID != "cluster-1" {
		t.Errorf("expected cluster-1, got %s", dl.ClusterID)
	}
	if dl.Kind != "pod" {
		t.Errorf("expected pod, got %s", dl.Kind)
	}
	if dl.Namespace != "default" {
		t.Errorf("expected default, got %s", dl.Namespace)
	}
	if dl.Name != "nginx" {
		t.Errorf("expected nginx, got %s", dl.Name)
	}
	if dl.Mode != ViewModeResource {
		t.Errorf("expected resource mode, got %s", dl.Mode)
	}
}

func TestParseDeepLink_ClusterScoped(t *testing.T) {
	dl, err := ParseDeepLink("/topology/cluster-1/resource/node/worker-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dl.Kind != "node" || dl.Name != "worker-1" {
		t.Errorf("unexpected: kind=%s name=%s", dl.Kind, dl.Name)
	}
}

func TestParseDeepLink_ClusterOverview(t *testing.T) {
	dl, err := ParseDeepLink("/topology/cluster-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dl.Mode != ViewModeCluster {
		t.Errorf("expected cluster mode, got %s", dl.Mode)
	}
}

func TestParseDeepLink_NamespaceView(t *testing.T) {
	dl, err := ParseDeepLink("/topology/cluster-1/ns/production")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dl.Mode != ViewModeNamespace || dl.Namespace != "production" {
		t.Errorf("unexpected: mode=%s ns=%s", dl.Mode, dl.Namespace)
	}
}

func TestParseDeepLink_Invalid(t *testing.T) {
	_, err := ParseDeepLink("/invalid/path")
	if err == nil {
		t.Error("expected error for invalid deep link")
	}
}

func TestDeepLink_ToOptions(t *testing.T) {
	dl := &DeepLink{ClusterID: "c1", Kind: "pod", Namespace: "default", Name: "nginx", Mode: ViewModeResource}
	opts := dl.ToOptions()
	if opts.ClusterID != "c1" {
		t.Errorf("expected c1, got %s", opts.ClusterID)
	}
	if opts.Mode != ViewModeResource {
		t.Errorf("expected resource mode, got %s", opts.Mode)
	}
	if opts.Resource != "Pod/default/nginx" {
		t.Errorf("expected Pod/default/nginx, got %s", opts.Resource)
	}
}
