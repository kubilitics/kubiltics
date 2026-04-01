package k8s

import (
	"context"
	"fmt"
	"strings"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/tracing"
)

// NormalizeKindToResource converts API kind (e.g. "Pod", "Pods", "pod") to lowercase plural for GVR lookup.
func NormalizeKindToResource(kind string) string {
	s := strings.ToLower(strings.TrimSpace(kind))
	if s == "" {
		return s
	}
	// Try exact match first (handles already-plural input like "pods", "deployments")
	if _, err := GetGVRForType(s); err == nil {
		return s
	}
	// Pluralize and try again
	plural := pluralizeKind(s)
	if _, err := GetGVRForType(plural); err == nil {
		return plural
	}
	// Fallback: return the pluralized form and let K8s API reject if wrong
	return plural
}

// pluralizeKind applies English pluralization rules for Kubernetes resource kinds.
func pluralizeKind(s string) string {
	switch {
	case strings.HasSuffix(s, "ss") || strings.HasSuffix(s, "ch") ||
		strings.HasSuffix(s, "sh") || strings.HasSuffix(s, "x"):
		// ingress → ingresses, ingressclass → ingressclasses
		return s + "es"
	case strings.HasSuffix(s, "cy") || strings.HasSuffix(s, "ry") ||
		strings.HasSuffix(s, "ty") || strings.HasSuffix(s, "gy") ||
		strings.HasSuffix(s, "ly") || strings.HasSuffix(s, "py"):
		// networkpolicy → networkpolicies, priorityclass handled by "ss" rule
		return s[:len(s)-1] + "ies"
	case strings.HasSuffix(s, "s"):
		// Already plural or ends in s (e.g., "endpoints" → keep as-is)
		return s
	default:
		return s + "s"
	}
}

// ListResources lists resources of the given kind in the cluster (optionally filtered by namespace).
// kind is normalized to resource type (e.g. "Pod" -> "pods"). Uses timeout, retry, and circuit breaker (5xx/429). Returns 404/403 from K8s as-is.
// BE-OBS-001: Instrumented with OpenTelemetry tracing.
// BE-SCALE-001: Uses circuit breaker to prevent cascading failures.
func (c *Client) ListResources(ctx context.Context, kind, namespace string, opts metav1.ListOptions) (*unstructured.UnstructuredList, error) {
	ctx, span := tracing.StartSpanWithAttributes(ctx, "k8s.list_resources",
		attribute.String("k8s.resource.kind", kind),
		attribute.String("k8s.resource.namespace", namespace),
	)
	defer span.End()

	if err := c.waitRateLimit(ctx); err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, err
	}

	resourceType := NormalizeKindToResource(kind)
	gvr, err := c.ResolveGVR(ctx, resourceType)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, err
	}

	var result *unstructured.UnstructuredList
	err = c.circuitBreaker.Execute(ctx, func() error {
		ctx, cancel := c.withTimeout(ctx)
		defer cancel()
		var fnErr error
		result, fnErr = doWithRetryValue(ctx, defaultRetryAttempts, func() (*unstructured.UnstructuredList, error) {
			if namespace != "" {
				return c.Dynamic.Resource(gvr).Namespace(namespace).List(ctx, opts)
			}
			return c.Dynamic.Resource(gvr).List(ctx, opts)
		})
		return fnErr
	})

	c.updateHealth(err)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	} else if result != nil {
		span.SetAttributes(attribute.Int("k8s.resource.count", len(result.Items)))
	}
	return result, err
}

