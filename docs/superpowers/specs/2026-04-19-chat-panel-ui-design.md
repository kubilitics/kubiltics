# Chat Panel UI — Design Spec

**Date:** 2026-04-19
**Subproject:** 5 of the AI integration arc.
**Goal:** Add a right-side AI chat panel to the kubilitics desktop frontend that consumes the backend WS endpoint shipped in subproject 2 and converses with the kotg-ai-server sidecar from subproject 4. Context-aware (knows what the user is looking at), per-cluster ephemeral sessions, block-based message rendering that's forward-compatible with subproject 3's ActionGate. v1 is a real conversational AI integrated into the K8s operator workflow.

> Backend dependencies (already shipped):
> - Subproject 2 (`vellankikoti/kubilitics@feat/ai-supervisor` merged): supervisor + proxy + handlers; WS endpoint at `/api/v1/ai/chat?cluster_id=X`; status/capabilities/refresh endpoints.
> - Subproject 4 (`vellankikoti/kotg-ai-server@v0.1.0`): three providers, in-memory sessions, K8s-aware system prompt.
>
> The `cfg.AI` follow-up (provider/endpoint/model/apiKeyEnv plumbing) shipped on `main` (`f7af52d`).

---

## 1. Locked Decisions

| # | Decision | Why |
|---|---|---|
| 1 | **Right-side slide-out panel** (~480px, collapsible, overlay fallback for narrow windows) | Context-aware AI only works in-place; matches Cursor/Copilot pattern; chat transcripts are vertical-dominant; the schema's `context_hint` exists precisely for "user is looking at X". |
| 2 | **One ephemeral session per cluster, auto-created** | Schema binds `Session` to one `focus_cluster_id`; sidecar wipes on restart. Zero session-management UI in v1. "New chat" button is the escape hatch. Sidecar restart marks past messages historical + disables input. |
| 3 | **Hybrid context: implicit store + explicit "Ask AI" buttons** | Pages publish `useAIContext().setImplicit(...)` on mount. Per-row buttons set explicit context. Explicit > implicit. Stale-context safeguard: discard if `cluster !== activeCluster`. Cmd+I uses implicit (no fabrication when null). |
| 4 | **Volatile per-cluster, no persistence** | Matches Q2's ephemeral session model; reduces privacy/compliance surface (no LLM completions on disk); Zustand `Map<cluster, Turn[]>` with NO `persist` middleware. Refresh wipes everything. Export-to-clipboard for the "I want to save this" case. |
| 5 | **Block-list per turn (`AssistantTurn = {turnId, anchorId, blocks[], state, ...}`)** | Mirrors `AssistantEvent` oneof. v1 has only `TextBlock`; subproject 3 adds Action/Plan/Citation/Tool blocks without touching the renderer pipeline. UnknownBlock fallback prevents crashes on future variants. |
| 6 | **Bundled entry: Cmd+I shortcut + header pill + sidebar item + per-row "Ask AI" buttons + per-page "Ask AI about this"** | Covers all personas (keyboard, mouse, discoverability). Reserves Cmd+K for a future command palette. Per-row buttons are the v1 differentiator — competitors require typing the resource name; we already know it from row context. |

---

## 2. Architecture

```
                       ┌──────────────────────────────────────┐
                       │ AppLayout                            │
                       │  ┌──────┬──────────────┬───────────┐ │
                       │  │ Side │ Main Content │ ChatPanel │ │
                       │  │ bar  │ (current     │ (~480px,  │ │
                       │  │      │  page)       │  toggle)  │ │
                       │  └──────┴──────────────┴───────────┘ │
                       │  Header: [Brand] ... [AI pill] [me] │
                       └──────────────────────────────────────┘
                                              │
            ┌─────────────────────────────────┴──────────────────┐
            │                                                    │
   ┌────────▼──────────┐  ┌─────────────┐  ┌──────────────┐  ┌──▼──────────────┐
   │ chatStore         │  │ aiContext   │  │ useAIStatus  │  │ chatClient      │
   │ (transcripts +    │  │ Store       │  │ (adaptive    │  │ (WebSocket)     │
   │  sessionByCluster │  │ (implicit/  │  │  poll        │  │                 │
   │  + connState)     │  │  explicit)  │  │  /status)    │  │                 │
   └───────────────────┘  └─────────────┘  └──────────────┘  └─────────────────┘
                                                                    │
                                                                    ▼
                                                        backend /api/v1/ai/chat
```

