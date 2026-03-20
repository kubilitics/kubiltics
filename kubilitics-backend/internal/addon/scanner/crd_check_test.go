package scanner

import (
	"context"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic/fake"
)

var crdGVR = schema.GroupVersionResource{
	Group:    "apiextensions.k8s.io",
	Version:  "v1",
	Resource: "customresourcedefinitions",
}

// buildFakeDynamicClient creates a dynamic fake client pre-populated with the given CRD objects.
func buildFakeDynamicClient(crds ...*unstructured.Unstructured) *fake.FakeDynamicClient {
	scheme := runtime.NewScheme()
	// Register the CRD GVK so the fake client can handle it.
	scheme.AddKnownTypeWithName(schema.GroupVersionKind{
		Group:   "apiextensions.k8s.io",
		Version: "v1",
		Kind:    "CustomResourceDefinition",
	}, &unstructured.Unstructured{})
	scheme.AddKnownTypeWithName(schema.GroupVersionKind{
		Group:   "apiextensions.k8s.io",
		Version: "v1",
		Kind:    "CustomResourceDefinitionList",
	}, &unstructured.UnstructuredList{})

	objs := make([]runtime.Object, len(crds))
	for i, c := range crds {
		objs[i] = c
	}
	return fake.NewSimpleDynamicClientWithCustomListKinds(scheme,
		map[schema.GroupVersionResource]string{
			crdGVR: "CustomResourceDefinitionList",
		},
		objs...,
	)
}

// makeCRDObj builds an unstructured CRD object suitable for the fake dynamic client.
func makeCRDObj(name string, labels map[string]string) *unstructured.Unstructured {
	u := &unstructured.Unstructured{}
	u.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "apiextensions.k8s.io",
		Version: "v1",
		Kind:    "CustomResourceDefinition",
	})
	u.SetName(name)
	if labels != nil {
		u.SetLabels(labels)
	}
	return u
}

// TestCRDCheck_NoCRDs: cluster has no CRDs and addon declares none → PreflightGO "no CRDs declared".
func TestCRDCheck_NoCRDs(t *testing.T) {
	dynClient := buildFakeDynamicClient()
	checker := &CRDChecker{}
	input := CheckInput{
		DynamicClient: dynClient,
		AddonDetail: &models.AddOnDetail{
			AddOnEntry: models.AddOnEntry{ID: "simple-addon", HelmChart: "simple-addon"},
			CRDsOwned:  nil,
		},
	}

	checks, err := checker.Run(context.Background(), input)
	if err != nil {
		t.Fatalf("CRDChecker.Run error: %v", err)
	}
	if len(checks) == 0 {
		t.Fatal("expected at least one check")
	}
	if checks[0].Status != models.PreflightGO {
		t.Errorf("expected PreflightGO for no CRDs, got %v: %s", checks[0].Status, checks[0].Title)
	}
}

// TestCRDCheck_OwnedBySameChart: the CRD exists and is labelled with the same helm chart
// → PreflightGO "CRD already present" (safe upgrade path).
func TestCRDCheck_OwnedBySameChart(t *testing.T) {
	crdObj := makeCRDObj("certificates.cert-manager.io", map[string]string{
		"helm.sh/chart": "cert-manager-v1.16.3",
	})
	dynClient := buildFakeDynamicClient(crdObj)
	checker := &CRDChecker{}
	input := CheckInput{
		DynamicClient: dynClient,
		AddonDetail: &models.AddOnDetail{
			AddOnEntry: models.AddOnEntry{ID: "kubilitics/cert-manager", HelmChart: "cert-manager"},
			CRDsOwned: []models.AddOnCRDOwnership{{
				CRDResource: "certificates",
				CRDGroup:    "cert-manager.io",
			}},
		},
	}

	checks, err := checker.Run(context.Background(), input)
	if err != nil {
		t.Fatalf("CRDChecker.Run error: %v", err)
	}
	if len(checks) == 0 {
		t.Fatal("expected at least one check")
	}
	// All checks should be GO (owned by same chart → safe upgrade).
	for _, c := range checks {
		if c.Status != models.PreflightGO {
			t.Errorf("expected PreflightGO for CRD owned by same chart, got %v: %s", c.Status, c.Title)
		}
	}
}

// TestCRDCheck_ConflictingOwner: CRD exists but labelled with a different release
// → PreflightBLOCK "CRD ownership conflict".
func TestCRDCheck_ConflictingOwner(t *testing.T) {
	crdObj := makeCRDObj("certificates.cert-manager.io", map[string]string{
		"helm.sh/chart": "some-other-chart-v1.0.0",
	})
	dynClient := buildFakeDynamicClient(crdObj)
	checker := &CRDChecker{}
	input := CheckInput{
		DynamicClient: dynClient,
		AddonDetail: &models.AddOnDetail{
			AddOnEntry: models.AddOnEntry{ID: "kubilitics/cert-manager", HelmChart: "cert-manager"},
			CRDsOwned: []models.AddOnCRDOwnership{{
				CRDResource: "certificates",
				CRDGroup:    "cert-manager.io",
			}},
		},
	}

	checks, err := checker.Run(context.Background(), input)
	if err != nil {
		t.Fatalf("CRDChecker.Run error: %v", err)
	}
	found := false
	for _, c := range checks {
		if c.Status == models.PreflightBLOCK {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected PreflightBLOCK for conflicting CRD ownership, got: %+v", checks)
	}
}

// Compile-time check that meta package is used (imported for RESTMapper in scanner.go).
var _ = meta.NewDefaultRESTMapper
