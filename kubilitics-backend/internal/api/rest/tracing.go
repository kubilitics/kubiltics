package rest

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/client-go/kubernetes"

	k8s "github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/otel"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/service"
)

// TracingHandler provides REST endpoints for enabling, disabling, and
// managing distributed tracing in connected Kubernetes clusters.
type TracingHandler struct {
	clusterService service.ClusterService
	puller         *otel.TracePuller
}

// NewTracingHandler creates a new TracingHandler.
func NewTracingHandler(cs service.ClusterService, puller *otel.TracePuller) *TracingHandler {
	return &TracingHandler{
		clusterService: cs,
		puller:         puller,
	}
}

// EnableTracing handles POST /clusters/{clusterId}/tracing/enable
// Full one-click setup: cert-manager → OTel Operator → trace-agent → Instrumentation CRs.
func (th *TracingHandler) EnableTracing(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	requestID := logger.FromContext(r.Context())
	ctx := r.Context()

	client, err := th.clusterService.GetClient(clusterID)
	if err != nil {
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, "Cluster not found: "+err.Error(), requestID)
		return
	}

	// Step 1: Deploy the standard OpenTelemetry Collector as the in-cluster
	// trace ingestion agent. It receives OTLP from instrumented apps and pushes
	// to the Kubilitics backend. For Docker Desktop kind clusters, traffic
	// reaches the host backend via host.docker.internal.
	//
	// TODO(cluster-aware): backendURL should be derived from how the cluster
	// reaches the backend (host.docker.internal vs ingress vs nodeport).
	// For now we hardcode the Docker Desktop case — improve in a follow-up.
	backendURL := "http://host.docker.internal:8190/v1/traces"
	_, err = client.ApplyYAML(ctx, otel.AgentManifestYAML(clusterID, backendURL))
	if err != nil {
		respondErrorWithCode(w, http.StatusInternalServerError, ErrCodeInternalError, "Failed to deploy otel-collector: "+err.Error(), requestID)
		return
	}
	log.Printf("[tracing] otel-collector deployed (cluster=%s backend=%s)", clusterID, backendURL)

	// Step 1b: Deploy demo app that generates real traces
	_, err = client.ApplyYAML(ctx, otel.DemoAppManifestYAML("v0.2.0"))
	if err != nil {
		// Non-fatal — agent is deployed, demo app is optional
		log.Printf("[tracing] demo app deploy failed (non-fatal): %v", err)
	} else {
		log.Printf("[tracing] demo app + traffic generator deployed")
	}

	// Step 2: Install cert-manager + OTel Operator + Instrumentation CRs ASYNC
	// These are large manifests (1.8MB+) that take minutes to download and apply.
	// We return success immediately so the UI doesn't hang.
	go func() {
		bgCtx := context.Background()

		// cert-manager
		_, certErr := client.Clientset.CoreV1().Namespaces().Get(bgCtx, "cert-manager", metav1.GetOptions{})
		if certErr != nil {
			log.Printf("[tracing] installing cert-manager...")
			if installErr := installViaKubectl(bgCtx, client, "https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml"); installErr != nil {
				log.Printf("[tracing] cert-manager install failed: %v", installErr)
				return
			}
			waitForDeployment(bgCtx, client.Clientset, "cert-manager", "cert-manager-webhook", 120*time.Second)
		}

		// OTel Operator
		_, otelCRDErr := client.Clientset.Discovery().ServerResourcesForGroupVersion("opentelemetry.io/v1alpha1")
		if otelCRDErr != nil {
			log.Printf("[tracing] installing OTel Operator...")
			if installErr := installViaKubectl(bgCtx, client, "https://github.com/open-telemetry/opentelemetry-operator/releases/latest/download/opentelemetry-operator.yaml"); installErr != nil {
				log.Printf("[tracing] OTel Operator install failed: %v", installErr)
				return
			}
			waitForDeployment(bgCtx, client.Clientset, "opentelemetry-operator-system", "opentelemetry-operator-controller-manager", 120*time.Second)
		}

		// Instrumentation CRs
		if _, instrErr := client.ApplyYAML(bgCtx, otel.InstrumentationCRsYAML()); instrErr != nil {
			log.Printf("[tracing] Instrumentation CR apply failed (will retry on next enable): %v", instrErr)
		} else {
			log.Printf("[tracing] auto-instrumentation configured")
		}
	}()

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "enabled",
		"message": "Trace agent deployed. cert-manager and OTel Operator installing in background (~2 minutes).",
	})
}

