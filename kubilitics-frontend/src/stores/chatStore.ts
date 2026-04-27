import { create } from 'zustand';
import type { ServerFrame } from '@/services/ai/protocol';
import { onClusterSwitch } from './clusterSwitch';

export type Block =
  | { type: 'text'; content: string; complete: boolean }
  | {
      type: 'tool';
      callId: string;
      toolName: string;
      startPreview?: string;
      endPreview?: string;
      ok?: boolean;
      startedAt: number;
      endedAt?: number;
    }
  | {
      type: 'action_pending';
      proposalId: string;
      tier?: number | string;
      summary: string;
      diff?: unknown;
    }
  | {
      type: 'plan_proposed';
      planId: string;
      summary: string;
      steps?: Array<{ title?: string; description?: string }>;
    }
  | { type: 'citation'; toolCallId?: string; title?: string; url?: string }
  | {
      // render_block carries opaque structured data shipped by the
      // brain for Deterministic tools — rendered directly by the
      // type-keyed dispatcher (no LLM paraphrasing).
      type: 'render_block';
      renderType: string;
      data: unknown;
      summary?: string;
    }
  | { type: 'unknown'; raw: unknown; kind: string };

export type AssistantTurn = {
  turnId: string;
  anchorId: string;
  blocks: Block[];
  state: 'streaming' | 'done' | 'error' | 'historical';
  startedAt: number;
  finishedAt?: number;
  error?: { code: string; message: string };
  meta?: {
    latencyMs?: number;
    promptTokens?: number;
    completionTokens?: number;
    /** brain's AssistantEvent_Done.FinishReason: "stop" | "error" | "cancel" | "budget" */
    finishReason?: string;
    /** True when the turn ended without reaching the model's natural stop. */
    partial?: boolean;
    /** Count of MCP tool calls the model made in this turn. Derived in the
     *  store from tool_end frames so Turn.tsx can render "3 tools" next to
     *  tokens without scanning blocks. */
    toolCalls?: number;
  };
};

export type UserTurn = {
  turnId: string;
  text: string;
  contextHint?: string;
  startedAt: number;
};

export type Turn =
  | ({ kind: 'user' } & UserTurn)
  | ({ kind: 'assistant' } & AssistantTurn);

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'error';

interface ChatState {
  panelOpen: boolean;
  prefilledText?: string;
  transcripts: Record<string, Turn[]>;
  sessionByCluster: Record<string, string>;
  connectionState: ConnectionState;
  connectionError?: string;
  spawnIdAtConnect?: string;

  togglePanel: (open?: boolean) => void;
  setPrefilled: (text: string | undefined) => void;
  appendUserTurn: (clusterId: string, t: UserTurn) => void;
  appendAssistantTurn: (clusterId: string, t: AssistantTurn) => void;
  applyEventToActiveTurn: (clusterId: string, frame: ServerFrame) => void;
  finishActiveTurn: (
    clusterId: string,
    finishedAt: number,
    error?: { code: string; message: string },
    meta?: AssistantTurn['meta']
  ) => void;
  markAllHistorical: (clusterId: string) => void;
  newChat: (clusterId: string) => void;
  setSession: (clusterId: string, sessionId: string | undefined) => void;
  setConnectionState: (s: ConnectionState, err?: string) => void;
  setSpawnIdAtConnect: (id: string | undefined) => void;
  __resetForTests: () => Partial<ChatState>;
}

const INITIAL: Partial<ChatState> = {
  panelOpen: false,
  prefilledText: undefined,
  transcripts: {},
  sessionByCluster: {},
  connectionState: 'idle',
  connectionError: undefined,
  spawnIdAtConnect: undefined,
};

