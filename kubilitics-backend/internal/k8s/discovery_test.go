package k8s

import (
	"context"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	discoveryfake "k8s.io/client-go/discovery/fake"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"
)

// TestResolveGVR_CRDResourceTypes verifies that ResolveGVR resolves CRD resource types (e.g. cert-manager)
// via live discovery cache when not in the hardcoded map (test gaps).
func TestResolveGVR_CRDResourceTypes(t *testing.T) {
	ctx := context.Background()

	// Create a fake clientset
	fakeClientset := fake.NewSimpleClientset()

	// Create resources list for cert-manager CRDs
	resources := []*metav1.APIResourceList{
		{
			GroupVersion: "cert-manager.io/v1",
			APIResources: []metav1.APIResource{
				{
					Name:       "certificates",
					Namespaced: true,
					Kind:       "Certificate",
				},
				{
					Name:       "certificaterequests",
					Namespaced: true,
					Kind:       "CertificateRequest",
				},
			},
		},
	}

	// Create a custom discovery client that wraps FakeDiscovery and overrides ServerPreferredResources
	fakeDiscovery := &customDiscovery{
		FakeDiscovery: &discoveryfake.FakeDiscovery{
			Fake: &clienttesting.Fake{},
		},
		resources: resources,
	}

	// Wrap the fake clientset to provide discovery interface
	clientset := &discoveryClientWrapper{
		Interface: fakeClientset,
		discovery: fakeDiscovery,
	}

	client := NewClientForTest(clientset)

	// Test resolving cert-manager certificates (not in hardcoded map)
	gvr, err := client.ResolveGVR(ctx, "certificates")
	if err != nil {
		t.Fatalf("ResolveGVR('certificates') failed: %v", err)
	}
	expectedGVR := schema.GroupVersionResource{
		Group:    "cert-manager.io",
		Version:  "v1",
		Resource: "certificates",
	}
	if gvr.Group != expectedGVR.Group || gvr.Version != expectedGVR.Version || gvr.Resource != expectedGVR.Resource {
		t.Errorf("ResolveGVR('certificates') = %+v, want %+v", gvr, expectedGVR)
	}

	// Test resolving certificaterequests
	gvr2, err := client.ResolveGVR(ctx, "certificaterequests")
	if err != nil {
		t.Fatalf("ResolveGVR('certificaterequests') failed: %v", err)
	}
	expectedGVR2 := schema.GroupVersionResource{
		Group:    "cert-manager.io",
		Version:  "v1",
		Resource: "certificaterequests",
	}
	if gvr2.Group != expectedGVR2.Group || gvr2.Version != expectedGVR2.Version || gvr2.Resource != expectedGVR2.Resource {
		t.Errorf("ResolveGVR('certificaterequests') = %+v, want %+v", gvr2, expectedGVR2)
	}
}

// discoveryClientWrapper wraps a fake clientset to provide discovery interface
type discoveryClientWrapper struct {
	kubernetes.Interface
	discovery discovery.DiscoveryInterface
}

func (w *discoveryClientWrapper) Discovery() discovery.DiscoveryInterface {
	return w.discovery
}

// customDiscovery wraps FakeDiscovery to override ServerPreferredResources
type customDiscovery struct {
	*discoveryfake.FakeDiscovery
	resources []*metav1.APIResourceList
}

func (c *customDiscovery) ServerPreferredResources() ([]*metav1.APIResourceList, error) {
	return c.resources, nil
}
