# kotg-schema — Shared Wire Contract Design

**Date:** 2026-04-18
**Status:** Approved for implementation planning
**Scope:** Define and ship the versioned shared schema module that kubilitics core and kotg.ai both consume to talk to each other. First subproject of the AI integration arc (see `2026-04-18-ai-integration-design.md`).

---

## 1. Why this is its own subproject

The integration design picks a sidecar architecture. A sidecar architecture only works if the wire contract between the two processes has a clear owner, a clean lifecycle, and a versioning policy that survives independent release cadences on both sides.

Today there is no such artifact. kotg.ai has a partial contract under its own `kubilitics-ai/pkg/contracts/grpc.go` and `api/proto/cluster_data.proto`. kubilitics core has nothing on this topic. The integration design references `kotg-schema` as the boundary but doesn't define it.

This spec creates that artifact. Once it ships, every other AI integration subproject can be implemented independently against a frozen contract.

---

## 2. Decision: schema lives in its own repo

Three placement options were considered.

| Option | Where | Verdict |
|---|---|---|
| A | New repo `vellankikoti/kotg-schema`. Both kubilitics and kotg.ai depend on it. | **Chosen.** |
| B | Inside kotg.ai under `kubilitics-ai/api/proto/v2/`. kubilitics imports tagged versions. | Rejected. Creates a master/slave repo dynamic. The schema can't release without kotg.ai releasing. |
| C | Inside kubilitics under `pkg/aischema/`. kotg.ai imports from kubilitics. | Rejected. Same problem in reverse. Also violates the integration design's import-graph rule that kubilitics core has zero AI imports. |

Option A is the symmetric model. Neither application repo "owns" the contract. The schema repo has its own semver, its own breaking-change PR review path, and its own CI. This is the same pattern that worked for protobuf in large distributed systems: the IDL has its own life cycle independent of any consumer.

Cost: one extra repo to create and maintain. Bounded — proto files don't change often once stable.

### Repo location and ownership

- **Repo:** `vellankikoti/kotg-schema` (public).
- **Module path:** `github.com/kubilitics/kotg-schema`.
- **Go module root:** `gen/go/`. Consumers `import "github.com/kubilitics/kotg-schema/gen/go/kotg/v1"`.
- **Proto root:** `proto/kotg/v1/`. Consumers can `buf generate` into other languages later if needed (TypeScript for direct browser use is intentionally not v1; the chat surface goes through kubilitics core which exposes its own JSON wrapper).

---

## 3. Wire format and transport

