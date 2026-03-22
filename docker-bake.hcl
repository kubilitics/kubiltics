// Kubilitics — BuildKit Bake file
// Usage:
//   docker buildx bake                  # build all services (parallel)
//   docker buildx bake backend          # build backend only
//   docker buildx bake frontend         # build frontend only
//   docker buildx bake --set *.platform=linux/arm64  # cross-compile
//
// For Kind cluster loading:
//   docker buildx bake --set *.output=type=docker    # load into local docker
//   kind load docker-image kubilitics-backend:local kubilitics-frontend:local
//
// For registry push:
//   REGISTRY=ghcr.io/kubilitics TAG=1.0.0 docker buildx bake --push

// ── Variables (overridable via env or --set) ────────────────────────────────

variable "REGISTRY" {
  default = ""
}

variable "TAG" {
  default = "local"
}

variable "GO_VERSION" {
  default = "1.25.8"
}

variable "NODE_VERSION" {
  default = "20"
}

variable "ALPINE_VERSION" {
  default = "3.21"
}

variable "KUBECTL_VERSION" {
  default = "v1.33.3"
}

// Helper: prefix registry if set
function "image" {
  params = [name]
  result = REGISTRY != "" ? "${REGISTRY}/${name}:${TAG}" : "${name}:${TAG}"
}

// ── Groups ──────────────────────────────────────────────────────────────────

group "default" {
  targets = ["backend", "frontend"]
}

group "all" {
  targets = ["backend", "frontend"]
}

// ── Shared cache config ─────────────────────────────────────────────────────

target "_common" {
  output = ["type=docker"]
}

// ── Backend ─────────────────────────────────────────────────────────────────

target "backend" {
  inherits   = ["_common"]
  context    = "./kubilitics-backend"
  dockerfile = "Dockerfile"
  tags       = [image("kubilitics-backend")]
  args = {
    GO_VERSION      = GO_VERSION
    ALPINE_VERSION  = ALPINE_VERSION
    KUBECTL_VERSION = KUBECTL_VERSION
  }
  cache-from = ["type=local,src=.buildcache/backend"]
  cache-to   = ["type=local,dest=.buildcache/backend,mode=max"]
}

// ── Frontend ────────────────────────────────────────────────────────────────

target "frontend" {
  inherits   = ["_common"]
  context    = "./kubilitics-frontend"
  dockerfile = "Dockerfile"
  tags       = [image("kubilitics-frontend")]
  args = {
    NODE_VERSION  = NODE_VERSION
    NGINX_VERSION = "1.27"
  }
  cache-from = ["type=local,src=.buildcache/frontend"]
  cache-to   = ["type=local,dest=.buildcache/frontend,mode=max"]
}

// ── Multi-platform (CI/release only — slower due to QEMU/cross-compile) ────

target "backend-multiarch" {
  inherits  = ["backend"]
  platforms = ["linux/amd64", "linux/arm64"]
  output    = ["type=registry"]
}

target "frontend-multiarch" {
  inherits  = ["frontend"]
  platforms = ["linux/amd64", "linux/arm64"]
  output    = ["type=registry"]
}