// installViaKubectl applies a remote YAML manifest URL by downloading and applying it.
func installViaKubectl(ctx context.Context, client *k8s.Client, url string) error {
	// Download the manifest
	httpClient := &http.Client{Timeout: 60 * time.Second}
	resp, err := httpClient.Get(url)
	if err != nil {
		return fmt.Errorf("download %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("download %s: HTTP %d", url, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 20*1024*1024)) // 20MB max
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}

	// Apply via the existing ApplyYAML
	_, err = client.ApplyYAML(ctx, string(body))
	return err
}

// waitForDeployment polls until a deployment has at least 1 ready replica or timeout.
func waitForDeployment(ctx context.Context, clientset kubernetes.Interface, namespace, name string, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		dep, err := clientset.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
		if err == nil && dep.Status.ReadyReplicas > 0 {
			return
		}
		time.Sleep(3 * time.Second)
	}
	log.Printf("[tracing] timeout waiting for %s/%s to become ready", namespace, name)
}

// TracingStatusResponse is the response for GET /clusters/{clusterId}/tracing/status.
type TracingStatusResponse struct {
	Enabled              bool                   `json:"enabled"`
	AgentHealthy         bool                   `json:"agent_healthy"`
	AgentDeployed        bool                   `json:"agent_deployed"`
	Instrumented         []InstrumentedWorkload `json:"instrumented"`
	AvailableDeployments []AvailableDeployment  `json:"available_deployments"`
}

// InstrumentedWorkload describes a deployment that has OTel auto-instrumentation enabled.
type InstrumentedWorkload struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Language  string `json:"language"`
}

// AvailableDeployment describes a deployment that can be instrumented.
type AvailableDeployment struct {
	Name             string `json:"name"`
	Namespace        string `json:"namespace"`
	Image            string `json:"image"`
	DetectedLanguage string `json:"detected_language"`
	Replicas         int32  `json:"replicas"`
	Instrumented     bool   `json:"instrumented"`
}

// GetTracingStatus handles GET /clusters/{clusterId}/tracing/status
func (th *TracingHandler) GetTracingStatus(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	requestID := logger.FromContext(r.Context())

	client, err := th.clusterService.GetClient(clusterID)
	if err != nil {
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, "Cluster not found: "+err.Error(), requestID)
		return
	}

	ctx := r.Context()
	status := TracingStatusResponse{}

	// Check if deployment exists
	ns, depName, _, _ := otel.CleanupManifestNames()
	dep, err := client.Clientset.AppsV1().Deployments(ns).Get(ctx, depName, metav1.GetOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			// Agent not deployed
			respondJSON(w, http.StatusOK, status)
			return
		}
		respondErrorWithCode(w, http.StatusInternalServerError, ErrCodeInternalError, "Failed to check agent deployment: "+err.Error(), requestID)
		return
	}

	status.AgentDeployed = true
	status.Enabled = dep.Status.ReadyReplicas > 0
	// With the standard otel-collector path, traces are pushed directly to
	// the backend's POST /v1/traces — there is no longer a custom HTTP query
	// API on the agent to probe. If the collector deployment has at least one
	// ready replica, we treat the agent as healthy.
	status.AgentHealthy = status.Enabled

	// List all deployments across all namespaces
	systemNamespaces := map[string]bool{
		"kube-system": true, "kube-public": true, "kube-node-lease": true,
		"kubilitics-system": true, "cert-manager": true, "local-path-storage": true,
	}
	deployments, err := client.Clientset.AppsV1().Deployments("").List(ctx, metav1.ListOptions{})
	if err == nil {
		for _, d := range deployments.Items {
			// Check if instrumented
			isInstrumented := false
			instrLang := ""
			annotations := d.GetAnnotations()
			if annotations != nil {
				for key, val := range annotations {
					if strings.HasPrefix(key, "instrumentation.opentelemetry.io/inject-") && val != "" && val != "false" {
						instrLang = strings.TrimPrefix(key, "instrumentation.opentelemetry.io/inject-")
						isInstrumented = true
						status.Instrumented = append(status.Instrumented, InstrumentedWorkload{
							Name:      d.Name,
							Namespace: d.Namespace,
							Language:  instrLang,
						})
						break
					}
				}
			}

			// Skip system namespaces for available list
			if systemNamespaces[d.Namespace] {
				continue
			}

			// Get container image for language detection
			image := ""
			if len(d.Spec.Template.Spec.Containers) > 0 {
				image = d.Spec.Template.Spec.Containers[0].Image
			}
			detectedLang := instrLang
			if detectedLang == "" {
				detectedLang = detectLanguage(image)
			}

			status.AvailableDeployments = append(status.AvailableDeployments, AvailableDeployment{
				Name:             d.Name,
				Namespace:        d.Namespace,
				Image:            image,
				DetectedLanguage: detectedLang,
				Replicas:         d.Status.ReadyReplicas,
				Instrumented:     isInstrumented,
			})
		}
	}

	respondJSON(w, http.StatusOK, status)
}

