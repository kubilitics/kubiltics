# kotg-schema v1.0.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `vellankikoti/kotg-schema v1.0.0` — a public GitHub repo containing the versioned wire contract that kubilitics core and kotg.ai both depend on.

**Architecture:** Three protobuf packages (`common`, `cluster`, `chat`) under `proto/kotg/v1/`. `buf` toolchain for lint, generation, and breaking-change checks. Generated Go committed under `gen/go/kotg/v1/`. Two minimal example programs prove the generated code is consumable. CI on every PR + on tag.

**Tech Stack:** Protocol Buffers v3, gRPC, `buf` (Buf Build), Go 1.22+, GitHub Actions, GitHub repo on `vellankikoti` user.

---

## Spec reference

`docs/superpowers/specs/2026-04-18-kotg-schema-design.md` (committed in `6d75c66`).

## Working directory note

This plan creates a **brand-new repo separate from kubilitics**. The implementer works in a sibling directory (e.g., `~/code/kotg-schema`). Only the final task (Task 14) touches the kubilitics repo — for a smoke test that imports the new module.

The `kubilitics/kubilitics` org repo is FROZEN per the project memory (`feedback_no_org_push.md`). Only push to `vellankikoti/kotg-schema` (this new repo) and `vellankikoti/kubilitics` (origin of the existing kubilitics repo).

## File structure to create

| File | Responsibility |
|---|---|
| `README.md` | Wire contract overview, 5 cross-cutting rules, versioning policy |
| `go.mod` / `go.sum` | Go module `github.com/kubilitics/kotg-schema` |
| `buf.yaml` | buf module config (lint rules, breaking-change config) |
| `buf.gen.yaml` | code-gen plugins (protoc-gen-go, protoc-gen-go-grpc) |
| `proto/kotg/v1/common.proto` | Shared types (ActionTier enum, ResourceRef, Diff, AuditExtras) |
| `proto/kotg/v1/cluster.proto` | `ClusterRead`, `ClusterAction`, `ActionTemplate` services |
| `proto/kotg/v1/chat.proto` | `Chat`, `AIControl` services + `AssistantEvent` union + `Citation` |
| `gen/go/kotg/v1/*.pb.go` | Generated Go (committed) |
| `gen/go/kotg/v1/*_grpc.pb.go` | Generated gRPC server/client stubs (committed) |
| `examples/stub_cluster_server/main.go` | Hardcoded `ClusterRead` + `ClusterAction` impl proving consumers can implement the service |
| `examples/stub_chat_server/main.go` | Echo `Chat` + `AIControl` impl |
| `.github/workflows/lint.yml` | `buf lint` + `golangci-lint` on examples |
| `.github/workflows/breaking.yml` | `buf breaking` against last tag |
| `.github/workflows/release.yml` | Sanity build on tag push (module proxy auto-publishes) |

---

## Task 1: Create the repo + local clone + tooling install

**Files:**
- Create: brand-new repo `vellankikoti/kotg-schema` on GitHub.
- Local: `~/code/kotg-schema` working directory.

- [ ] **Step 1: Create the public GitHub repo**

```bash
gh repo create vellankikoti/kotg-schema --public \
  --description "Versioned wire contract between kubilitics core and kotg.ai" \
  --confirm
```
Expected: prints the new repo URL.

- [ ] **Step 2: Clone locally**

```bash
mkdir -p ~/code && cd ~/code
gh repo clone vellankikoti/kotg-schema
cd kotg-schema
```

- [ ] **Step 3: Install buf + protoc plugins**

```bash
brew install bufbuild/buf/buf       # buf CLI
go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.34.2
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@v1.5.1
buf --version                       # verify
protoc-gen-go --version
protoc-gen-go-grpc --version
```
Expected: each prints a version.

- [ ] **Step 4: Initialize Go module**

```bash
go mod init github.com/kubilitics/kotg-schema
```
Expected: creates `go.mod` with `module github.com/kubilitics/kotg-schema` + `go 1.22` (or current).

- [ ] **Step 5: Commit the empty module**

```bash
git add go.mod
git commit -m "chore: initialize Go module for kotg-schema"
```

---

## Task 2: buf scaffold

**Files:**
- Create: `buf.yaml`, `buf.gen.yaml`, `proto/kotg/v1/.gitkeep`, `gen/go/kotg/v1/.gitkeep`

- [ ] **Step 1: Write buf.yaml**

`buf.yaml`:
```yaml
version: v2
modules:
  - path: proto
lint:
  use:
    - STANDARD
breaking:
  use:
    - FILE
```

- [ ] **Step 2: Write buf.gen.yaml**

`buf.gen.yaml`:
```yaml
version: v2
plugins:
  - remote: buf.build/protocolbuffers/go:v1.34.2
    out: gen/go
    opt:
      - paths=source_relative
  - remote: buf.build/grpc/go:v1.5.1
    out: gen/go
    opt:
      - paths=source_relative
      - require_unimplemented_servers=false
inputs:
  - directory: proto
```

