# Multi-stage build for kubilitics-backend + kcli sidecar
# Must be built from the repo root so both kubilitics-backend/ and kcli/ are in context:
#   docker build -f kubilitics-backend/Dockerfile -t kubilitics-backend .
# syntax=docker/dockerfile:1

# ── Stage 1: Build backend + kcli in one stage (one base image, faster) ───────
FROM golang:1.24-alpine AS builder

# Build arguments for multi-platform support
ARG TARGETOS=linux
ARG TARGETARCH
ARG BUILDPLATFORM

# Create output directory
RUN mkdir -p /out

# Backend: copy go.mod/sum and download deps (BuildKit cache mount speeds up rebuilds)
WORKDIR /build
COPY kubilitics-backend/go.mod kubilitics-backend/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY kubilitics-backend/ .
# Build with explicit target architecture for cross-compilation
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -ldflags="-s -w" -o /out/kubilitics-backend ./cmd/server

# Verify backend binary was created
RUN test -f /out/kubilitics-backend || (echo "ERROR: Backend binary not found for ${TARGETOS}/${TARGETARCH}" && exit 1)

# kcli: same stage, different dir (avoids second golang image pull)
WORKDIR /build-kcli
COPY kcli/go.mod kcli/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY kcli/ .
# Build kcli with explicit target architecture for cross-compilation
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -ldflags="-s -w" -o /out/kcli ./cmd/kcli

# Verify kcli binary was created
RUN test -f /out/kcli || (echo "ERROR: kcli binary not found for ${TARGETOS}/${TARGETARCH}" && exit 1)
# ── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM alpine:3.19
WORKDIR /app

# Copy binaries from builder
COPY --from=builder /out/kubilitics-backend .
COPY --from=builder /out/kcli /usr/local/bin/kcli

# Install runtime dependencies (check depends on kubectl)
RUN apk --no-cache add ca-certificates kubectl

# Verify kcli exists and is executable
RUN test -f /usr/local/bin/kcli || (echo "ERROR: kcli not found in final image" && exit 1)
RUN chmod +x /usr/local/bin/kcli
RUN test -x /usr/local/bin/kcli || (echo "ERROR: kcli not executable" && exit 1)

# Verify kcli runs (requires kubectl in PATH)
RUN /usr/local/bin/kcli version || (echo "ERROR: kcli failed to run" && exit 1)

RUN mkdir -p /data
EXPOSE 819
EXPOSE 50051
ENV KCLI_BIN=/usr/local/bin/kcli
ENTRYPOINT ["./kubilitics-backend"]
