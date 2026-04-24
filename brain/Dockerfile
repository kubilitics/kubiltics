# syntax=docker/dockerfile:1

# ── Build arguments — declared before any FROM so they scope globally ─────────
ARG GO_VERSION=1.24.2
ARG ALPINE_VERSION=3.19

# ── Stage 1: Builder ──────────────────────────────────────────────────────────
# Pin builder to linux/amd64 so the Go compiler + gcc run natively.
# CGO_ENABLED=1 is required for sqlite and creack/pty — cross-compilation with
# CGO requires a cross-compiler toolchain which is complex to set up in Alpine.
# The AI service is built as a single-arch (amd64) image; arm64 support can be
# added later via a proper cross-compiler setup or native arm64 runners.
FROM --platform=linux/amd64 golang:${GO_VERSION}-alpine AS builder

# Prevent Go from downloading a newer toolchain.
# go.mod requires go 1.24.0; the builder image provides 1.24.2 which satisfies that.
ENV GOTOOLCHAIN=local

# gcc + musl-dev required for CGO_ENABLED=1 (sqlite, creack/pty)
RUN apk add --no-cache gcc musl-dev

WORKDIR /build

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .

RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=1 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-s -w" -o bin/kubilitics-ai ./cmd/server/main.go

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM alpine:${ALPINE_VERSION} AS runtime

# libc6-compat needed by CGO-linked binary on alpine (musl vs glibc shim)
# wget needed for HEALTHCHECK probe
RUN apk add --no-cache ca-certificates libc6-compat wget

RUN addgroup -g 1000 kubilitics && \
    adduser -D -u 1000 -G kubilitics kubilitics

WORKDIR /app

COPY --from=builder /build/bin/kubilitics-ai /app/
COPY config.example.yaml /app/config.yaml.example

# Create config dir and set ownership before switching to non-root user
RUN mkdir -p /etc/kubilitics && \
    chown -R kubilitics:kubilitics /app /etc/kubilitics

USER kubilitics

EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:8081/health || exit 1

ENTRYPOINT ["/app/kubilitics-ai"]
CMD ["--config", "/etc/kubilitics/config.yaml"]
