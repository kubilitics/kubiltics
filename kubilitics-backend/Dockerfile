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
# CRITICAL: Pin builder to linux/amd64 (the CI runner's native arch).
# This means the Go compiler runs natively — no QEMU emulation — regardless
# of the TARGET platform. Go's built-in cross-compilation handles arm64/etc
# via GOARCH in nanoseconds; QEMU-emulated arm64 compilation takes 20+ minutes.
FROM --platform=linux/amd64 golang:${GO_VERSION}-alpine AS builder

# Re-declare ARGs after FROM (ARG scope resets at each FROM).
# TARGETOS/TARGETARCH are set by BuildKit for the target platform.
ARG TARGETOS=linux
ARG TARGETARCH=amd64

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
# Cross-compile: Go runs natively on amd64, produces binary for TARGETARCH.
# CGO_ENABLED=0 is mandatory for cross-compilation (no C toolchain for target).
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

# ── Stage 2: kubectl downloader ───────────────────────────────────────────────
# Download the pinned kubectl binary for the TARGET architecture.
# Runs on amd64 (native), downloads the correct arch binary for the target image.
FROM --platform=linux/amd64 alpine:${ALPINE_VERSION} AS kubectl-fetcher

ARG TARGETARCH
ARG KUBECTL_VERSION

RUN apk --no-cache add curl ca-certificates && \
    KARCH=$(case "${TARGETARCH}" in \
        amd64)  echo "amd64" ;; \
        arm64)  echo "arm64" ;; \
        *)      echo "${TARGETARCH}" ;; \
    esac) && \
    curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${KARCH}/kubectl" \
        -o /usr/local/bin/kubectl && \
    chmod +x /usr/local/bin/kubectl && \
    # Verify download succeeded (size check — can't exec cross-arch binary here)
    test -s /usr/local/bin/kubectl && \
    echo "kubectl ${KUBECTL_VERSION} for ${KARCH} downloaded: $(ls -lh /usr/local/bin/kubectl | awk '{print $5}')"

# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
# Runtime stage uses the TARGET platform — this is the actual container image.
FROM alpine:${ALPINE_VERSION} AS runtime

WORKDIR /app

# ca-certificates: TLS; wget: HEALTHCHECK probe
RUN apk --no-cache add ca-certificates wget

# Create non-root service user — running as root in containers is a security risk
RUN addgroup -g 1000 kubilitics && \
    adduser -D -u 1000 -G kubilitics kubilitics

# kubectl (pinned version, correct arch downloaded in kubectl-fetcher stage)
COPY --from=kubectl-fetcher /usr/local/bin/kubectl /usr/local/bin/kubectl

# Application binaries (cross-compiled natively, correct arch)
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
