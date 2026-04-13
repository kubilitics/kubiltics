# kubilitics-otel

OpenTelemetry Collector for Kubilitics. Receives OTLP traces from instrumented
applications in your cluster and forwards them to the Kubilitics backend.

## Prerequisites

- Kubernetes 1.25+
- Helm 3.10+
- [cert-manager](https://cert-manager.io/) v1.11+ — required by the OTel Operator webhook
- [OpenTelemetry Operator](https://github.com/open-telemetry/opentelemetry-operator) v0.85+

These are NOT bundled. Install them once per cluster before installing this chart:

```bash
# cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml
kubectl wait --for=condition=available --timeout=120s deployment/cert-manager-webhook -n cert-manager

# OpenTelemetry Operator
kubectl apply -f https://github.com/open-telemetry/opentelemetry-operator/releases/latest/download/opentelemetry-operator.yaml
kubectl wait --for=condition=available --timeout=120s deployment/opentelemetry-operator-controller-manager -n opentelemetry-operator-system
```

## Install

```bash
helm repo add kubilitics https://charts.kubilitics.io
helm repo update
helm install kubilitics-otel kubilitics/kubilitics-otel \
  --namespace kubilitics-system --create-namespace \
  --set kubilitics.clusterId=<your-cluster-id> \
  --set kubilitics.backendUrl=<your-kubilitics-backend-url>
```

Get `clusterId` and `backendUrl` from the Kubilitics setup page for your cluster
(the UI generates a copy-pasteable command with both values pre-filled).

## Verify

```bash
kubectl get pods -n kubilitics-system
kubectl wait --for=condition=available --timeout=60s deployment/otel-collector -n kubilitics-system
```

## Instrumenting your apps

After the chart is installed, add an annotation to any Deployment to enable
OTel auto-instrumentation:

```bash
kubectl -n my-namespace annotate deployment my-app \
  instrumentation.opentelemetry.io/inject-python=kubilitics-system/kubilitics-auto
```

Supported languages: `java`, `python`, `nodejs`, `go`, `dotnet`. The Kubilitics
UI auto-detects the language for each deployment and generates the right command.

## Uninstall

```bash
helm uninstall kubilitics-otel -n kubilitics-system
kubectl delete namespace kubilitics-system
```

## Values reference

| Key | Default | Description |
|---|---|---|
| `kubilitics.clusterId` | `""` | **REQUIRED.** Cluster identifier. |
| `kubilitics.backendUrl` | `""` | **REQUIRED.** Kubilitics backend URL. |
| `image.repository` | `otel/opentelemetry-collector-contrib` | Override for air-gap registries. |
| `image.tag` | `0.119.0` | Pin a specific collector version. |
| `image.pullPolicy` | `IfNotPresent` | |
| `image.imagePullSecrets` | `[]` | For private registries. |
| `replicaCount` | `1` | HA: bump to 2+ for production. |
| `resources.requests.cpu` | `100m` | |
| `resources.requests.memory` | `128Mi` | |
| `resources.limits.cpu` | `500m` | |
| `resources.limits.memory` | `512Mi` | |
| `service.grpcPort` | `4317` | OTLP gRPC port. |
| `service.httpPort` | `4318` | OTLP HTTP port. |
| `instrumentation.enabled` | `true` | Install the Instrumentation CR. |
| `instrumentation.languages` | all 5 | Languages to enable injection for. |

## Air-gap installation

For environments without internet access:

1. Mirror these images to your internal registry:
   - `otel/opentelemetry-collector-contrib:0.119.0`
   - `ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-{java,python,nodejs,go,dotnet}:latest`

2. Override the chart's image references:

```yaml
image:
  repository: my-registry.internal/otel-collector-contrib
  tag: "0.119.0"
```
