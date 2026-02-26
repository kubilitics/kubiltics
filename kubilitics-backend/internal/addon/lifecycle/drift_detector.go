package lifecycle

import (
	"context"
	"log/slog"
	"reflect"
	"strings"
	"time"

	addonmetrics "github.com/kubilitics/kubilitics-backend/internal/addon/metrics"
	"github.com/kubilitics/kubilitics-backend/internal/addon/helm"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"sigs.k8s.io/yaml"
)

// DriftDetector compares Helm desired state (release manifest) with live cluster resources.
type DriftDetector struct {
	helmClient helm.HelmClient
	k8sClient  dynamic.Interface
	restMapper meta.RESTMapper
	logger     *slog.Logger
}

// NewDriftDetector creates a drift detector. restMapper is typically from restmapper.NewDeferredDiscoveryRESTMapper(discoveryClient).
func NewDriftDetector(
	helmClient helm.HelmClient,
	k8sClient dynamic.Interface,
	restMapper meta.RESTMapper,
	logger *slog.Logger,
) *DriftDetector {
	if logger == nil {
		logger = slog.Default()
	}
	return &DriftDetector{
		helmClient: helmClient,
		k8sClient:  k8sClient,
		restMapper: restMapper,
		logger:     logger,
	}
}

// DetectDrift fetches the release manifest from Helm, parses it to resources, and compares each with the live cluster.
// Returns a DriftEvent if any DriftDestructive or DriftStructural drift is found; nil if only cosmetic or none.
func (d *DriftDetector) DetectDrift(ctx context.Context, install models.AddOnInstallWithHealth) (*DriftEvent, error) {
	status, err := d.helmClient.Status(ctx, install.ReleaseName, install.Namespace)
	if err != nil {
		return nil, err
	}
	if status == nil || status.Manifest == "" {
		return nil, nil
	}
	desiredList, err := parseManifestToUnstructured(status.Manifest)
	if err != nil {
		return nil, err
	}
	var drifted []DriftedResource
	hasStructuralOrDestructive := false
	for _, desired := range desiredList {
		dr, severity := d.compareResource(ctx, desired, install.Namespace)
		if dr == nil {
			continue
		}
		if severity == DriftStructural || severity == DriftDestructive {
			drifted = append(drifted, *dr)
			hasStructuralOrDestructive = true
		}
	}
	if !hasStructuralOrDestructive {
		return nil, nil
	}
	severity := DriftStructural
	for _, dr := range drifted {
		if dr.ExpectedValue == "present" && dr.ActualValue == "missing" {
			severity = DriftDestructive
			break
		}
	}
	event := &DriftEvent{
		AddonInstallID:   install.ID,
		ClusterID:        install.ClusterID,
		DriftSeverity:    severity,
		DriftedResources: drifted,
		DetectedAt:       time.Now(),
	}
	// Prometheus: count drift events by cluster and severity (structural | destructive).
	addonmetrics.DriftDetectedTotal.WithLabelValues(install.ClusterID, strings.ToLower(severity)).Inc()
	return event, nil
}

func parseManifestToUnstructured(manifest string) ([]*unstructured.Unstructured, error) {
	docs := splitYAMLDocuments(manifest)
	var out []*unstructured.Unstructured
	for _, doc := range docs {
		doc = strings.TrimSpace(doc)
		if doc == "" {
			continue
		}
		obj := &unstructured.Unstructured{}
		if err := yaml.Unmarshal([]byte(doc), &obj.Object); err != nil {
			continue
		}
		if obj.GetKind() == "" || obj.GetName() == "" {
			continue
		}
		out = append(out, obj)
	}
	return out, nil
}

func splitYAMLDocuments(manifest string) []string {
	const sep = "\n---"
	var out []string
	for {
		idx := strings.Index(manifest, sep)
		if idx == -1 {
			if strings.TrimSpace(manifest) != "" {
				out = append(out, manifest)
			}
			break
		}
		out = append(out, manifest[:idx])
		manifest = manifest[idx+len(sep):]
	}
	return out
}

