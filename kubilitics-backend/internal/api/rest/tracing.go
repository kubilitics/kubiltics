package rest

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/mux"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"

	k8s "github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/otel"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/service"
)

// Operator install state values used by TracingHandler.operatorState.
const (
	OperatorStateNotInstalled = "not_installed"
	OperatorStateInstalling   = "installing"
	OperatorStateReady        = "ready"
	OperatorStateFailed       = "failed"
)

// TracingHandler provides REST endpoints for enabling, disabling, and
// managing distributed tracing in connected Kubernetes clusters.
type TracingHandler struct {
	clusterService service.ClusterService
	puller         *otel.TracePuller
	helmRenderer   *otel.HelmRenderer

	// operatorState tracks the cert-manager + OTel Operator install state
	// per cluster ID. Values are strings: OperatorState* constants.
	operatorState   sync.Map // clusterID -> *atomic.Value(string)
	operatorMessage sync.Map // clusterID -> string (last error / status msg)
	// installMu serializes concurrent install requests per cluster.
	installMu sync.Mutex
	installing sync.Map // clusterID -> bool (true while install goroutine is running)
}

// getOperatorState returns the current install state for a cluster.
func (th *TracingHandler) getOperatorState(clusterID string) (string, string) {
	v, ok := th.operatorState.Load(clusterID)
	state := OperatorStateNotInstalled
	if ok {
		if av, ok2 := v.(*atomic.Value); ok2 {
			if s, ok3 := av.Load().(string); ok3 && s != "" {
				state = s
			}
		}
	}
	msg := ""
	if m, ok := th.operatorMessage.Load(clusterID); ok {
		if s, ok2 := m.(string); ok2 {
			msg = s
		}
	}
	return state, msg
}

// setOperatorState updates the install state and optional message.
func (th *TracingHandler) setOperatorState(clusterID, state, msg string) {
	v, _ := th.operatorState.LoadOrStore(clusterID, &atomic.Value{})
	if av, ok := v.(*atomic.Value); ok {
		av.Store(state)
	}
	th.operatorMessage.Store(clusterID, msg)
}

// NewTracingHandler creates a new TracingHandler.
func NewTracingHandler(cs service.ClusterService, puller *otel.TracePuller) *TracingHandler {
	return &TracingHandler{
		clusterService: cs,
		puller:         puller,
		helmRenderer:   otel.NewHelmRenderer("../charts/kubilitics-otel"),
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
	// NOTE: otlphttp exporter auto-appends /v1/traces — pass base URL only.
	backendURL := "http://host.docker.internal:8190"
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
	th.startOperatorInstall(clusterID, client)

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "enabled",
		"message": "Trace agent deployed. cert-manager and OTel Operator installing in background (~2 minutes).",
	})
}

// startOperatorInstall kicks off the cert-manager + OTel Operator install
// in a background goroutine. It is idempotent — concurrent calls for the
// same cluster while an install is already in progress are no-ops. The
// handler tracks the install state per-cluster so the status endpoint and
// UI can surface progress.
func (th *TracingHandler) startOperatorInstall(clusterID string, client *k8s.Client) {
	// Guard against concurrent starts for the same cluster.
	if _, loaded := th.installing.LoadOrStore(clusterID, true); loaded {
		return
	}

	th.setOperatorState(clusterID, OperatorStateInstalling, "")

	go func() {
		defer th.installing.Delete(clusterID)
		bgCtx := context.Background()

		// cert-manager
		_, certErr := client.Clientset.CoreV1().Namespaces().Get(bgCtx, "cert-manager", metav1.GetOptions{})
		if certErr != nil {
			log.Printf("[tracing] installing cert-manager...")
			if installErr := installViaKubectl(bgCtx, client, "https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml"); installErr != nil {
				log.Printf("[tracing] cert-manager install failed: %v", installErr)
				th.setOperatorState(clusterID, OperatorStateFailed, "cert-manager install failed: "+installErr.Error())
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
				th.setOperatorState(clusterID, OperatorStateFailed, "OTel Operator install failed: "+installErr.Error())
				return
			}
			waitForDeployment(bgCtx, client.Clientset, "opentelemetry-operator-system", "opentelemetry-operator-controller-manager", 120*time.Second)
		}

		// Instrumentation CRs
		if _, instrErr := client.ApplyYAML(bgCtx, otel.InstrumentationCRsYAML()); instrErr != nil {
			log.Printf("[tracing] Instrumentation CR apply failed (will retry on next enable): %v", instrErr)
			th.setOperatorState(clusterID, OperatorStateFailed, "Instrumentation CR apply failed: "+instrErr.Error())
			return
		}
		log.Printf("[tracing] auto-instrumentation configured")
		th.setOperatorState(clusterID, OperatorStateReady, "")
	}()
}