export const useChatStore = create<ChatState>((set, get) => ({
  ...(INITIAL as ChatState),

  togglePanel: (open) =>
    set((s) => ({ panelOpen: open === undefined ? !s.panelOpen : open })),

  setPrefilled: (text) => set({ prefilledText: text }),

  appendUserTurn: (clusterId, t) =>
    set((s) => ({
      transcripts: {
        ...s.transcripts,
        [clusterId]: [...(s.transcripts[clusterId] ?? []), { kind: 'user', ...t }],
      },
    })),

  appendAssistantTurn: (clusterId, t) =>
    set((s) => ({
      transcripts: {
        ...s.transcripts,
        [clusterId]: [...(s.transcripts[clusterId] ?? []), { kind: 'assistant', ...t }],
      },
    })),

  applyEventToActiveTurn: (clusterId, frame) =>
    set((s) => {
      const turns = s.transcripts[clusterId] ?? [];
      if (turns.length === 0) return s;
      const lastIdx = turns.length - 1;
      const last = turns[lastIdx];
      if (last.kind !== 'assistant') return s;

      const updated = applyFrameToTurn(last, frame);
      const newTurns = turns.slice(0, lastIdx).concat(updated);
      return { transcripts: { ...s.transcripts, [clusterId]: newTurns } };
    }),

  finishActiveTurn: (clusterId, finishedAt, error, meta) =>
    set((s) => {
      const turns = s.transcripts[clusterId] ?? [];
      if (turns.length === 0) return s;
      const lastIdx = turns.length - 1;
      const last = turns[lastIdx];
      if (last.kind !== 'assistant') return s;
      // Force-finalize every block on turn completion. Text blocks lose the
      // streaming cursor; tool blocks that never received their tool_end (LLM
      // crashed mid-tool, network drop, brain timeout) are marked failed so
      // the spinner doesn't loop forever.
      const completedBlocks = last.blocks.map((b) => {
        if (b.type === 'text') return { ...b, complete: true };
        if (b.type === 'tool' && b.endedAt === undefined) {
          return {
            ...b,
            ok: false,
            endedAt: finishedAt,
            endPreview: b.endPreview ?? 'Tool did not complete before the turn ended.',
          };
        }
        return b;
      });
      const finished: Turn = {
        ...last,
        kind: 'assistant',
        state: error ? 'error' : 'done',
        blocks: completedBlocks,
        finishedAt,
        error,
        meta: { ...last.meta, ...meta, latencyMs: finishedAt - last.startedAt },
      };
      const newTurns = turns.slice(0, lastIdx).concat(finished);
      return { transcripts: { ...s.transcripts, [clusterId]: newTurns } };
    }),

  markAllHistorical: (clusterId) =>
    set((s) => {
      const turns = s.transcripts[clusterId] ?? [];
      const flipped = turns.map((t) =>
        t.kind === 'assistant' ? ({ ...t, state: 'historical' as const }) : t
      );
      return { transcripts: { ...s.transcripts, [clusterId]: flipped } };
    }),

  newChat: (clusterId) =>
    set((s) => {
      const nextTranscripts = { ...s.transcripts, [clusterId]: [] };
      const nextSessions = { ...s.sessionByCluster };
      delete nextSessions[clusterId];
      return { transcripts: nextTranscripts, sessionByCluster: nextSessions };
    }),

  setSession: (clusterId, sessionId) =>
    set((s) => {
      const next = { ...s.sessionByCluster };
      if (sessionId) next[clusterId] = sessionId;
      else delete next[clusterId];
      return { sessionByCluster: next };
    }),

  setConnectionState: (state, err) =>
    set({ connectionState: state, connectionError: err }),

  setSpawnIdAtConnect: (id) => set({ spawnIdAtConnect: id }),

  __resetForTests: () => ({ ...get(), ...INITIAL }),
}));