func (d *DriftDetector) compareResource(ctx context.Context, desired *unstructured.Unstructured, defaultNS string) (*DriftedResource, string) {
	gvk := desired.GroupVersionKind()
	if gvk.Empty() {
		gvk = schema.FromAPIVersionAndKind(desired.GetAPIVersion(), desired.GetKind())
	}
	mapping, err := d.restMapper.RESTMapping(gvk.GroupKind(), gvk.Version)
	if err != nil {
		d.logger.Debug("drift rest mapping", "gvk", gvk, "err", err)
		return nil, ""
	}
	ns := desired.GetNamespace()
	if ns == "" {
		ns = defaultNS
	}
	name := desired.GetName()
	gvr := mapping.Resource
	var res dynamic.ResourceInterface
	if mapping.Scope.Name() == meta.RESTScopeNameNamespace {
		res = d.k8sClient.Resource(gvr).Namespace(ns)
	} else {
		res = d.k8sClient.Resource(gvr)
	}
	live, err := res.Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) || strings.Contains(err.Error(), "NotFound") {
			return &DriftedResource{Kind: desired.GetKind(), Namespace: ns, Name: name, Field: "resource", ExpectedValue: "present", ActualValue: "missing"}, DriftDestructive
		}
		d.logger.Debug("drift get resource", "kind", desired.GetKind(), "name", name, "err", err)
		return nil, ""
	}
	// Compare desired vs live
	dr, severity := compareSpecAndMetadata(desired, live, desired.GetKind(), ns, name)
	return dr, severity
}

// compareSpecAndMetadata compares desired vs live Kubernetes resource state and returns a
// DriftedResource descriptor plus severity string, or nil/"" when no meaningful drift exists.
//
// Root cause of false positives in the original implementation:
//   reflect.DeepEqual on the full "spec" map matches the ENTIRE live spec, which always contains
//   many fields Kubernetes/admission webhooks inject that are absent from the Helm manifest:
//   e.g. spec.progressDeadlineSeconds=600, spec.revisionHistoryLimit=10,
//   spec.template.spec.terminationGracePeriodSeconds=30, spec.template.spec.dnsPolicy="ClusterFirst",
//   container.imagePullPolicy="IfNotPresent", container.terminationMessagePath, etc.
//
// Fix: desiredSubsetEqual — verifies only the fields the Helm chart explicitly sets are present
// in the live object with matching values. K8s-injected extra fields are silently ignored.
// A curated injectedSpecFields allowlist skips known Kubernetes defaulting fields even when
// they appear in the desired spec (e.g. from a chart that explicitly sets dnsPolicy).
func compareSpecAndMetadata(desired, live *unstructured.Unstructured, kind, ns, name string) (*DriftedResource, string) {
	specDiff := false
	var field, expected, actual string

	switch kind {
	case "ConfigMap", "Secret":
		// Compare only keys present in the desired data map.
		if desiredData, ok := desired.Object["data"].(map[string]interface{}); ok {
			if liveData, ok := live.Object["data"].(map[string]interface{}); ok {
				if !desiredSubsetEqual(desiredData, liveData) {
					specDiff = true
					field = "data"
					expected = "match desired"
					actual = "differs"
				}
			}
		}

	case "Role", "ClusterRole":
		// RBAC rules are an ordered list; Kubernetes does not inject entries, so exact comparison is correct.
		if desiredRules, ok := desired.Object["rules"]; ok {
			if liveRules, ok := live.Object["rules"]; ok {
				if !reflect.DeepEqual(desiredRules, liveRules) {
					specDiff = true
					field = "rules"
					expected = "match desired"
					actual = "differs"
				}
			}
		}

	case "RoleBinding", "ClusterRoleBinding":
		if desiredSubj := desired.Object["subjects"]; desiredSubj != nil {
			if !reflect.DeepEqual(desiredSubj, live.Object["subjects"]) {
				specDiff = true
				field = "subjects"
				expected = "match desired"
				actual = "differs"
			}
		}
		if !specDiff {
			if desiredRef := desired.Object["roleRef"]; desiredRef != nil {
				if !reflect.DeepEqual(desiredRef, live.Object["roleRef"]) {
					specDiff = true
					field = "roleRef"
					expected = "match desired"
					actual = "differs"
				}
			}
		}

	default:
		// Deployment, StatefulSet, DaemonSet, Service, Ingress, PVC, CRD instances, etc.
		// Use desiredSubsetEqual to avoid false positives from K8s-defaulted/injected fields.
		if desiredSpec, ok := desired.Object["spec"].(map[string]interface{}); ok {
			if liveSpec, ok := live.Object["spec"].(map[string]interface{}); ok {
				if !desiredSubsetEqual(desiredSpec, liveSpec) {
					specDiff = true
					field = "spec"
					expected = "match desired"
					actual = "differs"
				}
			}
		}
	}

	if specDiff {
		return &DriftedResource{Kind: kind, Namespace: ns, Name: name, Field: field, ExpectedValue: expected, ActualValue: actual}, DriftStructural
	}

	// Label/annotation diffs are DriftCosmetic. Compare only desired labels/annotations against
	// live, ignoring extra entries added by operators or Kubernetes itself.
	labelDiff := !labelsSubsetEqual(desired.GetLabels(), live.GetLabels())
	annDiff := !annotationsSubsetEqual(desired.GetAnnotations(), live.GetAnnotations())
	if labelDiff || annDiff {
		return &DriftedResource{Kind: kind, Namespace: ns, Name: name, Field: "metadata", ExpectedValue: "labels/annotations match", ActualValue: "differs"}, DriftCosmetic
	}
	return nil, ""
}