// InstallOperator handles POST /clusters/{clusterId}/tracing/operator/install
// Idempotent retry endpoint — re-runs the cert-manager + OTel Operator install
// flow. If the operator is already ready, returns success immediately.
func (th *TracingHandler) InstallOperator(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	requestID := logger.FromContext(r.Context())

	client, err := th.clusterService.GetClient(clusterID)
	if err != nil {
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, "Cluster not found: "+err.Error(), requestID)
		return
	}

	// Fast path: if the operator is already installed and reachable, mark
	// ready and return success.
	if isOTelOperatorReady(r.Context(), client.Clientset) {
		th.setOperatorState(clusterID, OperatorStateReady, "")
		respondJSON(w, http.StatusOK, map[string]interface{}{
			"operator_state": OperatorStateReady,
			"message":        "OTel Operator already installed and ready",
		})
		return
	}

	th.startOperatorInstall(clusterID, client)
	state, msg := th.getOperatorState(clusterID)
	respondJSON(w, http.StatusAccepted, map[string]interface{}{
		"operator_state":   state,
		"operator_message": msg,
		"message":          "Operator install started in background",
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
	// OperatorState surfaces the cert-manager + OTel Operator install state
	// so the UI can show "installing" / "failed" / "ready" without polling
	// individual deployments. One of: not_installed|installing|ready|failed.
	OperatorState   string `json:"operator_state"`
	OperatorMessage string `json:"operator_message,omitempty"`
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

	// Populate operator state up-front so callers see install progress even
	// when the collector isn't deployed yet.
	state, msg := th.getOperatorState(clusterID)
	// If we haven't tracked state yet but the operator is actually ready,
	// reflect that on the fly.
	if state == OperatorStateNotInstalled && isOTelOperatorReady(ctx, client.Clientset) {
		state = OperatorStateReady
	}
	status.OperatorState = state
	status.OperatorMessage = msg

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
// Kept for the multi-deployment legacy endpoint; callers that want confidence
// and source should use detectContainerLanguage instead.
func detectLanguage(image string) string {
	lang := detectLanguageFromImage(image)
	if lang == "unknown" {
		return "java"
	}
	return lang
}

// supportedLanguages lists the languages the OTel Operator Instrumentation
// CR can auto-inject via annotations.
var supportedLanguages = []string{"java", "python", "nodejs", "go", "dotnet"}

// languageSupportsAuto reports whether the OTel Operator can auto-inject
// instrumentation for the given language. Languages like rust, ruby, php
// and cpp currently need manual instrumentation.
func languageSupportsAuto(lang string) bool {
	switch lang {
	case "java", "python", "nodejs", "go", "dotnet":
		return true
	default:
		return false
	}
}

// LanguageDetection is the result of a layered language-detection pass over
// a single container. Confidence and source capture why the detector reached
// its conclusion, so the UI can surface uncertainty to the operator.
type LanguageDetection struct {
	Language     string `json:"language"`  // java|python|nodejs|go|dotnet|rust|ruby|php|cpp|unknown
	Confidence   string `json:"confidence"` // high|medium|low
	Source       string `json:"source"`     // command|env|image-label|image-name|none
	SupportsAuto bool   `json:"supports_auto"`
}

// detectContainerLanguage examines a single container with a layered cascade:
//  1. Command/args (highest confidence)
//  2. Env vars (medium confidence)
//  3. Image labels / image name (low confidence)
func detectContainerLanguage(c *corev1.Container) LanguageDetection {
	// 1. Command / args
	if lang := langFromCmdline(c); lang != "" {
		return LanguageDetection{Language: lang, Confidence: "high", Source: "command", SupportsAuto: languageSupportsAuto(lang)}
	}
	// 2. Env vars
	if lang := langFromEnv(c); lang != "" {
		return LanguageDetection{Language: lang, Confidence: "medium", Source: "env", SupportsAuto: languageSupportsAuto(lang)}
	}
	// 3. Image name substring
	if lang := detectLanguageFromImage(c.Image); lang != "unknown" {
		return LanguageDetection{Language: lang, Confidence: "low", Source: "image-name", SupportsAuto: languageSupportsAuto(lang)}
	}
	return LanguageDetection{Language: "unknown", Confidence: "low", Source: "none", SupportsAuto: false}
}

// langFromCmdline inspects the container's command and args for a runtime hint.
func langFromCmdline(c *corev1.Container) string {
	parts := append([]string{}, c.Command...)
	parts = append(parts, c.Args...)
	cmdline := strings.ToLower(strings.Join(parts, " "))
	if cmdline == "" {
		return ""
	}
	switch {
	case strings.HasPrefix(cmdline, "python"),
		strings.Contains(cmdline, " python"),
		strings.Contains(cmdline, "/python"):
		return "python"
	case strings.HasPrefix(cmdline, "node"),
		strings.Contains(cmdline, " node "),
		strings.Contains(cmdline, "/node "),
		strings.HasSuffix(cmdline, "/node"),
		strings.Contains(cmdline, " node."),
		strings.Contains(cmdline, "npm "),
		strings.Contains(cmdline, "yarn "):
		return "nodejs"
	case strings.HasPrefix(cmdline, "java"),
		strings.Contains(cmdline, " java "),
		strings.Contains(cmdline, "/java "),
		strings.Contains(cmdline, ".jar"):
		return "java"
	case strings.HasPrefix(cmdline, "dotnet"),
		strings.Contains(cmdline, " dotnet"),
		strings.Contains(cmdline, ".dll"):
		return "dotnet"
	case strings.HasPrefix(cmdline, "ruby"),
		strings.Contains(cmdline, " ruby"),
		strings.Contains(cmdline, ".rb"),
		strings.Contains(cmdline, "rails "),
		strings.Contains(cmdline, "bundle exec"):
		return "ruby"
	case strings.HasPrefix(cmdline, "php"),
		strings.Contains(cmdline, " php"):
		return "php"
	}
	return ""
}

// langFromEnv inspects environment variables for runtime-specific hints.
func langFromEnv(c *corev1.Container) string {
	for _, e := range c.Env {
		switch e.Name {
		case "JAVA_HOME", "JAVA_OPTS", "JVM_OPTS", "CATALINA_HOME":
			return "java"
		case "PYTHON_VERSION", "PYTHONPATH", "PYTHONUNBUFFERED":
			return "python"
		case "NODE_VERSION", "NODE_ENV", "NODE_OPTIONS":
			return "nodejs"
		case "DOTNET_VERSION", "DOTNET_ROOT", "ASPNETCORE_URLS":
			return "dotnet"
		case "GOPATH", "GO_VERSION", "GOROOT":
			return "go"
		case "BUNDLE_PATH", "RUBY_VERSION", "RAILS_ENV", "GEM_HOME":
			return "ruby"
		case "PHP_VERSION", "PHP_INI_DIR":
			return "php"
		}
	}
	return ""
}

// detectLanguageFromImage returns one of: "java", "python", "nodejs", "go",
// "dotnet", "rust", "ruby", "php", "cpp", or "unknown" based on substring
// matching of a container image name. Lowest-confidence signal — use
// detectContainerLanguage when higher signals are available.
func detectLanguageFromImage(image string) string {
	img := strings.ToLower(image)
	switch {
	case strings.Contains(img, "openjdk"),
		strings.Contains(img, "/java"),
		strings.Contains(img, "jre"),
		strings.Contains(img, "jdk"),
		strings.Contains(img, "tomcat"),
		strings.Contains(img, "maven"),
		strings.Contains(img, "gradle"),
		strings.Contains(img, "quarkus"),
		strings.Contains(img, "spring"):
		return "java"
	case strings.Contains(img, "python"),
		strings.Contains(img, "py-"),
		strings.Contains(img, "/py"),
		strings.Contains(img, "django"),
		strings.Contains(img, "flask"),
		strings.Contains(img, "fastapi"):
		return "python"
	case strings.Contains(img, "node:"),
		strings.Contains(img, "nodejs"),
		strings.Contains(img, "/node-"),
		strings.Contains(img, "nestjs"),
		strings.Contains(img, "next.js"):
		return "nodejs"
	case strings.Contains(img, "golang"),
		strings.Contains(img, "/go-"):
		return "go"
	case strings.Contains(img, "dotnet"),
		strings.Contains(img, "aspnet"),
		strings.Contains(img, "/dotnet-"):
		return "dotnet"
	case strings.Contains(img, "rust"), strings.Contains(img, "/rust-"):
		return "rust"
	case strings.Contains(img, "ruby"), strings.Contains(img, "/ruby-"), strings.Contains(img, "rails"):
		return "ruby"
	case strings.Contains(img, "php"), strings.Contains(img, "wordpress"):
		return "php"
	case strings.Contains(img, "/cpp-"), strings.Contains(img, "gcc"), strings.Contains(img, "clang"):
		return "cpp"
	default:
		return "unknown"
	}
}

// detectLanguageFromDeployment walks the deployment's containers and returns
// the first detected language, or "unknown". Preserved for backwards compat —
// multi-container callers should iterate detectContainerLanguage themselves.
func detectLanguageFromDeployment(dep *appsv1.Deployment) string {
	for _, c := range dep.Spec.Template.Spec.Containers {
		if d := detectContainerLanguage(&c); d.Language != "unknown" {
			return d.Language
		}
	}
	return "unknown"
}

// findInjectAnnotation looks for an existing
// instrumentation.opentelemetry.io/inject-* annotation on the pod template
// and returns (language, fullAnnotationKey, found).
func findInjectAnnotation(dep *appsv1.Deployment) (string, string, bool) {
	ann := dep.Spec.Template.GetAnnotations()
	for key, val := range ann {
		if strings.HasPrefix(key, "instrumentation.opentelemetry.io/inject-") && val != "" && val != "false" {
			return strings.TrimPrefix(key, "instrumentation.opentelemetry.io/inject-"), key, true
		}
	}
	return "", "", false
}

// isOTelOperatorReady returns true if the OpenTelemetry Operator controller
// manager deployment has at least one ready replica.
func isOTelOperatorReady(ctx context.Context, clientset kubernetes.Interface) bool {
	dep, err := clientset.AppsV1().Deployments("opentelemetry-operator-system").
		Get(ctx, "opentelemetry-operator-controller-manager", metav1.GetOptions{})
	if err != nil {
		return false
	}
	return dep.Status.ReadyReplicas > 0
}

// ContainerInstrumentation is per-container detection + instrumentation info.
type ContainerInstrumentation struct {
	Name             string `json:"name"`
	Image            string `json:"image"`
	DetectedLanguage string `json:"detected_language"`
	Confidence       string `json:"confidence"`
	DetectionSource  string `json:"detection_source"`
	SupportsAuto     bool   `json:"supports_auto"`
	Instrumented     bool   `json:"instrumented"`
}

// PreflightCheck is a single preflight diagnostic result.
type PreflightCheck struct {
	Name     string `json:"name"`
	Severity string `json:"severity"` // blocking | warning | info
	Passed   bool   `json:"passed"`
	Message  string `json:"message"`
	Detail   string `json:"detail,omitempty"`
}

// PreflightChecks is the aggregate result of running preflight checks on a
// deployment/container pair. Passed is false if any blocking check failed.
type PreflightChecks struct {
	Passed bool             `json:"passed"`
	Checks []PreflightCheck `json:"checks"`
}

// InstrumentationStatus is the response for GET instrumentation-status.
type InstrumentationStatus struct {
	Instrumented      bool                       `json:"instrumented"`
	Language          string                     `json:"language,omitempty"`
	DetectedLanguage  string                     `json:"detected_language"`
	Annotation        string                     `json:"annotation,omitempty"`
	OTelOperatorReady bool                       `json:"otel_operator_ready"`
	SupportsLanguage  bool                       `json:"supports_language"`
	Containers        []ContainerInstrumentation `json:"containers"`
	PreflightChecks   PreflightChecks            `json:"preflight_checks"`
}

// runPreflightChecks evaluates the deployment + chosen container for common
// issues that break OTel auto-instrumentation. Blocking failures should
// prevent the instrument endpoint from patching.
func runPreflightChecks(dep *appsv1.Deployment, container *corev1.Container) PreflightChecks {
	var checks []PreflightCheck

	if container != nil {
		// 1. runAsNonRoot — info only, OTel init container respects it
		psc := dep.Spec.Template.Spec.SecurityContext
		csc := container.SecurityContext
		runAsNonRoot := false
		if psc != nil && psc.RunAsNonRoot != nil {
			runAsNonRoot = *psc.RunAsNonRoot
		}
		if csc != nil && csc.RunAsNonRoot != nil {
			runAsNonRoot = *csc.RunAsNonRoot
		}
		if runAsNonRoot {
			checks = append(checks, PreflightCheck{
				Name: "Pod security context", Severity: "warning", Passed: true,
				Message: "Pod runs as non-root — OTel Operator init container will respect this",
			})
		}

		// 2. readOnlyRootFilesystem — blocking
		if csc != nil && csc.ReadOnlyRootFilesystem != nil && *csc.ReadOnlyRootFilesystem {
			checks = append(checks, PreflightCheck{
				Name: "Read-only root filesystem", Severity: "blocking", Passed: false,
				Message: "Container has readOnlyRootFilesystem: true",
				Detail: "OTel auto-instrumentation needs to write the SDK agent files to the container filesystem. " +
					"Either disable readOnlyRootFilesystem or add an emptyDir volume mount at the SDK install path.",
			})
		} else {
			checks = append(checks, PreflightCheck{
				Name: "Filesystem writable", Severity: "blocking", Passed: true,
				Message: "Container filesystem allows writes",
			})
		}

		// 3. Memory headroom — warning if < 256Mi
		if container.Resources.Limits != nil {
			if memLimit, ok := container.Resources.Limits[corev1.ResourceMemory]; ok {
				if memLimit.Value() < 256*1024*1024 {
					checks = append(checks, PreflightCheck{
						Name: "Memory headroom", Severity: "warning", Passed: false,
						Message: fmt.Sprintf("Container memory limit is %s — OTel SDK adds 50-200MB overhead", memLimit.String()),
						Detail:  "Consider increasing memory limit to at least 256Mi to avoid OOMKilled.",
					})
				} else {
					checks = append(checks, PreflightCheck{
						Name: "Memory headroom", Severity: "info", Passed: true,
						Message: fmt.Sprintf("Memory limit %s is sufficient", memLimit.String()),
					})
				}
			}
		}
	}

	// 4. Existing service-mesh instrumentation
	annotations := dep.Spec.Template.GetAnnotations()
	if annotations != nil {
		for k := range annotations {
			if strings.HasPrefix(k, "sidecar.istio.io/inject") || strings.HasPrefix(k, "linkerd.io/inject") {
				checks = append(checks, PreflightCheck{
					Name: "Service mesh detected", Severity: "info", Passed: true,
					Message: fmt.Sprintf("Detected service mesh annotation: %s", k),
					Detail:  "Service mesh sidecars (Istio/Linkerd) coexist with OTel auto-instrumentation but generate spans of their own. You may see duplicate spans.",
				})
			}
		}
	}

	// 5. Single replica — warn about downtime
	if dep.Spec.Replicas != nil && *dep.Spec.Replicas == 1 {
		checks = append(checks, PreflightCheck{
			Name: "Replica count", Severity: "warning", Passed: true,
			Message: "Single-replica deployment — instrumentation will cause brief downtime during rolling restart",
		})
	}

	passed := true
	for _, c := range checks {
		if c.Severity == "blocking" && !c.Passed {
			passed = false
		}
	}
	return PreflightChecks{Passed: passed, Checks: checks}
}

// GetInstrumentationStatus handles
// GET /clusters/{clusterId}/deployments/{namespace}/{deployment}/instrumentation-status
func (th *TracingHandler) GetInstrumentationStatus(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	ns := vars["namespace"]
	name := vars["deployment"]
	requestID := logger.FromContext(r.Context())
	ctx := r.Context()

	client, err := th.clusterService.GetClient(clusterID)
	if err != nil {
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, "Cluster not found: "+err.Error(), requestID)
		return
	}

	dep, err := client.Clientset.AppsV1().Deployments(ns).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, "Deployment not found", requestID)
			return
		}
		respondErrorWithCode(w, http.StatusInternalServerError, ErrCodeInternalError, "Failed to get deployment: "+err.Error(), requestID)
		return
	}

	lang, annKey, instrumented := findInjectAnnotation(dep)
	detected := detectLanguageFromDeployment(dep)

	// Per-container detection
	var containers []ContainerInstrumentation
	// Determine which container(s) are instrumented. If the OTel
	// inject-container-names annotation is present, only those are; otherwise
	// the operator defaults to the first container.
	annotations := dep.Spec.Template.GetAnnotations()
	injectContainerNames := map[string]bool{}
	if v := annotations["instrumentation.opentelemetry.io/container-names"]; v != "" {
		for _, n := range strings.Split(v, ",") {
			injectContainerNames[strings.TrimSpace(n)] = true
		}
	}
	for i := range dep.Spec.Template.Spec.Containers {
		c := dep.Spec.Template.Spec.Containers[i]
		det := detectContainerLanguage(&c)
		containerInstrumented := false
		if instrumented {
			if len(injectContainerNames) > 0 {
				containerInstrumented = injectContainerNames[c.Name]
			} else {
				containerInstrumented = i == 0
			}
		}
		containers = append(containers, ContainerInstrumentation{
			Name:             c.Name,
			Image:            c.Image,
			DetectedLanguage: det.Language,
			Confidence:       det.Confidence,
			DetectionSource:  det.Source,
			SupportsAuto:     det.SupportsAuto,
			Instrumented:     containerInstrumented,
		})
	}

	// Preflight checks against the first container (most common injection target)
	var firstContainer *corev1.Container
	if len(dep.Spec.Template.Spec.Containers) > 0 {
		firstContainer = &dep.Spec.Template.Spec.Containers[0]
	}
	preflight := runPreflightChecks(dep, firstContainer)

	status := InstrumentationStatus{
		Instrumented:      instrumented,
		Language:          lang,
		DetectedLanguage:  detected,
		OTelOperatorReady: isOTelOperatorReady(ctx, client.Clientset),
		SupportsLanguage:  detected != "unknown" && languageSupportsAuto(detected),
		Containers:        containers,
		PreflightChecks:   preflight,
	}
	if instrumented {
		status.Annotation = fmt.Sprintf("%s=%s", annKey, dep.Spec.Template.GetAnnotations()[annKey])
	}

	respondJSON(w, http.StatusOK, status)
}

