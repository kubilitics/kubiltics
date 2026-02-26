package k8s

import (
	"context"
	"fmt"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/yaml"
)

// AppliedResource describes a resource that was created or updated by ApplyYAML.
type AppliedResource struct {
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Action    string `json:"action"` // "created" or "updated"
}

// ApplyYAML decodes YAML (single or multi-doc) and creates or updates each resource via the dynamic client.
// Returns the list of applied resources and the first error encountered.
func (c *Client) ApplyYAML(ctx context.Context, yamlContent string) ([]AppliedResource, error) {
	docs := splitYAMLDocuments(yamlContent)
	var applied []AppliedResource
	for _, doc := range docs {
		doc = strings.TrimSpace(doc)
		if doc == "" {
			continue
		}
		var m map[string]interface{}
		if err := yaml.Unmarshal([]byte(doc), &m); err != nil {
			return applied, fmt.Errorf("invalid YAML: %w", err)
		}
		if len(m) == 0 {
			continue
		}
		obj := &unstructured.Unstructured{Object: m}
		action, err := c.applyOne(ctx, obj)
		if err != nil {
			return applied, err
		}
		applied = append(applied, AppliedResource{
			Kind:      obj.GetKind(),
			Namespace: obj.GetNamespace(),
			Name:      obj.GetName(),
			Action:    action,
		})
	}
	return applied, nil
}

func (c *Client) applyOne(ctx context.Context, obj *unstructured.Unstructured) (string, error) {
	if err := c.waitRateLimit(ctx); err != nil {
		return "", err
	}
	apiVersion := obj.GetAPIVersion()
	kind := obj.GetKind()
	name := obj.GetName()
	namespace := obj.GetNamespace()
	if name == "" {
		return "", fmt.Errorf("resource missing metadata.name")
	}

	// BE-FUNC-001: Default namespace for namespaced resources
	if namespace == "" && IsNamespaced(kind) {
		namespace = "default"
		obj.SetNamespace(namespace)
	}

	gv, err := schema.ParseGroupVersion(apiVersion)
	if err != nil {
		return "", fmt.Errorf("invalid apiVersion %q: %w", apiVersion, err)
	}
	resource := NormalizeKindToResource(kind)
	gvr := gv.WithResource(resource)

	// Remove read-only fields that would cause conflicts
	objCopy := obj.DeepCopy()
	unstructured.RemoveNestedField(objCopy.Object, "metadata", "resourceVersion")
	unstructured.RemoveNestedField(objCopy.Object, "metadata", "uid")
	unstructured.RemoveNestedField(objCopy.Object, "metadata", "creationTimestamp")
	unstructured.RemoveNestedField(objCopy.Object, "status")

	resourceClient := c.Dynamic.Resource(gvr)
	// Namespace("") yields cluster-scoped ResourceInterface when resource is cluster-scoped
	nsClient := resourceClient.Namespace(namespace)

	_, err = nsClient.Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			_, createErr := nsClient.Create(ctx, objCopy, metav1.CreateOptions{})
			if createErr != nil {
				return "", createErr
			}
			return "created", nil
		}
		return "", err
	}

	_, updateErr := nsClient.Update(ctx, objCopy, metav1.UpdateOptions{})
	if updateErr != nil {
		return "", updateErr
	}
	return "updated", nil
}

// splitYAMLDocuments splits multi-doc YAML by "---" (with optional surrounding newlines).
func splitYAMLDocuments(content string) []string {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil
	}
	// Split by "\n---" or "---\n" to handle K8s-style multi-doc
	sep := "\n---"
	parts := strings.Split(content, sep)
	var out []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	// If no "---" was found, the whole content is one doc
	if len(out) == 0 {
		out = []string{content}
	}
	return out
}
