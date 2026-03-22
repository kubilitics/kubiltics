#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Kubilitics — One-command deploy to any Kubernetes cluster
#
# Usage:
#   ./scripts/deploy.sh                           # Deploy to current kubectl context
#   ./scripts/deploy.sh --kind                    # Create Kind cluster + deploy
#   ./scripts/deploy.sh --registry ghcr.io/org    # Use pre-built registry images
#   ./scripts/deploy.sh --tag 1.0.0               # Specify image tag
#   ./scripts/deploy.sh --namespace prod           # Custom namespace
#   ./scripts/deploy.sh --uninstall               # Remove deployment
#
# Supports: Kind, Minikube, EKS, GKE, AKS, or any conformant cluster
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────────────────────
NAMESPACE="kubilitics"
RELEASE="kubilitics"
TAG="local"
REGISTRY=""
KIND_CLUSTER="kubilitics-test"
USE_KIND=false
UNINSTALL=false
BUILD_LOCAL=true
VALUES_FILE=""
DRY_RUN=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { echo -e "${BLUE}[kubilitics]${NC} $*"; }
ok()    { echo -e "${GREEN}  ✓${NC} $*"; }
warn()  { echo -e "${YELLOW}  ⚠${NC} $*"; }
fail()  { echo -e "${RED}  ✗${NC} $*"; exit 1; }

# ── Parse args ───────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --kind)       USE_KIND=true; shift ;;
    --registry)   REGISTRY="$2"; BUILD_LOCAL=false; TAG="${TAG:-latest}"; shift 2 ;;
    --tag)        TAG="$2"; shift 2 ;;
    --namespace)  NAMESPACE="$2"; shift 2 ;;
    --release)    RELEASE="$2"; shift 2 ;;
    --values)     VALUES_FILE="$2"; shift 2 ;;
    --uninstall)  UNINSTALL=true; shift ;;
    --dry-run)    DRY_RUN=true; shift ;;
    --help|-h)
      sed -n '2,/^# ─/{ /^#/s/^# \?//p }' "$0"
      exit 0
      ;;
    *) fail "Unknown option: $1 (use --help)" ;;
  esac
done

# ── Repo root ────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HELM_CHART="$REPO_ROOT/deploy/helm/kubilitics"

# ── Preflight checks ────────────────────────────────────────────────────────
log "Preflight checks..."

command -v kubectl >/dev/null || fail "kubectl not found. Install: https://kubernetes.io/docs/tasks/tools/"
command -v helm    >/dev/null || fail "helm not found. Install: https://helm.sh/docs/intro/install/"

if $USE_KIND; then
  command -v kind   >/dev/null || fail "kind not found. Install: https://kind.sigs.k8s.io/docs/user/quick-start/"
  command -v docker >/dev/null || fail "docker not found. Install: https://docs.docker.com/get-docker/"
fi

if ! $USE_KIND; then
  kubectl cluster-info >/dev/null 2>&1 || fail "No Kubernetes cluster reachable. Connect to a cluster or use --kind"
fi

ok "Prerequisites met"

# ── Uninstall ────────────────────────────────────────────────────────────────
if $UNINSTALL; then
  log "Uninstalling ${RELEASE} from ${NAMESPACE}..."
  helm uninstall "$RELEASE" --namespace "$NAMESPACE" 2>/dev/null || warn "Release not found"
  kubectl delete namespace "$NAMESPACE" 2>/dev/null || warn "Namespace not found"
  if $USE_KIND; then
    kind delete cluster --name "$KIND_CLUSTER" 2>/dev/null || warn "Kind cluster not found"
  fi
  ok "Cleanup complete"
  exit 0
fi

