package rest

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gorilla/mux"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/kubilitics/kubilitics-backend/internal/otel"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/service"
)

// TracingHandler provides REST endpoints for distributed tracing configuration
// and status. Kubilitics is read-only — it never mutates the user's cluster.
// Users run the install commands themselves with their own credentials.
type TracingHandler struct {
	clusterService service.ClusterService
	helmRenderer   *otel.HelmRenderer
}

// NewTracingHandler creates a new TracingHandler.
//
// Chart path resolution strategy, in order:
//
//  1. $KUBILITICS_CHART_PATH env var (explicit operator override)
//  2. Walk up from CWD or the executable's directory looking for a
//     charts/kubilitics-otel/Chart.yaml — useful for dev workflows where
//     you're iterating on the chart without rebuilding the binary
//  3. Extract the embedded chart (compiled into the binary via go:embed)
//     to a temp directory — this is how the sidecar works in production:
//     the chart travels with the binary
//
// If everything fails (shouldn't happen — embedded chart is always there),
// Render() returns a helpful error.
func NewTracingHandler(cs service.ClusterService) *TracingHandler {
	return &TracingHandler{
		clusterService: cs,
		helmRenderer:   otel.NewHelmRenderer(resolveChartPath()),
	}
}

// resolveChartPath returns the first usable chart directory. See
// NewTracingHandler for the resolution order.
func resolveChartPath() string {
	// 1. Env override.
	if env := strings.TrimSpace(os.Getenv("KUBILITICS_CHART_PATH")); env != "" {
		return env
	}

	// 2. Walk up from CWD or executable directory. Dev loop: edit the chart
	// in-repo, the backend picks it up on next request — no rebuild needed.
	if cwd, err := os.Getwd(); err == nil {
		if found := walkUpForChart(cwd); found != "" {
			return found
		}
	}
	if exe, err := os.Executable(); err == nil {
		if found := walkUpForChart(filepath.Dir(exe)); found != "" {
			return found
		}
	}

	// 3. Fall back to the embedded chart. This is the production path:
	// the binary ships with the chart compiled in, so it works regardless
	// of CWD, repo layout, or deployment target.
	if extracted, err := otel.ExtractedChartPath(); err == nil {
		return extracted
	}

	// Last-resort fallback so Render() produces a helpful error instead
	// of panicking. Embedded extraction shouldn't fail in practice.
	return "./charts/kubilitics-otel"
}

// walkUpForChart walks up from start, checking each ancestor (up to 8 levels)
// for a `charts/kubilitics-otel/Chart.yaml` file. Returns the directory path
// containing Chart.yaml on success, or "" if not found.
func walkUpForChart(start string) string {
	const maxLevels = 8
	dir := start
	for i := 0; i < maxLevels; i++ {
		candidate := filepath.Join(dir, "charts", "kubilitics-otel")
		if _, err := os.Stat(filepath.Join(candidate, "Chart.yaml")); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break // filesystem root
		}
		dir = parent
	}
	return ""
}

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
	Language     string `json:"language"`     // java|python|nodejs|go|dotnet|rust|ruby|php|cpp|unknown
	Confidence   string `json:"confidence"`   // high|medium|low
	Source       string `json:"source"`       // command|env|image-label|image-name|none
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