// desiredSubsetEqual returns true when every key present in desired also exists in live with
// an equal value. Keys present only in live (K8s-defaulted / admission-injected fields) are
// silently ignored. Comparison recurses into nested maps. Well-known injected field names
// (see injectedSpecFields) are skipped even when they appear in the desired map.
func desiredSubsetEqual(desired, live map[string]interface{}) bool {
	for k, dv := range desired {
		// Skip field names that Kubernetes commonly injects regardless of chart content.
		if injectedSpecFields[k] {
			continue
		}
		lv, ok := live[k]
		if !ok {
			return false
		}
		dMap, dIsMap := dv.(map[string]interface{})
		lMap, lIsMap := lv.(map[string]interface{})
		if dIsMap && lIsMap {
			if !desiredSubsetEqual(dMap, lMap) {
				return false
			}
		} else {
			if !reflect.DeepEqual(dv, lv) {
				return false
			}
		}
	}
	return true
}

// injectedSpecFields lists spec field names that Kubernetes defaulting or admission webhooks
// commonly inject into live objects. These fields are absent from Helm manifests but present
// in the live spec, and must be ignored during drift comparison to prevent false positives.
var injectedSpecFields = map[string]bool{
	// Pod scheduling defaults
	"nodeName":                      true,
	"schedulerName":                 true,
	"preemptionPolicy":              true,
	"priority":                      true,
	"priorityClassName":             true,
	// Pod networking / runtime defaults
	"dnsPolicy":                     true,
	"enableServiceLinks":            true,
	"restartPolicy":                 true,
	"terminationGracePeriodSeconds": true,
	// Service account admission controller injections
	"serviceAccountName":            true,
	"serviceAccount":                true,
	"automountServiceAccountToken":  true,
	// Deployment defaulting controller
	"progressDeadlineSeconds":       true,
	"revisionHistoryLimit":          true,
	// Pod security context defaulted to empty by kube-apiserver
	"securityContext":               true,
	// Projected service account token volumes/mounts added by SA admission controller.
	// These change per-cluster and are not part of chart intent.
	"volumes":                       true,
	"volumeMounts":                  true,
}

// labelsSubsetEqual returns true when every label key-value pair in desired exists in live.
// Extra labels in live (e.g. added by label sync operators or GitOps tools) are ignored.
func labelsSubsetEqual(desired, live map[string]string) bool {
	for k, dv := range desired {
		if lv, ok := live[k]; !ok || lv != dv {
			return false
		}
	}
	return true
}

// managedAnnotationPrefixes contains annotation key prefixes that Kubernetes manages internally.
// These should not be compared for drift because they change on every operation.
var managedAnnotationPrefixes = []string{
	"kubectl.kubernetes.io/",
	"deployment.kubernetes.io/",
	"autoscaling.alpha.kubernetes.io/",
	"control-plane.alpha.kubernetes.io/",
	"kubernetes.io/",
}

// annotationsSubsetEqual returns true when every annotation in desired that is NOT a Kubernetes-
// managed annotation also exists in live with the same value. Kubernetes-managed annotations
// (e.g. kubectl.kubernetes.io/last-applied-configuration, deployment.kubernetes.io/revision)
// are skipped in both desired and live to prevent false positives.
func annotationsSubsetEqual(desired, live map[string]string) bool {
	for k, dv := range desired {
		if isManagedAnnotation(k) {
			continue
		}
		if lv, ok := live[k]; !ok || lv != dv {
			return false
		}
	}
	return true
}

func isManagedAnnotation(key string) bool {
	for _, prefix := range managedAnnotationPrefixes {
		if strings.HasPrefix(key, prefix) {
			return true
		}
	}
	return false
}