// instrumentOneRequest is the body for POST instrument.
type instrumentOneRequest struct {
	Language  string `json:"language,omitempty"`
	Container string `json:"container,omitempty"`
}

// removeInjectAnnotations strips all known instrumentation.opentelemetry.io
// inject-* annotations and the container-names annotation from a deployment's
// pod template via strategic merge patch. Used by UninstrumentDeployment and
// the auto-rollback path.
func (th *TracingHandler) removeInjectAnnotations(ctx context.Context, client *k8s.Client, ns, depName string) error {
	nullAnn := map[string]interface{}{}
	for _, l := range supportedLanguages {
		nullAnn["instrumentation.opentelemetry.io/inject-"+l] = nil
	}
	nullAnn["instrumentation.opentelemetry.io/container-names"] = nil
	patch := map[string]interface{}{
		"spec": map[string]interface{}{
			"template": map[string]interface{}{
				"metadata": map[string]interface{}{
					"annotations": nullAnn,
				},
			},
		},
	}
	patchBytes, err := json.Marshal(patch)
	if err != nil {
		return err
	}
	_, err = client.Clientset.AppsV1().Deployments(ns).Patch(
		ctx, depName, types.StrategicMergePatchType, patchBytes, metav1.PatchOptions{},
	)
	return err
}