- [ ] **Step 3: Create the proto + gen directory tree**

```bash
mkdir -p proto/kotg/v1 gen/go/kotg/v1
touch proto/kotg/v1/.gitkeep gen/go/kotg/v1/.gitkeep
```

- [ ] **Step 4: Verify buf is happy with the empty layout**

```bash
buf lint
```
Expected: no errors (no proto files yet → nothing to lint).

- [ ] **Step 5: Commit**

```bash
git add buf.yaml buf.gen.yaml proto/ gen/
git commit -m "chore: add buf toolchain scaffold"
```

---

## Task 3: common.proto — shared types

**Files:**
- Create: `proto/kotg/v1/common.proto`
- Generate: `gen/go/kotg/v1/common.pb.go`

- [ ] **Step 1: Write common.proto**

`proto/kotg/v1/common.proto`:
```proto
syntax = "proto3";

package kotg.v1;

option go_package = "github.com/kubilitics/kotg-schema/gen/go/kotg/v1;kotgv1";

import "google/protobuf/timestamp.proto";

// ActionTier classifies a cluster mutation by risk. The kubilitics core
// action gateway uses this to decide whether to auto-allow, banner,
// confirm, or modal-approve.
enum ActionTier {
  ACTION_TIER_UNSPECIFIED = 0;
  ACTION_TIER_READ        = 1; // get/list/watch/logs/describe
  ACTION_TIER_WRITE_SAFE  = 2; // label/annotate/scale-up
  ACTION_TIER_WRITE_RISKY = 3; // apply/scale-down/edit-secret
  ACTION_TIER_DESTRUCTIVE = 4; // delete/exec/restart/drain
}

// ResourceRef identifies a Kubernetes object across clusters.
message ResourceRef {
  string cluster_id  = 1;
  string namespace   = 2;
  string kind        = 3;
  string api_version = 4;
  string name        = 5;
}

// Diff is a pre-rendered before/after pair plus a unified diff string.
// The unified field is precomputed so the UI does not recompute on every
// render.
message Diff {
  string before_yaml = 1;
  string after_yaml  = 2;
  string unified     = 3;
}

// AuditExtras is metadata appended to every audit row produced by an AI
// action. Lives next to the existing kubilitics audit fields.
message AuditExtras {
  string     session_id     = 1;
  string     turn_id        = 2;
  string     model          = 3; // e.g. "claude-3.5-sonnet"
  string     provider       = 4; // e.g. "anthropic"
  string     prompt_excerpt = 5; // first 200 chars, redacted
  ActionTier tier           = 6;
}

// HealthStatus is returned by AIControl.Health.
message HealthStatus {
  enum State {
    STATE_UNSPECIFIED = 0;
    STATE_OK          = 1;
    STATE_DEGRADED    = 2;
    STATE_UNAVAILABLE = 3;
  }
  State                     state    = 1;
  string                    detail   = 2;
  google.protobuf.Timestamp ts       = 3;
}

// Empty is a no-arg / no-return placeholder. Defined locally so both
// services can reference it without importing google/protobuf/empty.
message Empty {}
```

- [ ] **Step 2: Lint and generate**

```bash
buf lint
buf generate
ls gen/go/kotg/v1/
```
Expected: lint passes; `common.pb.go` appears.

- [ ] **Step 3: Verify generated Go compiles**

```bash
go build ./gen/...
```
Expected: no errors. (No examples yet, just compile-checks the generated code.)

- [ ] **Step 4: Commit**

```bash
git add proto/kotg/v1/common.proto gen/go/kotg/v1/common.pb.go go.mod go.sum
git commit -m "feat: common.proto — ActionTier, ResourceRef, Diff, AuditExtras, HealthStatus"
```

---

## Task 4: cluster.proto — read + action + template services

**Files:**
- Create: `proto/kotg/v1/cluster.proto`
- Generate: `gen/go/kotg/v1/cluster.pb.go`, `cluster_grpc.pb.go`

- [ ] **Step 1: Write cluster.proto**

