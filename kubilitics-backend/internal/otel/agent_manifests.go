package otel

import "fmt"

// otelCollectorImage is the standard OpenTelemetry Collector contrib image.
// We pin to a known-good version for reproducibility. Bump when validating
// against a newer release.
const otelCollectorImage = "otel/opentelemetry-collector-contrib:0.119.0"

// AgentManifestYAML returns multi-doc K8s YAML for deploying the standard
// OpenTelemetry Collector into a cluster as the Kubilitics trace ingestion
// agent. The collector receives OTLP traces from in-cluster apps, enriches
// them with k8sattributes, and pushes them via OTLP/HTTP to the Kubilitics
// backend.
//
// clusterID is injected as the resource attribute "kubilitics.cluster.id"
// so the backend's OTLP receiver can attribute spans to the right cluster.
//
// backendURL must be the full URL the collector should POST to, e.g.
// "http://host.docker.internal:8190/v1/traces" for Docker Desktop kind
// clusters where the collector is inside the cluster but the backend runs
// on the host.
func AgentManifestYAML(clusterID string, backendURL string) string {
	return fmt.Sprintf(`apiVersion: v1
kind: Namespace
metadata:
  name: kubilitics-system
  labels:
    app.kubernetes.io/managed-by: kubilitics
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: otel-collector
  namespace: kubilitics-system
  labels:
    app.kubernetes.io/name: otel-collector
    app.kubernetes.io/managed-by: kubilitics
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: kubilitics-otel-collector
  labels:
    app.kubernetes.io/managed-by: kubilitics
rules:
  - apiGroups: [""]
    resources: ["pods", "namespaces", "nodes"]
    verbs: ["get", "watch", "list"]
  - apiGroups: ["apps"]
    resources: ["replicasets", "deployments"]
    verbs: ["get", "watch", "list"]
  - apiGroups: ["extensions"]
    resources: ["replicasets"]
    verbs: ["get", "watch", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: kubilitics-otel-collector
  labels:
    app.kubernetes.io/managed-by: kubilitics
subjects:
  - kind: ServiceAccount
    name: otel-collector
    namespace: kubilitics-system
roleRef:
  kind: ClusterRole
  name: kubilitics-otel-collector
  apiGroup: rbac.authorization.k8s.io
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: otel-collector-config
  namespace: kubilitics-system
  labels:
    app.kubernetes.io/name: otel-collector
    app.kubernetes.io/managed-by: kubilitics
data:
  config.yaml: |
    receivers:
      otlp:
        protocols:
          http:
            endpoint: 0.0.0.0:4318
          grpc:
            endpoint: 0.0.0.0:4317

    processors:
      batch:
        timeout: 5s
        send_batch_size: 100
      k8sattributes:
        auth_type: serviceAccount
        extract:
          metadata:
            - k8s.namespace.name
            - k8s.pod.name
            - k8s.pod.uid
            - k8s.deployment.name
            - k8s.node.name
            - k8s.container.name
        pod_association:
          - sources:
              - from: resource_attribute
                name: k8s.pod.ip
          - sources:
              - from: resource_attribute
                name: k8s.pod.uid
          - sources:
              - from: connection
      resource:
        attributes:
          - key: kubilitics.cluster.id
            value: ${env:KUBILITICS_CLUSTER_ID}
            action: upsert

    exporters:
      otlphttp:
        endpoint: ${env:KUBILITICS_BACKEND_URL}
        tls:
          insecure: true
      debug:
        verbosity: basic

    service:
      pipelines:
        traces:
          receivers: [otlp]
          processors: [k8sattributes, resource, batch]
          exporters: [otlphttp, debug]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: otel-collector
  namespace: kubilitics-system
  labels:
    app.kubernetes.io/name: otel-collector
    app.kubernetes.io/managed-by: kubilitics
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: otel-collector
  template:
    metadata:
      labels:
        app.kubernetes.io/name: otel-collector
    spec:
      serviceAccountName: otel-collector
      containers:
        - name: otel-collector
          image: %s
          imagePullPolicy: IfNotPresent
          args: ["--config=/etc/otel/config.yaml"]
          env:
            - name: KUBILITICS_CLUSTER_ID
              value: %q
            - name: KUBILITICS_BACKEND_URL
              value: %q
          ports:
            - name: otlp-grpc
              containerPort: 4317
              protocol: TCP
            - name: otlp-http
              containerPort: 4318
              protocol: TCP
          resources:
            requests:
              memory: "128Mi"
              cpu: "50m"
            limits:
              memory: "512Mi"
              cpu: "500m"
          volumeMounts:
            - name: config
              mountPath: /etc/otel
      volumes:
        - name: config
          configMap:
            name: otel-collector-config
            items:
              - key: config.yaml
                path: config.yaml
---
apiVersion: v1
kind: Service
metadata:
  name: otel-collector
  namespace: kubilitics-system
  labels:
    app.kubernetes.io/name: otel-collector
    app.kubernetes.io/managed-by: kubilitics
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: otel-collector
  ports:
    - name: otlp-grpc
      port: 4317
      targetPort: 4317
      protocol: TCP
    - name: otlp-http
      port: 4318
      targetPort: 4318
      protocol: TCP
`, otelCollectorImage, clusterID, backendURL)
}

