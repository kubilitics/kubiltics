package k8s

import (
	"context"
	"fmt"
	"log"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/workqueue"
	informers "k8s.io/client-go/informers"
	corev1informers "k8s.io/client-go/informers/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const (
	// ClusterLabelKey is the label key to identify cluster kubeconfig Secrets
	ClusterLabelKey = "kubilitics.io/cluster-kubeconfig"
	// ClusterLabelValue is the label value for cluster kubeconfigs
	ClusterLabelValue = "true"

	// Annotation keys for cluster metadata
	ClusterNameAnnotation        = "kubilitics.io/cluster-name"
	ClusterProviderAnnotation    = "kubilitics.io/cluster-provider"
	ClusterEnvironmentAnnotation = "kubilitics.io/cluster-environment"
	ClusterRegionAnnotation      = "kubilitics.io/cluster-region"

	// Default data key for kubeconfig in Secret
	KubeconfigDataKey = "kubeconfig"
)

// DiscoveredCluster represents a cluster discovered from a labeled Secret
type DiscoveredCluster struct {
	// Name is the cluster name (from annotation or defaults to SecretName)
	Name string
	// Namespace is the namespace where the Secret is stored
	Namespace string
	// SecretName is the name of the Secret containing the kubeconfig
	SecretName string
	// Provider is the cluster provider hint (e.g., "eks", "gke", "aks")
	Provider string
	// Environment is the environment tag (e.g., "production", "staging", "dev")
	Environment string
	// Region is the cluster region hint
	Region string
	// Kubeconfig is the raw kubeconfig YAML bytes
	Kubeconfig []byte
	// Labels are all labels from the Secret
	Labels map[string]string
	// Annotations are all annotations from the Secret
	Annotations map[string]string
}

// ClusterDiscovery watches for labeled Secrets and automatically registers/updates/removes clusters
type ClusterDiscovery struct {
	clientset kubernetes.Interface
	namespace string
	informer  corev1informers.SecretInformer
	workqueue workqueue.RateLimitingInterface //nolint:staticcheck // TODO: migrate to TypedRateLimitingInterface

	// Callbacks
	onAdd    func(clusterName string, kubeconfig []byte, annotations map[string]string)
	onUpdate func(clusterName string, kubeconfig []byte, annotations map[string]string)
	onDelete func(clusterName string, kubeconfig []byte, annotations map[string]string)

	stopChan chan struct{}
	doneChan chan struct{}
}

// NewClusterDiscovery creates a new ClusterDiscovery instance
// onAdd: called when a labeled Secret is added
// onUpdate: called when a labeled Secret is updated
// onDelete: called when a labeled Secret is deleted (clusterName and kubeconfig may be empty/nil)
func NewClusterDiscovery(
	clientset kubernetes.Interface,
	namespace string,
	onAdd, onUpdate, onDelete func(clusterName string, kubeconfig []byte, annotations map[string]string),
) *ClusterDiscovery {
	return &ClusterDiscovery{
		clientset: clientset,
		namespace: namespace,
		onAdd:     onAdd,
		onUpdate:  onUpdate,
		onDelete:  onDelete,
		workqueue: workqueue.NewRateLimitingQueue(workqueue.DefaultControllerRateLimiter()), //nolint:staticcheck // TODO: migrate to NewTypedRateLimitingQueue
		stopChan:  make(chan struct{}),
		doneChan:  make(chan struct{}),
	}
}