### File structure

```
kubilitics-frontend/src/
  components/ai/
    ChatPanel.tsx                  # right-side slide-out container
    ChatHeader.tsx                 # title + status pill + actions (new chat / export / close)
    ChatTranscript.tsx             # virtualized message list (react-virtual)
    ChatInput.tsx                  # textarea + send/stop button + disabled handling
    ChatStatusPill.tsx             # state indicator (used in header + sidebar)
    AskAIButton.tsx                # shared per-row + per-page button
    messages/
      Turn.tsx                     # one assistant turn (renders blocks)
      UserMessage.tsx              # user echo bubble
      SystemNotice.tsx             # "session reset" / "AI restarted" inline notices
      blocks/
        TextBlock.tsx              # markdown + code highlighter
        UnknownBlock.tsx           # forward-compat fallback
  hooks/
    useAIContext.ts                # context publish hook for pages
    useAIStatus.ts                 # adaptive polling of /api/v1/ai/status
    useAICapabilities.ts           # GET /api/v1/ai/capabilities (read-only by default)
    useChatSession.ts              # session lifecycle (create/get for active cluster)
    useChatStream.ts               # WS connection + event-to-block mapping
    useChatController.ts           # orchestrator: ensure session + open WS + send + retry
  stores/
    chatStore.ts
    aiContextStore.ts
  services/ai/
    chatClient.ts                  # WS connect/send/close (replaces "chatWsAdapter" name)
    eventMapper.ts                 # AssistantEvent → Block (pure function, testable)
    protocol.ts                    # frame envelope types
```

**New runtime deps:** `react-markdown`, `remark-gfm`, `@tanstack/react-virtual`. Existing kubilitics syntax-highlighter reused for code blocks.

---

## 3. State Stores + Data Model

### `chatStore.ts`

```ts
type AssistantTurn = {
  turnId: string
  anchorId: string                // from AssistantEvent.anchor_id
  blocks: Block[]
  state: "streaming" | "done" | "error" | "historical"
  startedAt: number
  finishedAt?: number
  error?: { code: string; message: string }
  meta?: { latencyMs?: number; promptTokens?: number; completionTokens?: number }
}

type UserTurn = {
  turnId: string
  text: string
  contextHint?: string            // serialized JSON of context at send time
  startedAt: number
}

type Turn = ({ kind: "user" } & UserTurn) | ({ kind: "assistant" } & AssistantTurn)

type Block =
  | { type: "text"; content: string; complete: boolean }
  | { type: "unknown"; raw: unknown; kind: string }    // forward-compat fallback

type ChatState = {
  panelOpen: boolean
  prefilledText?: string                    // set by AskAIButton; cleared on send

  transcripts: Record<string, Turn[]>       // key: cluster_id (volatile)
  sessionByCluster: Record<string, string>  // key: cluster_id → session_id

  connectionState: "idle" | "connecting" | "open" | "error"
  connectionError?: string
  spawnIdAtConnect?: string                 // for detecting spawn_changed
}

type ChatActions = {
  togglePanel: (open?: boolean) => void
  setPrefilled: (text: string | undefined) => void
  appendUserTurn: (clusterId: string, t: UserTurn) => void
  appendAssistantTurn: (clusterId: string, t: AssistantTurn) => void
  applyEventToActiveTurn: (clusterId: string, frame: ServerFrame) => void
  finishActiveTurn: (clusterId: string, finishedAt: number, error?: { code: string; message: string }, meta?: AssistantTurn["meta"]) => void
  markAllHistorical: (clusterId: string) => void   // on spawn_changed
  newChat: (clusterId: string) => void              // clears + drops session id
  setSession: (clusterId: string, sessionId: string | undefined) => void
  setConnectionState: (s: ChatState["connectionState"], err?: string) => void
}
```