- **Format:** Protocol Buffers v3.
- **Transport:** gRPC.
- **Security:** mutual TLS, mandatory. No plaintext fallback. The schema repo specifies the cert pinning protocol but does not generate certs (that is subproject 2's job).
- **Identity:** the user's session token is passed in gRPC metadata under key `kotg-user-token`. Identity never appears in proto message bodies.

---

## 4. The three proto packages

All under `proto/kotg/v1/`. Together they define the entire boundary between kubilitics core and kotg-ai-server.

### 4.1 `kotg.v1.cluster.proto` — what kubilitics core exposes to AI

Two services. The AI sidecar consumes both. Reads are unrestricted (subject to the user's RBAC). Writes go through `ClusterAction` which routes through the action gateway in core (subproject 3).

```proto
service ClusterRead {
  rpc GetCluster      (GetClusterRequest)      returns (Cluster);
  rpc ListResources   (ListResourcesRequest)   returns (stream ResourceItem);
  rpc GetResource     (GetResourceRequest)     returns (Resource);
  rpc GetLogs         (GetLogsRequest)         returns (stream LogLine);
  rpc GetEvents       (GetEventsRequest)       returns (stream Event);
  rpc GetMetrics      (GetMetricsRequest)      returns (MetricSeries);
  rpc Topology        (TopologyRequest)        returns (TopologyGraph);
}

service ClusterAction {
  // Preview the effect without executing. Used by the AI to construct a
  // diff for the user. Cheap; never mutates state.
  rpc PreviewAction   (ActionRequest)          returns (ActionPreview);

  // Submit a single action for human approval. Returns proposal_id.
  // Pairs with ApproveAction below for the user-confirms-then-execute flow.
  rpc ProposeAction   (ActionRequest)          returns (ActionProposal);

  // Called by the UI after the human approves a proposal. Returns the
  // result with the undo_token for the rollback differentiator.
  rpc ApproveAction   (ApproveActionRequest)   returns (ActionResult);

  // Direct execute paths for read-equivalent or pre-approved tier actions.
  // The action gateway in core enforces tier classification on every call.
  rpc Apply           (ApplyRequest)           returns (ActionResult);
  rpc Delete          (DeleteRequest)          returns (ActionResult);
  rpc Scale           (ScaleRequest)           returns (ActionResult);
  rpc Exec            (ExecRequest)            returns (stream ExecChunk);

  // The rollback differentiator. Every ActionResult carries an undo_token
  // valid for undo_ttl_seconds. Calling Undo within that window reverts.
  rpc Undo            (UndoRequest)            returns (ActionResult);
}

service ActionTemplate {
  // The action-templates differentiator. AI proposes a multi-step plan;
  // the human approves the whole plan once; the gateway executes atomically
  // with built-in per-step rollback if any step fails or is undone later.
  rpc CreatePlan      (PlanRequest)            returns (Plan);
  rpc ApprovePlan     (ApprovePlanRequest)     returns (PlanResult);
  rpc CancelPlan      (CancelPlanRequest)      returns (Empty);
}
```

Field-level shapes for the request and response messages above (`PlanRequest`,
`ApprovePlanRequest`, `ExecRequest`, etc.) are intentionally left for the
implementation plan, not this design doc. The service signatures shown here
are the contract; the body of each message is mechanical translation from
the existing `pkg/contracts/grpc.go` shapes plus the new fields the
unicorn overlay (receipts, undo, plans) requires.

### 4.2 `kotg.v1.chat.proto` — what kotg-ai-server exposes to kubilitics core

Two services. The kubilitics core consumes both. Chat is the user-facing surface; AIControl is health/handshake.

```proto
service Chat {
  rpc CreateSession   (CreateSessionRequest)   returns (Session);
  rpc Send            (stream UserMessage)     returns (stream AssistantEvent);
  rpc CancelTurn      (CancelTurnRequest)      returns (Empty);
  rpc ListSessions    (ListSessionsRequest)    returns (stream Session);
}

service AIControl {
  rpc Capabilities    (Empty)                  returns (AICapabilities);
  rpc Health          (Empty)                  returns (HealthStatus);
}
```

`AssistantEvent` is the streaming union that powers the chat panel and the receipts differentiator:

```proto
message AssistantEvent {
  oneof event {
    TextDelta       text_delta      = 1;  // partial assistant tokens
    ToolStart       tool_start      = 2;  // "Looking up pods in default..."
    ToolEnd         tool_end        = 3;  // tool result; addressable by tool_call_id
    ActionPending   action_pending  = 4;  // gateway awaiting user approval
    PlanProposed    plan_proposed   = 5;  // AI just created an action template
    Citation        citation        = 6;  // RECEIPTS: links assistant text → tool result
    Error           error           = 7;
    Done            done            = 8;  // turn complete; carries token usage
  }
}

// Citation is the wire shape behind the receipts differentiator. The UI
// renders inline footnote markers in the assistant text; clicking a marker
// expands the original tool result. AI quality regression: any non-trivial
// claim about cluster state without an accompanying Citation event.
message Citation {
  string assistant_text_anchor_id = 1; // matches a TextDelta anchor_id
  string tool_call_id             = 2; // points to a ToolEnd by id
  string short_label              = 3; // e.g., "OOMKilled event 14:32 UTC"
}
```

### 4.3 `kotg.v1.common.proto` — shared types

Identity (passed in metadata, defined here for reference), ResourceRef, Diff, RBACDecision, ActionTier, AuditExtras, error codes.

```proto
enum ActionTier {
  ACTION_TIER_UNSPECIFIED = 0;
  ACTION_TIER_READ        = 1; // get/list/watch/logs/describe
  ACTION_TIER_WRITE_SAFE  = 2; // label/annotate/scale-up
  ACTION_TIER_WRITE_RISKY = 3; // apply/scale-down/edit-secret
  ACTION_TIER_DESTRUCTIVE = 4; // delete/exec/restart/drain
}

message ResourceRef {
  string cluster_id = 1;
  string namespace  = 2;
  string kind       = 3;
  string api_version= 4;
  string name       = 5;
}

message Diff {
  string before_yaml = 1;
  string after_yaml  = 2;
  // Pre-rendered unified diff; the UI uses this directly to avoid
  // recomputing on every render.
  string unified     = 3;
}

message AuditExtras {
  string session_id      = 1;
  string turn_id         = 2;
  string model           = 3;  // "claude-3.5-sonnet" etc.
  string provider        = 4;  // "anthropic" etc.
  string prompt_excerpt  = 5;  // first 200 chars, redacted
  ActionTier tier        = 6;
}
```

---

## 5. Cross-cutting decisions baked into the schema

Five rules. Every consumer must honor them. They exist because forgetting any one of them is the difference between an enterprise-grade product and a toy.

**5.1 User identity travels in gRPC metadata, never in a body field.**
Key: `kotg-user-token`. Every call. The schema has no `user_id` body field anywhere. This forces the AI sidecar to use the metadata path (which kubilitics core validates) and prevents accidental impersonation by a malformed body.

**5.2 Every mutating ActionResult carries `undo_token` and `undo_ttl_seconds` as REQUIRED fields.**
Not optional. Forcing every action to be undoable shapes the implementation: the action gateway captures the pre-state before mutating, stores it under the token, and the rollback differentiator becomes a property of the system rather than a feature you bolt on later.

**5.3 Receipts are SHOULD on the wire and MUST in practice.**
The Citation event is structurally optional in proto, because not every assistant turn has claims (e.g., "Hello, I'm Kubi. What can I help with?"). But the kotg.ai reasoning layer treats unsupported claims as a quality bug, and the UI surfaces "no source" claims with a low-confidence badge. The schema makes the right thing cheap.

**5.4 ActionPending carries the full preview.**
The `ActionPending` event embeds the `Diff` and the `tier` so the approval modal renders immediately without an extra round-trip. One bad latency moment in an approval flow is worse than a slightly larger streaming event.

**5.5 mTLS is mandatory.**
The schema docs state plainly that any deployment serving plaintext is non-conformant. There is no `tls_disabled` field. Adding one would be the easiest way to back into a security incident.

---

## 6. Versioning policy

- Module: semver, `v1.x.y`.
- **Patch and minor: additive only.** New fields, new RPCs, new event variants in oneof unions. Old generated code keeps compiling.
- **Major:** requires both kubilitics core and kotg.ai teams to ship a release that supports both old and new schema for an overlap window of three months. Then drop old.
- **Breaking-change check in CI.** Every PR runs `buf breaking --against '.git#tag=v$LAST_TAG'`. PRs that break SemVer fail.
- **Generated code is committed.** No "regenerate at build time" surprises for consumers. Tags ship with the .pb.go files inline.

---

## 7. Repo layout

```
vellankikoti/kotg-schema/
├── README.md                  # wire contract, decisions §5, versioning §6
├── go.mod                     # module github.com/kubilitics/kotg-schema
├── go.sum
├── buf.yaml
├── buf.gen.yaml               # generates Go; future: TypeScript, Python
├── proto/
│   └── kotg/
│       └── v1/
│           ├── cluster.proto
│           ├── chat.proto
│           └── common.proto
├── gen/
│   └── go/
│       └── kotg/
│           └── v1/
│               ├── cluster.pb.go
│               ├── cluster_grpc.pb.go
│               ├── chat.pb.go
│               ├── chat_grpc.pb.go
│               ├── common.pb.go
│               └── common_grpc.pb.go
├── examples/                  # tiny Go programs that exercise the contract
│   ├── stub_cluster_server/
│   └── stub_chat_server/
└── .github/workflows/
    ├── lint.yml               # buf lint, golangci-lint on examples
    ├── breaking.yml           # buf breaking against last tag
    └── release.yml            # tag → publish + module proxy refresh
```

---

## 8. Done means

1. `vellankikoti/kotg-schema` repo exists, public, default branch `main`.
2. Three .proto files committed under `proto/kotg/v1/`, structured per §4.
3. Generated Go committed under `gen/go/kotg/v1/`.
4. `buf lint` passes; `buf breaking` job exists in CI (will activate once a tag exists).
5. README documents the wire contract, the five cross-cutting rules, and the versioning policy.
6. Two example programs in `examples/` — a stub `ClusterRead` server and a stub `Chat` server — that compile and run, proving the generated code is consumable.
7. Tagged `v1.0.0`.
8. Pulled into kubilitics-frontend's module sandbox as a smoke test (one-line `require`, `go build`).

---

## 9. Out of scope for this subproject

- Implementing the services. That's subprojects 2 (capability + supervisor) and 3 (action gateway) for the kubilitics side, and subproject 4 (sidecar adapter) for the kotg.ai side.
- mTLS cert generation, distribution, rotation. Owned by subproject 2.
- The action-tier classification logic. Owned by subproject 3.
- Frontend rendering of citations, undo banners, plan-approval modals. Owned by subprojects 5 and 6.
- Migration of kotg.ai's existing `pkg/contracts/grpc.go` to the new schema. Subproject 4 picks the migration path; both contracts can coexist during transition.

---

## 10. Risk and mitigation specific to this subproject

| Risk | Mitigation |
|---|---|
| Schema drift between repo and consumers (someone hand-edits .pb.go) | Both consumers' CI verifies generated files match the tagged version |
| Premature lock-in on field names we'll regret | Keep v1 minimal; new fields are free, removing fields requires v2; consumers should not mass-import everything in `common.proto` — only what they actually use |
| Citation fields untrue / hallucinated tool_call_id | The AI server validates every Citation against its own tool_call registry before emitting; CI test in the kotg.ai repo (not this one) enforces |
| Undo tokens become stale forever (memory leak) | TTL is REQUIRED in the schema; the action gateway has its own GC of the undo store after TTL elapses (subproject 3) |
| Two repos drift on the unicorn overlay (receipts, undo, plans) | This spec is the single source of truth; integration tests in subproject 9 exercise all three end-to-end |

---

## 11. Why this is the right first subproject to ship

Three reasons.

1. **It unblocks every other AI subproject.** With a frozen contract, subprojects 2, 3, 4, 5, 6 can be designed and implemented in parallel.
2. **It encodes the unicorn overlay structurally.** Receipts (Citation), rollback (undo_token + Undo RPC), action templates (ActionTemplate service) are baked into the wire format, not bolted on later. We will not have to break the contract to make the product defensible.
3. **It is small.** A focused repo with three .proto files, generated Go, two example programs, and a README. One implementation plan, one PR, one tag. Done.

The next subproject after this — **kubilitics core: AI capability + sidecar supervisor** — depends on `kotg-schema v1.0.0` existing and being importable. Shipping this first removes the dependency that would otherwise serialize the whole arc.
