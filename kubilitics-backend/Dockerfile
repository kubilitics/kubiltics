# Multi-stage build for kubilitics-backend + kcli sidecar
# Must be built from the repo root so both kubilitics-backend/ and kcli/ are in context:
#   docker build -f kubilitics-backend/Dockerfile -t kubilitics-backend .
# syntax=docker/dockerfile:1

# ── Build arguments (declared before any FROM so they scope to all stages) ───
# BuildKit automatically sets TARGETOS/TARGETARCH for multi-platform builds.
# Provide defaults so local single-platform builds work without --platform.
ARG GO_VERSION=1.24.2
ARG ALPINE_VERSION=3.19
# Pinned kubectl release — update this when bumping the k8s client-go version
ARG KUBECTL_VERSION=v1.30.3

# ── Stage 1: Builder ──────────────────────────────────────────────────────────
# Use the exact Go patch version that satisfies both go.mod toolchain directives:
#   kubilitics-backend: go 1.24.0  (toolchain go1.24.5 — download-only fallback)
#   kcli:               go 1.24.2
# 1.24.2 satisfies kcli; backend's "toolchain go1.24.5" is advisory — Go will
# use the installed 1.24.2 and not attempt a network download when GOTOOLCHAIN=local.
FROM golang:${GO_VERSION}-alpine AS builder

ARG TARGETOS=linux
ARG TARGETARCH

# Prevent Go from trying to download a newer toolchain at build time.
# "local" means "use exactly the Go version in this image, no downloads".
ENV GOTOOLCHAIN=local

# Create output directory
RUN mkdir -p /out

# ── Backend ───────────────────────────────────────────────────────────────────
WORKDIR /build
COPY kubilitics-backend/go.mod kubilitics-backend/go.sum ./
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY kubilitics-backend/ .
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -ldflags="-s -w" -o /out/kubilitics-backend ./cmd/server

RUN test -f /out/kubilitics-backend || \
    (echo "ERROR: backend binary not found (TARGETOS=${TARGETOS} TARGETARCH=${TARGETARCH})" && exit 1)

# ── kcli ──────────────────────────────────────────────────────────────────────
WORKDIR /build-kcli
COPY kcli/go.mod kcli/go.sum ./
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY kcli/ .
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -ldflags="-s -w" -o /out/kcli ./cmd/kcli

RUN test -f /out/kcli || \
    (echo "ERROR: kcli binary not found (TARGETOS=${TARGETOS} TARGETARCH=${TARGETARCH})" && exit 1)

# ── Stage 2: kubectl downloader (native arch, runs on builder host) ───────────
# Download the pinned kubectl binary for the TARGET architecture so we can copy
# it into the final runtime image without needing curl/wget there.
# We use a separate stage so this download is cached independently.
FROM alpine:${ALPINE_VERSION} AS kubectl-fetcher

ARG TARGETARCH
ARG KUBECTL_VERSION

RUN apk --no-cache add curl ca-certificates && \
    # Map Docker arch names to kubectl release arch names
    KARCH=$(case "${TARGETARCH}" in \
        amd64)  echo "amd64" ;; \
        arm64)  echo "arm64" ;; \
        *)      echo "${TARGETARCH}" ;; \
    esac) && \
    curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${KARCH}/kubectl" \
        -o /usr/local/bin/kubectl && \
    chmod +x /usr/local/bin/kubectl && \
    /usr/local/bin/kubectl version --client --output=json

# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
FROM alpine:${ALPINE_VERSION} AS runtime

WORKDIR /app

# ca-certificates: TLS; wget: HEALTHCHECK probe
RUN apk --no-cache add ca-certificates wget

# Create non-root service user — running as root in containers is a security risk
RUN addgroup -g 1000 kubilitics && \
    adduser -D -u 1000 -G kubilitics kubilitics

# kubectl (pinned version, pre-verified in kubectl-fetcher stage)
COPY --from=kubectl-fetcher /usr/local/bin/kubectl /usr/local/bin/kubectl

# Application binaries
COPY --from=builder /out/kubilitics-backend .
COPY --from=builder /out/kcli /usr/local/bin/kcli

# Create writable data directory and fix ownership before dropping to non-root
RUN mkdir -p /data && \
    chown -R kubilitics:kubilitics /app /data

# Smoke test: kcli version bypasses kubectl dependency check
# (PersistentPreRunE early-returns for 'version' and 'completion').
# KCLI_CI=true disables animations so this RUN step never blocks on TTY.
RUN KCLI_CI=true /usr/local/bin/kcli version

USER kubilitics

EXPOSE 8190
EXPOSE 50051

ENV KCLI_BIN=/usr/local/bin/kcli

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:8190/health || exit 1

ENTRYPOINT ["./kubilitics-backend"]