// watchRolloutAndRollback waits up to 2 minutes for a deployment rollout to
// reach Available + Ready. If the rollout fails (ProgressDeadlineExceeded)
// or times out, it reverts the OTel inject annotations and returns an error
// describing the failure. Paused deployments return nil immediately because
// the rollout will not progress without user action.
func (th *TracingHandler) watchRolloutAndRollback(ctx context.Context, client *k8s.Client, ns, depName string) error {
	// Respect paused deployments — don't wait or rollback.
	if dep, err := client.Clientset.AppsV1().Deployments(ns).Get(ctx, depName, metav1.GetOptions{}); err == nil {
		if dep.Spec.Paused {
			return nil
		}
	}

	timeout := 120 * time.Second
	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		dep, err := client.Clientset.AppsV1().Deployments(ns).Get(ctx, depName, metav1.GetOptions{})
		if err != nil {
			return err
		}
		desired := int32(1)
		if dep.Spec.Replicas != nil {
			desired = *dep.Spec.Replicas
		}
		// Success path
		for _, cond := range dep.Status.Conditions {
			if cond.Type == appsv1.DeploymentAvailable && cond.Status == corev1.ConditionTrue {
				if dep.Status.UpdatedReplicas == desired && dep.Status.ReadyReplicas == desired && dep.Status.ObservedGeneration >= dep.Generation {
					return nil
				}
			}
			if cond.Type == appsv1.DeploymentProgressing && cond.Status == corev1.ConditionFalse && cond.Reason == "ProgressDeadlineExceeded" {
				_ = th.removeInjectAnnotations(ctx, client, ns, depName)
				return fmt.Errorf("rollout failed: %s — instrumentation reverted", cond.Message)
			}
		}
		time.Sleep(3 * time.Second)
	}

	// Timeout — examine final state
	dep, _ := client.Clientset.AppsV1().Deployments(ns).Get(ctx, depName, metav1.GetOptions{})
	if dep != nil {
		desired := int32(1)
		if dep.Spec.Replicas != nil {
			desired = *dep.Spec.Replicas
		}
		if dep.Status.ReadyReplicas < desired {
			_ = th.removeInjectAnnotations(ctx, client, ns, depName)
			return fmt.Errorf("rollout did not complete in 2 minutes (%d/%d ready) — instrumentation reverted", dep.Status.ReadyReplicas, desired)
		}
	}
	return nil
}