// Start begins watching for labeled Secrets. It runs the informer and processes queue items.
// Returns an error if the informer factory or informer cannot be created.
func (cd *ClusterDiscovery) Start(ctx context.Context) error {
	// Create a shared informer factory with the label selector
	labelSelector := fmt.Sprintf("%s=%s", ClusterLabelKey, ClusterLabelValue)

	informerFactory := informers.NewSharedInformerFactoryWithOptions(
		cd.clientset,
		0, // resyncPeriod = 0 means use default
		informers.WithNamespace(cd.namespace),
		informers.WithTweakListOptions(func(opts *metav1.ListOptions) {
			opts.LabelSelector = labelSelector
		}),
	)

	cd.informer = informerFactory.Core().V1().Secrets()

	// Register event handlers
	_, _ = cd.informer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    cd.enqueueSecret,
		UpdateFunc: cd.enqueueSecretUpdate,
		DeleteFunc: cd.enqueueSecret,
	})

	// Start the informer
	stopCh := make(chan struct{})
	go informerFactory.Start(stopCh)

	// Wait for cache to sync
	if !cache.WaitForCacheSync(stopCh, cd.informer.Informer().HasSynced) {
		return fmt.Errorf("timed out waiting for cache to sync")
	}

	// Process work queue items
	go cd.processQueue(ctx)

	// Wrap the stop in a goroutine that listens to both internal stopChan and context
	go func() {
		<-ctx.Done()
		close(stopCh)
		cd.Stop()
	}()

	return nil
}

// Stop gracefully shuts down the ClusterDiscovery watcher
func (cd *ClusterDiscovery) Stop() {
	close(cd.stopChan)
	cd.workqueue.ShutDown()
	<-cd.doneChan
}

// DiscoverExisting performs a one-time scan of all labeled Secrets and returns the discovered clusters
func (cd *ClusterDiscovery) DiscoverExisting(ctx context.Context) ([]DiscoveredCluster, error) {
	inClusterConfig, err := rest.InClusterConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to get in-cluster config: %w", err)
	}

	clientset, err := kubernetes.NewForConfig(inClusterConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create clientset: %w", err)
	}

	labelSelector := fmt.Sprintf("%s=%s", ClusterLabelKey, ClusterLabelValue)
	secrets, err := clientset.CoreV1().Secrets(cd.namespace).List(ctx, metav1.ListOptions{
		LabelSelector: labelSelector,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list Secrets with label selector %q: %w", labelSelector, err)
	}

	var clusters []DiscoveredCluster
	for _, secret := range secrets.Items {
		if cluster := cd.secretToCluster(&secret); cluster != nil {
			clusters = append(clusters, *cluster)
		}
	}

	return clusters, nil
}

// enqueueSecret adds a Secret to the work queue
func (cd *ClusterDiscovery) enqueueSecret(obj interface{}) {
	key, err := cache.MetaNamespaceKeyFunc(obj)
	if err != nil {
		log.Printf("[ClusterDiscovery] Error extracting key: %v", err)
		return
	}
	cd.workqueue.Add(key)
}

// enqueueSecretUpdate adds a Secret to the work queue for update events (old and new)
func (cd *ClusterDiscovery) enqueueSecretUpdate(oldObj, newObj interface{}) {
	key, err := cache.MetaNamespaceKeyFunc(newObj)
	if err != nil {
		log.Printf("[ClusterDiscovery] Error extracting key: %v", err)
		return
	}
	cd.workqueue.Add(key)
}

// processQueue processes items from the work queue
func (cd *ClusterDiscovery) processQueue(ctx context.Context) {
	defer close(cd.doneChan)

	for {
		select {
		case <-cd.stopChan:
			return
		case <-ctx.Done():
			return
		default:
			key, shutdown := cd.workqueue.Get()
			if shutdown {
				return
			}

			cd.processItem(key.(string))
			cd.workqueue.Done(key)
		}
	}
}

// processItem handles a single queued item
func (cd *ClusterDiscovery) processItem(key string) {
	// namespace/name format
	namespace, name, err := cache.SplitMetaNamespaceKey(key)
	if err != nil {
		log.Printf("[ClusterDiscovery] Error splitting key %q: %v", key, err)
		return
	}

	// Try to get the Secret
	secret, err := cd.informer.Lister().Secrets(namespace).Get(name)
	if err != nil {
		// Secret not found — could be a delete event
		// We need to determine if this is a delete or an error
		// For now, we'll treat it as a delete if the cache doesn't have it
		log.Printf("[ClusterDiscovery] Secret %s/%s not found (possibly deleted): %v", namespace, name, err)
		// Call onDelete with minimal info; we don't have the old kubeconfig/annotations
		cd.onDelete("", nil, nil)
		return
	}

	// Process the Secret based on whether it has the label
	if secret.Labels != nil && secret.Labels[ClusterLabelKey] == ClusterLabelValue {
		cluster := cd.secretToCluster(secret)
		if cluster == nil {
			log.Printf("[ClusterDiscovery] Failed to convert Secret %s/%s to cluster", namespace, name)
			return
		}

		// Determine if this is an add or update
		// A simple heuristic: if the Secret is very new, it's an add; otherwise, it's an update
		// For now, we'll always call onAdd on first encounter and onUpdate if already tracked
		// A production implementation would track which clusters have been seen
		// For simplicity here, we'll call onAdd for all events (idempotent registration)
		cd.onAdd(cluster.Name, cluster.Kubeconfig, cluster.Annotations)
	}
}