// InstrumentationCRsYAML returns YAML for the OpenTelemetry Instrumentation
// custom resource. This requires the OTel Operator to be installed in the
// cluster; application is best-effort.
//
// The exporter endpoint points at the in-cluster otel-collector Service
// (deployed by AgentManifestYAML), so auto-instrumented apps push spans
// to the collector, which forwards them to the Kubilitics backend.
func InstrumentationCRsYAML() string {
	return `apiVersion: opentelemetry.io/v1alpha1
kind: Instrumentation
metadata:
  name: kubilitics-auto
  namespace: kubilitics-system
spec:
  exporter:
    endpoint: http://otel-collector.kubilitics-system:4318
  propagators:
    - tracecontext
    - baggage
  sampler:
    type: parentbased_traceidratio
    argument: "1"
  env:
    - name: OTEL_EXPORTER_OTLP_PROTOCOL
      value: http/protobuf
  java:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-java:latest
  nodejs:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-nodejs:latest
  python:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-python:latest
  go:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-go:latest
  dotnet:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-dotnet:latest
`
}

// DemoAppManifestYAML returns multi-doc K8s YAML for deploying a demo
// application that generates real OTel traces. It includes a Deployment,
// Service, and a CronJob that sends traffic to produce continuous traces.
//
// NOTE: this still references a Kubilitics-published image. With the new
// standard otel-collector path, the demo app is optional — failures are
// non-fatal. Real users instrument their own apps to point at the collector.
func DemoAppManifestYAML(imageTag string) string {
	return fmt.Sprintf(`apiVersion: apps/v1
kind: Deployment
metadata:
  name: trace-demo-app
  namespace: kubilitics-system
  labels:
    app.kubernetes.io/name: trace-demo-app
    app.kubernetes.io/managed-by: kubilitics
spec:
  replicas: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: trace-demo-app
  template:
    metadata:
      labels:
        app.kubernetes.io/name: trace-demo-app
    spec:
      containers:
        - name: demo-app
          image: ghcr.io/kubilitics/trace-demo-app:%s
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 8080
              protocol: TCP
          env:
            - name: OTEL_EXPORTER_OTLP_ENDPOINT
              value: "http://otel-collector.kubilitics-system:4318"
            - name: OTEL_SERVICE_NAME
              value: "demo-order-service"
            - name: POD_NAMESPACE
              valueFrom:
                fieldRef:
                  fieldPath: metadata.namespace
            - name: POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
          resources:
            requests:
              memory: "32Mi"
              cpu: "10m"
            limits:
              memory: "64Mi"
              cpu: "100m"
          livenessProbe:
            httpGet:
              path: /api/health
              port: 8080
            initialDelaySeconds: 3
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /api/health
              port: 8080
            initialDelaySeconds: 2
            periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: trace-demo-app
  namespace: kubilitics-system
  labels:
    app.kubernetes.io/name: trace-demo-app
    app.kubernetes.io/managed-by: kubilitics
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: trace-demo-app
  ports:
    - name: http
      port: 8080
      targetPort: 8080
      protocol: TCP
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: trace-demo-traffic
  namespace: kubilitics-system
  labels:
    app.kubernetes.io/name: trace-demo-traffic
    app.kubernetes.io/managed-by: kubilitics
spec:
  schedule: "* * * * *"
  successfulJobsHistoryLimit: 1
  failedJobsHistoryLimit: 1
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: traffic
              image: ghcr.io/kubilitics/trace-demo-app:%s
              imagePullPolicy: IfNotPresent
              command: ["/bin/sh", "-c"]
              args:
                - |
                  for i in $(seq 1 10); do
                    wget -qO- http://trace-demo-app:8080/api/orders > /dev/null 2>&1
                    sleep 2
                  done
          restartPolicy: Never
      backoffLimit: 1
`, imageTag, imageTag)
}

// CleanupManifestNames returns the resource names used by the otel-collector
// deployment so they can be located for deletion during disable.
func CleanupManifestNames() (namespace, deploymentName, serviceName, instrumentationName string) {
	return "kubilitics-system", "otel-collector", "otel-collector", "kubilitics-auto"
}

// DemoAppResourceNames returns the resource names for the demo app so they
// can be cleaned up when tracing is disabled.
func DemoAppResourceNames() (namespace, deploymentName, serviceName, cronJobName string) {
	return "kubilitics-system", "trace-demo-app", "trace-demo-app", "trace-demo-traffic"
}