// instrumentRequest is the request body for POST /clusters/{clusterId}/tracing/instrument.
type instrumentRequest struct {
	Deployments []struct {
		Name      string `json:"name"`
		Namespace string `json:"namespace"`
	} `json:"deployments"`
}

// InstrumentDeployments handles POST /clusters/{clusterId}/tracing/instrument
func (th *TracingHandler) InstrumentDeployments(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	requestID := logger.FromContext(r.Context())

	client, err := th.clusterService.GetClient(clusterID)
	if err != nil {
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, "Cluster not found: "+err.Error(), requestID)
		return
	}

	var req instrumentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest, "Invalid request body", requestID)
		return
	}
	if len(req.Deployments) == 0 {
		respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest, "No deployments specified", requestID)
		return
	}

	ctx := r.Context()
	var instrumented []map[string]string

	for _, target := range req.Deployments {
		dep, err := client.Clientset.AppsV1().Deployments(target.Namespace).Get(ctx, target.Name, metav1.GetOptions{})
		if err != nil {
			log.Printf("[tracing] failed to get deployment %s/%s: %v", target.Namespace, target.Name, err)
			continue
		}

		// Detect language from first container image
		lang := "java" // default
		if len(dep.Spec.Template.Spec.Containers) > 0 {
			lang = detectLanguage(dep.Spec.Template.Spec.Containers[0].Image)
		}

		// Set OTel auto-instrumentation annotation
		annotations := dep.Spec.Template.GetAnnotations()
		if annotations == nil {
			annotations = make(map[string]string)
		}
		annotations[fmt.Sprintf("instrumentation.opentelemetry.io/inject-%s", lang)] = "kubilitics-system/kubilitics-auto"
		// Trigger restart
		annotations["kubectl.kubernetes.io/restartedAt"] = time.Now().Format(time.RFC3339)
		dep.Spec.Template.SetAnnotations(annotations)

		_, err = client.Clientset.AppsV1().Deployments(target.Namespace).Update(ctx, dep, metav1.UpdateOptions{})
		if err != nil {
			log.Printf("[tracing] failed to update deployment %s/%s: %v", target.Namespace, target.Name, err)
			continue
		}

		instrumented = append(instrumented, map[string]string{
			"name":      target.Name,
			"namespace": target.Namespace,
			"language":  lang,
		})
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"instrumented": instrumented,
		"restarting":   true,
	})
}

