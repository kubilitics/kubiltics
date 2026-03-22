package k8s

import (
	"context"
	"fmt"
	"log"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	k8swatch "k8s.io/apimachinery/pkg/watch"
)

// SecretRef identifies a kubeconfig stored in a Kubernetes Secret
type SecretRef struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Key       string `json:"key"` // defaults to "kubeconfig" if empty
}

// SecretEvent represents a change to a kubeconfig Secret
type SecretEvent struct {
	Type      k8swatch.EventType // Added, Modified, Deleted
	SecretRef SecretRef
	Error     error
}

// LoadKubeconfigFromSecret reads a kubeconfig from a Kubernetes Secret using the
// in-cluster ServiceAccount. Returns the raw kubeconfig bytes or an error if the Secret
// is not found, the key is missing, or the kubeconfig is invalid.
func LoadKubeconfigFromSecret(ref SecretRef) ([]byte, error) {
	// Get the in-cluster config for accessing the local Kubernetes API
	inClusterConfig, err := rest.InClusterConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to get in-cluster config: %w", err)
	}

	// Create a clientset to access Secrets
	clientset, err := kubernetes.NewForConfig(inClusterConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create clientset: %w", err)
	}

	// Determine key name
	key := ref.Key
	if key == "" {
		key = "kubeconfig"
	}

	// Retrieve the Secret
	ctx, cancel := context.WithTimeout(context.Background(), defaultRequestTimeout)
	defer cancel()

	secret, err := clientset.CoreV1().Secrets(ref.Namespace).Get(ctx, ref.Name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to read Secret %s/%s: %w", ref.Namespace, ref.Name, err)
	}

	// Extract the kubeconfig data from the specified key
	kubeconfigBytes, ok := secret.Data[key]
	if !ok {
		return nil, fmt.Errorf("key %q not found in Secret %s/%s", key, ref.Namespace, ref.Name)
	}

	if len(kubeconfigBytes) == 0 {
		return nil, fmt.Errorf("kubeconfig data in Secret %s/%s key %q is empty", ref.Namespace, ref.Name, key)
	}

	// Validate that it's a valid kubeconfig by attempting to parse it
	_, err = clientcmd.Load(kubeconfigBytes)
	if err != nil {
		return nil, fmt.Errorf("invalid kubeconfig in Secret %s/%s key %q: %w", ref.Namespace, ref.Name, key, err)
	}

	return kubeconfigBytes, nil
}

// NewClientFromSecret creates a Kubernetes client from a kubeconfig stored in a Secret.
// It uses the in-cluster ServiceAccount to read the Secret, extracts the kubeconfig,
// and creates a fully functional Client for the specified context. If context is empty,
// uses the current context from the kubeconfig.
func NewClientFromSecret(ref SecretRef, context string) (*Client, error) {
	// Load kubeconfig bytes from Secret
	kubeconfigBytes, err := LoadKubeconfigFromSecret(ref)
	if err != nil {
		return nil, err
	}

	// Use the existing NewClientFromBytes to build the client
	// This handles context selection, TLS configuration, and client initialization
	client, err := NewClientFromBytes(kubeconfigBytes, context)
	if err != nil {
		return nil, fmt.Errorf("failed to create client from Secret %s/%s: %w", ref.Namespace, ref.Name, err)
	}

	return client, nil
}

// WatchSecretChanges sets up a watch on kubeconfig Secrets so that if a Secret is
// updated, deleted, or added, the caller is notified via the returned channel.
// Only Secrets matching the labelSelector (e.g., "kubilitics.io/cluster-kubeconfig=true")
// are watched. This allows dynamic cluster registration when kubeconfig Secrets are added/removed.
//
// The returned channel sends SecretEvent for each change. When a Secret is deleted,
// the event Type will be watch.Deleted. The caller should use the SecretRef to identify
// which cluster registration needs to be refreshed or removed.
//
// Watch runs until the context is cancelled or an unrecoverable error occurs.
// Errors are sent as SecretEvent with non-nil Error field.
func WatchSecretChanges(ctx context.Context, namespace string, labelSelector string) (<-chan SecretEvent, error) {
	// Get the in-cluster config
	inClusterConfig, err := rest.InClusterConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to get in-cluster config: %w", err)
	}

	// Create a clientset
	clientset, err := kubernetes.NewForConfig(inClusterConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create clientset: %w", err)
	}

	// Use the RESTClient to watch Secrets
	watcher, err := clientset.CoreV1().Secrets(namespace).Watch(ctx, metav1.ListOptions{
		LabelSelector: labelSelector,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to watch Secrets in namespace %s with label %s: %w", namespace, labelSelector, err)
	}

	// Create output channel
	eventChan := make(chan SecretEvent, 10)

	// Start a goroutine to forward watch events
	go func() {
		defer close(eventChan)
		defer watcher.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case event, ok := <-watcher.ResultChan():
				if !ok {
					// Channel closed; watch ended
					return
				}

				// Convert Kubernetes Secret to SecretRef
				secret, ok := event.Object.(*corev1.Secret)
				if !ok {
					log.Printf("[WatchSecretChanges] Unexpected event object type: %T", event.Object)
					continue
				}

				ref := SecretRef{
					Name:      secret.Name,
					Namespace: secret.Namespace,
					Key:       "kubeconfig", // Default key; could be extended to read from annotation
				}

				select {
				case eventChan <- SecretEvent{
					Type:      event.Type,
					SecretRef: ref,
					Error:     nil,
				}:
				case <-ctx.Done():
					return
				}
			}
		}
	}()

	return eventChan, nil
}

// ValidateSecretRef checks that a SecretRef is well-formed and the Secret exists.
// Returns an error if the Secret cannot be accessed or is invalid.
func ValidateSecretRef(ref SecretRef) error {
	if ref.Name == "" {
		return fmt.Errorf("Secret name is required")
	}
	if ref.Namespace == "" {
		return fmt.Errorf("Secret namespace is required")
	}

	// Try to load the kubeconfig; this validates the Secret exists and contains valid data
	_, err := LoadKubeconfigFromSecret(ref)
	return err
}

// RotateSecretRef updates an existing client to use a new kubeconfig from an updated Secret.
// This is useful when a kubeconfig Secret is rotated (e.g., new certificate, new token).
// Returns the new Client or an error.
func RotateSecretRef(ref SecretRef, context string) (*Client, error) {
	newClient, err := NewClientFromSecret(ref, context)
	if err != nil {
		return nil, fmt.Errorf("failed to rotate client from Secret %s/%s: %w", ref.Namespace, ref.Name, err)
	}
	return newClient, nil
}

// defaultRequestTimeout is the default timeout for Secret read operations
const defaultRequestTimeout = 10 * defaultRetryAttempts
