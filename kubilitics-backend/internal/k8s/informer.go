package k8s

import (
	"context"
	"fmt"
	"strings"
	"sync/atomic"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
)

// ResourceEventHandler handles resource events
type ResourceEventHandler func(eventType string, obj interface{})

// InformerManager manages Kubernetes informers for real-time updates.
// After Start() completes and HasSynced() returns true, its stores contain
// a full snapshot of all cluster resources — reads are sub-millisecond.
type InformerManager struct {
	client   *Client
	factory  informers.SharedInformerFactory
	stopCh   chan struct{}
	handlers map[string]ResourceEventHandler
	stores   map[string]cache.Store
	synced   atomic.Bool // true after WaitForCacheSync succeeds
}

// NewInformerManager creates a new informer manager
func NewInformerManager(client *Client) *InformerManager {
	// Resync period: periodic full re-list from K8s API as a consistency check.
	// 30s was too aggressive — with 25+ resource types per cluster it generates
	// a constant stream of LIST calls even when nothing changes. 5 minutes matches
	// Headlamp's approach: informers get real-time Watch events; the resync is just
	// a safety net for missed events, not a data source.
	factory := informers.NewSharedInformerFactory(client.Clientset, 5*time.Minute)

	return &InformerManager{
		client:   client,
		factory:  factory,
		stopCh:   make(chan struct{}),
		handlers: make(map[string]ResourceEventHandler),
		stores:   make(map[string]cache.Store),
	}
}

// RegisterHandler registers an event handler for a resource type
func (im *InformerManager) RegisterHandler(resourceType string, handler ResourceEventHandler) {
	im.handlers[resourceType] = handler
}

// Start starts all informers
func (im *InformerManager) Start(ctx context.Context) error {
	// Core resources
	im.setupPodInformer()
	im.setupServiceInformer()
	im.setupConfigMapInformer()
	im.setupSecretInformer()
	im.setupNodeInformer()
	im.setupNamespaceInformer()
	im.setupPersistentVolumeInformer()
	im.setupPersistentVolumeClaimInformer()
	im.setupServiceAccountInformer()
	im.setupEndpointsInformer()
	im.setupEventInformer()

	// Apps resources
	im.setupDeploymentInformer()
	im.setupReplicaSetInformer()
	im.setupStatefulSetInformer()
	im.setupDaemonSetInformer()

	// Batch resources
	im.setupJobInformer()
	im.setupCronJobInformer()

	// Networking resources
	im.setupIngressInformer()
	im.setupIngressClassInformer()
	im.setupNetworkPolicyInformer()

	// RBAC resources
	im.setupRoleInformer()
	im.setupRoleBindingInformer()
	im.setupClusterRoleInformer()
	im.setupClusterRoleBindingInformer()

	// Storage resources
	im.setupStorageClassInformer()

	// Autoscaling resources
	im.setupHorizontalPodAutoscalerInformer()

	// Policy resources
	im.setupPodDisruptionBudgetInformer()

	// Start all informers
	im.factory.Start(im.stopCh)

	// Wait for cache sync
	syncMap := im.factory.WaitForCacheSync(im.stopCh)
	for resource, ok := range syncMap {
		if !ok {
			return fmt.Errorf("failed to sync cache for resource: %v", resource)
		}
	}

	im.synced.Store(true)
	return nil
}

// HasSynced returns true after all informer caches have completed their
// initial list+watch sync. Before this returns true, ListFromCache will
// return (nil, false) to force a direct API call.
func (im *InformerManager) HasSynced() bool {
	return im.synced.Load()
}