// DisableTracing handles POST /clusters/{clusterId}/tracing/disable
func (th *TracingHandler) DisableTracing(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	requestID := logger.FromContext(r.Context())

	client, err := th.clusterService.GetClient(clusterID)
	if err != nil {
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, "Cluster not found: "+err.Error(), requestID)
		return
	}

	ctx := r.Context()
	ns, depName, svcName, _ := otel.CleanupManifestNames()

	// Step 1: Remove OTel annotations from all instrumented deployments
	deployments, err := client.Clientset.AppsV1().Deployments("").List(ctx, metav1.ListOptions{})
	if err == nil {
		for _, d := range deployments.Items {
			annotations := d.Spec.Template.GetAnnotations()
			if annotations == nil {
				continue
			}
			modified := false
			for key := range annotations {
				if strings.HasPrefix(key, "instrumentation.opentelemetry.io/inject-") {
					delete(annotations, key)
					modified = true
				}
			}
			if modified {
				// Trigger restart
				annotations["kubectl.kubernetes.io/restartedAt"] = time.Now().Format(time.RFC3339)
				d.Spec.Template.SetAnnotations(annotations)
				_, err := client.Clientset.AppsV1().Deployments(d.Namespace).Update(ctx, &d, metav1.UpdateOptions{})
				if err != nil {
					log.Printf("[tracing] failed to remove OTel annotations from %s/%s: %v", d.Namespace, d.Name, err)
				}
			}
		}
	}

	// Step 2: Delete Instrumentation CR (best-effort — may not exist)
	// We use ApplyYAML's underlying dynamic client for CRD deletion, but
	// since we don't have a typed client for Instrumentation, just log and continue.
	// The CR will be cleaned up when the namespace is recreated next time.

	// Step 3: Delete trace-agent Deployment and Service
	deletePolicy := metav1.DeletePropagationForeground
	deleteOpts := metav1.DeleteOptions{PropagationPolicy: &deletePolicy}
	if err := client.Clientset.AppsV1().Deployments(ns).Delete(ctx, depName, deleteOpts); err != nil && !apierrors.IsNotFound(err) {
		log.Printf("[tracing] failed to delete agent deployment: %v", err)
	}
	if err := client.Clientset.CoreV1().Services(ns).Delete(ctx, svcName, deleteOpts); err != nil && !apierrors.IsNotFound(err) {
		log.Printf("[tracing] failed to delete agent service: %v", err)
	}

	// Step 3b: Delete demo app resources
	demoNs, demoDep, demoSvc, demoCron := otel.DemoAppResourceNames()
	if err := client.Clientset.AppsV1().Deployments(demoNs).Delete(ctx, demoDep, deleteOpts); err != nil && !apierrors.IsNotFound(err) {
		log.Printf("[tracing] failed to delete demo app deployment: %v", err)
	}
	if err := client.Clientset.CoreV1().Services(demoNs).Delete(ctx, demoSvc, deleteOpts); err != nil && !apierrors.IsNotFound(err) {
		log.Printf("[tracing] failed to delete demo app service: %v", err)
	}
	if err := client.Clientset.BatchV1().CronJobs(demoNs).Delete(ctx, demoCron, deleteOpts); err != nil && !apierrors.IsNotFound(err) {
		log.Printf("[tracing] failed to delete demo traffic cronjob: %v", err)
	}

	// Step 4: Stop puller for this cluster
	th.puller.StopCluster(clusterID)

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "disabled",
		"message": "Trace agent removed and instrumentation annotations cleaned up",
	})
}

// detectLanguage infers the programming language from a container image name.
func detectLanguage(image string) string {
	lower := strings.ToLower(image)

	switch {
	case containsAny(lower, "java", "jdk", "jre", "spring", "maven", "gradle", "tomcat", "quarkus"):
		return "java"
	case containsAny(lower, "node", "npm", "yarn", "next", "express", "nestjs", "bun"):
		return "nodejs"
	case containsAny(lower, "python", "pip", "django", "flask", "fastapi", "uvicorn", "gunicorn"):
		return "python"
	case containsAny(lower, "golang", "/go", "go-"):
		return "go"
	case containsAny(lower, "dotnet", "aspnet", "csharp"):
		return "dotnet"
	default:
		return "java"
	}
}

// containsAny returns true if s contains any of the given substrings.
func containsAny(s string, substrs ...string) bool {
	for _, sub := range substrs {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}