# ── Kind cluster ─────────────────────────────────────────────────────────────
if $USE_KIND; then
  if kind get clusters 2>/dev/null | grep -q "$KIND_CLUSTER"; then
    ok "Kind cluster '$KIND_CLUSTER' already exists"
  else
    log "Creating Kind cluster '$KIND_CLUSTER'..."
    kind create cluster --name "$KIND_CLUSTER" --wait 60s
    ok "Kind cluster ready"
  fi
  kubectl cluster-info --context "kind-${KIND_CLUSTER}" >/dev/null
fi

# ── Build images ─────────────────────────────────────────────────────────────
BACKEND_IMAGE="${REGISTRY:+${REGISTRY}/}kubilitics-backend"
FRONTEND_IMAGE="${REGISTRY:+${REGISTRY}/}kubilitics-frontend"

if $BUILD_LOCAL; then
  log "Building Docker images (tag: ${TAG})..."

  if command -v docker buildx bake --help >/dev/null 2>&1; then
    # Prefer buildx bake for parallel builds + caching
    cd "$REPO_ROOT"
    REGISTRY="$REGISTRY" TAG="$TAG" docker buildx bake backend frontend 2>&1 | tail -5
  else
    # Fallback to sequential builds
    log "  Building backend..."
    docker build -t "kubilitics-backend:${TAG}" "$REPO_ROOT/kubilitics-backend" 2>&1 | tail -3
    log "  Building frontend..."
    docker build -t "kubilitics-frontend:${TAG}" "$REPO_ROOT/kubilitics-frontend" 2>&1 | tail -3
  fi
  ok "Images built"

  # Load into Kind if applicable
  if $USE_KIND; then
    log "Loading images into Kind cluster..."
    kind load docker-image "kubilitics-backend:${TAG}"  --name "$KIND_CLUSTER"
    kind load docker-image "kubilitics-frontend:${TAG}" --name "$KIND_CLUSTER"
    ok "Images loaded into Kind"
  fi
fi

# ── Deploy with Helm ─────────────────────────────────────────────────────────
log "Deploying Kubilitics to ${NAMESPACE}..."

kubectl create namespace "$NAMESPACE" 2>/dev/null || true

# Build Helm args (without --wait; we validate pods separately for better diagnostics)
HELM_SET_ARGS=(
  --set "image.repository=${BACKEND_IMAGE}"
  --set "image.tag=${TAG}"
  --set "frontend.enabled=true"
  --set "frontend.image.repository=${FRONTEND_IMAGE}"
  --set "frontend.image.tag=${TAG}"
)

# Kind/local builds need pullPolicy=Never
if $BUILD_LOCAL; then
  HELM_SET_ARGS+=(
    --set "image.pullPolicy=Never"
    --set "frontend.image.pullPolicy=Never"
  )
fi

HELM_VALUES_ARGS=()
# Use CI values for Kind, or custom values file
if $USE_KIND && [[ -z "$VALUES_FILE" ]]; then
  HELM_VALUES_ARGS+=(-f "$HELM_CHART/values-ci.yaml")
elif [[ -n "$VALUES_FILE" ]]; then
  HELM_VALUES_ARGS+=(-f "$VALUES_FILE")
fi

# Step 1: Validate templates before deploying
log "  Validating Helm templates..."
if ! helm template "$RELEASE" "$HELM_CHART" --namespace "$NAMESPACE" \
    "${HELM_VALUES_ARGS[@]}" "${HELM_SET_ARGS[@]}" >/dev/null 2>&1; then
  warn "Template validation failed. Full error:"
  helm template "$RELEASE" "$HELM_CHART" --namespace "$NAMESPACE" \
    "${HELM_VALUES_ARGS[@]}" "${HELM_SET_ARGS[@]}" 2>&1 || true
  fail "Helm template rendering failed — fix the chart before deploying"
fi
ok "Templates valid"