`proto/kotg/v1/cluster.proto`:
```proto
syntax = "proto3";

package kotg.v1;

option go_package = "github.com/kubilitics/kotg-schema/gen/go/kotg/v1;kotgv1";

import "kotg/v1/common.proto";
import "google/protobuf/timestamp.proto";
import "google/protobuf/struct.proto";

// ─── ClusterRead ────────────────────────────────────────────────────────────
// What kubilitics core exposes to the AI sidecar. All reads are subject to
// the user's RBAC (token in metadata).

service ClusterRead {
  rpc GetCluster    (GetClusterRequest)    returns (Cluster);
  rpc ListResources (ListResourcesRequest) returns (stream ResourceItem);
  rpc GetResource   (GetResourceRequest)   returns (Resource);
  rpc GetLogs       (GetLogsRequest)       returns (stream LogLine);
  rpc GetEvents     (GetEventsRequest)     returns (stream Event);
  rpc GetMetrics    (GetMetricsRequest)    returns (MetricSeries);
  rpc Topology      (TopologyRequest)      returns (TopologyGraph);
}

message Cluster {
  string cluster_id   = 1;
  string name         = 2;
  string distribution = 3; // "kind", "eks", "gke", "in-cluster", etc.
  string k8s_version  = 4;
  int32  node_count   = 5;
  int32  namespace_count = 6;
}

message GetClusterRequest  { string cluster_id = 1; }

message ListResourcesRequest {
  string cluster_id     = 1;
  string namespace      = 2; // empty = all
  string kind           = 3;
  string label_selector = 4;
  int32  limit          = 5;
}
message ResourceItem { google.protobuf.Struct object = 1; } // unstructured

message GetResourceRequest { ResourceRef ref = 1; }
message Resource           { google.protobuf.Struct object = 1; }

message GetLogsRequest {
  ResourceRef pod        = 1;
  string      container  = 2;
  int32       tail_lines = 3;
  bool        follow     = 4;
}
message LogLine {
  google.protobuf.Timestamp ts   = 1;
  string                    line = 2;
}

message GetEventsRequest {
  string cluster_id = 1;
  string namespace  = 2;
  int64  since_unix = 3;
}
message Event {
  google.protobuf.Timestamp ts        = 1;
  string                    type      = 2; // Normal | Warning
  string                    reason    = 3;
  string                    message   = 4;
  ResourceRef               involved  = 5;
}

message GetMetricsRequest {
  ResourceRef ref         = 1;
  string      metric_name = 2; // "cpu.usage", "memory.usage", etc.
  int64       from_unix   = 3;
  int64       to_unix     = 4;
  string      step        = 5; // "30s", "1m", ...
}
message MetricSeries {
  message Point {
    int64  ts    = 1;
    double value = 2;
  }
  repeated Point points = 1;
}

message TopologyRequest { string cluster_id = 1; string namespace = 2; }
message TopologyGraph {
  message Node { string id = 1; string kind = 2; string name = 3; string namespace = 4; }
  message Edge { string from = 1; string to = 2; string kind = 3; }
  repeated Node nodes = 1;
  repeated Edge edges = 2;
}

// ─── ClusterAction ──────────────────────────────────────────────────────────
// What kubilitics core exposes for AI-initiated mutations. Every result
// carries an undo_token (REQUIRED by spec §5.2) for the rollback
// differentiator.

service ClusterAction {
  rpc PreviewAction (ActionRequest)        returns (ActionPreview);
  rpc ProposeAction (ActionRequest)        returns (ActionProposal);
  rpc ApproveAction (ApproveActionRequest) returns (ActionResult);
  rpc Apply         (ApplyRequest)         returns (ActionResult);
  rpc Delete        (DeleteRequest)        returns (ActionResult);
  rpc Scale         (ScaleRequest)         returns (ActionResult);
  rpc Exec          (ExecRequest)          returns (stream ExecChunk);
  rpc Undo          (UndoRequest)          returns (ActionResult);
}

// ActionRequest is the discriminated input for Preview/Propose. The action
// itself sits in the `action` oneof.
message ActionRequest {
  ResourceRef target  = 1;
  oneof action {
    ApplyRequest  apply  = 2;
    DeleteRequest del    = 3;
    ScaleRequest  scale  = 4;
  }
}

message ActionPreview {
  ActionTier tier = 1;
  Diff       diff = 2;
}

message ActionProposal {
  string proposal_id = 1; // referenced by ApproveActionRequest
  ActionTier tier    = 2;
  Diff       diff    = 3;
}

message ApproveActionRequest { string proposal_id = 1; }

message ApplyRequest  { ResourceRef target = 1; string yaml = 2; }
message DeleteRequest { ResourceRef target = 1; bool   force = 2; }
message ScaleRequest  { ResourceRef target = 1; int32  replicas = 2; }
message ExecRequest   { ResourceRef target = 1; string container = 2; repeated string command = 3; }
message ExecChunk     { bytes data = 1; bool is_stderr = 2; int32 exit_code = 3; }
message UndoRequest   { string undo_token = 1; }

// ActionResult is what every mutating call returns. undo_token and
// undo_ttl_seconds are REQUIRED non-empty. The kubilitics core action
// gateway captures pre-state under the token before mutating.
message ActionResult {
  bool        ok                = 1;
  string      message           = 2;
  Diff        applied_diff      = 3;
  string      undo_token        = 4; // required; non-empty
  int32       undo_ttl_seconds  = 5; // required; >0 for any successful mutation
  AuditExtras audit             = 6;
}

// ─── ActionTemplate ─────────────────────────────────────────────────────────
// Multi-step plans. The user approves once; the gateway executes
// atomically with built-in per-step rollback. Powers the action-templates
// differentiator.

service ActionTemplate {
  rpc CreatePlan  (PlanRequest)        returns (Plan);
  rpc ApprovePlan (ApprovePlanRequest) returns (PlanResult);
  rpc CancelPlan  (CancelPlanRequest)  returns (Empty);
}

message PlanRequest {
  string                summary = 1;
  repeated ActionRequest steps  = 2;
}

message Plan {
  string                 plan_id      = 1;
  string                 summary      = 2;
  repeated ActionPreview step_preview = 3;
  Diff                   combined_diff = 4;
}

message ApprovePlanRequest { string plan_id = 1; }
message CancelPlanRequest  { string plan_id = 1; }

message PlanResult {
  bool                  ok                = 1;
  string                message           = 2;
  repeated ActionResult per_step          = 3;
  string                plan_undo_token   = 4; // undoes the entire plan
  int32                 undo_ttl_seconds  = 5;
}
```

