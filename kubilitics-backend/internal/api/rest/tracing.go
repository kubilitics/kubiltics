package rest

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"

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
// Deploys the trace agent and (best-effort) the OTel Instrumentation CR.
func (th *TracingHandler) EnableTracing(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	requestID := logger.FromContext(r.Context())

	client, err := th.clusterService.GetClient(clusterID)
	if err != nil {
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, "Cluster not found: "+err.Error(), requestID)
		return
	}

	// Deploy trace agent (namespace + deployment + service)
	_, err = client.ApplyYAML(r.Context(), otel.AgentManifestYAML("v0.2.0"))
	if err != nil {
		respondErrorWithCode(w, http.StatusInternalServerError, ErrCodeInternalError, "Failed to deploy trace agent: "+err.Error(), requestID)
		return
	}

	// Best-effort: apply Instrumentation CR (requires OTel Operator CRDs)
	_, instrErr := client.ApplyYAML(r.Context(), otel.InstrumentationCRsYAML())
	if instrErr != nil {
		log.Printf("[tracing] warning: Instrumentation CR apply failed (OTel Operator may not be installed): %v", instrErr)
	}

	resp := map[string]interface{}{
		"status":  "enabled",
		"message": "Trace agent deployed to kubilitics-system",
	}
	if instrErr != nil {
		resp["instrumentation_warning"] = "OTel Operator not installed — auto-instrumentation unavailable. Install the OTel Operator separately to enable it."
	}
	respondJSON(w, http.StatusOK, resp)
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

	// Check agent health via proxy
	status.AgentHealthy = th.puller.IsAgentReachable(ctx, client.Clientset)

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