NO Zustand `persist` middleware — refresh wipes the store.

### `aiContextStore.ts`

```ts
type AIContext = {
  type: "pod" | "deployment" | "node" | "namespace" | "service" |
        "ingress" | "event" | "cluster" | "dashboard" | "topology" | "blast-radius"
  cluster: string
  namespace?: string
  name?: string
  page?: string                              // sub-tab e.g. "yaml", "events", "logs"
  extra?: Record<string, string | number>    // free-form
}

type AIContextState = {
  implicit: AIContext | null
  explicit: AIContext | null
}

type AIContextActions = {
  setImplicit: (ctx: AIContext | null) => void
  setExplicit: (ctx: AIContext | null) => void  // null reverts to implicit
  current: () => AIContext | null               // explicit ?? implicit
}
```

**Stale-context safeguard:** chat panel reads `current()` and discards if `current.cluster !== activeCluster`. No fabrication when `current()` is null.

### WS frame protocol (`services/ai/protocol.ts`)

```ts
// Outbound (frontend → backend):
type ClientFrame =
  | { type: "user_message"; payload: { text: string; session_id: string; turn_id: string; context_hint?: string } }
  | { type: "cancel_turn"; payload: { session_id: string; turn_id: string } }

// Inbound (backend → frontend):
type ServerFrame =
  | { type: "text_delta"; payload: { anchor_id: string; text: string } }
  | { type: "done"; payload: { anchor_id: string; prompt_tokens: number; completion_tokens: number } }
  | { type: "error"; payload: { code: string; message: string } }
  // Forward-compat (subproject 3 emits these; v1 maps to UnknownBlock):
  | { type: "tool_start"; payload: any }
  | { type: "tool_end"; payload: any }
  | { type: "action_pending"; payload: any }
  | { type: "plan_proposed"; payload: any }
  | { type: "citation"; payload: any }
```

### Event → Block mapping (`services/ai/eventMapper.ts`)

Pure function — fully unit-testable without WS:

```ts
export function applyEventToTurn(turn: AssistantTurn, frame: ServerFrame): {
  turn: AssistantTurn
  finished: boolean
}
```

---

## 4. Entry Points + Context System

Six callsites in v1. Heavy logic stays in stores/hooks/services.

### Header AI pill

```tsx
<ChatStatusPill />   // state-driven dot + label, click toggles panel
```

`ChatStatusPill` reads `useAIStatus()` (1s/5s/10s/30s adaptive polling per subproject 2 spec):
- 🟢 Ready
- 🟡 Starting
- 🔴 Disabled (with reason)

### Sidebar item

```tsx
<SidebarItem icon={Sparkles} label="AI Assistant" onClick={togglePanel}>
  <ChatStatusDot />
</SidebarItem>
```

### Per-row "Ask AI" button (4 list pages: Pods, Deployments, Nodes, Events)

```tsx
<AskAIButton
  context={{ type: "pod", cluster, namespace: pod.namespace, name: pod.name }}
  promptTemplate={`Why is this pod in state ${pod.status.phase}?`}
/>
```

`AskAIButton` shared component on click:

```ts
useChatStore.getState().togglePanel(true)
useAIContextStore.getState().setExplicit(context)
useChatStore.getState().setPrefilled(promptTemplate)
focusChatInput()
```

### Per-page "Ask AI about this" button (6 detail pages)

`PodDetailPage`, `DeploymentDetailPage`, `NodeDetailPage`, `HealthDashboard`, `TopologyPage`, `BlastRadiusPage`. Place in `SectionOverviewHeader.extraActions`.

### Page context publishing (10 detail pages, identical 3-line hook)

```tsx
const setImplicit = useAIContext(s => s.setImplicit)
useEffect(() => {
  setImplicit({ type: "pod", cluster, namespace, name, page: activeTab })
  return () => setImplicit(null)
}, [cluster, namespace, name, activeTab, setImplicit])
```