// GetResource returns a single resource by kind, namespace, and name (with timeout, retry, and circuit breaker).
// BE-SCALE-001: Uses circuit breaker to prevent cascading failures.
func (c *Client) GetResource(ctx context.Context, kind, namespace, name string) (*unstructured.Unstructured, error) {
	if err := c.waitRateLimit(ctx); err != nil {
		return nil, err
	}

	resourceType := NormalizeKindToResource(kind)
	gvr, err := c.ResolveGVR(ctx, resourceType)
	if err != nil {
		return nil, err
	}

	var result *unstructured.Unstructured
	err = c.circuitBreaker.Execute(ctx, func() error {
		ctx, cancel := c.withTimeout(ctx)
		defer cancel()
		var fnErr error
		result, fnErr = doWithRetryValue(ctx, defaultRetryAttempts, func() (*unstructured.Unstructured, error) {
			if namespace != "" {
				return c.Dynamic.Resource(gvr).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
			}
			return c.Dynamic.Resource(gvr).Get(ctx, name, metav1.GetOptions{})
		})
		return fnErr
	})

	c.updateHealth(err)
	return result, err
}

// DeleteResource deletes a single resource by kind, namespace, and name (with timeout, retry, and circuit breaker).
// BE-SCALE-001: Uses circuit breaker to prevent cascading failures.
func (c *Client) DeleteResource(ctx context.Context, kind, namespace, name string, opts metav1.DeleteOptions) error {
	if err := c.waitRateLimit(ctx); err != nil {
		return err
	}

	resourceType := NormalizeKindToResource(kind)
	gvr, err := c.ResolveGVR(ctx, resourceType)
	if err != nil {
		return err
	}

	err = c.circuitBreaker.Execute(ctx, func() error {
		ctx, cancel := c.withTimeout(ctx)
		defer cancel()
		return doWithRetry(ctx, defaultRetryAttempts, func() error {
			if namespace != "" {
				return c.Dynamic.Resource(gvr).Namespace(namespace).Delete(ctx, name, opts)
			}
			return c.Dynamic.Resource(gvr).Delete(ctx, name, opts)
		})
	})

	c.updateHealth(err)
	return err
}

// PatchResource patches a single resource by kind, namespace, and name using JSON merge patch.
// BE-SCALE-001: Uses circuit breaker to prevent cascading failures.
func (c *Client) PatchResource(ctx context.Context, kind, namespace, name string, patch []byte) (*unstructured.Unstructured, error) {
	if err := c.waitRateLimit(ctx); err != nil {
		return nil, err
	}

	resourceType := NormalizeKindToResource(kind)
	gvr, err := c.ResolveGVR(ctx, resourceType)
	if err != nil {
		return nil, err
	}

	var result *unstructured.Unstructured
	err = c.circuitBreaker.Execute(ctx, func() error {
		ctx, cancel := c.withTimeout(ctx)
		defer cancel()
		var fnErr error
		result, fnErr = doWithRetryValue(ctx, defaultRetryAttempts, func() (*unstructured.Unstructured, error) {
			if namespace != "" {
				return c.Dynamic.Resource(gvr).Namespace(namespace).Patch(ctx, name, types.MergePatchType, patch, metav1.PatchOptions{})
			}
			return c.Dynamic.Resource(gvr).Patch(ctx, name, types.MergePatchType, patch, metav1.PatchOptions{})
		})
		return fnErr
	})

	c.updateHealth(err)
	return result, err
}

// CreateResource creates a resource from an unstructured object. The object must have apiVersion, kind, and metadata (namespace for namespaced resources). Uses timeout and retry.
func (c *Client) CreateResource(ctx context.Context, obj *unstructured.Unstructured) (*unstructured.Unstructured, error) {
	if err := c.waitRateLimit(ctx); err != nil {
		return nil, err
	}
	ctx, cancel := c.withTimeout(ctx)
	defer cancel()

	namespace := obj.GetNamespace()
	resourceType := NormalizeKindToResource(obj.GetKind())
	gvr, err := c.ResolveGVR(ctx, resourceType)
	if err != nil {
		return nil, err
	}
	// Jobs are namespaced; ensure namespace is set
	if namespace == "" {
		namespace = "default"
	}

	return doWithRetryValue(ctx, defaultRetryAttempts, func() (*unstructured.Unstructured, error) {
		return c.Dynamic.Resource(gvr).Namespace(namespace).Create(ctx, obj, metav1.CreateOptions{})
	})
}