// resourceKindToStoreKey maps the lowercase-plural resource type used in REST URLs
// to the PascalCase kind used as the informer store key.
var resourceKindToStoreKey = map[string]string{
	"pods":                     "Pod",
	"services":                 "Service",
	"configmaps":               "ConfigMap",
	"secrets":                  "Secret",
	"nodes":                    "Node",
	"namespaces":               "Namespace",
	"persistentvolumes":        "PersistentVolume",
	"persistentvolumeclaims":   "PersistentVolumeClaim",
	"serviceaccounts":          "ServiceAccount",
	"endpoints":                "Endpoints",
	"events":                   "Event",
	"deployments":              "Deployment",
	"replicasets":              "ReplicaSet",
	"statefulsets":             "StatefulSet",
	"daemonsets":               "DaemonSet",
	"jobs":                     "Job",
	"cronjobs":                 "CronJob",
	"ingresses":                "Ingress",
	"ingressclasses":           "IngressClass",
	"networkpolicies":          "NetworkPolicy",
	"roles":                    "Role",
	"rolebindings":             "RoleBinding",
	"clusterroles":             "ClusterRole",
	"clusterrolebindings":      "ClusterRoleBinding",
	"storageclasses":           "StorageClass",
	"horizontalpodautoscalers": "HorizontalPodAutoscaler",
	"poddisruptionbudgets":     "PodDisruptionBudget",
}

// ListFromCache reads resources from the in-memory informer cache.
// Returns (list, true) on cache hit or (nil, false) when the cache is
// unavailable or the resource type is not tracked by informers.
//
// This is the Lens/Headlamp model: informers maintain a live mirror of
// the cluster state via Watch; reads are served from local memory in <1ms.
// The caller should fall back to a direct K8s API call on cache miss.
//
// Supports optional namespace filtering and basic limit/offset pagination.
// Label selectors and field selectors are NOT supported — cache miss.
func (im *InformerManager) ListFromCache(resourceType, namespace string, opts metav1.ListOptions) (*unstructured.UnstructuredList, bool) {
	// Cannot serve from cache if informers haven't synced yet
	if !im.HasSynced() {
		return nil, false
	}

	// Label/field selectors require server-side filtering — cache miss
	if opts.LabelSelector != "" || opts.FieldSelector != "" {
		return nil, false
	}

	// Continue tokens are K8s API server state — not applicable to local cache
	if opts.Continue != "" {
		return nil, false
	}

	// Map resource type to store key
	storeKey, ok := resourceKindToStoreKey[strings.ToLower(resourceType)]
	if !ok {
		return nil, false
	}

	store := im.stores[storeKey]
	if store == nil {
		return nil, false
	}

	// Read all items from the informer store (lock-free, O(n))
	items := store.List()
	result := &unstructured.UnstructuredList{}

	for _, item := range items {
		// Convert runtime.Object to unstructured
		obj, err := runtime.DefaultUnstructuredConverter.ToUnstructured(item)
		if err != nil {
			continue
		}
		u := unstructured.Unstructured{Object: obj}

		// Namespace filter
		if namespace != "" && u.GetNamespace() != namespace {
			continue
		}

		result.Items = append(result.Items, u)
	}

	// Apply limit if specified
	if opts.Limit > 0 && int64(len(result.Items)) > opts.Limit {
		result.Items = result.Items[:opts.Limit]
	}

	return result, true
}

// Stop stops all informers
func (im *InformerManager) Stop() {
	if im.stopCh != nil {
		close(im.stopCh)
	}
}

// GetStore returns the store for a resource type
func (im *InformerManager) GetStore(resourceType string) cache.Store {
	return im.stores[resourceType]
}