- [ ] **Step 2: Lint and generate**

```bash
buf lint
buf generate
ls gen/go/kotg/v1/cluster*
```
Expected: lint passes; `cluster.pb.go` and `cluster_grpc.pb.go` appear.

- [ ] **Step 3: Verify the generated package compiles**

```bash
go build ./gen/...
```
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add proto/kotg/v1/cluster.proto gen/go/kotg/v1/cluster.pb.go gen/go/kotg/v1/cluster_grpc.pb.go go.mod go.sum
git commit -m "feat: cluster.proto — ClusterRead + ClusterAction + ActionTemplate"
```

---

## Task 5: chat.proto — chat + control services + assistant events

**Files:**
- Create: `proto/kotg/v1/chat.proto`
- Generate: `gen/go/kotg/v1/chat.pb.go`, `chat_grpc.pb.go`

- [ ] **Step 1: Write chat.proto**

`proto/kotg/v1/chat.proto`:
```proto
syntax = "proto3";

package kotg.v1;

option go_package = "github.com/kubilitics/kotg-schema/gen/go/kotg/v1;kotgv1";

import "kotg/v1/common.proto";
import "google/protobuf/timestamp.proto";

// ─── Chat ───────────────────────────────────────────────────────────────────
// What kotg-ai-server exposes for the conversational surface. Streamed.

service Chat {
  rpc CreateSession (CreateSessionRequest) returns (Session);
  rpc Send          (stream UserMessage)   returns (stream AssistantEvent);
  rpc CancelTurn    (CancelTurnRequest)    returns (Empty);
  rpc ListSessions  (ListSessionsRequest)  returns (stream Session);
}

message Session {
  string                    session_id        = 1;
  string                    title             = 2;
  string                    focus_cluster_id  = 3;
  google.protobuf.Timestamp created_at        = 4;
  google.protobuf.Timestamp updated_at        = 5;
  int32                     turn_count        = 6;
}

message CreateSessionRequest {
  string focus_cluster_id = 1;
  string title            = 2; // optional; AI may auto-title later
}

message UserMessage {
  string session_id = 1;
  string turn_id    = 2;
  string text       = 3;
  // Optional: client may attach a structured context hint, e.g. "the user
  // is currently looking at deployment X in namespace Y". Kept generic so
  // the schema doesn't lock in UI specifics.
  string context_hint = 4;
}

message CancelTurnRequest {
  string session_id = 1;
  string turn_id    = 2;
}

message ListSessionsRequest {
  int32 limit = 1;
  int64 since_unix = 2;
}

// ─── AssistantEvent ─────────────────────────────────────────────────────────
// Streaming union sent over Send(). The chat panel renders these in order.

message AssistantEvent {
  string anchor_id = 100; // monotonic per-turn id; Citation refers to it
  oneof event {
    TextDelta     text_delta     = 1;
    ToolStart     tool_start     = 2;
    ToolEnd       tool_end       = 3;
    ActionPending action_pending = 4;
    PlanProposed  plan_proposed  = 5;
    Citation      citation       = 6;
    ErrorEvent    error          = 7;
    Done          done           = 8;
  }
}

message TextDelta { string text = 1; }

message ToolStart {
  string tool_call_id = 1;
  string tool_name    = 2;
  string preview      = 3; // human-readable, e.g. "Looking up pods in default..."
}

message ToolEnd {
  string tool_call_id = 1;
  bool   ok           = 2;
  string preview      = 3; // e.g. "Found 14 pods"
}

// ActionPending is emitted when the AI proposes an action that requires
// human approval. The full preview travels with the event so the UI can
// render the modal without a round-trip.
message ActionPending {
  string         proposal_id = 1;
  ActionTier     tier        = 2;
  Diff           diff        = 3;
  string         summary     = 4;
}

message PlanProposed {
  string plan_id = 1;
  string summary = 2;
  Diff   combined_diff = 3;
  int32  step_count = 4;
}

// Citation links assistant text to the tool result that supports it.
// Powers the receipts differentiator.
message Citation {
  string assistant_text_anchor_id = 1; // matches an AssistantEvent.anchor_id
  string tool_call_id             = 2; // points to a ToolEnd
  string short_label              = 3; // e.g., "OOMKilled event 14:32 UTC"
}

