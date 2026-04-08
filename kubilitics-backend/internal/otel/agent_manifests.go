package otel

import "fmt"

// AgentManifestYAML returns multi-doc K8s YAML for deploying the kubilitics
// trace agent into a cluster. It creates a namespace, deployment, and service.
func AgentManifestYAML(imageTag string) string {
	return fmt.Sprintf(`apiVersion: v1
kind: Namespace
metadata:
  name: kubilitics-system
  labels:
    app.kubernetes.io/managed-by: kubilitics
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kubilitics-trace-agent
  namespace: kubilitics-system
  labels:
    app.kubernetes.io/name: kubilitics-trace-agent
    app.kubernetes.io/managed-by: kubilitics
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: kubilitics-trace-agent
  template:
    metadata:
      labels:
        app.kubernetes.io/name: kubilitics-trace-agent
    spec:
      containers:
        - name: trace-agent
          image: ghcr.io/kubilitics/trace-agent:%s
          imagePullPolicy: IfNotPresent
          ports:
            - name: otlp-grpc
              containerPort: 4317
              protocol: TCP
            - name: otlp-http
              containerPort: 4318
              protocol: TCP
            - name: query
              containerPort: 9417
              protocol: TCP
          resources:
            requests:
              memory: "64Mi"
              cpu: "50m"
            limits:
              memory: "128Mi"
              cpu: "200m"
          volumeMounts:
            - name: data
              mountPath: /data
          livenessProbe:
            httpGet:
              path: /health
              port: 9417
            initialDelaySeconds: 5
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /health
              port: 9417
            initialDelaySeconds: 3
            periodSeconds: 10
      volumes:
        - name: data
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: kubilitics-trace-agent
  namespace: kubilitics-system
  labels:
    app.kubernetes.io/name: kubilitics-trace-agent
    app.kubernetes.io/managed-by: kubilitics
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: kubilitics-trace-agent
  ports:
    - name: otlp-grpc
      port: 4317
      targetPort: 4317
      protocol: TCP
    - name: otlp-http
      port: 4318
      targetPort: 4318
      protocol: TCP
    - name: query
      port: 9417
      targetPort: 9417
      protocol: TCP
`, imageTag)
}

// InstrumentationCRsYAML returns YAML for the OpenTelemetry Instrumentation
// custom resource. This requires the OTel Operator to be installed in the
// cluster; application is best-effort.
func InstrumentationCRsYAML() string {
	return `apiVersion: opentelemetry.io/v1alpha1
kind: Instrumentation
metadata:
  name: kubilitics-auto
  namespace: kubilitics-system
spec:
  exporter:
    endpoint: http://kubilitics-trace-agent.kubilitics-system:4318
  propagators:
    - tracecontext
    - baggage
  sampler:
    type: parentbased_traceidratio
    argument: "1"
  env:
    - name: OTEL_EXPORTER_OTLP_PROTOCOL
      value: http/json
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
              value: "kubilitics-trace-agent.kubilitics-system:4318"
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

// CleanupManifestNames returns the resource names used by the trace agent
// deployment so they can be located for deletion during disable.
func CleanupManifestNames() (namespace, deploymentName, serviceName, instrumentationName string) {
	return "kubilitics-system", "kubilitics-trace-agent", "kubilitics-trace-agent", "kubilitics-auto"
}

// DemoAppResourceNames returns the resource names for the demo app so they
// can be cleaned up when tracing is disabled.
func DemoAppResourceNames() (namespace, deploymentName, serviceName, cronJobName string) {
	return "kubilitics-system", "trace-demo-app", "trace-demo-app", "trace-demo-traffic"
}