// InstrumentDeployment handles
// POST /clusters/{clusterId}/deployments/{namespace}/{deployment}/instrument
func (th *TracingHandler) InstrumentDeployment(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	ns := vars["namespace"]
	name := vars["deployment"]
	requestID := logger.FromContext(r.Context())
	ctx := r.Context()

	client, err := th.clusterService.GetClient(clusterID)
	if err != nil {
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, "Cluster not found: "+err.Error(), requestID)
		return
	}

	var req instrumentOneRequest
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}

	dep, err := client.Clientset.AppsV1().Deployments(ns).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, "Deployment not found", requestID)
			return
		}
		respondErrorWithCode(w, http.StatusInternalServerError, ErrCodeInternalError, "Failed to get deployment: "+err.Error(), requestID)
		return
	}

	// Idempotent — if an inject-* annotation already exists, return success
	// without patching (don't trigger a needless rolling restart).
	if existingLang, _, already := findInjectAnnotation(dep); already {
		respondJSON(w, http.StatusOK, map[string]interface{}{
			"instrumented":    true,
			"language":        existingLang,
			"rollout_started": false,
			"already":         true,
		})
		return
	}

	// Resolve target container. If the caller specified one, find it;
	// otherwise default to the first container.
	var targetContainer *corev1.Container
	containerName := strings.TrimSpace(req.Container)
	if containerName != "" {
		for i := range dep.Spec.Template.Spec.Containers {
			if dep.Spec.Template.Spec.Containers[i].Name == containerName {
				targetContainer = &dep.Spec.Template.Spec.Containers[i]
				break
			}
		}
		if targetContainer == nil {
			respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest,
				"Container not found in deployment: "+containerName, requestID)
			return
		}
	} else if len(dep.Spec.Template.Spec.Containers) > 0 {
		targetContainer = &dep.Spec.Template.Spec.Containers[0]
	}

	lang := strings.ToLower(strings.TrimSpace(req.Language))
	if lang == "" {
		if targetContainer != nil {
			lang = detectContainerLanguage(targetContainer).Language
		} else {
			lang = detectLanguageFromDeployment(dep)
		}
	}
	if lang == "unknown" || lang == "" {
		respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest,
			"Could not auto-detect language; provide 'language' explicitly (java|python|nodejs|go|dotnet)", requestID)
		return
	}
	valid := false
	for _, s := range supportedLanguages {
		if s == lang {
			valid = true
			break
		}
	}
	if !valid {
		respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest,
			"Unsupported language for auto-instrumentation: "+lang, requestID)
		return
	}

	// Run preflight checks and refuse if any blocking check fails.
	preflight := runPreflightChecks(dep, targetContainer)
	if !preflight.Passed {
		respondJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error":            "Preflight checks failed",
			"preflight_checks": preflight,
		})
		return
	}

	// Build strategic merge patch on the pod template annotations.
	annPatch := map[string]interface{}{
		"instrumentation.opentelemetry.io/inject-" + lang: "kubilitics-system/kubilitics-auto",
	}
	if containerName != "" {
		annPatch["instrumentation.opentelemetry.io/container-names"] = containerName
	}
	patch := map[string]interface{}{
		"spec": map[string]interface{}{
			"template": map[string]interface{}{
				"metadata": map[string]interface{}{
					"annotations": annPatch,
				},
			},
		},
	}
	patchBytes, err := json.Marshal(patch)
	if err != nil {
		respondErrorWithCode(w, http.StatusInternalServerError, ErrCodeInternalError, "Failed to marshal patch: "+err.Error(), requestID)
		return
	}

	if _, err := client.Clientset.AppsV1().Deployments(ns).Patch(
		ctx, name, types.StrategicMergePatchType, patchBytes, metav1.PatchOptions{},
	); err != nil {
		respondErrorWithCode(w, http.StatusInternalServerError, ErrCodeInternalError, "Failed to patch deployment: "+err.Error(), requestID)
		return
	}

	log.Printf("[tracing] instrumented %s/%s with language=%s container=%q", ns, name, lang, containerName)

	// Synchronously watch the rollout and auto-rollback on failure. The
	// client just clicked a button and is waiting — they want the result.
	// This is bounded to ~2 minutes by watchRolloutAndRollback.
	rolloutErr := th.watchRolloutAndRollback(ctx, client, ns, name)
	if rolloutErr != nil {
		respondJSON(w, http.StatusOK, map[string]interface{}{
			"instrumented":    false,
			"language":        lang,
			"container":       containerName,
			"rollout_started": true,
			"rolled_back":     true,
			"error":           rolloutErr.Error(),
			"preflight_checks": preflight,
		})
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"instrumented":     true,
		"language":         lang,
		"container":        containerName,
		"rollout_started":  true,
		"rollout_complete": true,
		"preflight_checks": preflight,
	})
}

// UninstrumentDeployment handles
// POST /clusters/{clusterId}/deployments/{namespace}/{deployment}/uninstrument
func (th *TracingHandler) UninstrumentDeployment(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	ns := vars["namespace"]
	name := vars["deployment"]
	requestID := logger.FromContext(r.Context())
	ctx := r.Context()

	client, err := th.clusterService.GetClient(clusterID)
	if err != nil {
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, "Cluster not found: "+err.Error(), requestID)
		return
	}

	if err := th.removeInjectAnnotations(ctx, client, ns, name); err != nil {
		if apierrors.IsNotFound(err) {
			respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, "Deployment not found", requestID)
			return
		}
		respondErrorWithCode(w, http.StatusInternalServerError, ErrCodeInternalError, "Failed to patch deployment: "+err.Error(), requestID)
		return
	}

	log.Printf("[tracing] uninstrumented %s/%s", ns, name)
	respondJSON(w, http.StatusOK, map[string]interface{}{
		"instrumented": false,
	})
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