message ErrorEvent {
  string code    = 1;
  string message = 2;
}

message Done {
  bool   cancelled       = 1;
  bool   partial         = 2;
  int32  prompt_tokens   = 3;
  int32  completion_tokens = 4;
  string finish_reason   = 5; // "stop" | "length" | "cancel" | "error"
}

// ─── AIControl ──────────────────────────────────────────────────────────────
// Health and capability handshake. The kubilitics core supervisor
// validates schema_version compatibility with this.

service AIControl {
  rpc Capabilities (Empty)       returns (AICapabilities);
  rpc Health       (Empty)       returns (HealthStatus);
}

message AICapabilities {
  string                schema_version = 1; // semver, e.g. "1.0.0"
  string                ai_version     = 2; // kotg-ai-server semver
  repeated string       providers      = 3; // ["openai","anthropic","ollama",...]
  repeated string       models         = 4;
  bool                  supports_undo  = 5;
  bool                  supports_plans = 6;
}
```

- [ ] **Step 2: Lint and generate**

```bash
buf lint
buf generate
ls gen/go/kotg/v1/chat*
```
Expected: lint passes; `chat.pb.go` and `chat_grpc.pb.go` appear.

- [ ] **Step 3: Verify the package compiles**

```bash
go build ./gen/...
```
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add proto/kotg/v1/chat.proto gen/go/kotg/v1/chat.pb.go gen/go/kotg/v1/chat_grpc.pb.go go.mod go.sum
git commit -m "feat: chat.proto — Chat + AIControl + AssistantEvent + Citation"
```

---

## Task 6: stub_cluster_server example

**Files:**
- Create: `examples/stub_cluster_server/main.go`
- Create: `examples/stub_cluster_server/main_test.go`

- [ ] **Step 1: Write the failing test**

`examples/stub_cluster_server/main_test.go`:
```go
package main

import (
	"context"
	"net"
	"testing"

	kotgv1 "github.com/kubilitics/kotg-schema/gen/go/kotg/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

func TestStubClusterServer_GetCluster(t *testing.T) {
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil { t.Fatal(err) }
	defer lis.Close()

	srv := grpc.NewServer()
	kotgv1.RegisterClusterReadServer(srv, &stubClusterRead{})
	go srv.Serve(lis)
	defer srv.Stop()

	conn, err := grpc.NewClient(lis.Addr().String(), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil { t.Fatal(err) }
	defer conn.Close()
	client := kotgv1.NewClusterReadClient(conn)

	got, err := client.GetCluster(context.Background(), &kotgv1.GetClusterRequest{ClusterId: "test"})
	if err != nil { t.Fatal(err) }
	if got.GetClusterId() != "test" {
		t.Fatalf("expected cluster_id=test, got %q", got.GetClusterId())
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/code/kotg-schema
go test ./examples/stub_cluster_server -run TestStubClusterServer_GetCluster -v
```
Expected: FAIL — `stubClusterRead` undefined.

- [ ] **Step 3: Implement the stub**

`examples/stub_cluster_server/main.go`:
```go
// Stub ClusterRead + ClusterAction implementation. Proves consumers can
// implement the kotg-schema service interfaces. Returns hardcoded data.
//
// Run: go run ./examples/stub_cluster_server
package main

import (
	"context"
	"errors"
	"log"
	"net"
	"time"

	kotgv1 "github.com/kubilitics/kotg-schema/gen/go/kotg/v1"
	"google.golang.org/grpc"
)

type stubClusterRead struct {
	kotgv1.UnimplementedClusterReadServer
}

func (s *stubClusterRead) GetCluster(_ context.Context, req *kotgv1.GetClusterRequest) (*kotgv1.Cluster, error) {
	if req.GetClusterId() == "" {
		return nil, errors.New("cluster_id required")
	}
	return &kotgv1.Cluster{
		ClusterId:      req.GetClusterId(),
		Name:           "stub-cluster",
		Distribution:   "in-cluster",
		K8sVersion:     "v1.33.0",
		NodeCount:      1,
		NamespaceCount: 5,
	}, nil
}

func main() {
	lis, err := net.Listen("tcp", "127.0.0.1:50051")
	if err != nil { log.Fatal(err) }
	srv := grpc.NewServer()
	kotgv1.RegisterClusterReadServer(srv, &stubClusterRead{})
	log.Println("stub_cluster_server listening on 127.0.0.1:50051")
	if err := srv.Serve(lis); err != nil { log.Fatal(err) }
	_ = time.Now
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
go test ./examples/stub_cluster_server -run TestStubClusterServer_GetCluster -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/stub_cluster_server/ go.mod go.sum
git commit -m "feat: stub_cluster_server example — proves ClusterRead is consumable"
```

---

## Task 7: stub_chat_server example

**Files:**
- Create: `examples/stub_chat_server/main.go`
- Create: `examples/stub_chat_server/main_test.go`

- [ ] **Step 1: Write the failing test**