### Keyboard shortcut (Cmd+I / Ctrl+I)

Global registration in `App.tsx` via existing `useKeyboardShortcuts`:

```ts
useKeyboardShortcuts([
  {
    key: "i",
    cmd: true,
    when: (e) => !isTypingInTextInput(e.target),  // never override typing
    action: () => {
      useChatStore.getState().togglePanel()
      requestAnimationFrame(focusChatInput)
    },
  },
])
```

`isTypingInTextInput`: `INPUT`/`TEXTAREA`/`contentEditable` element check.

### Behavior matrix

| Trigger | Context source | Pre-fill | Action |
|---|---|---|---|
| Cmd+I | implicit (current page) | none | open + focus |
| Header pill click | implicit | none | toggle |
| Sidebar item | implicit | none | open |
| Per-row AskAI | explicit (row data) | template | open + focus + select pre-fill |
| Per-page AskAI | explicit (page data) | template | open + focus + select pre-fill |

Pre-fill text is auto-selected (type-to-replace works naturally), editable, never auto-sent.

### Cluster-switch behavior

When `activeCluster` changes:
1. Save scroll position of outgoing transcript.
2. Load new cluster's transcript from `transcripts[newClusterId]` (or empty).
3. Load new cluster's session id from `sessionByCluster[newClusterId]` (or undefined → lazy-create on first send).
4. Drop any explicit context (cluster mismatch).
5. Implicit context refreshes naturally as new pages mount.

---

## 5. WS Lifecycle + Streaming UX

### `useChatController` orchestration

```
User clicks Send / presses Enter
        │
        ▼
useChatController.sendMessage(text)
   1. Resolve context: aiContextStore.current() filtered for cluster match
   2. Ensure session: sessionByCluster[activeCluster] || createSession(activeCluster)
   3. Ensure WS open: chatClient.ensureOpen(activeCluster)
   4. appendUserTurn (optimistic)
   5. Send {type:"user_message", payload:{text, session_id, turn_id, context_hint}}
   6. Server streams text_delta frames → eventMapper.applyEventToTurn() → store update
   7. On {type:"done"}: finishActiveTurn(latencyMs, tokens)
   8. On {type:"error"}: finishActiveTurn(error), inline ErrorNotice
```

### Connection states

| State | When | UI |
|---|---|---|
| `idle` | Panel never opened OR closed cleanly | (panel closed) |
| `connecting` | After `ensureOpen()`, waiting for upgrade | Subtle "connecting…" footer |
| `open` | WS upgrade succeeded | Normal — input enabled |
| `error` | WS dropped / upgrade failed | "Reconnecting in Ns…" + manual Retry button |

**Reconnect:** exponential backoff 1s → 2s → 4s → 8s → 16s, capped at 30s. Auto-reconnects up to 5 attempts; after that show "Connection lost — Retry" button. Pending optimistic user turn stays visible during reconnect; auto-replay only if no response was ever received (prevents double-billing tokens). Otherwise leave it with a per-message Retry affordance.

### Streaming render

While an assistant turn is `state: "streaming"`:
- TextBlock content updates as deltas arrive; `react-markdown` re-renders incrementally.
- Subtle blinking cursor `▍` at the end (CSS animation, no JS re-renders).
- Code blocks render the moment closing ` ``` ` arrives; partial code blocks show as a "code (streaming)" placeholder bar (avoids jumpy half-formed code blocks). This is the only render-deferral; everything else is live.
- "Stop" button replaces "Send" → click sends `{type:"cancel_turn"}` frame; sidecar's `Chat.CancelTurn` RPC fires server-side context cancel. UI flips turn state to `done` with a "(stopped)" suffix.

### `spawn_changed` handling

Triggered when WS pushes a frame with code `Aborted` + reason `spawn_changed`:

```
1. chatStore.markAllHistorical(activeCluster)
   → all turns get state:"historical", visual: 60% opacity + "Session reset" divider
2. chatStore.setSession(activeCluster, undefined)
   → next send creates fresh session
