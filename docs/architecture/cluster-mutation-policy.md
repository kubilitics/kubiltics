# Cluster Mutation Policy

**Status:** Active, v1
**Owner:** Platform team
**Applies to:** All Kubilitics features that interact with user clusters

## The principle

**Kubilitics never mutates a user's Kubernetes cluster automatically.**

Every cluster API call from the Kubilitics backend is read-only. The user runs
all install, configure, and modify commands themselves — using their own
credentials, in their own terminal, with full visibility and audit trail.

## Why

We adopted this principle after deciding to make Kubilitics enterprise-ready.
Auto-mutation breaks for five concrete reasons:

1. **RBAC mismatch.** Kubilitics may not have the cluster-admin permissions
   required to install CRDs, ClusterRoles, and webhooks. Auto-install fails
   opaquely with permission-denied errors users can't act on.

2. **Compliance.** Regulated industries (finance, healthcare, government)
   forbid silent mutations of production clusters. SOC2 Type II requires
   auditable evidence of every cluster change. A button click in the UI
   doesn't satisfy that — a kubectl command in a deploy pipeline does.

3. **GitOps drift.** Deployments managed by Argo CD or Flux revert any
   out-of-band annotation we add. If we patch a deployment to instrument it,
   the next git sync (~3-5 min) reverts the patch. Users see traces appear
   briefly and then stop, with no explanation.

4. **Air-gap.** Disconnected environments can't reach `gh.com` to fetch
   third-party manifests. Our auto-installer fails with a network error
   they have no way to resolve from the UI.

5. **Reviewability.** Power users want to read every YAML before it touches
   their cluster. Auto-install gives them no chance.

## The three rules

Every Kubilitics feature that touches a user cluster must follow these rules:

### Rule 1: No silent mutations

Kubilitics never writes to the user's cluster without an explicit user action
**and** a clear preview of what will happen. There is no auto-apply, no
"convenience mode," no escape hatch. Even local development clusters use the
same flow.

### Rule 2: Commands, not buttons

When the user wants something installed, configured, or changed, we generate
the exact `helm` or `kubectl` command they would run themselves — pre-filled
with their cluster ID and config. They run it in their terminal. We watch
the result via read-only API calls and surface live status.

If a feature feels like it needs a button, the right move is to:
1. Keep the detection logic (read-only)
2. Generate the equivalent command
3. Let the user copy-paste it

### Rule 3: Detection over action

Our backend detects cluster state, never changes it. All `client-go` calls
in the backend use the read verbs (`Get`, `List`, `Watch`). Mutating verbs
(`Create`, `Update`, `Patch`, `Delete`, `DeleteCollection`) are not used
against user clusters.

(Exceptions: Kubilitics's own internal database, telemetry storage, and
config — those mutations are scoped to Kubilitics's own infrastructure,
not the user's cluster.)

## How this applies to specific features

### Tracing setup

The tracing setup page generates a single Helm command pre-filled with the
user's cluster ID and backend URL. The user runs it in their terminal. The
setup page polls the cluster every 3 seconds and surfaces live install
status.

### Per-deployment instrumentation

The Deployment Traces tab detects the application language from the
container command/env/image and shows the exact `kubectl annotate` command
the user should run. The user runs it. We re-detect on next poll.

### Future features

Any future feature that wants to install/configure/patch resources in the
user's cluster MUST follow the same pattern. Code reviews for any PR adding
a backend handler that calls a mutating `client-go` verb against a user
cluster must be rejected.

## Exceptions

There are no exceptions for user clusters. The only place Kubilitics
mutates Kubernetes objects is in its own embedded clusters used for
self-tests in CI.
