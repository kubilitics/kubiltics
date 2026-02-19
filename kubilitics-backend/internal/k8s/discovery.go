package k8s

import (
	"context"
	"fmt"
	"strings"
	"time"

	"k8s.io/apimachinery/pkg/runtime/schema"
)

const discoveryCacheTTL = 5 * time.Minute

// DiscoveredResource represents a discovered K8s resource type
type DiscoveredResource struct {
	GVR       schema.GroupVersionResource
	Kind      string
	Namespace bool // Is namespaced
}

// DiscoverAllResources discovers all available resource types in the cluster
func (c *Client) DiscoverAllResources(ctx context.Context) ([]DiscoveredResource, error) {
	apiResourceLists, err := c.Clientset.Discovery().ServerPreferredResources()
	if err != nil {
		// Partial discovery is OK, some APIs might be unavailable
		fmt.Printf("Warning: partial discovery: %v\n", err)
	}

	var resources []DiscoveredResource

	for _, apiResourceList := range apiResourceLists {
		gv, err := schema.ParseGroupVersion(apiResourceList.GroupVersion)
		if err != nil {
			continue
		}

		for _, apiResource := range apiResourceList.APIResources {
			// Skip subresources
			if len(apiResource.Name) == 0 || apiResource.Name[0] == '/' {
				continue
			}

			gvr := schema.GroupVersionResource{
				Group:    gv.Group,
				Version:  gv.Version,
				Resource: apiResource.Name,
			}

			resources = append(resources, DiscoveredResource{
				GVR:       gvr,
				Kind:      apiResource.Kind,
				Namespace: apiResource.Namespaced,
			})
		}
	}

	return resources, nil
}