// secretToCluster converts a Secret to a DiscoveredCluster if valid
func (cd *ClusterDiscovery) secretToCluster(secret *corev1.Secret) *DiscoveredCluster {
	if secret == nil {
		return nil
	}

	// Extract kubeconfig data
	kubeconfigBytes, ok := secret.Data[KubeconfigDataKey]
	if !ok {
		log.Printf("[ClusterDiscovery] Secret %s/%s missing key %q", secret.Namespace, secret.Name, KubeconfigDataKey)
		return nil
	}

	if len(kubeconfigBytes) == 0 {
		log.Printf("[ClusterDiscovery] Secret %s/%s has empty kubeconfig data", secret.Namespace, secret.Name)
		return nil
	}

	// Validate kubeconfig format
	_, err := clientcmd.Load(kubeconfigBytes)
	if err != nil {
		log.Printf("[ClusterDiscovery] Secret %s/%s contains invalid kubeconfig: %v", secret.Namespace, secret.Name, err)
		return nil
	}

	// Extract cluster name from annotation or use Secret name
	clusterName := secret.Annotations[ClusterNameAnnotation]
	if clusterName == "" {
		clusterName = secret.Name
	}

	// Extract optional metadata from annotations
	provider := secret.Annotations[ClusterProviderAnnotation]
	environment := secret.Annotations[ClusterEnvironmentAnnotation]
	region := secret.Annotations[ClusterRegionAnnotation]

	return &DiscoveredCluster{
		Name:        clusterName,
		Namespace:   secret.Namespace,
		SecretName:  secret.Name,
		Provider:    provider,
		Environment: environment,
		Region:      region,
		Kubeconfig:  kubeconfigBytes,
		Labels:      secret.Labels,
		Annotations: secret.Annotations,
	}
}

// WatchClusterSecrets is a helper that sets up cluster auto-discovery
// It returns a channel of watched events and an error if setup fails
// This is an alternative to using ClusterDiscovery directly if you prefer event streaming
func WatchClusterSecrets(ctx context.Context, clientset kubernetes.Interface, namespace string) (<-chan DiscoveredCluster, error) {
	eventChan := make(chan DiscoveredCluster, 10)

	// Define callbacks to send events to the channel
	onAdd := func(clusterName string, kubeconfig []byte, annotations map[string]string) {
		eventChan <- DiscoveredCluster{
			Name:        clusterName,
			Kubeconfig:  kubeconfig,
			Annotations: annotations,
		}
	}

	onUpdate := func(clusterName string, kubeconfig []byte, annotations map[string]string) {
		eventChan <- DiscoveredCluster{
			Name:        clusterName,
			Kubeconfig:  kubeconfig,
			Annotations: annotations,
		}
	}

	onDelete := func(clusterName string, kubeconfig []byte, annotations map[string]string) {
		eventChan <- DiscoveredCluster{
			Name:        clusterName,
			Kubeconfig:  kubeconfig,
			Annotations: annotations,
		}
	}

	discovery := NewClusterDiscovery(clientset, namespace, onAdd, onUpdate, onDelete)

	// Start the discovery watcher
	if err := discovery.Start(ctx); err != nil {
		close(eventChan)
		return nil, fmt.Errorf("failed to start cluster discovery: %w", err)
	}

	// Close the event channel when the context is done
	go func() {
		<-ctx.Done()
		close(eventChan)
		discovery.Stop()
	}()

	return eventChan, nil
}
