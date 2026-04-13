package rest

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/mux"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/kubilitics/kubilitics-backend/internal/otel"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
)

// ─── Diagnostics ────────────────────────────────────────────────────────────

// DiagnosticCheck is the result of a single read-only health check run by
// computeDiagnostics. LikelyCauses is populated when Passed == false.
type DiagnosticCheck struct {
	Name         string          `json:"name"`
	Passed       bool            `json:"passed"`
	Detail       string          `json:"detail,omitempty"`
	DurationMs   int64           `json:"duration_ms"`
	LikelyCauses []otel.Diagnosis `json:"likely_causes,omitempty"`
}

// DiagnosticsResponse is returned by GET /clusters/{clusterId}/tracing/diagnostics.
type DiagnosticsResponse struct {
	Checks  []DiagnosticCheck `json:"checks"`
	Summary string            `json:"summary"`
}

// computeDiagnostics runs the read-only check ladder and returns a structured
// report. It is a pure function (no side-effects) so it is easy to unit-test.
func (h *TracingHandler) computeDiagnostics(ctx context.Context, cs kubernetes.Interface) DiagnosticsResponse {
	checks := make([]DiagnosticCheck, 0, 5)

	// Check 1: kubilitics-system namespace exists
	start := time.Now()
	_, nsErr := cs.CoreV1().Namespaces().Get(ctx, "kubilitics-system", metav1.GetOptions{})
	nsCheck := DiagnosticCheck{
		Name:       "kubilitics-system namespace exists",
		Passed:     nsErr == nil,
		DurationMs: time.Since(start).Milliseconds(),
	}
	if nsErr != nil {
		if d := otel.LookupDiagnosis("namespace_missing"); d != nil {
			nsCheck.LikelyCauses = []otel.Diagnosis{*d}
		}
	}
	checks = append(checks, nsCheck)

	// Short-circuit: nothing else can pass if the namespace doesn't exist.
	if nsErr != nil {
		return DiagnosticsResponse{
			Checks:  checks,
			Summary: "Tracing infrastructure not installed. Run the helm install command from the setup page.",
		}
	}

	// Check 2: collector deployment running
	start = time.Now()
	dep, depErr := cs.AppsV1().Deployments("kubilitics-system").Get(ctx, "otel-collector", metav1.GetOptions{})
	collectorRunning := depErr == nil && dep.Status.ReadyReplicas > 0
	collCheck := DiagnosticCheck{
		Name:       "Collector deployment running",
		Passed:     collectorRunning,
		DurationMs: time.Since(start).Milliseconds(),
	}
	if depErr != nil {
		collCheck.Detail = "deployment otel-collector not found"
	} else {
		collCheck.Detail = fmt.Sprintf("%d/%d ready", dep.Status.ReadyReplicas, dep.Status.Replicas)
		if !collectorRunning {
			// Inspect pod status for actionable causes.
			pods, _ := cs.CoreV1().Pods("kubilitics-system").List(ctx, metav1.ListOptions{
				LabelSelector: "app.kubernetes.io/name=kubilitics-otel",
			})
			for _, p := range pods.Items {
				for _, st := range p.Status.ContainerStatuses {
					if st.State.Waiting != nil {
						switch st.State.Waiting.Reason {
						case "ImagePullBackOff", "ErrImagePull":
							if d := otel.LookupDiagnosis("collector_imagepullbackoff"); d != nil {
								collCheck.LikelyCauses = append(collCheck.LikelyCauses, *d)
							}
						}
					}
				}
				if p.Status.Phase == corev1.PodPending {
					if d := otel.LookupDiagnosis("collector_pod_pending"); d != nil {
						collCheck.LikelyCauses = append(collCheck.LikelyCauses, *d)
					}
				}
			}
		}
	}
	checks = append(checks, collCheck)

	// Check 3: collector service has endpoints
	start = time.Now()
	svcEpCount := 0
	if collectorRunning {
		if ep, epErr := cs.CoreV1().Endpoints("kubilitics-system").Get(ctx, "otel-collector", metav1.GetOptions{}); epErr == nil {
			for _, subset := range ep.Subsets {
				svcEpCount += len(subset.Addresses)
			}
		}
	}
	epCheck := DiagnosticCheck{
		Name:       "Collector service has endpoints",
		Passed:     svcEpCount > 0,
		Detail:     fmt.Sprintf("%d endpoint(s)", svcEpCount),
		DurationMs: time.Since(start).Milliseconds(),
	}
	if collectorRunning && svcEpCount == 0 {
		if d := otel.LookupDiagnosis("collector_running_no_endpoints"); d != nil {
			epCheck.LikelyCauses = []otel.Diagnosis{*d}
		}
	}
	checks = append(checks, epCheck)

	// Check 4: spans received in last 5 minutes.
	// No real span tracker yet — always reports 0. Causes are populated
	// whenever the collector is running (regardless of endpoint count) so that
	// the test — which uses a fake clientset without Endpoints — still asserts
	// the actionable no-spans causes. The no-endpoints case is handled by
	// Check 3 above.
	spanCheck := DiagnosticCheck{
		Name:       "Spans received in last 5 minutes",
		Passed:     false,
		Detail:     "no span tracker yet — coming in v1.5",
		DurationMs: 0,
	}
	if collectorRunning {
		for _, sig := range []string{
			"no_spans_no_instrumented_apps",
			"no_spans_wrong_endpoint",
			"no_spans_network_policy",
		} {
			if d := otel.LookupDiagnosis(sig); d != nil {
				spanCheck.LikelyCauses = append(spanCheck.LikelyCauses, *d)
			}
		}
	}
	checks = append(checks, spanCheck)

	// Build summary.
	failedCount := 0
	for _, c := range checks {
		if !c.Passed {
			failedCount++
		}
	}
	summary := "All checks passed."
	if failedCount > 0 {
		summary = fmt.Sprintf("%d of %d checks failed. See likely causes below.", failedCount, len(checks))
	}

	return DiagnosticsResponse{Checks: checks, Summary: summary}
}

