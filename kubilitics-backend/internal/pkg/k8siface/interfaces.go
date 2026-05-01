// Package k8siface defines narrow, role-specific interfaces for Kubernetes
// client operations.
//
// Design intent: subsystems should depend on the smallest interface they
// actually use rather than importing the concrete *k8s.Client or
// *k8s.InformerManager directly.  This reduces coupling, makes unit tests
// easier (mock just the interface you need), and limits the blast radius when
// the k8s package evolves.
//
// Subsystem → interface mapping:
//   blast-radius / spof:   ResourceLister (read-only list)
//   security scanner:      ResourceLister + ResourceReader
//   topology / infra:      CacheLister (informer-backed, sub-ms reads)
//   write paths (apply):   ResourceWriter
//
// All concrete types (*k8s.Client, *k8s.InformerManager) satisfy these
// interfaces automatically — no adapters required.
package k8siface

import (
	"context"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

// ResourceLister can list Kubernetes resources of any kind via the API server.
// Subsystems that only need to enumerate resources (blast-radius, spof,
// security probes) should accept ResourceLister rather than *k8s.Client.
type ResourceLister interface {
	ListResources(ctx context.Context, kind, namespace string, opts metav1.ListOptions) (*unstructured.UnstructuredList, error)
}

// ResourceReader can fetch a single named resource.
type ResourceReader interface {
	GetResource(ctx context.Context, kind, namespace, name string) (*unstructured.Unstructured, error)
}

// ResourceWriter groups mutating operations on cluster resources.
type ResourceWriter interface {
	CreateResource(ctx context.Context, obj *unstructured.Unstructured) (*unstructured.Unstructured, error)
	PatchResource(ctx context.Context, kind, namespace, name string, patch []byte) (*unstructured.Unstructured, error)
	DeleteResource(ctx context.Context, kind, namespace, name string, opts metav1.DeleteOptions) error
}

// ResourceReadWriter composes read + write for subsystems that need both.
type ResourceReadWriter interface {
	ResourceLister
	ResourceReader
	ResourceWriter
}

// CacheLister reads resources from an in-process informer cache (sub-ms,
// no API-server round-trip).  Topology and infrastructure subsystems should
// prefer this over ResourceLister when latency matters.
type CacheLister interface {
	// ListFromCache returns (list, true) when the cache is synced and the kind
	// is tracked, or (nil, false) when it falls back to the API server.
	ListFromCache(resourceType, namespace string, opts metav1.ListOptions) (*unstructured.UnstructuredList, bool)
}

// Compile-time checks that k8s concrete types satisfy these interfaces.
// These are in a separate _check.go normally, but kept here to avoid
// an import cycle (k8siface → k8s would create a cycle since k8s is
// the dependency being decoupled).  Add checks in consuming packages
// instead: var _ k8siface.ResourceLister = (*k8s.Client)(nil)