3. ChatInput renders disabled, placeholder: "Session expired — start a new chat"
4. Inline SystemNotice: "AI restarted. Start a new chat to continue."
5. ChatHeader's "New chat" button becomes primary affordance (highlighted).
```

User clicks "New chat" → `chatStore.newChat(activeCluster)` clears the cluster's transcript (historical messages dropped) → next message creates fresh session. Identical behavior whether reset came from spawn_changed, idle-shutdown, or explicit user action.

---

## 6. Testing

| Layer | What | How |
|---|---|---|
| **Unit** | `eventMapper.applyEventToTurn` for every ServerFrame variant; `chatStore` reducers; `aiContextStore` precedence rule | Vitest, no DOM, no WS |
| **Hook** | `useChatController` happy path + reconnect + spawn_changed; `useAIContext` mount/unmount cleanup; `useAIStatus` adaptive polling intervals | RTL `renderHook` with mocked chatClient |
| **Component** | `<ChatPanel>` open/close transitions; `<Turn>` rendering for every block type incl. UnknownBlock; `<AskAIButton>` click → store updates; `<ChatInput>` disabled states | React Testing Library |
| **Integration (mocked WS)** | Full panel flow: open → type → see streaming TextDelta → see Done → token count in footer | RTL + custom WS mock emitting canned ServerFrames |
| **Integration (mocked spawn_changed)** | WS emits Aborted frame mid-turn → panel marks historical → input disables → New chat clears | same harness |
| **E2E (Playwright)** | One smoke: open panel via Cmd+I, type "hi", see streaming response from a stub backend | Playwright + backend proxying to kotg-ai-server stub binary from subproject 2 |

**Coverage gaps explicitly accepted in v1:**
- No real-LLM E2E in CI (cost, flakiness — Ollama not always running).
- No visual-regression tests for streaming animation (manual sign-off).
- No tests for ActionPending/PlanProposed/Citation rendering — those land with subproject 3's UI.

---

## 7. Rollout

1. **Build behind capability gating.** `useAICapabilities()` returns `{ready, capabilities, disabledReason}`. Header pill always visible (state varies). Chat panel renders only when `ready === true`. Sidebar item shown but disabled when AI off. Per-row `<AskAIButton>` doesn't render at all when AI off (zero clutter on existing pages).

2. **Feature flag = backend `ai.enabled`.** Already wired in subproject 2. No frontend feature flag — UI follows the backend's truth via `/api/v1/ai/status`.

3. **Internal dogfood first.** Local dev cluster: `ai.enabled=true`, `ai.binaryPath=/tmp/kotg-ai-server`, Ollama running with `qwen2.5-coder:7b`. Validate full vertical slice: type a question on Pod detail → context auto-populated → streaming response → New chat → historical mark on sidecar restart.

4. **Helm + Tauri packaging follow-ups (NOT in this subproject).** Tauri sidecar packaging (subproject 7) embeds the binary in the desktop app. Helm sub-chart (subproject 8) ships it as sidecar container. Until those land, only local-dev users see the AI panel.

5. **First public beta.** Once subproject 7 lands and a desktop user can chat with their cluster, tag `v1.x.0-beta.1` on `vellankikoti/kubilitics`. Per the freeze rule: NEVER push to the kubilitics/* org repo.

---

## 8. Out of Scope (Later Subprojects)

| Concern | Subproject |
|---|---|
| ActionPending / PlanProposed approval UI | 6 — Action approval flow UI (after subproject 3 ships the gate) |
| Citation rendering with clickable anchors | 6 |
| Tool execution timeline (ToolStart/ToolEnd) | 6 |
| Multi-session UI (sidebar inside panel) | v1.5 — AI Sessions |
| Cross-page conversation continuity | v2 (requires server-side session persistence) |
| Search across past conversations | v2 |
| Voice input | v2+ |
| "AI Anywhere" — extending entry points to all 60+ pages | v1.5 |
| Configurable system prompt via UI | v1.5 |
| Token-cost display per turn | subproject 10 (cost dashboards) |
