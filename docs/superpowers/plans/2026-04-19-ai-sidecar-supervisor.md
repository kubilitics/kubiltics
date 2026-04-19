# AI Sidecar Supervisor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inside `kubilitics-backend`, manage the lifecycle of the `kotg-ai-server` sidecar process, perform an mTLS handshake using the `github.com/vellankikoti/kotg-schema` v1.0.1 contract, expose capability state to the desktop, and route chat/action traffic through a single backend chokepoint.

**Architecture:** Three internal packages — `supervisor` (lifecycle + ephemeral mTLS + crash backoff), `proxy` (cluster_id enforcement, observability, rate limiting, ActionGate stub), `handlers` (HTTP/WS endpoints). Backend exec's the bundled `kotg-ai-server` binary on demand, talks to it over localhost gRPC with per-spawn ephemeral mTLS, and proxies streaming chat events to the desktop over the existing WebSocket transport. Sidecar is one global process; cluster identity goes in every gRPC metadata header. All AI surface area gated behind `ai.enabled` feature flag (default `false`).

**Tech Stack:** Go 1.24+, `github.com/vellankikoti/kotg-schema@v1.0.1`, `google.golang.org/grpc`, `google.golang.org/grpc/health/grpc_health_v1`, `crypto/tls` + `crypto/x509`, `gorilla/mux`, `gorilla/websocket`, `prometheus/client_golang`, `golang.org/x/time/rate`. Test deps: existing `testify`, plus `examples/stub_chat_server` from kotg-schema as the sidecar stand-in.

**Spec:** `docs/superpowers/specs/2026-04-19-ai-sidecar-supervisor-design.md`. Read it first.

**Working dir:** `/Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-backend` unless noted. Branch should be created before T1.

