# Known Issues — v1.1.0

This file captures issues that are present in v1.1.0 and tracked for
follow-up. It is updated whenever smoke testing surfaces a new one.

## AI / brain

- **`observe_high_cardinality_labels` graceful-degrades.** The backend
  does not yet expose a `/labels/cardinality` index endpoint. The tool
  returns `{items: [], note: "backend endpoint not yet available"}` —
  this is intentional, not a bug.
- **`observe_restart_storms` uses cumulative counts, not per-window.**
  The backend exposes only `containerStatuses[].restartCount` (total
  restarts since pod start), not per-hour history. The tool returns a
  `note` field clarifying the semantic so the LLM can narrate it
  accurately.
- **`diagnose_networkpolicy_blocking` does not simulate per-pod
  flows.** It detects default-deny policies only; for a true from→to
  trace you need a policy simulator that isn't in the backend yet.
- **kagent + python engines are skeletons.** The brain ships with the
  `kubilitics-ai` built-in engine as the active router. `kagent` and
  `python` engines are conditionally registered via env vars but their
  real integrations are deferred to v1.5.

## Desktop

- **Cluster switch occasionally leaves sidebar counters at zero for
  ~200 ms** while stores drain and refill. Caches warm up on the next
  watch tick. Tracked under "Cluster Lifecycle Bug" in long-lived
  memory; does not block ship.
- **`kubilitics-ai-server` missing-sidecar is non-fatal.** If the
  binary isn't bundled (dev build, partial CI), the AI chat panel
  reports "AI disabled" while the rest of the app works. Run
  `./scripts/fetch-brain.sh` locally to provision it.

## Release

- **Three-provider bench baseline not yet captured.** The judge
  infrastructure is ready (`--judge-base-url`) but running against
  Ollama `qwen2.5:32b` is blocked on an AWS g-vCPU quota increase.
  The OpenAI / Anthropic legs can run today but the full baseline row
  lands in a follow-up patch.
- **Homebrew tap PR not yet opened.** The formula lives at
  `vellankikoti/homebrew-kubilitics` and needs its SHA256s bumped
  after the release artifacts are uploaded.
- **Windows + Linux builds are unsigned.** Headlamp-equivalent
  posture. macOS is notarized + Gatekeeper-happy; Windows users see a
  SmartScreen warning on first run; Linux `AppImage` / `.deb` /
  `.rpm` install without signature checking.

## Bench

- **Judge renderings in bench-report HTML are a follow-up.** JUnit
  `<system-out>` already carries the full judge JSON; `template_v2`
  still shows only the PASS/FAIL headline.
- **Chat-quality bench's 100-prompt re-run against the 183-tool
  surface is pending.** Expected to lift clean-answer rate from 81 →
  95+ based on the new aggregators covering previously-dead-end
  prompts.