function applyFrameToTurn(turn: AssistantTurn & { kind: 'assistant' }, frame: ServerFrame): Turn {
  switch (frame.type) {
    case 'text_delta': {
      const lastBlock = turn.blocks[turn.blocks.length - 1];
      if (lastBlock && lastBlock.type === 'text' && !lastBlock.complete) {
        const updated = {
          ...lastBlock,
          content: lastBlock.content + (frame.payload as { text: string }).text,
        };
        return {
          ...turn,
          kind: 'assistant',
          blocks: turn.blocks.slice(0, -1).concat(updated),
        };
      }
      return {
        ...turn,
        kind: 'assistant',
        blocks: [
          ...turn.blocks,
          { type: 'text', content: (frame.payload as { text: string }).text, complete: false },
        ],
      };
    }
    case 'tool_start': {
      const p = (frame.payload ?? {}) as {
        tool_call_id?: string;
        tool_name?: string;
        preview?: string;
      };
      // Seal the currently-streaming text block so the tool renders after the
      // text the AI has produced so far; any subsequent text_delta starts a
      // fresh block after the tool.
      const sealed = sealLastOpenText(turn.blocks);
      return {
        ...turn,
        kind: 'assistant',
        blocks: [
          ...sealed,
          {
            type: 'tool',
            callId: p.tool_call_id ?? `call-${turn.blocks.length}`,
            toolName: p.tool_name ?? 'tool',
            startPreview: p.preview,
            startedAt: Date.now(),
          },
        ],
      };
    }
    case 'tool_end': {
      const p = (frame.payload ?? {}) as {
        tool_call_id?: string;
        ok?: boolean;
        preview?: string;
      };
      const updated = turn.blocks.map((b) => {
        if (b.type === 'tool' && b.callId === p.tool_call_id && b.endedAt === undefined) {
          return { ...b, ok: !!p.ok, endPreview: p.preview, endedAt: Date.now() };
        }
        return b;
      });
      return { ...turn, kind: 'assistant', blocks: updated };
    }
    case 'action_pending': {
      const p = (frame.payload ?? {}) as {
        proposal_id?: string;
        tier?: number | string;
        summary?: string;
        diff?: unknown;
      };
      return {
        ...turn,
        kind: 'assistant',
        blocks: [
          ...sealLastOpenText(turn.blocks),
          {
            type: 'action_pending',
            proposalId: p.proposal_id ?? `proposal-${turn.blocks.length}`,
            tier: p.tier,
            summary: p.summary ?? 'AI wants to run an action.',
            diff: p.diff,
          },
        ],
      };
    }
    case 'plan_proposed': {
      const p = (frame.payload ?? {}) as {
        plan_id?: string;
        summary?: string;
        steps?: Array<{ title?: string; description?: string }>;
      };
      return {
        ...turn,
        kind: 'assistant',
        blocks: [
          ...sealLastOpenText(turn.blocks),
          {
            type: 'plan_proposed',
            planId: p.plan_id ?? `plan-${turn.blocks.length}`,
            summary: p.summary ?? '',
            steps: p.steps,
          },
        ],
      };
    }
    case 'citation': {
      const p = (frame.payload ?? {}) as {
        tool_call_id?: string;
        title?: string;
        url?: string;
      };
      return {
        ...turn,
        kind: 'assistant',
        blocks: [
          ...turn.blocks,
          { type: 'citation', toolCallId: p.tool_call_id, title: p.title, url: p.url },
        ],
      };
    }
    case 'render_block': {
      const p = (frame.payload ?? {}) as {
        render?: { type?: string; data?: unknown };
        summary?: string;
      };
      // Seal the currently-streaming text block so the structured
      // render appears after any prose the LLM emitted in this turn.
      const sealed = sealLastOpenText(turn.blocks);
      return {
        ...turn,
        kind: 'assistant',
        blocks: [
          ...sealed,
          {
            type: 'render_block',
            renderType: p.render?.type ?? 'render_error',
            data: p.render?.data ?? null,
            summary: p.summary,
          },
        ],
      };
    }
    case 'done':
    case 'error':
      return turn;
    default:
      return {
        ...turn,
        kind: 'assistant',
        blocks: [
          ...turn.blocks,
          { type: 'unknown', raw: (frame as { payload?: unknown }).payload, kind: frame.type },
        ],
      };
  }
}

/** Seal (mark complete) the last text block if it is currently streaming, so
 *  a subsequent non-text block renders in the right place and any later
 *  text_delta creates a fresh block after the interstitial. */
function sealLastOpenText(blocks: Block[]): Block[] {
  const last = blocks[blocks.length - 1];
  if (last && last.type === 'text' && !last.complete) {
    return blocks.slice(0, -1).concat({ ...last, complete: true });
  }
  return blocks;
}

// Phase 2 / Gap 4 — drop the per-cluster chat transcripts on cluster
// switch. The brain keeps sessions persisted server-side (B.3/B.4), so
// re-selecting the previous cluster will re-hydrate its history.
// Clearing here prevents a stale cluster's transcript from flashing
// during the switch transition.
onClusterSwitch(() => {
  useChatStore.setState({
    transcripts: {},
    sessionByCluster: {},
    connectionState: 'idle',
    connectionError: undefined,
    spawnIdAtConnect: undefined,
  });
});