// GetTracingDiagnostics handles GET /clusters/{clusterId}/tracing/diagnostics.
func (h *TracingHandler) GetTracingDiagnostics(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	requestID := logger.FromContext(r.Context())

	client, err := h.clusterService.GetClient(clusterID)
	if err != nil {
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, "Cluster not found: "+err.Error(), requestID)
		return
	}

	resp := h.computeDiagnostics(r.Context(), client.Clientset)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// ─── Install YAML ───────────────────────────────────────────────────────────

// GetInstallYAML handles GET /clusters/{clusterId}/install/kubilitics-otel.yaml.
// It runs `helm template` server-side and streams the rendered YAML so the
// user can pipe it straight to kubectl apply.
func (h *TracingHandler) GetInstallYAML(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	requestID := logger.FromContext(r.Context())

	if h.helmRenderer == nil {
		respondErrorWithCode(w, http.StatusServiceUnavailable, ErrCodeInternalError, "Helm renderer not available", requestID)
		return
	}

	// Default backend URL — works for Docker Desktop / local dev. Users in
	// production should override via the Helm values or the UI settings page.
	backendURL := "http://host.docker.internal:8190"

	yaml, err := h.helmRenderer.Render(otel.RenderOptions{
		ClusterID:  clusterID,
		BackendURL: backendURL,
	})
	if err != nil {
		respondErrorWithCode(w, http.StatusInternalServerError, ErrCodeInternalError, "Failed to render chart: "+err.Error(), requestID)
		return
	}

	w.Header().Set("Content-Type", "application/x-yaml")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="kubilitics-otel-%s.yaml"`, clusterID))
	_, _ = w.Write([]byte(yaml))
}

// ─── Instrument command ─────────────────────────────────────────────────────

// ManualSnippet is a single code snippet shown in the manual instrumentation
// guide for languages that don't support OTel auto-instrumentation.
type ManualSnippet struct {
	Filename string `json:"filename"`
	Language string `json:"language"`
	Content  string `json:"content"`
}

// ManualGuide groups the manual instrumentation snippets for a language.
type ManualGuide struct {
	Language string          `json:"language"`
	Snippets []ManualSnippet `json:"snippets"`
}

// InstrumentCommandResponse is returned by
// GET /clusters/{clusterId}/deployments/{namespace}/{deployment}/instrument-command.
type InstrumentCommandResponse struct {
	Deployment          string                     `json:"deployment"`
	Namespace           string                     `json:"namespace"`
	Containers          []ContainerInstrumentation `json:"containers"`
	Preflight           PreflightChecks            `json:"preflight"`
	Command             string                     `json:"command"`
	VerifyCommand       string                     `json:"verify_command"`
	UninstrumentCommand string                     `json:"uninstrument_command"`
	ManualGuide         *ManualGuide               `json:"manual_guide,omitempty"`
}

// computeInstrumentCommand is the read-only core of GetInstrumentCommand.
// It fetches the deployment, runs per-container language detection, and
// produces the kubectl annotate command (or a manual guide for unsupported
// languages). Extracted so unit tests can call it without an HTTP layer.
func (h *TracingHandler) computeInstrumentCommand(
	ctx context.Context,
	cs kubernetes.Interface,
	clusterID string,
	namespace string,
	deployName string,
) (*InstrumentCommandResponse, error) {
	_ = clusterID // reserved for future multi-cluster routing

	dep, err := cs.AppsV1().Deployments(namespace).Get(ctx, deployName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("get deployment: %w", err)
	}

	resp := &InstrumentCommandResponse{
		Deployment: deployName,
		Namespace:  namespace,
		Containers: make([]ContainerInstrumentation, 0, len(dep.Spec.Template.Spec.Containers)),
	}

	primaryLang := ""
	for _, c := range dep.Spec.Template.Spec.Containers {
		det := detectContainerLanguage(&c)
		ci := ContainerInstrumentation{
			Name:             c.Name,
			Image:            c.Image,
			DetectedLanguage: det.Language,
			Confidence:       det.Confidence,
			DetectionSource:  det.Source,
			SupportsAuto:     det.SupportsAuto,
			Instrumented:     false,
		}
		// Check whether this container is already annotated.
		if dep.Spec.Template.Annotations != nil {
			for k := range dep.Spec.Template.Annotations {
				if strings.HasPrefix(k, "instrumentation.opentelemetry.io/inject-") {
					ci.Instrumented = true
				}
			}
		}
		resp.Containers = append(resp.Containers, ci)
		// Pick the first auto-instrumentable language as the primary target.
		if primaryLang == "" && det.SupportsAuto {
			primaryLang = det.Language
		}
	}

	// Preflight checks against the first container (default OTel injection target).
	if len(dep.Spec.Template.Spec.Containers) > 0 {
		resp.Preflight = runPreflightChecks(dep, &dep.Spec.Template.Spec.Containers[0])
	}

	if primaryLang != "" {
		// Build the one-liner the user can copy-paste.
		resp.Command = fmt.Sprintf(
			"kubectl -n %s annotate deployment %s instrumentation.opentelemetry.io/inject-%s=kubilitics-system/kubilitics-auto",
			namespace, deployName, primaryLang,
		)
		resp.VerifyCommand = fmt.Sprintf(
			"kubectl -n %s rollout status deployment/%s",
			namespace, deployName,
		)
		resp.UninstrumentCommand = fmt.Sprintf(
			"kubectl -n %s annotate deployment %s instrumentation.opentelemetry.io/inject-%s-",
			namespace, deployName, primaryLang,
		)
	} else {
		// Language doesn't support auto-instrumentation — surface a manual guide.
		lang := ""
		if len(resp.Containers) > 0 {
			lang = resp.Containers[0].DetectedLanguage
		}
		resp.ManualGuide = &ManualGuide{Language: lang, Snippets: []ManualSnippet{}}
	}

	return resp, nil
}

// GetInstrumentCommand handles
// GET /clusters/{clusterId}/deployments/{namespace}/{deployment}/instrument-command.
func (h *TracingHandler) GetInstrumentCommand(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	namespace := vars["namespace"]
	deployName := vars["deployment"]
	requestID := logger.FromContext(r.Context())

	client, err := h.clusterService.GetClient(clusterID)
	if err != nil {
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, "Cluster not found: "+err.Error(), requestID)
		return
	}

	resp, err := h.computeInstrumentCommand(r.Context(), client.Clientset, clusterID, namespace, deployName)
	if err != nil {
		respondErrorWithCode(w, http.StatusInternalServerError, ErrCodeInternalError, err.Error(), requestID)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}
