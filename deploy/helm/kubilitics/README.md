# Kubilitics Helm Chart

Production-ready Helm chart for deploying Kubilitics - Kubernetes API gateway, topology visualization, and observability platform.

## Features

- **Backend Service**: Full-featured Kubernetes API gateway with topology engine
- **AI Backend** (Optional): AI-powered cluster analysis and recommendations
- **Frontend** (Optional): Web UI served via nginx
- **Database Options**: SQLite (default) or PostgreSQL (HA via Bitnami subchart)
- **Security**: RBAC, Network Policies, Pod Security Contexts, TLS support
- **Observability**: Prometheus ServiceMonitor, health checks, readiness/liveness probes
- **High Availability**: HPA, Pod Disruption Budgets, multiple replicas support
- **Production Ready**: ConfigMaps, Secrets, Ingress with cert-manager support

## Prerequisites

- Kubernetes 1.24+
- Helm 3.8+
- kubectl configured to access your cluster

### Optional Prerequisites

- cert-manager (for automatic TLS certificate management)
- Prometheus Operator (for ServiceMonitor support)
- Ingress Controller (nginx, traefik, istio, etc.)

## Quick Start

### Install with Default Values (SQLite)

```bash
# Clone the repository
git clone https://github.com/kubilitics/kubilitics-os-emergent.git
cd kubilitics-os-emergent

# Install the chart
helm install kubilitics ./deploy/helm/kubilitics \
  --namespace kubilitics-system \
  --create-namespace

# Check status
kubectl get pods -n kubilitics-system
kubectl get svc -n kubilitics-system
```

### Install with PostgreSQL (HA)

```bash
helm install kubilitics ./deploy/helm/kubilitics \
  --namespace kubilitics-system \
  --create-namespace \
  --set database.type=postgresql \
  --set postgresql.enabled=true \
  --set postgresql.auth.postgresPassword=changeme \
  --set postgresql.auth.password=changeme
```

### Install with Frontend

```bash
helm install kubilitics ./deploy/helm/kubilitics \
  --namespace kubilitics-system \
  --create-namespace \
  --set frontend.enabled=true \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=kubilitics.example.com
```

## Configuration

### Core Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `replicaCount` | Number of backend replicas | `1` |
| `image.repository` | Backend container image | `ghcr.io/kubilitics/kubilitics-backend` |
| `image.tag` | Image tag | `1.0.0` |
| `image.pullPolicy` | Image pull policy | `IfNotPresent` |
| `service.type` | Kubernetes service type | `ClusterIP` |
| `service.port` | Service port | `819` |

### Database Configuration

#### SQLite (Default)

```yaml
database:
  type: "sqlite"
  sqlite:
    path: "/data/kubilitics.db"

persistence:
  enabled: true
  size: 1Gi
  storageClass: ""
```

#### PostgreSQL (HA)

```yaml
database:
  type: "postgresql"
  postgresql:
    host: ""  # Auto-set from subchart
    port: 5432
    database: "kubilitics"
    username: "kubilitics"
    sslMode: "require"

postgresql:
  enabled: true
  auth:
    postgresPassword: "changeme"
    password: "changeme"
    database: "kubilitics"
    username: "kubilitics"
  primary:
    persistence:
      size: 8Gi
```

### Backend Configuration

```yaml
config:
  port: 819
  logLevel: "info"
  allowedOrigins: "https://your-domain.com"  # REQUIRED in production
  requestTimeoutSec: 30
  topologyTimeoutSec: 30
  maxClusters: 100
  k8sTimeoutSec: 15
```

### AI Backend (Optional)

```yaml
ai:
  enabled: true
  replicaCount: 1
  image:
    repository: ghcr.io/kubilitics/kubilitics-ai
    tag: "1.0.0"
  config:
    serverPort: 8081
    backendAddress: "kubilitics:50051"
    llmProvider: "anthropic"  # openai | anthropic | ollama
  secret:
    enabled: true
    anthropicApiKey: "your-api-key"
```

### Frontend (Optional)

```yaml
frontend:
  enabled: true
  replicaCount: 2
  image:
    repository: nginx
    tag: "1.25-alpine"
  service:
    type: ClusterIP
    port: 80
```

### Ingress Configuration

```yaml
ingress:
  enabled: true
  className: "nginx"
  hosts:
    - host: kubilitics.example.com
      paths:
        - path: /
          pathType: Prefix
  certManager:
    enabled: true
    clusterIssuer: "letsencrypt-prod"
  tls:
    - hosts:
        - kubilitics.example.com
```

### Security Configuration

#### RBAC

```yaml
rbac:
  enabled: true
  serviceAccount:
    annotations:
      eks.amazonaws.com/role-arn: "arn:aws:iam::ACCOUNT_ID:role/kubilitics-role"
```

#### Network Policies

```yaml
networkPolicy:
  enabled: true
  ingress:
    namespace: "ingress-nginx"
  egress:
    allowAll: true
```

#### Pod Disruption Budgets

```yaml
podDisruptionBudget:
  enabled: true
  minAvailable: 1
```

### Autoscaling

```yaml
autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80
  targetMemoryUtilizationPercentage: 80
```

### Observability

```yaml
serviceMonitor:
  enabled: true
  metricsPath: "/metrics"
  interval: "30s"
```

## Advanced Configuration