# Step 2: Clean up failed Helm releases (pending-install/failed block upgrade --install)
RELEASE_STATUS=""
RELEASE_STATUS=$(helm status "$RELEASE" -n "$NAMESPACE" -o json 2>/dev/null \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('info',{}).get('status',''))" 2>/dev/null) || true
if [[ "$RELEASE_STATUS" == "failed" || "$RELEASE_STATUS" == "pending-install" || "$RELEASE_STATUS" == "pending-upgrade" ]]; then
  warn "Previous release in '$RELEASE_STATUS' state — uninstalling before re-install"
  helm uninstall "$RELEASE" -n "$NAMESPACE" --wait 2>/dev/null || true
  sleep 3
fi

# Step 3: Install (without --wait so we get immediate feedback)
if $DRY_RUN; then
  log "DRY RUN — no changes will be made"
  helm upgrade --install "$RELEASE" "$HELM_CHART" --namespace "$NAMESPACE" \
    "${HELM_VALUES_ARGS[@]}" "${HELM_SET_ARGS[@]}" --dry-run
  ok "Dry run complete"
  exit 0
fi

log "  Running helm upgrade --install..."
if ! helm upgrade --install "$RELEASE" "$HELM_CHART" --namespace "$NAMESPACE" \
    "${HELM_VALUES_ARGS[@]}" "${HELM_SET_ARGS[@]}" --timeout 300s --atomic 2>&1; then
  echo ""
  warn "Helm install failed. Diagnosing..."
  echo ""
  echo "=== Pod Status ==="
  kubectl get pods -n "$NAMESPACE" -o wide 2>/dev/null || true
  echo ""
  echo "=== Pod Events (last 20) ==="
  kubectl get events -n "$NAMESPACE" --sort-by='.lastTimestamp' 2>/dev/null | tail -20 || true
  echo ""
  echo "=== Failing Pod Logs ==="
  for pod in $(kubectl get pods -n "$NAMESPACE" --no-headers 2>/dev/null | grep -v Running | awk '{print $1}'); do
    echo "--- $pod ---"
    kubectl logs "$pod" -n "$NAMESPACE" --tail=20 2>/dev/null || true
  done
  fail "Deployment failed — see diagnostics above"
fi
ok "Helm release '${RELEASE}' deployed"

# ── Post-deploy verification ─────────────────────────────────────────────────
if ! $DRY_RUN; then
  log "Verifying deployment..."

  echo ""
  kubectl get pods -n "$NAMESPACE" -o wide
  echo ""

  # Wait for pods
  kubectl wait --for=condition=ready pod -l "app.kubernetes.io/instance=${RELEASE}" \
    -n "$NAMESPACE" --timeout=120s 2>/dev/null || \
  kubectl wait --for=condition=ready pod -l "app=kubilitics" \
    -n "$NAMESPACE" --timeout=120s 2>/dev/null || \
    warn "Some pods not ready yet — check with: kubectl get pods -n ${NAMESPACE}"

  # Quick health check via port-forward
  log "Running health check..."
  kubectl port-forward "svc/${RELEASE}" 18190:819 -n "$NAMESPACE" >/dev/null 2>&1 &
  PF_PID=$!
  sleep 3

  if curl -sf http://localhost:18190/health >/dev/null 2>&1; then
    ok "Backend health check passed"
  else
    warn "Health check failed — backend may still be starting"
  fi

  kill $PF_PID 2>/dev/null || true

  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  Kubilitics deployed successfully!${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo "  Namespace:  ${NAMESPACE}"
  echo "  Release:    ${RELEASE}"
  echo ""
  echo "  Access the UI:"
  echo "    kubectl port-forward svc/${RELEASE}-frontend 8080:8080 -n ${NAMESPACE}"
  echo "    → http://localhost:8080"
  echo ""
  echo "  Access the API:"
  echo "    kubectl port-forward svc/${RELEASE} 819:819 -n ${NAMESPACE}"
  echo "    → http://localhost:819/health"
  echo ""
  echo "  Run E2E tests:"
  echo "    make incluster-e2e"
  echo ""
  echo "  Uninstall:"
  echo "    ./scripts/deploy.sh --uninstall$(${USE_KIND} && echo ' --kind')"
  echo ""
fi