// setupPodInformer sets up Pod informer
func (im *InformerManager) setupPodInformer() {
	informer := im.factory.Core().V1().Pods().Informer()
	im.stores["Pod"] = informer.GetStore()
	_, _ = informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["Pod"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["Pod"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["Pod"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupServiceInformer sets up Service informer
func (im *InformerManager) setupServiceInformer() {
	informer := im.factory.Core().V1().Services().Informer()
	im.stores["Service"] = informer.GetStore()
	_, _ = informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["Service"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["Service"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["Service"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupDeploymentInformer sets up Deployment informer
func (im *InformerManager) setupDeploymentInformer() {
	informer := im.factory.Apps().V1().Deployments().Informer()
	im.stores["Deployment"] = informer.GetStore()
	_, _ = informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["Deployment"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["Deployment"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["Deployment"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupReplicaSetInformer sets up ReplicaSet informer
func (im *InformerManager) setupReplicaSetInformer() {
	informer := im.factory.Apps().V1().ReplicaSets().Informer()
	im.stores["ReplicaSet"] = informer.GetStore()
	_, _ = informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["ReplicaSet"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["ReplicaSet"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["ReplicaSet"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupStatefulSetInformer sets up StatefulSet informer
func (im *InformerManager) setupStatefulSetInformer() {
	informer := im.factory.Apps().V1().StatefulSets().Informer()
	im.stores["StatefulSet"] = informer.GetStore()
	_, _ = informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["StatefulSet"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["StatefulSet"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["StatefulSet"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupDaemonSetInformer sets up DaemonSet informer
func (im *InformerManager) setupDaemonSetInformer() {
	informer := im.factory.Apps().V1().DaemonSets().Informer()
	im.stores["DaemonSet"] = informer.GetStore()
	_, _ = informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["DaemonSet"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["DaemonSet"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["DaemonSet"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupJobInformer sets up Job informer
func (im *InformerManager) setupJobInformer() {
	informer := im.factory.Batch().V1().Jobs().Informer()
	im.stores["Job"] = informer.GetStore()
	_, _ = informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["Job"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["Job"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["Job"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupCronJobInformer sets up CronJob informer
func (im *InformerManager) setupCronJobInformer() {
	informer := im.factory.Batch().V1().CronJobs().Informer()
	im.stores["CronJob"] = informer.GetStore()
	_, _ = informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["CronJob"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["CronJob"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["CronJob"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupConfigMapInformer sets up ConfigMap informer
func (im *InformerManager) setupConfigMapInformer() {
	informer := im.factory.Core().V1().ConfigMaps().Informer()
	im.stores["ConfigMap"] = informer.GetStore()
	_, _ = informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["ConfigMap"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["ConfigMap"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["ConfigMap"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupSecretInformer sets up Secret informer
func (im *InformerManager) setupSecretInformer() {
	informer := im.factory.Core().V1().Secrets().Informer()
	im.stores["Secret"] = informer.GetStore()
	_, _ = informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["Secret"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["Secret"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["Secret"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupNodeInformer sets up Node informer
func (im *InformerManager) setupNodeInformer() {
	informer := im.factory.Core().V1().Nodes().Informer()
	im.stores["Node"] = informer.GetStore()
	_, _ = informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["Node"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["Node"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["Node"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupNamespaceInformer sets up Namespace informer
func (im *InformerManager) setupNamespaceInformer() {
	informer := im.factory.Core().V1().Namespaces().Informer()
	im.stores["Namespace"] = informer.GetStore()
	_, _ = informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["Namespace"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["Namespace"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["Namespace"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupPersistentVolumeInformer sets up PersistentVolume informer
func (im *InformerManager) setupPersistentVolumeInformer() {
	informer := im.factory.Core().V1().PersistentVolumes().Informer()
	im.stores["PersistentVolume"] = informer.GetStore()
	_, _ = informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["PersistentVolume"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["PersistentVolume"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["PersistentVolume"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupPersistentVolumeClaimInformer sets up PersistentVolumeClaim informer
func (im *InformerManager) setupPersistentVolumeClaimInformer() {
	informer := im.factory.Core().V1().PersistentVolumeClaims().Informer()
	im.stores["PersistentVolumeClaim"] = informer.GetStore()
	informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["PersistentVolumeClaim"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["PersistentVolumeClaim"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["PersistentVolumeClaim"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupServiceAccountInformer sets up ServiceAccount informer
func (im *InformerManager) setupServiceAccountInformer() {
	informer := im.factory.Core().V1().ServiceAccounts().Informer()
	im.stores["ServiceAccount"] = informer.GetStore()
	informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["ServiceAccount"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["ServiceAccount"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["ServiceAccount"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupEndpointsInformer sets up Endpoints informer
func (im *InformerManager) setupEndpointsInformer() {
	informer := im.factory.Core().V1().Endpoints().Informer()
	im.stores["Endpoints"] = informer.GetStore()
	informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["Endpoints"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["Endpoints"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["Endpoints"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupEventInformer sets up Event informer
func (im *InformerManager) setupEventInformer() {
	informer := im.factory.Core().V1().Events().Informer()
	im.stores["Event"] = informer.GetStore()
	informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["Event"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["Event"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["Event"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupIngressInformer sets up Ingress informer
func (im *InformerManager) setupIngressInformer() {
	informer := im.factory.Networking().V1().Ingresses().Informer()
	im.stores["Ingress"] = informer.GetStore()
	informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["Ingress"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["Ingress"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["Ingress"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupIngressClassInformer sets up IngressClass informer
func (im *InformerManager) setupIngressClassInformer() {
	informer := im.factory.Networking().V1().IngressClasses().Informer()
	im.stores["IngressClass"] = informer.GetStore()
	informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["IngressClass"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["IngressClass"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["IngressClass"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupNetworkPolicyInformer sets up NetworkPolicy informer
func (im *InformerManager) setupNetworkPolicyInformer() {
	informer := im.factory.Networking().V1().NetworkPolicies().Informer()
	im.stores["NetworkPolicy"] = informer.GetStore()
	informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["NetworkPolicy"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["NetworkPolicy"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["NetworkPolicy"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupRoleInformer sets up Role informer
func (im *InformerManager) setupRoleInformer() {
	informer := im.factory.Rbac().V1().Roles().Informer()
	im.stores["Role"] = informer.GetStore()
	informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["Role"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["Role"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["Role"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupRoleBindingInformer sets up RoleBinding informer
func (im *InformerManager) setupRoleBindingInformer() {
	informer := im.factory.Rbac().V1().RoleBindings().Informer()
	im.stores["RoleBinding"] = informer.GetStore()
	informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["RoleBinding"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["RoleBinding"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["RoleBinding"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupClusterRoleInformer sets up ClusterRole informer
func (im *InformerManager) setupClusterRoleInformer() {
	informer := im.factory.Rbac().V1().ClusterRoles().Informer()
	im.stores["ClusterRole"] = informer.GetStore()
	informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["ClusterRole"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["ClusterRole"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["ClusterRole"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupClusterRoleBindingInformer sets up ClusterRoleBinding informer
func (im *InformerManager) setupClusterRoleBindingInformer() {
	informer := im.factory.Rbac().V1().ClusterRoleBindings().Informer()
	im.stores["ClusterRoleBinding"] = informer.GetStore()
	informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["ClusterRoleBinding"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["ClusterRoleBinding"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["ClusterRoleBinding"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupStorageClassInformer sets up StorageClass informer
func (im *InformerManager) setupStorageClassInformer() {
	informer := im.factory.Storage().V1().StorageClasses().Informer()
	im.stores["StorageClass"] = informer.GetStore()
	informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["StorageClass"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["StorageClass"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["StorageClass"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupHorizontalPodAutoscalerInformer sets up HorizontalPodAutoscaler informer
func (im *InformerManager) setupHorizontalPodAutoscalerInformer() {
	informer := im.factory.Autoscaling().V2().HorizontalPodAutoscalers().Informer()
	im.stores["HorizontalPodAutoscaler"] = informer.GetStore()
	informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["HorizontalPodAutoscaler"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["HorizontalPodAutoscaler"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["HorizontalPodAutoscaler"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}

// setupPodDisruptionBudgetInformer sets up PodDisruptionBudget informer
func (im *InformerManager) setupPodDisruptionBudgetInformer() {
	informer := im.factory.Policy().V1().PodDisruptionBudgets().Informer()
	im.stores["PodDisruptionBudget"] = informer.GetStore()
	informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if handler, ok := im.handlers["PodDisruptionBudget"]; ok {
				handler("ADDED", obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if handler, ok := im.handlers["PodDisruptionBudget"]; ok {
				handler("MODIFIED", newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if handler, ok := im.handlers["PodDisruptionBudget"]; ok {
				handler("DELETED", obj)
			}
		},
	})
}