// ListCRDInstances lists instances of a CRD by its full name (e.g. "certificates.cert-manager.io").
// Fetches the CRD, extracts GVR from spec (group, storage version, names.plural), and lists resources.
func (c *Client) ListCRDInstances(ctx context.Context, crdName, namespace string, opts metav1.ListOptions) (*unstructured.UnstructuredList, error) {
	if err := c.waitRateLimit(ctx); err != nil {
		return nil, err
	}
	ctx, cancel := c.withTimeout(ctx)
	defer cancel()

	crdGVR := schema.GroupVersionResource{
		Group:    "apiextensions.k8s.io",
		Version:  "v1",
		Resource: "customresourcedefinitions",
	}
	crdObj, err := c.Dynamic.Resource(crdGVR).Get(ctx, crdName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("get CRD %s: %w", crdName, err)
	}

	spec, ok := crdObj.Object["spec"].(map[string]interface{})
	if !ok || spec == nil {
		return nil, fmt.Errorf("CRD %s has no spec", crdName)
	}

	group, _ := spec["group"].(string)
	if group == "" {
		return nil, fmt.Errorf("CRD %s spec.group is empty", crdName)
	}

	names, _ := spec["names"].(map[string]interface{})
	plural, _ := names["plural"].(string)
	if plural == "" {
		return nil, fmt.Errorf("CRD %s spec.names.plural is empty", crdName)
	}

	versions, _ := spec["versions"].([]interface{})
	var version string
	for _, v := range versions {
		vm, _ := v.(map[string]interface{})
		if vm == nil {
			continue
		}
		if storage, _ := vm["storage"].(bool); storage {
			if vn, ok := vm["name"].(string); ok && vn != "" {
				version = vn
				break
			}
		}
	}
	if version == "" && len(versions) > 0 {
		if v0, ok := versions[0].(map[string]interface{}); ok {
			version, _ = v0["name"].(string)
		}
	}
	if version == "" {
		return nil, fmt.Errorf("CRD %s has no version", crdName)
	}

	gvr := schema.GroupVersionResource{Group: group, Version: version, Resource: plural}

	return doWithRetryValue(ctx, defaultRetryAttempts, func() (*unstructured.UnstructuredList, error) {
		if namespace != "" {
			return c.Dynamic.Resource(gvr).Namespace(namespace).List(ctx, opts)
		}
		return c.Dynamic.Resource(gvr).List(ctx, opts)
	})
}

// IsNamespaced returns whether the given kind is typically namespaced (for validation).
// Uses static map only; no client/context for discovery (CRD namespacing still correct for known types).
func IsNamespaced(kind string) bool {
	resourceType := NormalizeKindToResource(kind)
	gvr, err := GetGVRForType(resourceType)
	if err != nil {
		return true // default to namespaced
	}
	// Cluster-scoped: nodes, namespaces, persistentvolumes, storageclasses, clusterroles, clusterrolebindings
	clusterScoped := map[string]bool{
		"nodes":                             true,
		"namespaces":                        true,
		"persistentvolumes":                 true,
		"storageclasses":                    true,
		"clusterroles":                      true,
		"clusterrolebindings":               true,
		"ingressclasses":                    true,
		"priorityclasses":                   true,
		"runtimeclasses":                    true,
		"customresourcedefinitions":          true,
		"apiservices":                       true,
		"mutatingwebhookconfigurations":     true,
		"validatingwebhookconfigurations":   true,
		"csidrivers":                        true,
		"csinodes":                          true,
		"volumeattachments":                 true,
		"flowschemas":                       true,
		"prioritylevelconfigurations":       true,
	}
	_, ok := clusterScoped[gvr.Resource]
	return !ok
}