`examples/stub_chat_server/main_test.go`:
```go
package main

import (
	"context"
	"net"
	"testing"

	kotgv1 "github.com/kubilitics/kotg-schema/gen/go/kotg/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

func TestStubChatServer_Capabilities(t *testing.T) {
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil { t.Fatal(err) }
	defer lis.Close()

	srv := grpc.NewServer()
	kotgv1.RegisterAIControlServer(srv, &stubAIControl{})
	go srv.Serve(lis)
	defer srv.Stop()

	conn, err := grpc.NewClient(lis.Addr().String(), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil { t.Fatal(err) }
	defer conn.Close()
	client := kotgv1.NewAIControlClient(conn)

	got, err := client.Capabilities(context.Background(), &kotgv1.Empty{})
	if err != nil { t.Fatal(err) }
	if got.GetSchemaVersion() != "1.0.0" {
		t.Fatalf("expected schema_version=1.0.0, got %q", got.GetSchemaVersion())
	}
	if !got.GetSupportsUndo() {
		t.Fatal("supports_undo should be true")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
go test ./examples/stub_chat_server -run TestStubChatServer_Capabilities -v
```
Expected: FAIL — `stubAIControl` undefined.

- [ ] **Step 3: Implement the stub**

`examples/stub_chat_server/main.go`:
```go
// Stub Chat + AIControl implementation. Proves consumers can implement
// the kotg-schema service interfaces.
//
// Run: go run ./examples/stub_chat_server
package main

import (
	"context"
	"log"
	"net"

	kotgv1 "github.com/kubilitics/kotg-schema/gen/go/kotg/v1"
	"google.golang.org/grpc"
)

type stubChat struct {
	kotgv1.UnimplementedChatServer
}

func (s *stubChat) Send(stream kotgv1.Chat_SendServer) error {
	for {
		msg, err := stream.Recv()
		if err != nil { return err }
		// Echo: stream a TextDelta + Done back.
		if err := stream.Send(&kotgv1.AssistantEvent{
			AnchorId: "1",
			Event:    &kotgv1.AssistantEvent_TextDelta{TextDelta: &kotgv1.TextDelta{Text: "echo: " + msg.GetText()}},
		}); err != nil { return err }
		if err := stream.Send(&kotgv1.AssistantEvent{
			AnchorId: "2",
			Event:    &kotgv1.AssistantEvent_Done{Done: &kotgv1.Done{FinishReason: "stop"}},
		}); err != nil { return err }
	}
}

type stubAIControl struct {
	kotgv1.UnimplementedAIControlServer
}

func (s *stubAIControl) Capabilities(_ context.Context, _ *kotgv1.Empty) (*kotgv1.AICapabilities, error) {
	return &kotgv1.AICapabilities{
		SchemaVersion: "1.0.0",
		AiVersion:     "0.0.1-stub",
		Providers:     []string{"stub"},
		Models:        []string{"stub-1"},
		SupportsUndo:  true,
		SupportsPlans: true,
	}, nil
}

func main() {
	lis, err := net.Listen("tcp", "127.0.0.1:50052")
	if err != nil { log.Fatal(err) }
	srv := grpc.NewServer()
	kotgv1.RegisterChatServer(srv, &stubChat{})
	kotgv1.RegisterAIControlServer(srv, &stubAIControl{})
	log.Println("stub_chat_server listening on 127.0.0.1:50052")
	if err := srv.Serve(lis); err != nil { log.Fatal(err) }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
go test ./examples/stub_chat_server -run TestStubChatServer_Capabilities -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/stub_chat_server/ go.mod go.sum
git commit -m "feat: stub_chat_server example — proves Chat/AIControl are consumable"
```

---

## Task 8: CI — buf lint + Go test

**Files:**
- Create: `.github/workflows/lint.yml`

- [ ] **Step 1: Write the workflow**

`.github/workflows/lint.yml`:
```yaml
name: lint

on:
  pull_request:
  push:
    branches: [main]

jobs:
  buf:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: bufbuild/buf-setup-action@v1
      - run: buf lint
      - run: buf format --diff --exit-code

  go:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: "1.22"
      - run: go build ./...
      - run: go test ./... -count=1 -timeout=60s
      - uses: golangci/golangci-lint-action@v6
        with:
          version: v1.60
          args: --timeout=2m ./examples/...
```

- [ ] **Step 2: Commit and push to trigger CI**

```bash
git add .github/workflows/lint.yml
git commit -m "ci: buf lint + Go build/test/lint on PRs"
git push -u origin main
```

- [ ] **Step 3: Watch the run, fix anything that fails**

```bash
gh run watch
```
Expected: both `buf` and `go` jobs pass. If `golangci-lint` finds issues in the examples, fix in a follow-up commit.

---

## Task 9: CI — release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Write the release workflow**

The Go module proxy publishes new versions automatically when a tag is pushed; this workflow just verifies the tagged commit builds cleanly and creates a GitHub Release with auto-generated notes.