### Custom ConfigMap and Secrets

```yaml
configMap:
  enabled: true
  data:
    CUSTOM_CONFIG: "value"

secret:
  enabled: true
  authJWTSecret: "your-jwt-secret"
  authAdminPass: "admin-password"
```

### Resource Limits

```yaml
resources:
  limits:
    cpu: 1000m
    memory: 1Gi
  requests:
    cpu: 200m
    memory: 256Mi
```

### Node Selection and Affinity

```yaml
nodeSelector:
  kubernetes.io/os: linux

affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector:
            matchExpressions:
              - key: app.kubernetes.io/name
                operator: In
                values:
                  - kubilitics
          topologyKey: kubernetes.io/hostname

tolerations:
  - key: "dedicated"
    operator: "Equal"
    value: "kubilitics"
    effect: "NoSchedule"
```

## Installation Examples

### Development Setup

```bash
helm install kubilitics ./deploy/helm/kubilitics \
  --namespace kubilitics-dev \
  --create-namespace \
  --set config.allowedOrigins="http://localhost:5173,http://localhost:819" \
  --set replicaCount=1 \
  --set persistence.enabled=false
```

### Production Setup

```bash
helm install kubilitics ./deploy/helm/kubilitics \
  --namespace kubilitics-system \
  --create-namespace \
  --set replicaCount=3 \
  --set database.type=postgresql \
  --set postgresql.enabled=true \
  --set frontend.enabled=true \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=kubilitics.example.com \
  --set ingress.certManager.enabled=true \
  --set autoscaling.enabled=true \
  --set networkPolicy.enabled=true \
  --set podDisruptionBudget.enabled=true \
  --set serviceMonitor.enabled=true \
  --set config.allowedOrigins="https://kubilitics.example.com" \
  --set secret.enabled=true \
  --set secret.authJWTSecret="$(openssl rand -base64 32)"
```

### High Availability Setup

```bash
helm install kubilitics ./deploy/helm/kubilitics \
  --namespace kubilitics-system \
  --create-namespace \
  --set replicaCount=3 \
  --set database.type=postgresql \
  --set postgresql.enabled=true \
  --set postgresql.readReplicas.replicaCount=2 \
  --set frontend.enabled=true \
  --set frontend.replicaCount=3 \
  --set autoscaling.enabled=true \
  --set autoscaling.minReplicas=3 \
  --set podDisruptionBudget.enabled=true \
  --set podDisruptionBudget.minAvailable=2 \
  --set networkPolicy.enabled=true
```

## Upgrading

```bash
# Upgrade to new version
helm upgrade kubilitics ./deploy/helm/kubilitics \
  --namespace kubilitics-system \
  --reuse-values

# Upgrade with new values
helm upgrade kubilitics ./deploy/helm/kubilitics \
  --namespace kubilitics-system \
  --set image.tag=1.1.0
```

## Uninstalling

```bash
helm uninstall kubilitics --namespace kubilitics-system

# Remove PVCs (optional, will delete data)
kubectl delete pvc -n kubilitics-system -l app.kubernetes.io/name=kubilitics
```

## Testing

Run Helm tests to verify the installation:

```bash
# Run all tests
helm test kubilitics --namespace kubilitics-system

# Run specific test
helm test kubilitics --namespace kubilitics-system --filter name=test-backend-connection
```

Available tests:
- `test-backend-deployment`: Verifies deployment is ready
- `test-backend-service`: Verifies service configuration
- `test-backend-connection`: Verifies backend health endpoint

## Troubleshooting

### Pods Not Starting

```bash
# Check pod status
kubectl get pods -n kubilitics-system

# Check pod logs
kubectl logs -n kubilitics-system -l app.kubernetes.io/name=kubilitics

# Check events
kubectl get events -n kubilitics-system --sort-by='.lastTimestamp'
```

### Database Connection Issues

```bash
# For SQLite: Check PVC
kubectl get pvc -n kubilitics-system

# For PostgreSQL: Check PostgreSQL pods
kubectl get pods -n kubilitics-system -l app.kubernetes.io/name=postgresql

# Check PostgreSQL logs
kubectl logs -n kubilitics-system -l app.kubernetes.io/name=postgresql
```

### Service Not Accessible

```bash
# Check service
kubectl get svc -n kubilitics-system

# Port forward for testing
kubectl port-forward -n kubilitics-system svc/kubilitics 819:819

# Test health endpoint
curl http://localhost:819/health
```

### RBAC Issues

```bash
# Check ServiceAccount
kubectl get sa -n kubilitics-system

# Check ClusterRole
kubectl get clusterrole kubilitics

# Check ClusterRoleBinding
kubectl get clusterrolebinding kubilitics

# Test permissions
kubectl auth can-i get pods --as=system:serviceaccount:kubilitics-system:kubilitics
```

## Values Reference

See [values.yaml](./values.yaml) for all available configuration options with detailed comments.

## Contributing

When contributing to this Helm chart:

1. Test your changes locally with `helm template` and `helm lint`
2. Run tests with `helm test`
3. Update documentation for any new parameters
4. Follow semantic versioning for chart versions

## License

Apache 2.0

## Support

- GitHub Issues: https://github.com/kubilitics/kubilitics-os-emergent/issues
- Documentation: https://kubilitics.com/docs
