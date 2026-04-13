package otel

// Diagnosis is a single likely cause + remediation for a tracing failure mode.
// All entries are static; this file IS the troubleshooting database.
type Diagnosis struct {
	// Signature is a stable identifier we match on. See diagnose() below.
	Signature string `json:"signature"`
	// Title is a one-line description shown to the user.
	Title string `json:"title"`
	// Remediation is a short paragraph explaining what to do.
	Remediation string `json:"remediation"`
	// TestCommand is an optional kubectl command the user can copy to verify.
	TestCommand string `json:"test_command,omitempty"`
}

// allDiagnoses is the static troubleshooting database. Adding a new failure
// mode is just appending an entry here.
//
// Coverage targets the 14 most common failure modes — see the design spec
// for the rationale on why these specific signatures.
var allDiagnoses = []Diagnosis{
	{
		Signature:   "namespace_missing",
		Title:       "Kubilitics namespace doesn't exist yet",
		Remediation: "You haven't run the helm install command yet. Go back to the setup page and copy the command shown there.",
	},
	{
		Signature:   "cm_namespace_exists_but_no_webhook",
		Title:       "cert-manager is partially installed",
		Remediation: "The cert-manager namespace exists but the webhook pod isn't ready. The OTel Operator's webhook depends on cert-manager. Wait 60s and check again, or reinstall cert-manager.",
		TestCommand: "kubectl get pods -n cert-manager",
	},
	{
		Signature:   "operator_crash_loop",
		Title:       "OpenTelemetry Operator is crashing",
		Remediation: "The operator usually crashes when cert-manager isn't ready when it starts. Restart it: `kubectl rollout restart deployment/opentelemetry-operator-controller-manager -n opentelemetry-operator-system`",
		TestCommand: "kubectl logs -n opentelemetry-operator-system deployment/opentelemetry-operator-controller-manager --tail=50",
	},
	{
		Signature:   "collector_imagepullbackoff",
		Title:       "Collector image cannot be pulled",
		Remediation: "The collector pod is in ImagePullBackOff. If you're in an air-gap environment, mirror otel/opentelemetry-collector-contrib:0.119.0 to your internal registry and override image.repository in the helm values.",
		TestCommand: "kubectl describe pod -n kubilitics-system -l app.kubernetes.io/name=kubilitics-otel | grep -A5 'Events'",
	},
	{
		Signature:   "collector_pod_pending",
		Title:       "Collector pod is Pending",
		Remediation: "The pod can't be scheduled. Most likely your nodes don't have enough CPU/memory headroom, or the pod's nodeSelector/tolerations don't match any node.",
		TestCommand: "kubectl describe pod -n kubilitics-system -l app.kubernetes.io/name=kubilitics-otel | grep -A3 'Conditions'",
	},
	{
		Signature:   "collector_running_no_endpoints",
		Title:       "Collector running but Service has no endpoints",
		Remediation: "Service selector mismatch. This is rare and usually indicates a bug in the chart. File an issue with the output of the test command.",
		TestCommand: "kubectl get endpoints -n kubilitics-system otel-collector",
	},
	{
		Signature:   "no_spans_no_instrumented_apps",
		Title:       "No applications are instrumented",
		Remediation: "The collector is healthy but no apps are sending spans. Open any Deployment detail page → Traces tab to see the kubectl annotate command for that specific deployment.",
	},
	{
		Signature:   "no_spans_wrong_endpoint",
		Title:       "Apps are sending traces to a different endpoint",
		Remediation: "Check the OTEL_EXPORTER_OTLP_ENDPOINT env var in your app pods. It should point to http://otel-collector.kubilitics-system:4318 for HTTP or :4317 for gRPC.",
		TestCommand: "kubectl get pods -A -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name}: {.spec.containers[*].env[?(@.name==\"OTEL_EXPORTER_OTLP_ENDPOINT\")].value}{\"\\n\"}{end}'",
	},
	{
		Signature:   "no_spans_network_policy",
		Title:       "NetworkPolicy may be blocking pod-to-collector traffic",
		Remediation: "Run a test pod in the same namespace as your apps to verify connectivity to the collector. If this fails, you have a NetworkPolicy that needs an exception for the kubilitics-system namespace.",
		TestCommand: "kubectl run otlp-test --rm -it --image=curlimages/curl --restart=Never -- curl -v http://otel-collector.kubilitics-system:4318/v1/traces",
	},
	{
		Signature:   "no_spans_istio_conflict",
		Title:       "Istio sidecar may be intercepting OTLP traffic",
		Remediation: "If you have Istio installed, the sidecar can intercept the collector's port. Add an exclusion: annotate the collector pod with `traffic.sidecar.istio.io/excludeOutboundPorts: \"4317,4318\"`.",
	},
	{
		Signature:   "instrument_security_context_blocker",
		Title:       "Target deployment uses readOnlyRootFilesystem",
		Remediation: "OTel auto-instrumentation needs to write the SDK init container's files. Either disable readOnlyRootFilesystem on the target container, or add an emptyDir volume mount at the SDK install path.",
	},
	{
		Signature:   "instrument_replicaset_drift",
		Title:       "GitOps controller may be reverting the annotation",
		Remediation: "Argo CD/Flux will revert any annotation that's not in your git source. Commit the instrumentation annotation to your deployment YAML in git, not just via kubectl.",
	},
	{
		Signature:   "crd_version_mismatch",
		Title:       "OpenTelemetry Operator CRD version mismatch",
		Remediation: "The Instrumentation CR version doesn't match what the operator supports. Upgrade the operator to v0.85+ or downgrade the chart to a compatible version.",
		TestCommand: "kubectl get crd instrumentations.opentelemetry.io -o jsonpath='{.spec.versions[*].name}'",
	},
	{
		Signature:   "rbac_denied",
		Title:       "Backend lacks permission to read cluster resources",
		Remediation: "The backend's kubeconfig doesn't have read access to namespaces, deployments, or pods. Check the backend logs for 'forbidden' errors and grant the missing permissions.",
	},
}

// LookupDiagnosis returns the Diagnosis for a given signature, or nil if
// the signature is unknown. Used by the diagnostics endpoint to attach
// remediation hints to failed checks.
func LookupDiagnosis(signature string) *Diagnosis {
	for i := range allDiagnoses {
		if allDiagnoses[i].Signature == signature {
			return &allDiagnoses[i]
		}
	}
	return nil
}

// AllDiagnoses returns the entire troubleshooting database (used by tests
// and for documentation generation).
func AllDiagnoses() []Diagnosis {
	out := make([]Diagnosis, len(allDiagnoses))
	copy(out, allDiagnoses)
	return out
}