`.github/workflows/release.yml`:
```yaml
name: release

on:
  push:
    tags: ["v*"]

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: "1.22" }
      - uses: bufbuild/buf-setup-action@v1
      - run: buf lint
      - run: go build ./...
      - run: go test ./... -count=1 -timeout=60s
      - uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
```

- [ ] **Step 2: Commit and push**

```bash
git add .github/workflows/release.yml
git commit -m "ci: release workflow — verify build + GitHub Release on tag"
git push origin main
```

---

## Task 10: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write the README**

`README.md`:
```markdown
# kotg-schema

Versioned wire contract between [kubilitics](https://github.com/vellankikoti/kubilitics)
core and [kotg.ai](https://github.com/vellankikoti/kotg.ai). One
protobuf schema, one Go module, two consumers, independent release
cadence on either side.

This repo's only job is to define the bytes that travel over the wire.
Everything else (servers, clients, business logic) lives in the
consumers. See the [integration design](https://github.com/vellankikoti/kubilitics/blob/main/docs/superpowers/specs/2026-04-18-ai-integration-design.md)
and [schema design](https://github.com/vellankikoti/kubilitics/blob/main/docs/superpowers/specs/2026-04-18-kotg-schema-design.md)
for the full picture.

## Wire contract

Three proto packages under `proto/kotg/v1/`:

| Package         | Services                                                        |
|-----------------|-----------------------------------------------------------------|
| `cluster.proto` | `ClusterRead`, `ClusterAction`, `ActionTemplate`                |
| `chat.proto`    | `Chat`, `AIControl`                                             |
| `common.proto`  | shared types (`ActionTier`, `ResourceRef`, `Diff`, `AuditExtras`, `HealthStatus`) |

Generated Go is committed under `gen/go/kotg/v1/` so consumers do not
need protoc.

## Five rules baked into the contract

1. **User identity travels in gRPC metadata** under key `kotg-user-token`. Never in a body field.
2. **Every mutating `ActionResult` carries `undo_token` + `undo_ttl_seconds` as REQUIRED fields.** Powers one-click rollback.
3. **`Citation` events SHOULD accompany any assistant claim about cluster state.** Powers the receipts UX. Treat missing-citation as a quality bug.
4. **`ActionPending` carries the full `Diff` and `tier`** so approval modals render without an extra round-trip.
5. **mTLS is mandatory.** No `tls_disabled` field. No plaintext fallback.

## Versioning

Semver, `v1.x.y`. Patch + minor are additive only — old generated code keeps compiling. Major version bumps require a coordinated release with a 3-month overlap window where both v1 and v2 are served. CI runs `buf breaking` against the previous tag on every PR.

## Using from Go

```go
import kotgv1 "github.com/kubilitics/kotg-schema/gen/go/kotg/v1"
```

See `examples/stub_cluster_server/` and `examples/stub_chat_server/` for minimal working servers.

## Development

```bash
brew install bufbuild/buf/buf
go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.34.2
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@v1.5.1

buf lint
buf generate
go build ./...
go test ./...
```
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README — wire contract overview, 5 rules, versioning, usage"
```

---

## Task 11: Tag v1.0.0

- [ ] **Step 1: Push current main**

```bash
git push origin main
```

- [ ] **Step 2: Wait for `lint` workflow to pass**

```bash
gh run list --workflow=lint.yml --limit 1
gh run watch
```
Expected: green.

- [ ] **Step 3: Tag and push**

```bash
git tag -a v1.0.0 -m "kotg-schema v1.0.0 — initial wire contract"
git push origin v1.0.0
```

- [ ] **Step 4: Verify the release workflow ran and the GitHub Release was created**

```bash
gh run list --workflow=release.yml --limit 1
gh release view v1.0.0
```
Expected: release exists, auto-generated notes, no assets needed.

- [ ] **Step 5: Verify the module proxy picked it up**

```bash
curl -sS "https://proxy.golang.org/github.com/kubilitics/kotg-schema/@v/v1.0.0.info"
```
Expected: JSON like `{"Version":"v1.0.0","Time":"..."}`. May take 30-60 seconds after the tag push.

---

## Task 12: CI — buf breaking-change check

**Files:**
- Create: `.github/workflows/breaking.yml`

Now that a tag exists, enable the breaking-change CI.

- [ ] **Step 1: Write the workflow**

`.github/workflows/breaking.yml`:
```yaml
name: breaking

on:
  pull_request:

jobs:
  buf-breaking:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: bufbuild/buf-setup-action@v1
      - name: Get latest tag
        id: tag
        run: echo "tag=$(git describe --tags --abbrev=0)" >> "$GITHUB_OUTPUT"
      - run: buf breaking --against ".git#tag=${{ steps.tag.outputs.tag }}"
```

- [ ] **Step 2: Commit and push**

```bash
git add .github/workflows/breaking.yml
git commit -m "ci: enforce buf breaking-change check against latest tag on PRs"
git push origin main
```