// GetGVRForType returns the GroupVersionResource for a resource type
func GetGVRForType(resourceType string) (schema.GroupVersionResource, error) {
	// Core resources (no group)
	coreResources := map[string]schema.GroupVersionResource{
		"pods":                   {Group: "", Version: "v1", Resource: "pods"},
		"services":               {Group: "", Version: "v1", Resource: "services"},
		"configmaps":             {Group: "", Version: "v1", Resource: "configmaps"},
		"secrets":                {Group: "", Version: "v1", Resource: "secrets"},
		"namespaces":             {Group: "", Version: "v1", Resource: "namespaces"},
		"nodes":                  {Group: "", Version: "v1", Resource: "nodes"},
		"persistentvolumes":      {Group: "", Version: "v1", Resource: "persistentvolumes"},
		"persistentvolumeclaims": {Group: "", Version: "v1", Resource: "persistentvolumeclaims"},
		"serviceaccounts":        {Group: "", Version: "v1", Resource: "serviceaccounts"},
		"endpoints":              {Group: "", Version: "v1", Resource: "endpoints"},
		"events":                 {Group: "", Version: "v1", Resource: "events"},
		"resourcequotas":         {Group: "", Version: "v1", Resource: "resourcequotas"},
		"limitranges":            {Group: "", Version: "v1", Resource: "limitranges"},
		"replicationcontrollers": {Group: "", Version: "v1", Resource: "replicationcontrollers"},
		"podtemplates":             {Group: "", Version: "v1", Resource: "podtemplates"},
	}

	// Apps resources
	appsResources := map[string]schema.GroupVersionResource{
		"deployments":           {Group: "apps", Version: "v1", Resource: "deployments"},
		"replicasets":           {Group: "apps", Version: "v1", Resource: "replicasets"},
		"statefulsets":          {Group: "apps", Version: "v1", Resource: "statefulsets"},
		"daemonsets":            {Group: "apps", Version: "v1", Resource: "daemonsets"},
		"controllerrevisions":   {Group: "apps", Version: "v1", Resource: "controllerrevisions"},
	}

	// Batch resources
	batchResources := map[string]schema.GroupVersionResource{
		"jobs":     {Group: "batch", Version: "v1", Resource: "jobs"},
		"cronjobs": {Group: "batch", Version: "v1", Resource: "cronjobs"},
	}

	// Networking resources
	networkResources := map[string]schema.GroupVersionResource{
		"ingresses":        {Group: "networking.k8s.io", Version: "v1", Resource: "ingresses"},
		"networkpolicies":  {Group: "networking.k8s.io", Version: "v1", Resource: "networkpolicies"},
		"ingressclasses":   {Group: "networking.k8s.io", Version: "v1", Resource: "ingressclasses"},
	}

	// Discovery resources (EndpointSlices)
	discoveryResources := map[string]schema.GroupVersionResource{
		"endpointslices": {Group: "discovery.k8s.io", Version: "v1", Resource: "endpointslices"},
	}

	// DRA resources (Dynamic Resource Allocation - K8s 1.31+)
	draResources := map[string]schema.GroupVersionResource{
		"resourceslices":  {Group: "resource.k8s.io", Version: "v1alpha3", Resource: "resourceslices"},
		"deviceclasses":   {Group: "resource.k8s.io", Version: "v1", Resource: "deviceclasses"},
	}

	// MetalLB CRDs (bare-metal load balancer — common in on-prem)
	metallbResources := map[string]schema.GroupVersionResource{
		"ipaddresspools": {Group: "metallb.io", Version: "v1beta1", Resource: "ipaddresspools"},
		"bgppeers":       {Group: "metallb.io", Version: "v1beta2", Resource: "bgppeers"},
	}

	// RBAC resources
	rbacResources := map[string]schema.GroupVersionResource{
		"roles":               {Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "roles"},
		"rolebindings":        {Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "rolebindings"},
		"clusterroles":        {Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "clusterroles"},
		"clusterrolebindings": {Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "clusterrolebindings"},
	}

	// Storage resources
	storageResources := map[string]schema.GroupVersionResource{
		"storageclasses":     {Group: "storage.k8s.io", Version: "v1", Resource: "storageclasses"},
		"volumeattachments":  {Group: "storage.k8s.io", Version: "v1", Resource: "volumeattachments"},
	}

	// Snapshot resources (CSI Volume Snapshots - CRDs)
	snapshotResources := map[string]schema.GroupVersionResource{
		"volumesnapshots":        {Group: "snapshot.storage.k8s.io", Version: "v1", Resource: "volumesnapshots"},
		"volumesnapshotclasses":  {Group: "snapshot.storage.k8s.io", Version: "v1", Resource: "volumesnapshotclasses"},
		"volumesnapshotcontents": {Group: "snapshot.storage.k8s.io", Version: "v1", Resource: "volumesnapshotcontents"},
	}

	// Autoscaling resources
	autoscalingResources := map[string]schema.GroupVersionResource{
		"horizontalpodautoscalers": {Group: "autoscaling", Version: "v2", Resource: "horizontalpodautoscalers"},
		"verticalpodautoscalers":   {Group: "autoscaling.k8s.io", Version: "v1", Resource: "verticalpodautoscalers"},
	}

	// Policy resources
	policyResources := map[string]schema.GroupVersionResource{
		"poddisruptionbudgets": {Group: "policy", Version: "v1", Resource: "poddisruptionbudgets"},
	}

	// Scheduling resources
	schedulingResources := map[string]schema.GroupVersionResource{
		"priorityclasses": {Group: "scheduling.k8s.io", Version: "v1", Resource: "priorityclasses"},
	}

	// Coordination resources
	coordinationResources := map[string]schema.GroupVersionResource{
		"leases": {Group: "coordination.k8s.io", Version: "v1", Resource: "leases"},
	}

	// API registration
	apiregistrationResources := map[string]schema.GroupVersionResource{
		"apiservices": {Group: "apiregistration.k8s.io", Version: "v1", Resource: "apiservices"},
	}

	// Custom resources
	apiextensionsResources := map[string]schema.GroupVersionResource{
		"customresourcedefinitions": {Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions"},
	}

	// Admission control
	admissionResources := map[string]schema.GroupVersionResource{
		"mutatingwebhookconfigurations":   {Group: "admissionregistration.k8s.io", Version: "v1", Resource: "mutatingwebhookconfigurations"},
		"validatingwebhookconfigurations": {Group: "admissionregistration.k8s.io", Version: "v1", Resource: "validatingwebhookconfigurations"},
	}

	// Check all maps
	if gvr, ok := coreResources[resourceType]; ok {
		return gvr, nil
	}
	if gvr, ok := appsResources[resourceType]; ok {
		return gvr, nil
	}
	if gvr, ok := batchResources[resourceType]; ok {
		return gvr, nil
	}
	if gvr, ok := networkResources[resourceType]; ok {
		return gvr, nil
	}
	if gvr, ok := discoveryResources[resourceType]; ok {
		return gvr, nil
	}
	if gvr, ok := draResources[resourceType]; ok {
		return gvr, nil
	}
	if gvr, ok := metallbResources[resourceType]; ok {
		return gvr, nil
	}
	if gvr, ok := rbacResources[resourceType]; ok {
		return gvr, nil
	}
	if gvr, ok := storageResources[resourceType]; ok {
		return gvr, nil
	}
	if gvr, ok := snapshotResources[resourceType]; ok {
		return gvr, nil
	}
	if gvr, ok := autoscalingResources[resourceType]; ok {
		return gvr, nil
	}
	if gvr, ok := policyResources[resourceType]; ok {
		return gvr, nil
	}
	if gvr, ok := schedulingResources[resourceType]; ok {
		return gvr, nil
	}
	if gvr, ok := coordinationResources[resourceType]; ok {
		return gvr, nil
	}
	if gvr, ok := apiregistrationResources[resourceType]; ok {
		return gvr, nil
	}
	if gvr, ok := apiextensionsResources[resourceType]; ok {
		return gvr, nil
	}
	if gvr, ok := admissionResources[resourceType]; ok {
		return gvr, nil
	}

	return schema.GroupVersionResource{}, fmt.Errorf("unknown resource type: %s", resourceType)
}

// ResolveGVR returns the GroupVersionResource for a resource type, with BA-8 fallback to live discovery for CRDs.
// Tries the hardcoded map first; on miss, calls DiscoverAllResources (cached 5 min) and looks up the resource.
func (c *Client) ResolveGVR(ctx context.Context, resourceType string) (schema.GroupVersionResource, error) {
	gvr, err := GetGVRForType(resourceType)
	if err == nil {
		return gvr, nil
	}

	c.discoveryCacheMu.Lock()
	defer c.discoveryCacheMu.Unlock()
	if time.Since(c.discoveryCacheTime) > discoveryCacheTTL || len(c.discoveryCache) == 0 {
		list, discoverErr := c.DiscoverAllResources(ctx)
		if discoverErr != nil {
			return schema.GroupVersionResource{}, fmt.Errorf("unknown resource type: %s (discovery failed: %w)", resourceType, discoverErr)
		}
		c.discoveryCache = list
		c.discoveryCacheTime = time.Now()
	}
	rtLower := strings.ToLower(strings.TrimSpace(resourceType))
	for _, dr := range c.discoveryCache {
		if strings.EqualFold(dr.GVR.Resource, rtLower) {
			return dr.GVR, nil
		}
	}
	return schema.GroupVersionResource{}, fmt.Errorf("unknown resource type: %s", resourceType)
}