**Push policy:** push only to `vellankikoti/kubilitics` (origin). Never push to the kubilitics/* org repo. Per memory: `feedback_no_org_push.md`.

---

## File Structure (created/modified)

**New packages, each file ≤300 LOC:**

| Path | Responsibility |
|---|---|
| `internal/ai/types/snapshot.go` | `CapabilitiesSnapshot`, `SidecarStatus`, `SidecarState` enum, `DisabledReason` constants |
| `internal/ai/types/errors.go` | `ErrAIDisabled`, `ErrMissingCluster`, `ErrSidecarUnavailable`, `ErrRateLimited` |
| `internal/ai/certs/mint.go` | In-memory CA + server cert + client cert generation. PEM blob writer. |
| `internal/ai/certs/mint_test.go` | Cert chain validates; client cert verifies against CA. |
| `internal/ai/gate/gate.go` | `ActionGate` interface + `NoOpGate` impl. |
| `internal/ai/gate/gate_test.go` | NoOpGate is pass-through. |
| `internal/ai/supervisor/state.go` | State machine enum + transitions + thread-safe Status snapshot. |
| `internal/ai/supervisor/state_test.go` | Transition table tests. |
| `internal/ai/supervisor/spawn.go` | `exec.CommandContext`, stdin cert write, READY parse. |
| `internal/ai/supervisor/spawn_test.go` | Stub binary tests. |
| `internal/ai/supervisor/dial.go` | mTLS dial + health check + capabilities fetch. |
| `internal/ai/supervisor/dial_test.go` | Dial against stub. |
| `internal/ai/supervisor/idle.go` | Idle timer + ActiveStreams counter. |
| `internal/ai/supervisor/idle_test.go` | Timer reset semantics. |
| `internal/ai/supervisor/backoff.go` | Crash backoff + restart cap. |
| `internal/ai/supervisor/backoff_test.go` | Cap exhaustion + window reset. |
| `internal/ai/supervisor/supervisor.go` | Public `Supervisor` interface + `New(cfg)` constructor; orchestrates the above. |
| `internal/ai/supervisor/supervisor_test.go` | Full lifecycle integration test using stub. |
| `internal/ai/proxy/proxy.go` | `Chat`, `GetCapabilities`, `Refresh` methods; cluster_id enforce; metadata inject; SpawnID guard. |
| `internal/ai/proxy/proxy_test.go` | Metadata propagation, SpawnID guard, ErrMissingCluster. |
| `internal/ai/proxy/observability.go` | Prometheus collectors + structured log helpers. |
| `internal/ai/proxy/ratelimit.go` | Per-user token bucket. |
| `internal/ai/proxy/ratelimit_test.go` | Bucket behavior. |
| `internal/ai/handlers/handlers.go` | `New(supervisor, proxy, cfg)` constructor; route registration helper. |
| `internal/ai/handlers/capabilities.go` | `GET /api/v1/ai/capabilities`. |
| `internal/ai/handlers/capabilities_test.go` | ai_disabled, never_started, ready, ?warm. |
| `internal/ai/handlers/chat.go` | `GET /api/v1/ai/chat` (WS upgrade). |
| `internal/ai/handlers/chat_test.go` | Happy path + missing cluster_id 400. |
| `internal/ai/handlers/status.go` | `GET /api/v1/ai/status`. |
| `internal/ai/handlers/refresh.go` | `POST /api/v1/ai/refresh`. |

**Modified:**

| Path | Change |
|---|---|
| `internal/config/config.go` | Add `AIConfig` struct, `AI AIConfig` field to `Config`, defaults in viper init. |
| `internal/config/config_test.go` | Cover defaults + override. |
| `cmd/server/main.go` | Wire supervisor + proxy + handlers if `cfg.AI.Enabled`. Register routes. Call `Supervisor.Shutdown` on graceful shutdown. |
| `go.mod` / `go.sum` | `go get github.com/vellankikoti/kotg-schema@v1.0.1`, `golang.org/x/time` (likely already present, verify). |
| `deploy/helm/kubilitics/values.yaml` | Mirror `ai.*` block (default `enabled: false`). |
| `deploy/helm/kubilitics/templates/configmap.yaml` | Surface `ai.*` to backend config. |

---

## Pre-Flight: Worktree + Branch

- [ ] **Create worktree on branch `feat/ai-supervisor`**

```bash
cd /Users/koti/myFuture/Kubernetes/kubilitics
ls .worktrees 2>/dev/null && echo "exists" || mkdir -p .worktrees
git worktree add .worktrees/ai-supervisor -b feat/ai-supervisor
cd .worktrees/ai-supervisor/kubilitics-backend
go test ./... -count=1 -timeout=120s | tail -20
```

Expected: tests pass on baseline. From here on, all paths are relative to `.worktrees/ai-supervisor/kubilitics-backend/` unless noted.

- [ ] **Add the kotg-schema dependency**

```bash
cd .worktrees/ai-supervisor/kubilitics-backend
go get github.com/vellankikoti/kotg-schema@v1.0.1
go mod tidy
go build ./...
```

Expected: build succeeds, go.mod gains `github.com/vellankikoti/kotg-schema v1.0.1`.

- [ ] **Verify rate-limit dep present**

```bash
grep "golang.org/x/time" go.mod
```

If missing: `go get golang.org/x/time/rate && go mod tidy`.

- [ ] **Commit baseline**

```bash
git add go.mod go.sum
git commit -m "deps: add github.com/vellankikoti/kotg-schema@v1.0.1"
```

---

## Task 1: Config — `ai.*` block

**Files:**
- Modify: `internal/config/config.go`
- Modify: `internal/config/config_test.go`

- [ ] **Step 1: Write failing test for AI config defaults**

Append to `internal/config/config_test.go`:

```go
func TestAIConfigDefaults(t *testing.T) {
    cfg, err := Load("")
    if err != nil {
        t.Fatalf("Load: %v", err)
    }
    if cfg.AI.Enabled != false {
        t.Errorf("AI.Enabled default = %v, want false", cfg.AI.Enabled)
    }
    if cfg.AI.IdleShutdownSeconds != 900 {
        t.Errorf("AI.IdleShutdownSeconds default = %d, want 900", cfg.AI.IdleShutdownSeconds)
    }
    if cfg.AI.ChatMaxDurationSeconds != 600 {
        t.Errorf("AI.ChatMaxDurationSeconds default = %d, want 600", cfg.AI.ChatMaxDurationSeconds)
    }
    if cfg.AI.PerMessageIdleSeconds != 60 {
        t.Errorf("AI.PerMessageIdleSeconds default = %d, want 60", cfg.AI.PerMessageIdleSeconds)
    }
    if cfg.AI.MaxRestartAttempts != 5 {
        t.Errorf("AI.MaxRestartAttempts default = %d, want 5", cfg.AI.MaxRestartAttempts)
    }
    if cfg.AI.RestartWindowSeconds != 300 {
        t.Errorf("AI.RestartWindowSeconds default = %d, want 300", cfg.AI.RestartWindowSeconds)
    }
    if cfg.AI.RateLimitPerUserPerMin != 30 {
        t.Errorf("AI.RateLimitPerUserPerMin default = %d, want 30", cfg.AI.RateLimitPerUserPerMin)
    }
    if cfg.AI.BinaryPath != "" {
        t.Errorf("AI.BinaryPath default = %q, want empty", cfg.AI.BinaryPath)
    }
}
```

- [ ] **Step 2: Run test, expect compile failure**

```bash
go test ./internal/config/ -run TestAIConfigDefaults -count=1
```

Expected: compile error (`cfg.AI undefined`).

- [ ] **Step 3: Add AIConfig type + field**

In `internal/config/config.go`, add this type definition near the other types (above `type Config struct`):

```go
// AIConfig controls the AI sidecar (kotg-ai-server) lifecycle and proxy.
type AIConfig struct {
    Enabled                bool   `mapstructure:"enabled"`
    BinaryPath             string `mapstructure:"binary_path"`
    IdleShutdownSeconds    int    `mapstructure:"idle_shutdown_seconds"`
    ChatMaxDurationSeconds int    `mapstructure:"chat_max_duration_seconds"`
    PerMessageIdleSeconds  int    `mapstructure:"per_message_idle_seconds"`
    MaxRestartAttempts     int    `mapstructure:"max_restart_attempts"`
    RestartWindowSeconds   int    `mapstructure:"restart_window_seconds"`
    RateLimitPerUserPerMin int    `mapstructure:"rate_limit_per_user_per_min"`
}
```

Add to `Config` struct (place near other feature blocks):

```go
    AI AIConfig `mapstructure:"ai"`
```

In the viper defaults section of `Load`, add:

```go
    v.SetDefault("ai.enabled", false)
    v.SetDefault("ai.binary_path", "")
    v.SetDefault("ai.idle_shutdown_seconds", 900)
    v.SetDefault("ai.chat_max_duration_seconds", 600)
    v.SetDefault("ai.per_message_idle_seconds", 60)
    v.SetDefault("ai.max_restart_attempts", 5)
    v.SetDefault("ai.restart_window_seconds", 300)
    v.SetDefault("ai.rate_limit_per_user_per_min", 30)
```

- [ ] **Step 4: Run test, expect PASS**

```bash
go test ./internal/config/ -run TestAIConfigDefaults -count=1 -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/config/config.go internal/config/config_test.go
git commit -m "feat(ai): add AIConfig with defaults (feature-flagged off)"
```

---

## Task 2: Types — Snapshot + Errors

**Files:**
- Create: `internal/ai/types/snapshot.go`
- Create: `internal/ai/types/errors.go`
- Create: `internal/ai/types/snapshot_test.go`

- [ ] **Step 1: Write failing test**

Create `internal/ai/types/snapshot_test.go`:

```go
package types

import (
    "testing"
    "time"
)

func TestSidecarStateString(t *testing.T) {
    cases := map[SidecarState]string{
        StateStopped:  "stopped",
        StateStarting: "starting",
        StateReady:    "ready",
        StateStopping: "stopping",
        StateCrashed:  "crashed",
    }
    for s, want := range cases {
        if got := s.String(); got != want {
            t.Errorf("SidecarState(%d).String() = %q, want %q", s, got, want)
        }
    }
}

func TestSidecarStatusZero(t *testing.T) {
    var st SidecarStatus
    if st.State.String() != "stopped" {
        t.Errorf("zero status state = %q, want stopped", st.State.String())
    }
    if !st.NextRetryAt.IsZero() {
        t.Errorf("zero NextRetryAt should be zero time, got %v", st.NextRetryAt)
    }
    _ = time.Now() // keep import used
}
```

- [ ] **Step 2: Run test, expect compile failure**

```bash
go test ./internal/ai/types/ -count=1
```

Expected: compile error (package missing).

- [ ] **Step 3: Implement types**

Create `internal/ai/types/snapshot.go`:

```go
// Package types defines internal data structures shared between the AI
// supervisor, proxy, and handlers. No external imports beyond stdlib.
package types

import "time"

// SidecarState is the supervisor's process state.
type SidecarState int

const (
    StateStopped SidecarState = iota
    StateStarting
    StateReady
    StateStopping
    StateCrashed
)

func (s SidecarState) String() string {
    switch s {
    case StateStopped:
        return "stopped"
    case StateStarting:
        return "starting"
    case StateReady:
        return "ready"
    case StateStopping:
        return "stopping"
    case StateCrashed:
        return "crashed"
    default:
        return "unknown"
    }
}

// DisabledReason values surfaced to the desktop UI when AI is not usable.
const (
    DisabledReasonAIDisabled       = "ai_disabled"
    DisabledReasonNeverStarted     = "never_started"
    DisabledReasonRestartExhausted = "restart_cap_exhausted"
    DisabledReasonSpawnChanged     = "spawn_changed"
)

// SidecarStatus is the snapshot returned by Supervisor.Status() and
// surfaced via /api/v1/ai/status.
type SidecarStatus struct {
    State           SidecarState `json:"state"`
    LastError       string       `json:"last_error,omitempty"`
    RestartAttempts int          `json:"restart_attempts"`
    NextRetryAt     time.Time    `json:"next_retry_at,omitempty"`
    ActiveStreams   int          `json:"active_streams"`
    CurrentSpawnID  string       `json:"current_spawn_id,omitempty"`
    DisabledReason  string       `json:"disabled_reason,omitempty"`
}

// CapabilitiesSnapshot is the cached AICapabilities response from the
// sidecar plus a freshness timestamp.
type CapabilitiesSnapshot struct {
    Capabilities any       `json:"capabilities"` // raw kotgv1.AICapabilities (any to keep this pkg dep-free)
    FetchedAt    time.Time `json:"fetched_at"`
    SpawnID      string    `json:"spawn_id"`
}
```

- [ ] **Step 4: Implement errors**

Create `internal/ai/types/errors.go`:

```go
package types

import "errors"

var (
    ErrAIDisabled         = errors.New("ai: feature disabled (ai.enabled=false)")
    ErrMissingCluster     = errors.New("ai: cluster_id is required")
    ErrSidecarUnavailable = errors.New("ai: sidecar unavailable")
    ErrRateLimited        = errors.New("ai: rate limit exceeded")
    ErrSpawnChanged       = errors.New("ai: sidecar respawned during stream")
)
```

- [ ] **Step 5: Run test, expect PASS**

```bash
go test ./internal/ai/types/ -count=1 -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/ai/types/
git commit -m "feat(ai/types): SidecarStatus, CapabilitiesSnapshot, error sentinels"
```

---

## Task 3: ActionGate Interface + NoOpGate

**Files:**
- Create: `internal/ai/gate/gate.go`
- Create: `internal/ai/gate/gate_test.go`

- [ ] **Step 1: Write failing test**

Create `internal/ai/gate/gate_test.go`:

```go
package gate

import (
    "context"
    "testing"

    chatv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
)

func TestNoOpGateChatPassesThrough(t *testing.T) {
    g := NoOpGate{}
    called := false
    next := func(ctx context.Context, req *chatv1.ChatRequest) (chatv1.Chat_StreamClient, error) {
        called = true
        return nil, nil
    }
    _, err := g.WrapChat(context.Background(), &chatv1.ChatRequest{}, next)
    if err != nil {
        t.Fatalf("WrapChat: %v", err)
    }
    if !called {
        t.Fatalf("next not invoked by NoOpGate")
    }
}
```

- [ ] **Step 2: Run test, expect compile failure**

```bash
go test ./internal/ai/gate/ -count=1
```

Expected: compile error.

- [ ] **Step 3: Implement gate.go**

Create `internal/ai/gate/gate.go`:

```go
// Package gate defines the ActionGate interface that the proxy chain calls
// before forwarding to the sidecar. v1 ships only NoOpGate; subproject 3
// (Action Gateway) plugs in approval/audit/RBAC enforcement without
// touching the proxy.
package gate

import (
    "context"

    chatv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
    clusterv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
)

// ChatNext is the proxy-supplied function that, when invoked, performs the
// real gRPC call to the sidecar. The gate may inspect/modify the request,
// reject it, or wrap the returned stream.
type ChatNext func(ctx context.Context, req *chatv1.ChatRequest) (chatv1.Chat_StreamClient, error)

// ActionNext is the unary equivalent for ClusterAction RPCs.
type ActionNext func(ctx context.Context, req *clusterv1.ClusterActionRequest) (*clusterv1.ActionResult, error)

type ActionGate interface {
    WrapChat(ctx context.Context, req *chatv1.ChatRequest, next ChatNext) (chatv1.Chat_StreamClient, error)
    WrapAction(ctx context.Context, req *clusterv1.ClusterActionRequest, next ActionNext) (*clusterv1.ActionResult, error)
}

// NoOpGate forwards to next without modification. v1 default.
type NoOpGate struct{}

func (NoOpGate) WrapChat(ctx context.Context, req *chatv1.ChatRequest, next ChatNext) (chatv1.Chat_StreamClient, error) {
    return next(ctx, req)
}

func (NoOpGate) WrapAction(ctx context.Context, req *clusterv1.ClusterActionRequest, next ActionNext) (*clusterv1.ActionResult, error) {
    return next(ctx, req)
}
```

> **Type-name verification:** before running the test, confirm the actual exported names in `~/code/kotg-schema/gen/go/kotg/v1/`. If `ChatRequest` is named differently or `ClusterActionRequest` doesn't exist as written, adjust both the gate file and the test to use the real names. Run `grep -E "type (ChatRequest|ClusterActionRequest|ActionResult|Chat_StreamClient) " ~/code/kotg-schema/gen/go/kotg/v1/*.go` to discover them.

- [ ] **Step 4: Run test, expect PASS**

```bash
go test ./internal/ai/gate/ -count=1 -v
```

Expected: PASS. If type-name mismatch fails compilation, fix per the verification note above and re-run.

- [ ] **Step 5: Commit**

```bash
git add internal/ai/gate/
git commit -m "feat(ai/gate): ActionGate interface + NoOpGate (subproject 3 plugs the real gate)"
```

---

## Task 4: Cert Minting

**Files:**
- Create: `internal/ai/certs/mint.go`
- Create: `internal/ai/certs/mint_test.go`

- [ ] **Step 1: Write failing test**

Create `internal/ai/certs/mint_test.go`:

```go
package certs

import (
    "crypto/tls"
    "crypto/x509"
    "testing"
)

func TestMintProducesValidChain(t *testing.T) {
    bundle, err := Mint()
    if err != nil {
        t.Fatalf("Mint: %v", err)
    }
    if len(bundle.CAPEM) == 0 || len(bundle.ServerCertPEM) == 0 ||
        len(bundle.ServerKeyPEM) == 0 || len(bundle.ClientCertPEM) == 0 ||
        len(bundle.ClientKeyPEM) == 0 {
        t.Fatalf("bundle has empty fields: %+v", bundle)
    }

    // Parse CA, parse client cert, verify client cert against CA.
    caPool := x509.NewCertPool()
    if !caPool.AppendCertsFromPEM(bundle.CAPEM) {
        t.Fatalf("AppendCertsFromPEM(CA) failed")
    }
    clientPair, err := tls.X509KeyPair(bundle.ClientCertPEM, bundle.ClientKeyPEM)
    if err != nil {
        t.Fatalf("X509KeyPair(client): %v", err)
    }
    leaf, err := x509.ParseCertificate(clientPair.Certificate[0])
    if err != nil {
        t.Fatalf("ParseCertificate(client leaf): %v", err)
    }
    _, err = leaf.Verify(x509.VerifyOptions{Roots: caPool, KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}})
    if err != nil {
        t.Fatalf("client cert verify: %v", err)
    }
}

func TestMintEachCallIsFresh(t *testing.T) {
    a, _ := Mint()
    b, _ := Mint()
    if string(a.CAPEM) == string(b.CAPEM) {
        t.Fatalf("two Mint() calls produced identical CA — must be fresh per spawn")
    }
}

func TestStdinBlobRoundtrip(t *testing.T) {
    bundle, err := Mint()
    if err != nil {
        t.Fatalf("Mint: %v", err)
    }
    var buf testBuf
    if err := WriteStdinBlob(&buf, bundle); err != nil {
        t.Fatalf("WriteStdinBlob: %v", err)
    }
    got, err := ReadStdinBlob(&buf)
    if err != nil {
        t.Fatalf("ReadStdinBlob: %v", err)
    }
    if string(got.CAPEM) != string(bundle.CAPEM) ||
        string(got.ServerCertPEM) != string(bundle.ServerCertPEM) ||
        string(got.ServerKeyPEM) != string(bundle.ServerKeyPEM) {
        t.Fatalf("roundtrip mismatch")
    }
}

type testBuf struct{ b []byte; r int }

func (t *testBuf) Write(p []byte) (int, error) { t.b = append(t.b, p...); return len(p), nil }
func (t *testBuf) Read(p []byte) (int, error) {
    if t.r >= len(t.b) {
        return 0, errEOF
    }
    n := copy(p, t.b[t.r:])
    t.r += n
    return n, nil
}

var errEOF = ioEOF()
func ioEOF() error { return _eof }
type eofErr struct{}
func (eofErr) Error() string { return "EOF" }
var _eof = eofErr{}
```

> Note: this test uses a hand-rolled buffer so the `Read`/`Write` signatures are minimal. If the engineer prefers, replace with `bytes.Buffer` and `io.EOF` from the standard library — both are equivalent for the roundtrip assertion.

- [ ] **Step 2: Run test, expect compile failure**

```bash
go test ./internal/ai/certs/ -count=1
```

Expected: compile error.

- [ ] **Step 3: Implement mint.go**

Create `internal/ai/certs/mint.go`:

```go
// Package certs mints a per-spawn ephemeral CA + server cert + client cert
// for the localhost mTLS handshake between the backend supervisor and the
// kotg-ai-server sidecar. Nothing in this package writes to disk.
package certs

import (
    "crypto/ecdsa"
    "crypto/elliptic"
    "crypto/rand"
    "crypto/x509"
    "crypto/x509/pkix"
    "encoding/binary"
    "encoding/pem"
    "fmt"
    "io"
    "math/big"
    "net"
    "time"
)

// Bundle holds the in-memory PEM blobs needed for a single sidecar spawn.
type Bundle struct {
    CAPEM         []byte // CA cert (server uses to verify client; client uses to verify server)
    ServerCertPEM []byte
    ServerKeyPEM  []byte
    ClientCertPEM []byte
    ClientKeyPEM  []byte
}

// Mint generates a fresh CA + server cert + client cert. Certs are valid
// for 24h (we expect spawns to be ephemeral, but 24h leaves ample room).
func Mint() (*Bundle, error) {
    notBefore := time.Now().Add(-1 * time.Minute)
    notAfter := notBefore.Add(24 * time.Hour)

    caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
    if err != nil {
        return nil, fmt.Errorf("gen ca key: %w", err)
    }
    caTpl := &x509.Certificate{
        SerialNumber:          serial(),
        Subject:               pkix.Name{CommonName: "kotg-ai-supervisor-ca"},
        NotBefore:             notBefore, NotAfter: notAfter,
        KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
        BasicConstraintsValid: true, IsCA: true,
    }
    caDER, err := x509.CreateCertificate(rand.Reader, caTpl, caTpl, &caKey.PublicKey, caKey)
    if err != nil {
        return nil, fmt.Errorf("create ca cert: %w", err)
    }
    caPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})

    serverPEM, serverKeyPEM, err := signLeaf(caTpl, caKey, "kotg-ai-server",
        []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
        []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")},
        []string{"localhost"})
    if err != nil {
        return nil, err
    }
    clientPEM, clientKeyPEM, err := signLeaf(caTpl, caKey, "kotg-ai-client",
        []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}, nil, nil)
    if err != nil {
        return nil, err
    }

    return &Bundle{
        CAPEM: caPEM,
        ServerCertPEM: serverPEM, ServerKeyPEM: serverKeyPEM,
        ClientCertPEM: clientPEM, ClientKeyPEM: clientKeyPEM,
    }, nil
}

// signLeaf creates a leaf cert signed by (caTpl, caKey) and returns its
// PEM-encoded cert + key.
func signLeaf(caTpl *x509.Certificate, caKey *ecdsa.PrivateKey, cn string,
    eku []x509.ExtKeyUsage, ips []net.IP, dns []string) ([]byte, []byte, error) {
    key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
    if err != nil {
        return nil, nil, err
    }
    tpl := &x509.Certificate{
        SerialNumber: serial(),
        Subject:      pkix.Name{CommonName: cn},
        NotBefore:    caTpl.NotBefore, NotAfter: caTpl.NotAfter,
        KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
        ExtKeyUsage:  eku,
        IPAddresses:  ips, DNSNames: dns,
    }
    der, err := x509.CreateCertificate(rand.Reader, tpl, caTpl, &key.PublicKey, caKey)
    if err != nil {
        return nil, nil, err
    }
    keyDER, err := x509.MarshalECPrivateKey(key)
    if err != nil {
        return nil, nil, err
    }
    certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
    keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
    return certPEM, keyPEM, nil
}

func serial() *big.Int {
    b := make([]byte, 16)
    _, _ = rand.Read(b)
    return new(big.Int).SetBytes(b)
}

// WriteStdinBlob writes the bundle to w in length-prefixed framing:
//   [4-byte BE length][payload]  for each of CA, server cert, server key.
// (The client cert/key never leave the supervisor.)
func WriteStdinBlob(w io.Writer, b *Bundle) error {
    for _, part := range [][]byte{b.CAPEM, b.ServerCertPEM, b.ServerKeyPEM} {
        var hdr [4]byte
        binary.BigEndian.PutUint32(hdr[:], uint32(len(part)))
        if _, err := w.Write(hdr[:]); err != nil {
            return err
        }
        if _, err := w.Write(part); err != nil {
            return err
        }
    }
    return nil
}

// ReadStdinBlob is the inverse, used by both the test and (eventually) the
// kotg-ai-server binary when it reads its certs at startup.
func ReadStdinBlob(r io.Reader) (*Bundle, error) {
    parts := make([][]byte, 3)
    for i := range parts {
        var hdr [4]byte
        if _, err := io.ReadFull(r, hdr[:]); err != nil {
            return nil, fmt.Errorf("read length: %w", err)
        }
        n := binary.BigEndian.Uint32(hdr[:])
        if n > 1<<20 {
            return nil, fmt.Errorf("payload too large: %d bytes", n)
        }
        buf := make([]byte, n)
        if _, err := io.ReadFull(r, buf); err != nil {
            return nil, fmt.Errorf("read payload: %w", err)
        }
        parts[i] = buf
    }
    return &Bundle{CAPEM: parts[0], ServerCertPEM: parts[1], ServerKeyPEM: parts[2]}, nil
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
go test ./internal/ai/certs/ -count=1 -v
```

Expected: all three tests PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/ai/certs/
git commit -m "feat(ai/certs): per-spawn ephemeral CA + server + client cert mint"
```

---

## Task 5: Supervisor State Machine

**Files:**
- Create: `internal/ai/supervisor/state.go`
- Create: `internal/ai/supervisor/state_test.go`

- [ ] **Step 1: Write failing test**

Create `internal/ai/supervisor/state_test.go`:

```go
package supervisor

import (
    "testing"

    "github.com/kubilitics/kubilitics-backend/internal/ai/types"
)

func TestStateTransitions(t *testing.T) {
    s := newStateMachine()
    if got := s.Snapshot().State; got != types.StateStopped {
        t.Fatalf("initial state = %v, want stopped", got)
    }
    if err := s.transition(types.StateStarting); err != nil {
        t.Fatalf("Stopped→Starting: %v", err)
    }
    if err := s.transition(types.StateReady); err != nil {
        t.Fatalf("Starting→Ready: %v", err)
    }
    if err := s.transition(types.StateStopping); err != nil {
        t.Fatalf("Ready→Stopping: %v", err)
    }
    if err := s.transition(types.StateStopped); err != nil {
        t.Fatalf("Stopping→Stopped: %v", err)
    }
}

func TestStateInvalidTransition(t *testing.T) {
    s := newStateMachine()
    // Stopped → Ready is not allowed (must go through Starting).
    if err := s.transition(types.StateReady); err == nil {
        t.Fatalf("expected error on Stopped→Ready")
    }
}

func TestStateSetError(t *testing.T) {
    s := newStateMachine()
    s.setLastError("boom")
    if got := s.Snapshot().LastError; got != "boom" {
        t.Errorf("LastError = %q, want boom", got)
    }
}
```

- [ ] **Step 2: Run test, expect compile failure**

```bash
go test ./internal/ai/supervisor/ -count=1
```

Expected: compile error.

- [ ] **Step 3: Implement state.go**

Create `internal/ai/supervisor/state.go`:

```go
package supervisor

import (
    "fmt"
    "sync"
    "time"

    "github.com/kubilitics/kubilitics-backend/internal/ai/types"
)

// stateMachine is goroutine-safe wrapper around SidecarStatus + transition rules.
type stateMachine struct {
    mu     sync.Mutex
    status types.SidecarStatus
}

func newStateMachine() *stateMachine {
    return &stateMachine{status: types.SidecarStatus{State: types.StateStopped}}
}

// allowed returns true if from→to is a legal edge in the state machine.
//
//   stopped  → starting
//   starting → ready, crashed, stopped (immediate failure)
//   ready    → stopping, crashed
//   stopping → stopped
//   crashed  → starting (retry), stopped (cap exhausted)
func allowed(from, to types.SidecarState) bool {
    switch from {
    case types.StateStopped:
        return to == types.StateStarting
    case types.StateStarting:
        return to == types.StateReady || to == types.StateCrashed || to == types.StateStopped
    case types.StateReady:
        return to == types.StateStopping || to == types.StateCrashed
    case types.StateStopping:
        return to == types.StateStopped
    case types.StateCrashed:
        return to == types.StateStarting || to == types.StateStopped
    }
    return false
}

func (s *stateMachine) transition(to types.SidecarState) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    if !allowed(s.status.State, to) {
        return fmt.Errorf("invalid transition %s→%s", s.status.State, to)
    }
    s.status.State = to
    return nil
}

func (s *stateMachine) Snapshot() types.SidecarStatus {
    s.mu.Lock()
    defer s.mu.Unlock()
    out := s.status
    return out
}

func (s *stateMachine) setLastError(msg string) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.status.LastError = msg
}

func (s *stateMachine) setSpawnID(id string) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.status.CurrentSpawnID = id
}

func (s *stateMachine) setDisabledReason(r string) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.status.DisabledReason = r
}

func (s *stateMachine) setRestartAttempts(n int, nextRetry time.Time) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.status.RestartAttempts = n
    s.status.NextRetryAt = nextRetry
}

func (s *stateMachine) incStreams() {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.status.ActiveStreams++
}

func (s *stateMachine) decStreams() {
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.status.ActiveStreams > 0 {
        s.status.ActiveStreams--
    }
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
go test ./internal/ai/supervisor/ -count=1 -run TestState -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/ai/supervisor/state.go internal/ai/supervisor/state_test.go
git commit -m "feat(ai/supervisor): goroutine-safe state machine with transition rules"
```

---

## Task 6: Backoff + Restart Cap

**Files:**
- Create: `internal/ai/supervisor/backoff.go`
- Create: `internal/ai/supervisor/backoff_test.go`

- [ ] **Step 1: Write failing test**

Create `internal/ai/supervisor/backoff_test.go`:

```go
package supervisor

import (
    "testing"
    "time"
)

func TestBackoffSchedule(t *testing.T) {
    b := newBackoff(5, 300*time.Second)
    delays := []time.Duration{}
    base := time.Now()
    for i := 0; i < 5; i++ {
        d, exhausted := b.next(base.Add(time.Duration(i) * time.Second))
        if exhausted {
            t.Fatalf("exhausted at attempt %d, want 5 attempts", i+1)
        }
        delays = append(delays, d)
    }
    want := []time.Duration{1 * time.Second, 2 * time.Second, 4 * time.Second, 8 * time.Second, 16 * time.Second}
    for i := range want {
        if delays[i] != want[i] {
            t.Errorf("delays[%d] = %v, want %v", i, delays[i], want[i])
        }
    }
    if _, exhausted := b.next(base.Add(5 * time.Second)); !exhausted {
        t.Fatalf("expected exhausted after cap")
    }
}

func TestBackoffMaxDelay(t *testing.T) {
    b := newBackoff(10, 300*time.Second)
    base := time.Now()
    var lastDelay time.Duration
    for i := 0; i < 10; i++ {
        lastDelay, _ = b.next(base.Add(time.Duration(i) * time.Second))
    }
    if lastDelay != 30*time.Second {
        t.Errorf("max delay = %v, want 30s", lastDelay)
    }
}

func TestBackoffWindowReset(t *testing.T) {
    b := newBackoff(3, 60*time.Second)
    base := time.Now()
    b.next(base)
    b.next(base.Add(10 * time.Second))
    // After 60s past last attempt, counter should reset.
    d, exhausted := b.next(base.Add(80 * time.Second))
    if exhausted {
        t.Fatalf("expected window reset, got exhausted")
    }
    if d != 1*time.Second {
        t.Errorf("delay after reset = %v, want 1s", d)
    }
}
```

- [ ] **Step 2: Run test, expect compile failure**

```bash
go test ./internal/ai/supervisor/ -run TestBackoff -count=1
```

Expected: compile error.

- [ ] **Step 3: Implement backoff.go**

Create `internal/ai/supervisor/backoff.go`:

```go
package supervisor

import "time"

// backoff implements exponential backoff (1, 2, 4, 8, 16, 30, 30, ...) with
// a hard restart cap inside a sliding window. After the window elapses
// without attempts, the counter resets.
type backoff struct {
    maxAttempts  int
    window       time.Duration
    attempts     int
    lastAttempt  time.Time
}

func newBackoff(maxAttempts int, window time.Duration) *backoff {
    return &backoff{maxAttempts: maxAttempts, window: window}
}

// next returns (delay, exhausted). Caller passes the current time. If the
// window has elapsed since the previous attempt, the counter resets first.
func (b *backoff) next(now time.Time) (time.Duration, bool) {
    if !b.lastAttempt.IsZero() && now.Sub(b.lastAttempt) > b.window {
        b.attempts = 0
    }
    if b.attempts >= b.maxAttempts {
        return 0, true
    }
    delay := time.Duration(1<<uint(b.attempts)) * time.Second
    if delay > 30*time.Second {
        delay = 30 * time.Second
    }
    b.attempts++
    b.lastAttempt = now
    return delay, false
}

// reset clears all counters (called on successful spawn or explicit Refresh).
func (b *backoff) reset() {
    b.attempts = 0
    b.lastAttempt = time.Time{}
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
go test ./internal/ai/supervisor/ -run TestBackoff -count=1 -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/ai/supervisor/backoff.go internal/ai/supervisor/backoff_test.go
git commit -m "feat(ai/supervisor): exponential backoff with restart cap and window reset"
```

---

## Task 7: Idle Timer + Stream Counter

**Files:**
- Create: `internal/ai/supervisor/idle.go`
- Create: `internal/ai/supervisor/idle_test.go`

- [ ] **Step 1: Write failing test**

Create `internal/ai/supervisor/idle_test.go`:

```go
package supervisor

import (
    "sync/atomic"
    "testing"
    "time"
)

func TestIdleTimerFiresAfterTimeout(t *testing.T) {
    fired := int32(0)
    it := newIdleTimer(50*time.Millisecond, func() {
        atomic.StoreInt32(&fired, 1)
    })
    it.start()
    defer it.stop()

    time.Sleep(120 * time.Millisecond)
    if atomic.LoadInt32(&fired) != 1 {
        t.Fatalf("idle timer did not fire")
    }
}

func TestIdleTimerResets(t *testing.T) {
    fired := int32(0)
    it := newIdleTimer(80*time.Millisecond, func() {
        atomic.StoreInt32(&fired, 1)
    })
    it.start()
    defer it.stop()

    for i := 0; i < 5; i++ {
        time.Sleep(40 * time.Millisecond)
        it.reset()
    }
    if atomic.LoadInt32(&fired) != 0 {
        t.Fatalf("idle timer fired despite resets")
    }
    time.Sleep(120 * time.Millisecond)
    if atomic.LoadInt32(&fired) != 1 {
        t.Fatalf("idle timer never fired after resets stopped")
    }
}

func TestIdleTimerSuppressedWhileStreamsActive(t *testing.T) {
    fired := int32(0)
    it := newIdleTimer(50*time.Millisecond, func() {
        atomic.StoreInt32(&fired, 1)
    })
    it.setActiveStreams(func() int { return 1 })
    it.start()
    defer it.stop()

    time.Sleep(120 * time.Millisecond)
    if atomic.LoadInt32(&fired) != 0 {
        t.Fatalf("idle timer fired while streams were active")
    }
}
```

- [ ] **Step 2: Run test, expect compile failure**

```bash
go test ./internal/ai/supervisor/ -run TestIdle -count=1
```

Expected: compile error.

- [ ] **Step 3: Implement idle.go**

Create `internal/ai/supervisor/idle.go`:

```go
package supervisor

import (
    "sync"
    "time"
)

// idleTimer fires onFire after `idle` elapses with no reset() calls AND
// no active streams. Reset cancels and reschedules the deadline.
type idleTimer struct {
    idle    time.Duration
    onFire  func()
    streams func() int

    mu      sync.Mutex
    timer   *time.Timer
    started bool
    stopped bool
}

func newIdleTimer(idle time.Duration, onFire func()) *idleTimer {
    return &idleTimer{idle: idle, onFire: onFire, streams: func() int { return 0 }}
}

func (i *idleTimer) setActiveStreams(fn func() int) {
    i.mu.Lock()
    defer i.mu.Unlock()
    i.streams = fn
}

func (i *idleTimer) start() {
    i.mu.Lock()
    defer i.mu.Unlock()
    if i.started {
        return
    }
    i.started = true
    i.scheduleLocked()
}

func (i *idleTimer) reset() {
    i.mu.Lock()
    defer i.mu.Unlock()
    if !i.started || i.stopped {
        return
    }
    if i.timer != nil {
        i.timer.Stop()
    }
    i.scheduleLocked()
}

func (i *idleTimer) stop() {
    i.mu.Lock()
    defer i.mu.Unlock()
    i.stopped = true
    if i.timer != nil {
        i.timer.Stop()
    }
}

func (i *idleTimer) scheduleLocked() {
    i.timer = time.AfterFunc(i.idle, func() {
        i.mu.Lock()
        if i.stopped {
            i.mu.Unlock()
            return
        }
        if i.streams() > 0 {
            i.scheduleLocked()
            i.mu.Unlock()
            return
        }
        i.mu.Unlock()
        i.onFire()
    })
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
go test ./internal/ai/supervisor/ -run TestIdle -count=1 -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/ai/supervisor/idle.go internal/ai/supervisor/idle_test.go
git commit -m "feat(ai/supervisor): idle timer with reset and active-stream suppression"
```

---

## Task 8: Stub Sidecar Binary (Test Helper)

**Files:**
- Create: `internal/ai/supervisor/testdata/stubsidecar/main.go`
- Create: `internal/ai/supervisor/testdata/stubsidecar/build_test.go` (hook to build the binary on `go test`)

> **Why a custom stub instead of `examples/stub_chat_server` from kotg-schema:** the kotg-schema stub binds a fixed port and does not perform the mTLS handshake or read certs from stdin. We need a minimal binary that:
> 1. Reads the cert blob from stdin in our framing format,
> 2. Binds 127.0.0.1:0 with the supplied server cert,
> 3. Prints `READY <port>\n`,
> 4. Serves grpc-health + a stub `AIControl.GetCapabilities`.
>
> This stub is test-only — it lives under `testdata/` so it isn't built into production binaries.

- [ ] **Step 1: Write failing test (build hook)**

Create `internal/ai/supervisor/testdata/stubsidecar/build_test.go`:

```go
package stubsidecar

import (
    "os"
    "os/exec"
    "path/filepath"
    "testing"
)

// TestBuildStubSidecar compiles the stub binary into testdata/stubsidecar/stub
// so other tests in the supervisor package can exec it.
func TestBuildStubSidecar(t *testing.T) {
    dir, _ := os.Getwd()
    out := filepath.Join(dir, "stub")
    cmd := exec.Command("go", "build", "-o", out, ".")
    cmd.Dir = dir
    if outBytes, err := cmd.CombinedOutput(); err != nil {
        t.Fatalf("build stub: %v\n%s", err, outBytes)
    }
    if _, err := os.Stat(out); err != nil {
        t.Fatalf("stub binary missing: %v", err)
    }
}
```

- [ ] **Step 2: Run test, expect failure (no main.go)**

```bash
go test ./internal/ai/supervisor/testdata/stubsidecar/ -count=1
```

Expected: build error (no Go files).

- [ ] **Step 3: Implement stub main.go**

Create `internal/ai/supervisor/testdata/stubsidecar/main.go`:

```go
// Package main is a test-only stub of kotg-ai-server. It performs the
// supervisor handshake (cert blob from stdin, bind :0, print READY <port>)
// and answers grpc-health + AIControl.GetCapabilities. Invoked by the
// supervisor integration tests via exec; not shipped in production.
package main

import (
    "context"
    "crypto/tls"
    "crypto/x509"
    "fmt"
    "log"
    "net"
    "os"

    "github.com/kubilitics/kubilitics-backend/internal/ai/certs"
    kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
    "google.golang.org/grpc"
    "google.golang.org/grpc/credentials"
    "google.golang.org/grpc/health"
    healthpb "google.golang.org/grpc/health/grpc_health_v1"
)

type aiControl struct {
    kotgv1.UnimplementedAIControlServer
}

func (a *aiControl) GetCapabilities(_ context.Context, _ *kotgv1.GetCapabilitiesRequest) (*kotgv1.AICapabilities, error) {
    return &kotgv1.AICapabilities{
        Provider: "stub",
        Model:    "stub-model",
    }, nil
}

func main() {
    bundle, err := certs.ReadStdinBlob(os.Stdin)
    if err != nil {
        log.Fatalf("read certs: %v", err)
    }
    serverCert, err := tls.X509KeyPair(bundle.ServerCertPEM, bundle.ServerKeyPEM)
    if err != nil {
        log.Fatalf("server keypair: %v", err)
    }
    caPool := x509.NewCertPool()
    if !caPool.AppendCertsFromPEM(bundle.CAPEM) {
        log.Fatalf("ca pool")
    }
    tlsCfg := &tls.Config{
        Certificates: []tls.Certificate{serverCert},
        ClientCAs:    caPool,
        ClientAuth:   tls.RequireAndVerifyClientCert,
        MinVersion:   tls.VersionTLS13,
    }

    lis, err := net.Listen("tcp", "127.0.0.1:0")
    if err != nil {
        log.Fatalf("listen: %v", err)
    }
    port := lis.Addr().(*net.TCPAddr).Port

    srv := grpc.NewServer(grpc.Creds(credentials.NewTLS(tlsCfg)))
    h := health.NewServer()
    h.SetServingStatus("", healthpb.HealthCheckResponse_SERVING)
    healthpb.RegisterHealthServer(srv, h)
    kotgv1.RegisterAIControlServer(srv, &aiControl{})

    fmt.Fprintf(os.Stdout, "READY %d\n", port)
    if err := srv.Serve(lis); err != nil {
        log.Fatalf("serve: %v", err)
    }
}
```

> **Type-name verification:** confirm `kotgv1.UnimplementedAIControlServer`, `kotgv1.GetCapabilitiesRequest`, `kotgv1.RegisterAIControlServer`, and field names on `kotgv1.AICapabilities` match the actual generated code in `~/code/kotg-schema/gen/go/kotg/v1/`. Adjust if names differ.

- [ ] **Step 4: Run build test, expect PASS**

```bash
go test ./internal/ai/supervisor/testdata/stubsidecar/ -count=1 -v
```

Expected: PASS, `stub` binary present in the directory.

- [ ] **Step 5: Add stub binary to .gitignore**

Append to `.gitignore` (root of kubilitics repo, or kubilitics-backend if a local one exists):

```
internal/ai/supervisor/testdata/stubsidecar/stub
```

- [ ] **Step 6: Commit**

```bash
git add internal/ai/supervisor/testdata/stubsidecar/main.go \
        internal/ai/supervisor/testdata/stubsidecar/build_test.go \
        .gitignore
git commit -m "test(ai/supervisor): stub sidecar binary that performs full handshake"
```

---

## Task 9: Spawn — exec + Stdin Cert Write + READY Parse

**Files:**
- Create: `internal/ai/supervisor/spawn.go`
- Create: `internal/ai/supervisor/spawn_test.go`

- [ ] **Step 1: Write failing test**

Create `internal/ai/supervisor/spawn_test.go`:

```go
package supervisor

import (
    "context"
    "path/filepath"
    "runtime"
    "testing"
    "time"
)

func stubBinaryPath(t *testing.T) string {
    t.Helper()
    _, file, _, _ := runtime.Caller(0)
    return filepath.Join(filepath.Dir(file), "testdata/stubsidecar/stub")
}

func TestSpawnReachesReady(t *testing.T) {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

    proc, err := spawnSidecar(ctx, stubBinaryPath(t))
    if err != nil {
        t.Fatalf("spawnSidecar: %v", err)
    }
    defer proc.kill()

    if proc.port <= 0 {
        t.Errorf("port = %d, want >0", proc.port)
    }
    if proc.bundle == nil || len(proc.bundle.CAPEM) == 0 {
        t.Errorf("bundle missing CA")
    }
}

func TestSpawnTimeoutKills(t *testing.T) {
    // Use a binary that won't print READY (use /bin/sleep on unix).
    if runtime.GOOS == "windows" {
        t.Skip("skip on windows")
    }
    ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
    defer cancel()

    _, err := spawnSidecar(ctx, "/bin/sleep")
    if err == nil {
        t.Fatalf("expected timeout error")
    }
}
```

- [ ] **Step 2: Run test, expect compile failure**

```bash
go test ./internal/ai/supervisor/ -run TestSpawn -count=1
```

Expected: compile error.

- [ ] **Step 3: Implement spawn.go**

Create `internal/ai/supervisor/spawn.go`:

```go
package supervisor

import (
    "bufio"
    "context"
    "fmt"
    "io"
    "os/exec"
    "strconv"
    "strings"
    "time"

    "github.com/kubilitics/kubilitics-backend/internal/ai/certs"
)

const spawnReadyTimeout = 5 * time.Second

type runningProcess struct {
    cmd    *exec.Cmd
    bundle *certs.Bundle
    port   int
    stdout io.ReadCloser
    done   chan error
}

func (p *runningProcess) kill() {
    if p.cmd != nil && p.cmd.Process != nil {
        _ = p.cmd.Process.Kill()
    }
}

// spawnSidecar mints fresh certs, exec's the binary, writes the cert blob
// to stdin, and waits for "READY <port>\n" on stdout (≤spawnReadyTimeout).
// Caller is responsible for proc.kill() on every exit path.
func spawnSidecar(ctx context.Context, binaryPath string) (*runningProcess, error) {
    bundle, err := certs.Mint()
    if err != nil {
        return nil, fmt.Errorf("mint certs: %w", err)
    }

    cmd := exec.CommandContext(ctx, binaryPath)
    stdin, err := cmd.StdinPipe()
    if err != nil {
        return nil, fmt.Errorf("stdin pipe: %w", err)
    }
    stdout, err := cmd.StdoutPipe()
    if err != nil {
        return nil, fmt.Errorf("stdout pipe: %w", err)
    }
    cmd.Stderr = nil // discard; could be wired to logger later

    if err := cmd.Start(); err != nil {
        return nil, fmt.Errorf("start: %w", err)
    }

    if err := certs.WriteStdinBlob(stdin, bundle); err != nil {
        _ = cmd.Process.Kill()
        return nil, fmt.Errorf("write certs: %w", err)
    }
    _ = stdin.Close()

    proc := &runningProcess{cmd: cmd, bundle: bundle, stdout: stdout, done: make(chan error, 1)}
    go func() { proc.done <- cmd.Wait() }()

    port, err := waitForReady(stdout, spawnReadyTimeout)
    if err != nil {
        _ = cmd.Process.Kill()
        return nil, err
    }
    proc.port = port
    return proc, nil
}

func waitForReady(r io.Reader, timeout time.Duration) (int, error) {
    type line struct {
        s   string
        err error
    }
    ch := make(chan line, 1)
    go func() {
        sc := bufio.NewScanner(r)
        if sc.Scan() {
            ch <- line{s: sc.Text()}
            return
        }
        if err := sc.Err(); err != nil {
            ch <- line{err: err}
            return
        }
        ch <- line{err: io.EOF}
    }()
    select {
    case l := <-ch:
        if l.err != nil {
            return 0, fmt.Errorf("read ready: %w", l.err)
        }
        if !strings.HasPrefix(l.s, "READY ") {
            return 0, fmt.Errorf("expected READY <port>, got %q", l.s)
        }
        port, err := strconv.Atoi(strings.TrimPrefix(l.s, "READY "))
        if err != nil {
            return 0, fmt.Errorf("parse port: %w", err)
        }
        return port, nil
    case <-time.After(timeout):
        return 0, fmt.Errorf("READY timeout after %s", timeout)
    }
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
go test ./internal/ai/supervisor/ -run TestSpawn -count=1 -v
```

Expected: PASS (both subtests). Stub binary must exist from Task 8 — re-run `go test ./internal/ai/supervisor/testdata/stubsidecar/` if needed.

- [ ] **Step 5: Commit**

```bash
git add internal/ai/supervisor/spawn.go internal/ai/supervisor/spawn_test.go
git commit -m "feat(ai/supervisor): spawn sidecar with stdin certs and READY <port> handshake"
```

---

## Task 10: Dial + Health + Capabilities

**Files:**
- Create: `internal/ai/supervisor/dial.go`
- Create: `internal/ai/supervisor/dial_test.go`

- [ ] **Step 1: Write failing test**

Create `internal/ai/supervisor/dial_test.go`:

```go
package supervisor

import (
    "context"
    "testing"
    "time"
)

func TestDialAndCheckHealth(t *testing.T) {
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()

    proc, err := spawnSidecar(ctx, stubBinaryPath(t))
    if err != nil {
        t.Fatalf("spawn: %v", err)
    }
    defer proc.kill()

    conn, err := dialMTLS(ctx, proc.port, proc.bundle)
    if err != nil {
        t.Fatalf("dial: %v", err)
    }
    defer conn.Close()

    if err := checkHealth(ctx, conn, 2*time.Second); err != nil {
        t.Fatalf("health: %v", err)
    }

    caps, err := fetchCapabilities(ctx, conn)
    if err != nil {
        t.Fatalf("capabilities: %v", err)
    }
    if caps == nil {
        t.Fatalf("nil capabilities")
    }
}
```

- [ ] **Step 2: Run test, expect compile failure**

```bash
go test ./internal/ai/supervisor/ -run TestDial -count=1
```

Expected: compile error.

- [ ] **Step 3: Implement dial.go**

Create `internal/ai/supervisor/dial.go`:

```go
package supervisor

import (
    "context"
    "crypto/tls"
    "crypto/x509"
    "fmt"
    "time"

    "github.com/kubilitics/kubilitics-backend/internal/ai/certs"
    kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
    "google.golang.org/grpc"
    "google.golang.org/grpc/credentials"
    healthpb "google.golang.org/grpc/health/grpc_health_v1"
)

func dialMTLS(ctx context.Context, port int, bundle *certs.Bundle) (*grpc.ClientConn, error) {
    clientPair, err := tls.X509KeyPair(bundle.ClientCertPEM, bundle.ClientKeyPEM)
    if err != nil {
        return nil, fmt.Errorf("client keypair: %w", err)
    }
    caPool := x509.NewCertPool()
    if !caPool.AppendCertsFromPEM(bundle.CAPEM) {
        return nil, fmt.Errorf("ca pool")
    }
    tlsCfg := &tls.Config{
        Certificates: []tls.Certificate{clientPair},
        RootCAs:      caPool,
        ServerName:   "localhost",
        MinVersion:   tls.VersionTLS13,
    }
    target := fmt.Sprintf("127.0.0.1:%d", port)
    return grpc.NewClient(target,
        grpc.WithTransportCredentials(credentials.NewTLS(tlsCfg)),
    )
}

func checkHealth(ctx context.Context, conn *grpc.ClientConn, timeout time.Duration) error {
    cctx, cancel := context.WithTimeout(ctx, timeout)
    defer cancel()
    cli := healthpb.NewHealthClient(conn)
    resp, err := cli.Check(cctx, &healthpb.HealthCheckRequest{Service: ""})
    if err != nil {
        return fmt.Errorf("health check: %w", err)
    }
    if resp.Status != healthpb.HealthCheckResponse_SERVING {
        return fmt.Errorf("health not SERVING: %v", resp.Status)
    }
    return nil
}

func fetchCapabilities(ctx context.Context, conn *grpc.ClientConn) (*kotgv1.AICapabilities, error) {
    cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    cli := kotgv1.NewAIControlClient(conn)
    return cli.GetCapabilities(cctx, &kotgv1.GetCapabilitiesRequest{})
}
```

> **Type-name verification:** confirm `kotgv1.NewAIControlClient` and `kotgv1.GetCapabilitiesRequest` exist in `~/code/kotg-schema/gen/go/kotg/v1/`. Adjust if names differ.

- [ ] **Step 4: Run test, expect PASS**

```bash
go test ./internal/ai/supervisor/ -run TestDial -count=1 -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/ai/supervisor/dial.go internal/ai/supervisor/dial_test.go
git commit -m "feat(ai/supervisor): mTLS dial + grpc-health check + capabilities fetch"
```

---

## Task 11: Supervisor — Orchestrator (`Supervisor` interface + `New`)

**Files:**
- Create: `internal/ai/supervisor/supervisor.go`
- Create: `internal/ai/supervisor/supervisor_test.go`

- [ ] **Step 1: Write failing test (full lifecycle)**

Create `internal/ai/supervisor/supervisor_test.go`:

```go
package supervisor

import (
    "context"
    "testing"
    "time"

    "github.com/kubilitics/kubilitics-backend/internal/ai/types"
)

func newTestSupervisor(t *testing.T) Supervisor {
    t.Helper()
    return New(Config{
        BinaryPath:           stubBinaryPath(t),
        IdleShutdown:         200 * time.Millisecond,
        MaxRestartAttempts:   3,
        RestartWindow:        5 * time.Second,
    })
}

func TestSupervisorEnsureReady(t *testing.T) {
    s := newTestSupervisor(t)
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    defer s.Shutdown(context.Background())

    rc, err := s.EnsureReady(ctx)
    if err != nil {
        t.Fatalf("EnsureReady: %v", err)
    }
    if rc.Conn == nil {
        t.Fatalf("nil conn")
    }
    if rc.SpawnID == "" {
        t.Fatalf("empty spawn id")
    }
    if got := s.Status().State; got != types.StateReady {
        t.Errorf("state = %v, want ready", got)
    }
}

func TestSupervisorIdleShutdown(t *testing.T) {
    s := newTestSupervisor(t)
    defer s.Shutdown(context.Background())

    ctx := context.Background()
    if _, err := s.EnsureReady(ctx); err != nil {
        t.Fatalf("EnsureReady: %v", err)
    }

    // Wait past idle shutdown threshold.
    time.Sleep(500 * time.Millisecond)
    if got := s.Status().State; got != types.StateStopped {
        t.Errorf("state after idle = %v, want stopped", got)
    }
}

func TestSupervisorRefresh(t *testing.T) {
    s := newTestSupervisor(t)
    defer s.Shutdown(context.Background())
    ctx := context.Background()

    rc1, err := s.EnsureReady(ctx)
    if err != nil {
        t.Fatalf("EnsureReady #1: %v", err)
    }
    if err := s.Refresh(ctx); err != nil {
        t.Fatalf("Refresh: %v", err)
    }
    rc2, err := s.EnsureReady(ctx)
    if err != nil {
        t.Fatalf("EnsureReady #2: %v", err)
    }
    if rc1.SpawnID == rc2.SpawnID {
        t.Errorf("SpawnID did not change after Refresh")
    }
}

func TestSupervisorGetCapabilities(t *testing.T) {
    s := newTestSupervisor(t)
    defer s.Shutdown(context.Background())
    ctx := context.Background()
    if _, err := s.EnsureReady(ctx); err != nil {
        t.Fatalf("EnsureReady: %v", err)
    }
    snap, err := s.GetCapabilities(ctx)
    if err != nil {
        t.Fatalf("GetCapabilities: %v", err)
    }
    if snap == nil || snap.Capabilities == nil {
        t.Fatalf("nil snapshot or capabilities")
    }
}
```

- [ ] **Step 2: Run test, expect compile failure**

```bash
go test ./internal/ai/supervisor/ -run TestSupervisor -count=1
```

Expected: compile error.

- [ ] **Step 3: Implement supervisor.go**

Create `internal/ai/supervisor/supervisor.go`:

```go
package supervisor

import (
    "context"
    "crypto/rand"
    "encoding/hex"
    "fmt"
    "sync"
    "time"

    "github.com/kubilitics/kubilitics-backend/internal/ai/types"
    "google.golang.org/grpc"
)

// Config carries the subset of ai.* config the supervisor needs. Wired
// from internal/config in cmd/server/main.go.
type Config struct {
    BinaryPath           string
    IdleShutdown         time.Duration
    MaxRestartAttempts   int
    RestartWindow        time.Duration
}

// ReadyConn is what EnsureReady returns. The proxy uses Conn for RPCs and
// SpawnID for the proxy-side spawn-change guard.
type ReadyConn struct {
    Conn    *grpc.ClientConn
    SpawnID string
}

type Supervisor interface {
    EnsureReady(ctx context.Context) (*ReadyConn, error)
    GetCapabilities(ctx context.Context) (*types.CapabilitiesSnapshot, error)
    Refresh(ctx context.Context) error
    Status() types.SidecarStatus
    IncStreams()
    DecStreams()
    CurrentSpawnID() string
    Shutdown(ctx context.Context) error
}

type supervisorImpl struct {
    cfg Config

    mu        sync.Mutex
    state     *stateMachine
    backoff   *backoff
    idle      *idleTimer
    proc      *runningProcess
    conn      *grpc.ClientConn
    snapshot  *types.CapabilitiesSnapshot
    spawnID   string
    shutdown  bool
    parentCtx context.Context
    cancel    context.CancelFunc
}

func New(cfg Config) Supervisor {
    pctx, cancel := context.WithCancel(context.Background())
    s := &supervisorImpl{
        cfg:       cfg,
        state:     newStateMachine(),
        backoff:   newBackoff(cfg.MaxRestartAttempts, cfg.RestartWindow),
        parentCtx: pctx,
        cancel:    cancel,
    }
    s.idle = newIdleTimer(cfg.IdleShutdown, s.onIdleFire)
    s.idle.setActiveStreams(func() int { return s.state.Snapshot().ActiveStreams })
    return s
}

func (s *supervisorImpl) EnsureReady(ctx context.Context) (*ReadyConn, error) {
    s.mu.Lock()
    if s.shutdown {
        s.mu.Unlock()
        return nil, fmt.Errorf("supervisor: shut down")
    }
    if s.state.Snapshot().State == types.StateReady && s.conn != nil {
        rc := &ReadyConn{Conn: s.conn, SpawnID: s.spawnID}
        s.mu.Unlock()
        s.idle.reset()
        return rc, nil
    }
    s.mu.Unlock()
    return s.spawnLocked(ctx)
}

func (s *supervisorImpl) spawnLocked(ctx context.Context) (*ReadyConn, error) {
    s.mu.Lock()
    defer s.mu.Unlock()
    // Re-check after acquiring the lock.
    if s.state.Snapshot().State == types.StateReady && s.conn != nil {
        return &ReadyConn{Conn: s.conn, SpawnID: s.spawnID}, nil
    }
    if err := s.state.transition(types.StateStarting); err != nil {
        // Recover from Crashed → Starting via explicit transition.
        s.state.transition(types.StateStopped)
        if err2 := s.state.transition(types.StateStarting); err2 != nil {
            return nil, fmt.Errorf("transition to starting: %w", err2)
        }
    }
    binPath := s.cfg.BinaryPath
    if binPath == "" {
        binPath = "kotg-ai-server"
    }
    proc, err := spawnSidecar(s.parentCtx, binPath)
    if err != nil {
        s.state.setLastError(err.Error())
        s.state.transition(types.StateCrashed)
        return nil, err
    }
    conn, err := dialMTLS(ctx, proc.port, proc.bundle)
    if err != nil {
        proc.kill()
        s.state.setLastError(err.Error())
        s.state.transition(types.StateCrashed)
        return nil, err
    }
    if err := checkHealth(ctx, conn, 2*time.Second); err != nil {
        conn.Close()
        proc.kill()
        s.state.setLastError(err.Error())
        s.state.transition(types.StateCrashed)
        return nil, err
    }
    caps, err := fetchCapabilities(ctx, conn)
    if err != nil {
        conn.Close()
        proc.kill()
        s.state.setLastError(err.Error())
        s.state.transition(types.StateCrashed)
        return nil, err
    }
    spawnID := newSpawnID()
    s.proc = proc
    s.conn = conn
    s.spawnID = spawnID
    s.snapshot = &types.CapabilitiesSnapshot{Capabilities: caps, FetchedAt: time.Now(), SpawnID: spawnID}
    s.state.setSpawnID(spawnID)
    s.state.transition(types.StateReady)
    s.backoff.reset()
    s.idle.start()
    s.idle.reset()
    go s.watchExit(proc)
    return &ReadyConn{Conn: conn, SpawnID: spawnID}, nil
}

func (s *supervisorImpl) watchExit(proc *runningProcess) {
    err := <-proc.done
    s.mu.Lock()
    if s.proc != proc {
        s.mu.Unlock()
        return
    }
    if s.conn != nil {
        s.conn.Close()
        s.conn = nil
    }
    s.proc = nil
    if err != nil {
        s.state.setLastError(err.Error())
    }
    if s.state.Snapshot().State == types.StateStopping {
        s.state.transition(types.StateStopped)
        s.mu.Unlock()
        return
    }
    s.state.transition(types.StateCrashed)
    s.mu.Unlock()
}

func (s *supervisorImpl) GetCapabilities(ctx context.Context) (*types.CapabilitiesSnapshot, error) {
    s.mu.Lock()
    snap := s.snapshot
    s.mu.Unlock()
    if snap != nil {
        return snap, nil
    }
    if _, err := s.EnsureReady(ctx); err != nil {
        return nil, err
    }
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.snapshot, nil
}

func (s *supervisorImpl) Refresh(ctx context.Context) error {
    s.mu.Lock()
    if s.proc == nil {
        s.mu.Unlock()
        return nil
    }
    proc := s.proc
    s.state.transition(types.StateStopping)
    s.mu.Unlock()

    proc.kill()
    select {
    case <-proc.done:
    case <-time.After(5 * time.Second):
        proc.kill()
    }

    s.mu.Lock()
    s.proc = nil
    if s.conn != nil {
        s.conn.Close()
        s.conn = nil
    }
    s.snapshot = nil
    s.backoff.reset()
    s.state.transition(types.StateStopped)
    s.mu.Unlock()
    return nil
}

func (s *supervisorImpl) Status() types.SidecarStatus       { return s.state.Snapshot() }
func (s *supervisorImpl) IncStreams()                       { s.state.incStreams() }
func (s *supervisorImpl) DecStreams()                       { s.state.decStreams(); s.idle.reset() }
func (s *supervisorImpl) CurrentSpawnID() string            { s.mu.Lock(); defer s.mu.Unlock(); return s.spawnID }

func (s *supervisorImpl) Shutdown(ctx context.Context) error {
    s.mu.Lock()
    s.shutdown = true
    s.mu.Unlock()
    s.idle.stop()
    return s.Refresh(ctx)
}

func (s *supervisorImpl) onIdleFire() {
    s.mu.Lock()
    if s.state.Snapshot().State != types.StateReady || s.proc == nil {
        s.mu.Unlock()
        return
    }
    proc := s.proc
    s.state.transition(types.StateStopping)
    s.mu.Unlock()

    proc.kill()
    select {
    case <-proc.done:
    case <-time.After(5 * time.Second):
    }
}

func newSpawnID() string {
    var b [8]byte
    _, _ = rand.Read(b[:])
    return hex.EncodeToString(b[:])
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
go test ./internal/ai/supervisor/ -count=1 -v -timeout=60s
```

Expected: all `TestSupervisor*` tests PASS. If `TestSupervisorIdleShutdown` is flaky on slow machines, increase the test sleep to 700ms.

- [ ] **Step 5: Commit**

```bash
git add internal/ai/supervisor/supervisor.go internal/ai/supervisor/supervisor_test.go
git commit -m "feat(ai/supervisor): orchestrator wiring spawn+dial+health+caps+idle+refresh"
```

---

## Task 12: Proxy — Rate Limiter

**Files:**
- Create: `internal/ai/proxy/ratelimit.go`
- Create: `internal/ai/proxy/ratelimit_test.go`

- [ ] **Step 1: Write failing test**

Create `internal/ai/proxy/ratelimit_test.go`:

```go
package proxy

import "testing"

func TestRateLimiterAllowsUnderBudget(t *testing.T) {
    rl := newRateLimiter(60) // 60/min = 1/sec, burst 60
    for i := 0; i < 60; i++ {
        if !rl.allow("user-a") {
            t.Fatalf("rejected request %d, expected all to pass under budget", i+1)
        }
    }
}

func TestRateLimiterBlocksOverBudget(t *testing.T) {
    rl := newRateLimiter(2) // very tight
    rl.allow("user-a")
    rl.allow("user-a")
    if rl.allow("user-a") {
        t.Fatalf("expected 3rd rapid request to be blocked")
    }
}

func TestRateLimiterPerUser(t *testing.T) {
    rl := newRateLimiter(2)
    rl.allow("user-a")
    rl.allow("user-a")
    if !rl.allow("user-b") {
        t.Fatalf("user-b should not be impacted by user-a's bucket")
    }
}
```

- [ ] **Step 2: Run test, expect compile failure**

```bash
go test ./internal/ai/proxy/ -run TestRateLimiter -count=1
```

Expected: compile error.

- [ ] **Step 3: Implement ratelimit.go**

Create `internal/ai/proxy/ratelimit.go`:

```go
package proxy

import (
    "sync"

    "golang.org/x/time/rate"
)

// rateLimiter holds one token bucket per user. perMin is the steady-state
// rate; burst equals perMin (allows a 1-minute spike without throttling
// new users).
type rateLimiter struct {
    perMin int
    mu     sync.Mutex
    buckets map[string]*rate.Limiter
}

func newRateLimiter(perMin int) *rateLimiter {
    return &rateLimiter{perMin: perMin, buckets: make(map[string]*rate.Limiter)}
}

func (r *rateLimiter) allow(userID string) bool {
    r.mu.Lock()
    lim, ok := r.buckets[userID]
    if !ok {
        // perMin requests per 60s = perMin/60 per second; burst = perMin.
        lim = rate.NewLimiter(rate.Limit(float64(r.perMin)/60.0), r.perMin)
        r.buckets[userID] = lim
    }
    r.mu.Unlock()
    return lim.Allow()
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
go test ./internal/ai/proxy/ -run TestRateLimiter -count=1 -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/ai/proxy/ratelimit.go internal/ai/proxy/ratelimit_test.go
git commit -m "feat(ai/proxy): per-user token-bucket rate limiter"
```

---

## Task 13: Proxy — Observability Metrics

**Files:**
- Create: `internal/ai/proxy/observability.go`

- [ ] **Step 1: Implement (no test — pure metric registration; covered by handler tests later)**

Create `internal/ai/proxy/observability.go`:

```go
package proxy

import (
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
)

var (
    proxyDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
        Name:    "kubilitics_ai_proxy_duration_seconds",
        Help:    "Latency of AI proxy calls.",
        Buckets: prometheus.DefBuckets,
    }, []string{"op", "status"})

    proxyErrors = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "kubilitics_ai_proxy_errors_total",
        Help: "AI proxy errors by op and status code.",
    }, []string{"op", "code"})

    rateDropped = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "kubilitics_ai_ratelimit_dropped_total",
        Help: "AI proxy requests dropped by rate limiter.",
    }, []string{"op"})
)
```

- [ ] **Step 2: Verify build**

```bash
go build ./internal/ai/proxy/
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add internal/ai/proxy/observability.go
git commit -m "feat(ai/proxy): prometheus collectors for duration, errors, rate drops"
```

---

## Task 14: Proxy — Chat (cluster_id enforce, metadata, SpawnID guard)

**Files:**
- Create: `internal/ai/proxy/proxy.go`
- Create: `internal/ai/proxy/proxy_test.go`

- [ ] **Step 1: Write failing test**

Create `internal/ai/proxy/proxy_test.go`:

```go
package proxy

import (
    "context"
    "testing"
    "time"

    "github.com/kubilitics/kubilitics-backend/internal/ai/gate"
    "github.com/kubilitics/kubilitics-backend/internal/ai/supervisor"
    "github.com/kubilitics/kubilitics-backend/internal/ai/types"

    "path/filepath"
    "runtime"
)

func stubBinaryPath(t *testing.T) string {
    t.Helper()
    _, file, _, _ := runtime.Caller(0)
    return filepath.Clean(filepath.Join(filepath.Dir(file), "../supervisor/testdata/stubsidecar/stub"))
}

func newTestProxy(t *testing.T) (*Proxy, supervisor.Supervisor) {
    sup := supervisor.New(supervisor.Config{
        BinaryPath:         stubBinaryPath(t),
        IdleShutdown:       30 * time.Second,
        MaxRestartAttempts: 3,
        RestartWindow:      5 * time.Second,
    })
    return New(sup, gate.NoOpGate{}, 60), sup
}

func TestProxyMissingClusterRejects(t *testing.T) {
    p, sup := newTestProxy(t)
    defer sup.Shutdown(context.Background())

    _, err := p.GetCapabilities(WithUser(context.Background(), "u1"), "")
    if err != types.ErrMissingCluster {
        t.Fatalf("err = %v, want ErrMissingCluster", err)
    }
}

func TestProxyGetCapabilitiesHappy(t *testing.T) {
    p, sup := newTestProxy(t)
    defer sup.Shutdown(context.Background())

    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    snap, err := p.GetCapabilities(WithUser(ctx, "u1"), "cluster-a")
    if err != nil {
        t.Fatalf("GetCapabilities: %v", err)
    }
    if snap == nil || snap.Capabilities == nil {
        t.Fatalf("nil snapshot")
    }
}

func TestProxyRateLimit(t *testing.T) {
    sup := supervisor.New(supervisor.Config{
        BinaryPath:         stubBinaryPath(t),
        IdleShutdown:       30 * time.Second,
        MaxRestartAttempts: 3,
        RestartWindow:      5 * time.Second,
    })
    defer sup.Shutdown(context.Background())
    p := New(sup, gate.NoOpGate{}, 1) // budget of 1/min, burst 1

    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    if _, err := p.GetCapabilities(WithUser(ctx, "u1"), "cluster-a"); err != nil {
        t.Fatalf("first call: %v", err)
    }
    if _, err := p.GetCapabilities(WithUser(ctx, "u1"), "cluster-a"); err != types.ErrRateLimited {
        t.Fatalf("second call err = %v, want ErrRateLimited", err)
    }
}
```

- [ ] **Step 2: Run test, expect compile failure**

```bash
go test ./internal/ai/proxy/ -count=1
```

Expected: compile error.

- [ ] **Step 3: Implement proxy.go**

Create `internal/ai/proxy/proxy.go`:

```go
// Package proxy fronts the AI sidecar with a single chokepoint that
// enforces cluster_id presence, injects identity metadata, runs each call
// through the ActionGate, applies per-user rate limiting, and emits
// structured logs and prometheus metrics. Streams are SpawnID-guarded so
// that a sidecar respawn cleanly aborts in-flight streams instead of
// silently switching processes.
package proxy

import (
    "context"
    "time"

    "github.com/kubilitics/kubilitics-backend/internal/ai/gate"
    "github.com/kubilitics/kubilitics-backend/internal/ai/supervisor"
    "github.com/kubilitics/kubilitics-backend/internal/ai/types"

    kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
    "google.golang.org/grpc/metadata"
    "google.golang.org/grpc/status"
)

type ctxKey int

const (
    ctxUserID ctxKey = iota
    ctxRequestID
)

func WithUser(ctx context.Context, userID string) context.Context {
    return context.WithValue(ctx, ctxUserID, userID)
}

func WithRequestID(ctx context.Context, reqID string) context.Context {
    return context.WithValue(ctx, ctxRequestID, reqID)
}

func userID(ctx context.Context) string {
    v, _ := ctx.Value(ctxUserID).(string)
    return v
}

func requestID(ctx context.Context) string {
    v, _ := ctx.Value(ctxRequestID).(string)
    return v
}

type Proxy struct {
    sup   supervisor.Supervisor
    gate  gate.ActionGate
    rl    *rateLimiter
}

func New(sup supervisor.Supervisor, g gate.ActionGate, rateLimitPerUserPerMin int) *Proxy {
    return &Proxy{sup: sup, gate: g, rl: newRateLimiter(rateLimitPerUserPerMin)}
}

func (p *Proxy) ensureCluster(clusterID string) error {
    if clusterID == "" {
        return types.ErrMissingCluster
    }
    return nil
}

func (p *Proxy) attachMeta(ctx context.Context, clusterID string) context.Context {
    return metadata.AppendToOutgoingContext(ctx,
        "kotg-cluster-id", clusterID,
        "kotg-user-id", userID(ctx),
        "kotg-request-id", requestID(ctx),
    )
}

func (p *Proxy) GetCapabilities(ctx context.Context, clusterID string) (*types.CapabilitiesSnapshot, error) {
    if err := p.ensureCluster(clusterID); err != nil {
        proxyErrors.WithLabelValues("capabilities", "missing_cluster").Inc()
        return nil, err
    }
    if uid := userID(ctx); uid != "" && !p.rl.allow(uid) {
        rateDropped.WithLabelValues("capabilities").Inc()
        return nil, types.ErrRateLimited
    }
    start := time.Now()
    snap, err := p.sup.GetCapabilities(p.attachMeta(ctx, clusterID))
    proxyDuration.WithLabelValues("capabilities", statusLabel(err)).Observe(time.Since(start).Seconds())
    if err != nil {
        proxyErrors.WithLabelValues("capabilities", statusLabel(err)).Inc()
    }
    return snap, err
}

func (p *Proxy) Refresh(ctx context.Context) error {
    start := time.Now()
    err := p.sup.Refresh(ctx)
    proxyDuration.WithLabelValues("refresh", statusLabel(err)).Observe(time.Since(start).Seconds())
    if err != nil {
        proxyErrors.WithLabelValues("refresh", statusLabel(err)).Inc()
    }
    return err
}

// Chat opens a server-streaming chat call. Caller MUST drain the returned
// stream and rely on the supervisor.IncStreams/DecStreams accounting that
// happens via wrapStream.
func (p *Proxy) Chat(ctx context.Context, clusterID string, req *kotgv1.ChatRequest, chatTimeout time.Duration) (kotgv1.Chat_StreamClient, string, error) {
    if err := p.ensureCluster(clusterID); err != nil {
        proxyErrors.WithLabelValues("chat", "missing_cluster").Inc()
        return nil, "", err
    }
    if uid := userID(ctx); uid != "" && !p.rl.allow(uid) {
        rateDropped.WithLabelValues("chat").Inc()
        return nil, "", types.ErrRateLimited
    }
    rc, err := p.sup.EnsureReady(ctx)
    if err != nil {
        proxyErrors.WithLabelValues("chat", statusLabel(err)).Inc()
        return nil, "", err
    }
    spawnID := rc.SpawnID
    cctx, _ := context.WithTimeout(p.attachMeta(ctx, clusterID), chatTimeout)
    p.sup.IncStreams()

    next := func(ctx context.Context, r *kotgv1.ChatRequest) (kotgv1.Chat_StreamClient, error) {
        cli := kotgv1.NewChatClient(rc.Conn)
        return cli.Stream(ctx, r)
    }
    stream, err := p.gate.WrapChat(cctx, req, next)
    if err != nil {
        p.sup.DecStreams()
        proxyErrors.WithLabelValues("chat", statusLabel(err)).Inc()
        return nil, "", err
    }
    return wrapStream(stream, spawnID, p.sup), spawnID, nil
}

func statusLabel(err error) string {
    if err == nil {
        return "ok"
    }
    if s, ok := status.FromError(err); ok {
        return s.Code().String()
    }
    return "error"
}
```

> **Type-name verification:** confirm `kotgv1.ChatRequest`, `kotgv1.Chat_StreamClient`, and `kotgv1.NewChatClient(...).Stream(...)` exist in `~/code/kotg-schema/gen/go/kotg/v1/`. The chat service's RPC may be named `Stream` or something else — check `chat.proto` in the kotg-schema repo. Adjust gate.go, proxy.go, and tests for the actual name.

- [ ] **Step 4: Implement wrapStream (separate small file for clarity)**

Create `internal/ai/proxy/stream.go`:

```go
package proxy

import (
    "github.com/kubilitics/kubilitics-backend/internal/ai/supervisor"
    "github.com/kubilitics/kubilitics-backend/internal/ai/types"

    kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/status"
)

type guardedStream struct {
    kotgv1.Chat_StreamClient
    spawnID string
    sup     supervisor.Supervisor
    closed  bool
}

func wrapStream(s kotgv1.Chat_StreamClient, spawnID string, sup supervisor.Supervisor) kotgv1.Chat_StreamClient {
    return &guardedStream{Chat_StreamClient: s, spawnID: spawnID, sup: sup}
}

func (g *guardedStream) Recv() (*kotgv1.AssistantEvent, error) {
    if g.spawnID != g.sup.CurrentSpawnID() {
        g.closeOnce()
        return nil, status.Error(codes.Aborted, types.ErrSpawnChanged.Error())
    }
    ev, err := g.Chat_StreamClient.Recv()
    if err != nil {
        g.closeOnce()
    }
    return ev, err
}

func (g *guardedStream) closeOnce() {
    if g.closed {
        return
    }
    g.closed = true
    g.sup.DecStreams()
}
```

> **Type-name verification:** confirm `kotgv1.AssistantEvent` exists; if it's `kotgv1.ChatEvent` or similar, adjust.

- [ ] **Step 5: Run test, expect PASS**

```bash
go test ./internal/ai/proxy/ -count=1 -v -timeout=60s
```

Expected: all proxy tests PASS. The stub binary returns capabilities for `GetCapabilities`; chat is not exercised here (handler tests cover it).

- [ ] **Step 6: Commit**

```bash
git add internal/ai/proxy/proxy.go internal/ai/proxy/stream.go internal/ai/proxy/proxy_test.go
git commit -m "feat(ai/proxy): cluster_id enforce + metadata inject + SpawnID guard + rate limit"
```

---

## Task 15: Handlers — Status + Refresh

**Files:**
- Create: `internal/ai/handlers/handlers.go`
- Create: `internal/ai/handlers/status.go`
- Create: `internal/ai/handlers/refresh.go`
- Create: `internal/ai/handlers/handlers_test.go`

- [ ] **Step 1: Write failing test**

Create `internal/ai/handlers/handlers_test.go`:

```go
package handlers

import (
    "encoding/json"
    "net/http"
    "net/http/httptest"
    "path/filepath"
    "runtime"
    "testing"
    "time"

    "github.com/kubilitics/kubilitics-backend/internal/ai/gate"
    "github.com/kubilitics/kubilitics-backend/internal/ai/proxy"
    "github.com/kubilitics/kubilitics-backend/internal/ai/supervisor"
    "github.com/kubilitics/kubilitics-backend/internal/ai/types"
)

func stubBinary(t *testing.T) string {
    t.Helper()
    _, file, _, _ := runtime.Caller(0)
    return filepath.Clean(filepath.Join(filepath.Dir(file), "../supervisor/testdata/stubsidecar/stub"))
}

func newTestServer(t *testing.T) (*httptest.Server, supervisor.Supervisor) {
    sup := supervisor.New(supervisor.Config{
        BinaryPath:         stubBinary(t),
        IdleShutdown:       30 * time.Second,
        MaxRestartAttempts: 3,
        RestartWindow:      5 * time.Second,
    })
    p := proxy.New(sup, gate.NoOpGate{}, 60)
    h := New(sup, p, Config{Enabled: true, ChatMaxDuration: 30 * time.Second})
    mux := http.NewServeMux()
    h.Register(mux)
    return httptest.NewServer(mux), sup
}

func TestStatusEndpoint(t *testing.T) {
    srv, sup := newTestServer(t)
    defer srv.Close()
    defer sup.Shutdown(nil)

    resp, err := http.Get(srv.URL + "/api/v1/ai/status")
    if err != nil {
        t.Fatalf("get: %v", err)
    }
    defer resp.Body.Close()
    if resp.StatusCode != 200 {
        t.Fatalf("status code = %d", resp.StatusCode)
    }
    var st types.SidecarStatus
    if err := json.NewDecoder(resp.Body).Decode(&st); err != nil {
        t.Fatalf("decode: %v", err)
    }
}

func TestRefreshEndpoint(t *testing.T) {
    srv, sup := newTestServer(t)
    defer srv.Close()
    defer sup.Shutdown(nil)

    req, _ := http.NewRequest("POST", srv.URL+"/api/v1/ai/refresh", nil)
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        t.Fatalf("post: %v", err)
    }
    if resp.StatusCode != 202 {
        t.Fatalf("status = %d, want 202", resp.StatusCode)
    }
}

func TestStatusWhenAIDisabled(t *testing.T) {
    sup := supervisor.New(supervisor.Config{BinaryPath: stubBinary(t)})
    p := proxy.New(sup, gate.NoOpGate{}, 60)
    h := New(sup, p, Config{Enabled: false, ChatMaxDuration: 30 * time.Second})
    mux := http.NewServeMux()
    h.Register(mux)
    srv := httptest.NewServer(mux)
    defer srv.Close()
    defer sup.Shutdown(nil)

    resp, _ := http.Get(srv.URL + "/api/v1/ai/status")
    var st types.SidecarStatus
    json.NewDecoder(resp.Body).Decode(&st)
    if st.DisabledReason != types.DisabledReasonAIDisabled {
        t.Errorf("DisabledReason = %q, want %q", st.DisabledReason, types.DisabledReasonAIDisabled)
    }
}
```

- [ ] **Step 2: Run test, expect compile failure**

```bash
go test ./internal/ai/handlers/ -count=1
```

Expected: compile error.

- [ ] **Step 3: Implement handlers.go**

Create `internal/ai/handlers/handlers.go`:

```go
// Package handlers exposes the AI HTTP/WS surface area on the existing
// kubilitics-backend mux. All routes honor the ai.enabled feature flag.
package handlers

import (
    "net/http"
    "time"

    "github.com/kubilitics/kubilitics-backend/internal/ai/proxy"
    "github.com/kubilitics/kubilitics-backend/internal/ai/supervisor"
)

type Config struct {
    Enabled              bool
    ChatMaxDuration      time.Duration
    PerMessageIdle       time.Duration
}

type Handlers struct {
    sup supervisor.Supervisor
    pxy *proxy.Proxy
    cfg Config
}

func New(sup supervisor.Supervisor, pxy *proxy.Proxy, cfg Config) *Handlers {
    return &Handlers{sup: sup, pxy: pxy, cfg: cfg}
}

// Register installs all four endpoints. Designed to accept either the
// gorilla/mux router used by the rest of kubilitics-backend (via its
// HandleFunc method) or stdlib http.ServeMux for tests.
func (h *Handlers) Register(mux interface {
    HandleFunc(pattern string, handler func(http.ResponseWriter, *http.Request))
}) {
    mux.HandleFunc("/api/v1/ai/status", h.GetStatus)
    mux.HandleFunc("/api/v1/ai/refresh", h.PostRefresh)
    mux.HandleFunc("/api/v1/ai/capabilities", h.GetCapabilities)
    mux.HandleFunc("/api/v1/ai/chat", h.GetChat)
}
```

- [ ] **Step 4: Implement status.go**

Create `internal/ai/handlers/status.go`:

```go
package handlers

import (
    "encoding/json"
    "net/http"

    "github.com/kubilitics/kubilitics-backend/internal/ai/types"
)

func (h *Handlers) GetStatus(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodGet {
        http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
        return
    }
    st := h.sup.Status()
    if !h.cfg.Enabled {
        st.DisabledReason = types.DisabledReasonAIDisabled
    }
    w.Header().Set("Content-Type", "application/json")
    _ = json.NewEncoder(w).Encode(st)
}
```

- [ ] **Step 5: Implement refresh.go**

Create `internal/ai/handlers/refresh.go`:

```go
package handlers

import (
    "encoding/json"
    "net/http"

    "github.com/kubilitics/kubilitics-backend/internal/ai/types"
)

func (h *Handlers) PostRefresh(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
        return
    }
    if !h.cfg.Enabled {
        w.Header().Set("Content-Type", "application/json")
        w.WriteHeader(http.StatusServiceUnavailable)
        _ = json.NewEncoder(w).Encode(map[string]string{"error": types.ErrAIDisabled.Error()})
        return
    }
    if err := h.pxy.Refresh(r.Context()); err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusAccepted)
    _ = json.NewEncoder(w).Encode(map[string]string{
        "spawn_id": h.sup.CurrentSpawnID(),
    })
}
```

- [ ] **Step 6: Run tests, expect PASS**

```bash
go test ./internal/ai/handlers/ -run "TestStatus|TestRefresh" -count=1 -v -timeout=60s
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add internal/ai/handlers/
git commit -m "feat(ai/handlers): /api/v1/ai/status + /refresh with feature-flag gating"
```

---

## Task 16: Handlers — Capabilities (read-only + ?warm)

**Files:**
- Create: `internal/ai/handlers/capabilities.go`
- Modify: `internal/ai/handlers/handlers_test.go`

- [ ] **Step 1: Write failing test**

Append to `internal/ai/handlers/handlers_test.go`:

```go
func TestCapabilitiesAIDisabled(t *testing.T) {
    sup := supervisor.New(supervisor.Config{BinaryPath: stubBinary(t)})
    p := proxy.New(sup, gate.NoOpGate{}, 60)
    h := New(sup, p, Config{Enabled: false, ChatMaxDuration: 30 * time.Second})
    mux := http.NewServeMux()
    h.Register(mux)
    srv := httptest.NewServer(mux)
    defer srv.Close()
    defer sup.Shutdown(nil)

    resp, _ := http.Get(srv.URL + "/api/v1/ai/capabilities?cluster_id=c1")
    var body map[string]any
    json.NewDecoder(resp.Body).Decode(&body)
    if body["disabled_reason"] != "ai_disabled" {
        t.Errorf("disabled_reason = %v, want ai_disabled", body["disabled_reason"])
    }
    if body["ready"] != false {
        t.Errorf("ready = %v, want false", body["ready"])
    }
}

func TestCapabilitiesMissingClusterID(t *testing.T) {
    srv, sup := newTestServer(t)
    defer srv.Close()
    defer sup.Shutdown(nil)

    resp, _ := http.Get(srv.URL + "/api/v1/ai/capabilities")
    if resp.StatusCode != 400 {
        t.Errorf("status = %d, want 400", resp.StatusCode)
    }
}

func TestCapabilitiesNeverStarted(t *testing.T) {
    srv, sup := newTestServer(t)
    defer srv.Close()
    defer sup.Shutdown(nil)

    resp, _ := http.Get(srv.URL + "/api/v1/ai/capabilities?cluster_id=c1")
    var body map[string]any
    json.NewDecoder(resp.Body).Decode(&body)
    if body["ready"] != false {
        t.Errorf("ready = %v, want false (sidecar never spawned)", body["ready"])
    }
    if body["disabled_reason"] != "never_started" {
        t.Errorf("disabled_reason = %v, want never_started", body["disabled_reason"])
    }
}

func TestCapabilitiesWarm(t *testing.T) {
    srv, sup := newTestServer(t)
    defer srv.Close()
    defer sup.Shutdown(nil)

    resp, err := http.Get(srv.URL + "/api/v1/ai/capabilities?cluster_id=c1&warm=true")
    if err != nil {
        t.Fatalf("get: %v", err)
    }
    var body map[string]any
    json.NewDecoder(resp.Body).Decode(&body)
    if body["ready"] != true {
        t.Errorf("ready = %v, want true", body["ready"])
    }
    if body["capabilities"] == nil {
        t.Errorf("capabilities should be populated after warm")
    }
}
```

- [ ] **Step 2: Run test, expect compile/missing-route failure**

```bash
go test ./internal/ai/handlers/ -run TestCapabilities -count=1
```

Expected: failure (route not implemented).

- [ ] **Step 3: Implement capabilities.go**

Create `internal/ai/handlers/capabilities.go`:

```go
package handlers

import (
    "encoding/json"
    "net/http"

    "github.com/kubilitics/kubilitics-backend/internal/ai/types"
)

type capsResponse struct {
    Ready          bool                  `json:"ready"`
    Capabilities   any                   `json:"capabilities"`
    DisabledReason string                `json:"disabled_reason,omitempty"`
    State          string                `json:"state"`
}

func (h *Handlers) GetCapabilities(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodGet {
        http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
        return
    }
    w.Header().Set("Content-Type", "application/json")

    if !h.cfg.Enabled {
        _ = json.NewEncoder(w).Encode(capsResponse{
            Ready:          false,
            DisabledReason: types.DisabledReasonAIDisabled,
            State:          "stopped",
        })
        return
    }

    clusterID := r.URL.Query().Get("cluster_id")
    if clusterID == "" {
        http.Error(w, types.ErrMissingCluster.Error(), http.StatusBadRequest)
        return
    }

    warm := r.URL.Query().Get("warm") == "true"
    st := h.sup.Status()

    if warm {
        // Spawn (or reuse) sidecar so first chat avoids cold-start.
        snap, err := h.pxy.GetCapabilities(r.Context(), clusterID)
        if err != nil {
            _ = json.NewEncoder(w).Encode(capsResponse{
                Ready: false, DisabledReason: err.Error(), State: h.sup.Status().State.String(),
            })
            return
        }
        _ = json.NewEncoder(w).Encode(capsResponse{
            Ready: true, Capabilities: snap.Capabilities, State: h.sup.Status().State.String(),
        })
        return
    }

    // Read-only path: never spawn.
    if st.State != types.StateReady {
        _ = json.NewEncoder(w).Encode(capsResponse{
            Ready: false, DisabledReason: types.DisabledReasonNeverStarted, State: st.State.String(),
        })
        return
    }
    snap, err := h.pxy.GetCapabilities(r.Context(), clusterID)
    if err != nil {
        _ = json.NewEncoder(w).Encode(capsResponse{
            Ready: false, DisabledReason: err.Error(), State: st.State.String(),
        })
        return
    }
    _ = json.NewEncoder(w).Encode(capsResponse{
        Ready: true, Capabilities: snap.Capabilities, State: st.State.String(),
    })
}
```

- [ ] **Step 4: Run tests, expect PASS**

```bash
go test ./internal/ai/handlers/ -run TestCapabilities -count=1 -v -timeout=60s
```

Expected: all four `TestCapabilities*` PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/ai/handlers/capabilities.go internal/ai/handlers/handlers_test.go
git commit -m "feat(ai/handlers): /capabilities — read-only default + ?warm + 400 on missing cluster"
```

---

## Task 17: Handlers — Chat WS Upgrade

**Files:**
- Create: `internal/ai/handlers/chat.go`
- Modify: `internal/ai/handlers/handlers_test.go`

> **Frame format:** JSON `{"type": "<assistant_event_kind>", "payload": {...}}`. Inbound (client→server) frame: `{"type": "user_message", "payload": {"text": "..."}}`. Outbound (server→client): one frame per `AssistantEvent` oneof variant. Strict: unknown inbound `type` → close 1003.

- [ ] **Step 1: Write failing test**

Append to `internal/ai/handlers/handlers_test.go`:

```go
import "github.com/gorilla/websocket"

// (place the import alongside the existing imports)

func TestChatMissingClusterID(t *testing.T) {
    srv, sup := newTestServer(t)
    defer srv.Close()
    defer sup.Shutdown(nil)

    wsURL := "ws" + srv.URL[len("http"):] + "/api/v1/ai/chat"
    _, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
    if err == nil {
        t.Fatalf("expected dial failure, got success")
    }
    if resp == nil || resp.StatusCode != 400 {
        t.Fatalf("status = %v, want 400", resp)
    }
}
```

- [ ] **Step 2: Run test, expect failure**

```bash
go test ./internal/ai/handlers/ -run TestChatMissingClusterID -count=1
```

Expected: failure (route returns 404).

- [ ] **Step 3: Implement chat.go**

Create `internal/ai/handlers/chat.go`:

```go
package handlers

import (
    "encoding/json"
    "net/http"

    "github.com/gorilla/websocket"
    "github.com/kubilitics/kubilitics-backend/internal/ai/proxy"
    "github.com/kubilitics/kubilitics-backend/internal/ai/types"

    kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
)

var upgrader = websocket.Upgrader{
    CheckOrigin: func(r *http.Request) bool { return true }, // origin is enforced upstream by middleware
}

type wsFrame struct {
    Type    string          `json:"type"`
    Payload json.RawMessage `json:"payload"`
}

type userMessagePayload struct {
    Text string `json:"text"`
}

func (h *Handlers) GetChat(w http.ResponseWriter, r *http.Request) {
    if !h.cfg.Enabled {
        http.Error(w, types.ErrAIDisabled.Error(), http.StatusServiceUnavailable)
        return
    }
    clusterID := r.URL.Query().Get("cluster_id")
    if clusterID == "" {
        http.Error(w, types.ErrMissingCluster.Error(), http.StatusBadRequest)
        return
    }
    conn, err := upgrader.Upgrade(w, r, nil)
    if err != nil {
        return // upgrader writes its own response
    }
    defer conn.Close()

    ctx := proxy.WithUser(r.Context(), userIDFromRequest(r))

    // Open the chat stream.
    stream, _, err := h.pxy.Chat(ctx, clusterID, &kotgv1.ChatRequest{}, h.cfg.ChatMaxDuration)
    if err != nil {
        _ = conn.WriteJSON(wsFrame{Type: "error", Payload: jsonString(err.Error())})
        _ = conn.WriteControl(websocket.CloseMessage,
            websocket.FormatCloseMessage(websocket.CloseInternalServerErr, err.Error()),
            timeNowPlusSec(2))
        return
    }

    // server→client pump
    done := make(chan struct{})
    go func() {
        defer close(done)
        for {
            ev, err := stream.Recv()
            if err != nil {
                _ = conn.WriteJSON(wsFrame{Type: "done", Payload: jsonString(err.Error())})
                return
            }
            payload, _ := json.Marshal(ev)
            // type tag is the AssistantEvent oneof variant name; default to "event".
            _ = conn.WriteJSON(wsFrame{Type: assistantEventType(ev), Payload: payload})
        }
    }()

    // client→server pump (inbound frames)
    for {
        var frame wsFrame
        if err := conn.ReadJSON(&frame); err != nil {
            break
        }
        switch frame.Type {
        case "user_message":
            var p userMessagePayload
            if err := json.Unmarshal(frame.Payload, &p); err != nil {
                _ = conn.WriteControl(websocket.CloseMessage,
                    websocket.FormatCloseMessage(1003, "invalid user_message"),
                    timeNowPlusSec(2))
                break
            }
            _ = stream.SendMsg(&kotgv1.ChatRequest{Text: p.Text})
        default:
            _ = conn.WriteControl(websocket.CloseMessage,
                websocket.FormatCloseMessage(1003, "unknown frame type"),
                timeNowPlusSec(2))
            return
        }
    }
    <-done
}

func userIDFromRequest(r *http.Request) string {
    // The kubilitics auth middleware places the user identity in the
    // request context under a known key. For tests + early integration we
    // fall back to a header so the contract is testable without spinning
    // up the full auth stack.
    if uid := r.Header.Get("X-Kubilitics-User-ID"); uid != "" {
        return uid
    }
    return "anonymous"
}

func jsonString(s string) json.RawMessage {
    b, _ := json.Marshal(s)
    return b
}
```

> **Type-name verification:** confirm `kotgv1.ChatRequest` has a `Text` field (or whatever the user-message field is actually named in `chat.proto`); confirm `stream.SendMsg(...)` is the correct way to send a request on the chosen RPC type. If the chat RPC is server-streaming-only, the client cannot Send mid-stream — in that case open one stream per user message instead.

- [ ] **Step 4: Add helper for time + event-type mapper**

Append to `internal/ai/handlers/chat.go`:

```go
import "time" // (add to existing import block, do not duplicate)

func timeNowPlusSec(s int) time.Time { return time.Now().Add(time.Duration(s) * time.Second) }

// assistantEventType returns the lowercase oneof variant name for the
// AssistantEvent. Used as the WS frame "type" tag.
func assistantEventType(ev *kotgv1.AssistantEvent) string {
    switch ev.GetEvent().(type) {
    case *kotgv1.AssistantEvent_TextDelta:    return "text_delta"
    case *kotgv1.AssistantEvent_ToolStart:    return "tool_start"
    case *kotgv1.AssistantEvent_ToolEnd:      return "tool_end"
    case *kotgv1.AssistantEvent_ActionPending: return "action_pending"
    case *kotgv1.AssistantEvent_PlanProposed:  return "plan_proposed"
    case *kotgv1.AssistantEvent_Citation:      return "citation"
    case *kotgv1.AssistantEvent_ErrorEvent:    return "error"
    case *kotgv1.AssistantEvent_Done:          return "done"
    default:                                   return "event"
    }
}
```

> **Type-name verification:** the oneof field accessor is generally `GetEvent()` if the oneof is named `event`. Inspect `~/code/kotg-schema/gen/go/kotg/v1/chat.pb.go` for the actual accessor name and the wrapper type names (`AssistantEvent_TextDelta` etc.). Adjust accordingly.

- [ ] **Step 5: Run test, expect PASS**

```bash
go test ./internal/ai/handlers/ -run TestChatMissingClusterID -count=1 -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/ai/handlers/chat.go internal/ai/handlers/handlers_test.go
git commit -m "feat(ai/handlers): /chat WS upgrade with cluster_id enforce + bidi proto-to-JSON pump"
```

---

## Task 18: Wire Into `cmd/server/main.go`

**Files:**
- Modify: `cmd/server/main.go`

- [ ] **Step 1: Locate route-registration block**

```bash
grep -n "router.HandleFunc.*ai\|ai.Enabled\|/api/v1/ai" cmd/server/main.go
```

Expected: no current AI routes. Locate the section near line 620–640 where existing `/api/v1/...` routes are registered.

- [ ] **Step 2: Add AI bootstrap above the route block**

Find the line where `apiRouter` (or similar) is finished being populated. Insert just below the imports block:

```go
import (
    // ... existing imports ...
    aihandlers "github.com/kubilitics/kubilitics-backend/internal/ai/handlers"
    aigate "github.com/kubilitics/kubilitics-backend/internal/ai/gate"
    aiproxy "github.com/kubilitics/kubilitics-backend/internal/ai/proxy"
    aisup "github.com/kubilitics/kubilitics-backend/internal/ai/supervisor"
)
```

After the existing handler/repository wiring and before the route registration, add:

```go
var aiSupervisor aisup.Supervisor
if cfg.AI.Enabled {
    aiSupervisor = aisup.New(aisup.Config{
        BinaryPath:         cfg.AI.BinaryPath,
        IdleShutdown:       time.Duration(cfg.AI.IdleShutdownSeconds) * time.Second,
        MaxRestartAttempts: cfg.AI.MaxRestartAttempts,
        RestartWindow:      time.Duration(cfg.AI.RestartWindowSeconds) * time.Second,
    })
    aiPxy := aiproxy.New(aiSupervisor, aigate.NoOpGate{}, cfg.AI.RateLimitPerUserPerMin)
    aiH := aihandlers.New(aiSupervisor, aiPxy, aihandlers.Config{
        Enabled:         cfg.AI.Enabled,
        ChatMaxDuration: time.Duration(cfg.AI.ChatMaxDurationSeconds) * time.Second,
        PerMessageIdle:  time.Duration(cfg.AI.PerMessageIdleSeconds) * time.Second,
    })
    aiH.Register(router)
    log.Printf("[ai] enabled (binary=%q, idle=%ds)", cfg.AI.BinaryPath, cfg.AI.IdleShutdownSeconds)
} else {
    // Even when disabled we register the status + capabilities endpoints
    // so the desktop can probe and render an "AI: Off" pill consistently.
    aiSupervisor = aisup.New(aisup.Config{})
    aiPxy := aiproxy.New(aiSupervisor, aigate.NoOpGate{}, 0)
    aiH := aihandlers.New(aiSupervisor, aiPxy, aihandlers.Config{Enabled: false})
    aiH.Register(router)
    log.Printf("[ai] disabled (ai.enabled=false)")
}
```

> **Note:** the `Register` adapter on `Handlers` accepts anything with a `HandleFunc(string, func(http.ResponseWriter, *http.Request))` method. `gorilla/mux.Router.HandleFunc` returns `*mux.Route`, not `void`, so the interface signature in `handlers.go` must accept the broader signature — verify the test passes locally and adjust the interface to `HandleFunc(string, func(http.ResponseWriter, *http.Request)) *mux.Route` if needed, or wrap router calls inline.

- [ ] **Step 3: Add graceful shutdown hook**

Find the existing graceful-shutdown block (`server.Shutdown(...)` near the bottom of `main`). After it returns, add:

```go
if aiSupervisor != nil {
    sctx, scancel := context.WithTimeout(context.Background(), 10*time.Second)
    _ = aiSupervisor.Shutdown(sctx)
    scancel()
}
```

- [ ] **Step 4: Build and run, sanity check**

```bash
go build ./cmd/server/
./server --help 2>&1 | head -5 || true   # just confirm it starts
```

Then manually verify (with `ai.enabled: false`):

```bash
KUBILITICS_AI_ENABLED=false go run ./cmd/server/ &
sleep 2
curl -s http://127.0.0.1:8080/api/v1/ai/status | head -c 200
kill %1
```

Expected: JSON response with `"disabled_reason":"ai_disabled"`. Adjust port if your dev config differs.

- [ ] **Step 5: Run full suite**

```bash
go test ./... -count=1 -timeout=180s
```

Expected: all tests PASS (existing + new AI tests).

- [ ] **Step 6: Commit**

```bash
git add cmd/server/main.go
git commit -m "feat(ai): wire supervisor+proxy+handlers into server (gated on ai.enabled)"
```

---

## Task 19: Helm Values + ConfigMap Surface

**Files:**
- Modify: `deploy/helm/kubilitics/values.yaml`
- Modify: `deploy/helm/kubilitics/templates/configmap.yaml`

- [ ] **Step 1: Add ai block to values.yaml**

Locate the existing config block in `deploy/helm/kubilitics/values.yaml` (likely under a top-level `config:` or similar key). Append:

```yaml
# AI sidecar (kotg-ai-server) configuration. Disabled by default until
# subprojects 3-6 of the AI integration arc are merged.
ai:
  enabled: false
  binaryPath: ""
  idleShutdownSeconds: 900
  chatMaxDurationSeconds: 600
  perMessageIdleSeconds: 60
  maxRestartAttempts: 5
  restartWindowSeconds: 300
  rateLimitPerUserPerMin: 30
```

- [ ] **Step 2: Surface ai.* in configmap.yaml**

In `deploy/helm/kubilitics/templates/configmap.yaml`, find where backend config is composed (likely a `data:` block emitting YAML/JSON). Add:

```yaml
    ai:
      enabled: {{ .Values.ai.enabled }}
      binary_path: {{ .Values.ai.binaryPath | quote }}
      idle_shutdown_seconds: {{ .Values.ai.idleShutdownSeconds }}
      chat_max_duration_seconds: {{ .Values.ai.chatMaxDurationSeconds }}
      per_message_idle_seconds: {{ .Values.ai.perMessageIdleSeconds }}
      max_restart_attempts: {{ .Values.ai.maxRestartAttempts }}
      restart_window_seconds: {{ .Values.ai.restartWindowSeconds }}
      rate_limit_per_user_per_min: {{ .Values.ai.rateLimitPerUserPerMin }}
```

> If the existing configmap uses a different format (env vars, JSON, etc.), translate the same keys to that format. The mapstructure tag in `AIConfig` (`ai.enabled`, etc.) is the source of truth.

- [ ] **Step 3: Validate Helm template render**

```bash
cd /Users/koti/myFuture/Kubernetes/kubilitics
helm template deploy/helm/kubilitics --set ai.enabled=true --set ai.binaryPath=/opt/ai/kotg-ai-server > /tmp/render.yaml
grep -A 8 "ai:" /tmp/render.yaml
```

Expected: rendered YAML shows `enabled: true` and the supplied path.

- [ ] **Step 4: Lint**

```bash
helm lint deploy/helm/kubilitics
```

Expected: no errors. (Warnings about icons/maintainers are pre-existing and acceptable.)

- [ ] **Step 5: Commit**

```bash
cd .worktrees/ai-supervisor
git add deploy/helm/kubilitics/values.yaml deploy/helm/kubilitics/templates/configmap.yaml
git commit -m "feat(helm): surface ai.* config block (disabled by default)"
```

---

## Task 20: End-to-End Smoke (manual checklist)

**Files:** (no files; verification only)

- [ ] **Step 1: Build full server**

```bash
cd .worktrees/ai-supervisor/kubilitics-backend
go build -o /tmp/server ./cmd/server/
```

- [ ] **Step 2: Build stub binary into a stable location**

```bash
go build -o /tmp/kotg-ai-server ./internal/ai/supervisor/testdata/stubsidecar
```

- [ ] **Step 3: Start server with AI on, pointing at the stub**

```bash
KUBILITICS_AI_ENABLED=true \
KUBILITICS_AI_BINARY_PATH=/tmp/kotg-ai-server \
/tmp/server &
sleep 2
```

- [ ] **Step 4: Probe each endpoint**

```bash
curl -s "http://127.0.0.1:8080/api/v1/ai/status" | python3 -m json.tool
curl -s "http://127.0.0.1:8080/api/v1/ai/capabilities?cluster_id=c1" | python3 -m json.tool
curl -s "http://127.0.0.1:8080/api/v1/ai/capabilities?cluster_id=c1&warm=true" | python3 -m json.tool
curl -s -X POST "http://127.0.0.1:8080/api/v1/ai/refresh" -i | head -5
```

Expected:
- `/status` shows `state` flipping between `stopped` and `ready` as you hit `?warm=true`.
- `/capabilities?cluster_id=c1` first returns `ready:false, disabled_reason:never_started`.
- `/capabilities?cluster_id=c1&warm=true` returns `ready:true, capabilities:{provider:"stub", ...}`.
- `/refresh` returns 202 with a new `spawn_id`.

- [ ] **Step 5: Probe missing cluster_id**

```bash
curl -s -i "http://127.0.0.1:8080/api/v1/ai/capabilities" | head -3
```

Expected: `HTTP/1.1 400 Bad Request`.

- [ ] **Step 6: Probe with AI disabled**

```bash
kill %1
KUBILITICS_AI_ENABLED=false /tmp/server &
sleep 2
curl -s "http://127.0.0.1:8080/api/v1/ai/capabilities?cluster_id=c1" | python3 -m json.tool
kill %1
```

Expected: `disabled_reason:"ai_disabled"`, `ready:false`.

- [ ] **Step 7: Document the smoke result in the PR description (later)**

This is a manual verification step — there's nothing to commit. The implementer should paste the four curl outputs into the PR body when opening the PR.

---

## Task 21: Memory Snapshot

**Files:**
- Create: `~/.claude/projects/-Users-koti-myFuture-Kubernetes-kubilitics/memory/project_ai_supervisor_status.md`
- Modify: `~/.claude/projects/-Users-koti-myFuture-Kubernetes-kubilitics/memory/MEMORY.md`

- [ ] **Step 1: Write project memory**

Create the memory file with status of subproject 2 (so future sessions inherit it without re-reading the spec):

```markdown
---
name: AI sidecar supervisor (subproject 2) — built
description: Subproject 2 of the AI integration arc shipped to feat/ai-supervisor on vellankikoti/kubilitics. Supervisor + proxy + handlers + Helm values, all gated behind ai.enabled feature flag (default off). Tested with stub kotg-ai-server.
type: project
---

**Status:** Built on branch `feat/ai-supervisor`. Default `ai.enabled: false` everywhere, so merging to main does not expose AI surface area to existing users.

**What's in:**
- `internal/ai/supervisor/` — process lifecycle, ephemeral mTLS, idle shutdown, crash backoff.
- `internal/ai/proxy/` — cluster_id enforcement, metadata injection, SpawnID guard, prometheus metrics, per-user rate limit.
- `internal/ai/gate/` — ActionGate interface + NoOpGate (subproject 3 plugs the real gate).
- `internal/ai/handlers/` — /api/v1/ai/{status,capabilities,chat,refresh}.
- `deploy/helm/kubilitics/values.yaml` + configmap — `ai.*` block.
- Stub binary at `internal/ai/supervisor/testdata/stubsidecar/` for tests until real kotg-ai-server lands.

**What's NOT in (later subprojects):**
- Real LLM-backed kotg-ai-server (subproject 4) — supervisor is provider-agnostic by design.
- Real ActionGate with approval/audit/RBAC (subproject 3) — NoOpGate placeholder.
- Chat panel UI (subproject 5) — backend WS endpoint is contract-stable.
- Tauri sidecar packaging (subproject 7) and Helm sub-chart (subproject 8) for the AI binary.

**How to apply:** when starting any of subprojects 3–8, the supervisor's contract is locked. Subproject 3 swaps `aigate.NoOpGate{}` in `cmd/server/main.go` for the real gate without touching supervisor or proxy.
```

- [ ] **Step 2: Add to MEMORY.md index**

Append one line to `~/.claude/projects/-Users-koti-myFuture-Kubernetes-kubilitics/memory/MEMORY.md`:

```
- [AI Supervisor Built](project_ai_supervisor_status.md) — Subproject 2 done on feat/ai-supervisor. Supervisor+proxy+handlers, ai.enabled defaults off. NoOpGate placeholder for subproject 3.
```

- [ ] **Step 3: No commit**

Memory files are not in the repo.

---

## Self-Review (filled in)

**Spec coverage:**

| Spec section | Tasks |
|---|---|
| §1 Locked Decisions (1–6) | T1 (config flag), T4–T11 (supervisor), T14 (proxy cluster enforce + metadata), T15–T17 (handlers), T19 (helm) |
| §2 Architecture / package layout | T1–T17 follow exact paths |
| §3 Sidecar Supervisor (state machine, spawn, idle, crash, refresh, binary discovery) | T5, T6, T7, T9, T10, T11 |
| §4 Proxy (cluster enforce, metadata, SpawnID, rate limit, observability, timeouts, ActionGate) | T3, T12, T13, T14 |
| §5 Handlers (capabilities, chat, status, refresh; cluster enforce; WS framing; ai_disabled) | T15, T16, T17 |
| §6 Desktop integration | Out of scope (covered by subproject 5 — chat panel UI consumes the WS). Backend contract verified by handler tests + manual smoke (T20). |
| §7 Configuration (full ai.* block) | T1, T19 |
| §8 Testing pyramid (unit, supervisor int, proxy int, handler int, crash/recovery int) | T1, T4, T5–T7 (unit), T8 (stub), T9–T11 (supervisor int), T14 (proxy int), T15–T17 (handler int). Crash/recovery int is exercised implicitly by the backoff unit test (T6) + supervisor test (T11) — extending it to mid-stream crash is acceptable but not required for v1; the stub doesn't exit on signal in current form. |
| §9 Rollout (feature flag, internal dogfood, helm values, beta tag) | T1 (flag), T18 (wired off by default), T19 (helm), T20 (manual smoke). Beta tagging is a separate release task, not part of this plan. |
| §10 Out of scope | Honored throughout. |

**Placeholder scan:** none of the listed forbidden patterns appear. Type-name verification notes are explicit (Tasks 3, 8, 10, 14, 17).

**Type consistency:** `Supervisor` interface methods, `Config` field names, `ReadyConn` / `SidecarStatus` shapes are identical across T2, T11, T14, T15. `CapabilitiesSnapshot` shape consistent T2 → T11 → T16.

**Known caveats:**
- Tasks 3, 8, 10, 14, 17 contain explicit type-name verification notes against the actual generated kotg-schema code. The implementer must run the suggested grep before writing each file. This is honest about what we don't know without inspecting the .pb.go output, and avoids guessing.
- Crash-mid-stream test is not separately authored; if needed, extend the stub to exit on a SIGUSR1 signal and assert proxy stream returns `Aborted`.
- T18 wiring assumes `gorilla/mux.Router` is in scope as `router`; if the actual variable name differs, adjust.