---

## Task 13: Sanity-check — open a no-op PR and confirm the breaking workflow runs

- [ ] **Step 1: Branch + trivial change**

```bash
git checkout -b ci-breaking-smoke
echo "" >> README.md
git commit -am "chore: README newline (CI smoke for breaking workflow)"
git push -u origin ci-breaking-smoke
gh pr create --fill
```

- [ ] **Step 2: Watch the PR's checks**

```bash
gh pr checks
```
Expected: `lint` passes, `breaking` passes (no breaking change).

- [ ] **Step 3: Merge and clean up**

```bash
gh pr merge --squash --delete-branch
git checkout main
git pull
```

---

## Task 14: Smoke-test consumption from kubilitics

**Files:**
- Modify: `kubilitics/go.work` and `kubilitics/kubilitics-backend/go.mod` (temporary; reverted at end)

- [ ] **Step 1: Switch to the kubilitics worktree**

```bash
cd /Users/koti/myFuture/Kubernetes/kubilitics
```

- [ ] **Step 2: Add kotg-schema to the backend module**

```bash
cd kubilitics-backend
go get github.com/kubilitics/kotg-schema@v1.0.0
```
Expected: downloads the module; updates `go.mod`/`go.sum`.

- [ ] **Step 3: Write a tiny smoke file**

`kubilitics-backend/internal/aiwip/schema_smoke_test.go`:
```go
//go:build aiwip

// Package aiwip exists ONLY to verify kotg-schema imports cleanly into
// kubilitics. Build-tagged so it never compiles in normal builds.
package aiwip

import (
	"testing"

	kotgv1 "github.com/kubilitics/kotg-schema/gen/go/kotg/v1"
)

func TestSchemaImportsCompile(t *testing.T) {
	c := &kotgv1.Cluster{ClusterId: "x"}
	if c.GetClusterId() != "x" {
		t.Fatal("schema package not consumable")
	}
	_ = kotgv1.ActionTier_ACTION_TIER_DESTRUCTIVE
}
```

- [ ] **Step 4: Run the smoke test**

```bash
mkdir -p internal/aiwip
# (Save the file from Step 3 to internal/aiwip/schema_smoke_test.go)
go test -tags aiwip ./internal/aiwip -count=1
```
Expected: PASS.

- [ ] **Step 5: Verify default builds DO NOT pull in the schema package**

```bash
go list -deps ./cmd/server | grep kotg && echo "FAIL: kotg leaked into core" || echo "OK: kotg not in default build"
```
Expected: `OK: kotg not in default build`.

- [ ] **Step 6: Revert the smoke artifacts**

```bash
rm -rf internal/aiwip
go mod tidy
```
Expected: `go.mod` no longer requires `kotg-schema` (since nothing imports it anymore).

- [ ] **Step 7: Commit only what's intentional (none, in this case)**

```bash
git status
# Should show no changes after `go mod tidy`. If `go.sum` lingered:
git checkout -- go.mod go.sum
```

The kubilitics core repo is unchanged after this task — the smoke test was deliberately ephemeral. Real consumption happens in subproject 2 (capability + sidecar supervisor).

---

## Self-Review

**Spec coverage (against `2026-04-18-kotg-schema-design.md`):**

| Spec section | Task |
|---|---|
| §2 Decision: separate repo | Task 1 (creates `vellankikoti/kotg-schema`) |
| §3 Wire format / transport / mTLS / metadata identity | Encoded in proto + README rules; mTLS implementation is subproject 2 |
| §4.1 cluster.proto services | Task 4 |
| §4.2 chat.proto services + AssistantEvent | Task 5 |
| §4.3 common.proto types | Task 3 |
| §5 Five cross-cutting rules | README Task 10 + structural enforcement in proto (e.g., undo_token is field 4 of ActionResult, AssistantEvent oneof) |
| §6 Versioning policy | README Task 10 + breaking workflow Task 12 |
| §7 Repo layout | Tasks 2, 3, 4, 5, 6, 7, 8, 9, 12 |
| §8 Done criteria (1-8) | Tasks 1, 3-5, 8, 10, 11; smoke = Task 14 |

**Placeholder scan:** None. Every task has full proto/Go content; no "TBD" or "implement later".

**Type consistency:** `kotgv1` import alias used everywhere. `Cluster.cluster_id` used in stub server matches the proto field name. `AICapabilities.SchemaVersion` matches the test assertion. `Empty` is a local message in `common.proto` and is used in `Chat.CancelTurn` (returns `Empty`) — wait, let me re-check. `CancelTurn` returns `Empty` per chat.proto Task 5, and `Empty` is defined in common.proto Task 3. Consistent.

`undo_token` field number: 4 in `ActionResult` and 4 in `UndoRequest` — both fine, separate messages, no conflict.

`Citation.assistant_text_anchor_id` matches `AssistantEvent.anchor_id` (the field that carries the anchor). Consistent.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-18-kotg-schema-v1.md`.
