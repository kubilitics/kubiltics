import { create } from 'zustand';
import type { ServerFrame } from '@/services/ai/protocol';

export type Block =
  | { type: 'text'; content: string; complete: boolean }
  | { type: 'unknown'; raw: unknown; kind: string };

export type AssistantTurn = {
  turnId: string;
  anchorId: string;
  blocks: Block[];
  state: 'streaming' | 'done' | 'error' | 'historical';
  startedAt: number;
  finishedAt?: number;
  error?: { code: string; message: string };
  meta?: { latencyMs?: number; promptTokens?: number; completionTokens?: number };
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
      const completedBlocks = last.blocks.map((b) =>
        b.type === 'text' ? { ...b, complete: true } : b
      );
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
        const updated = { ...lastBlock, content: lastBlock.content + (frame.payload as { text: string }).text };
        return {
          ...turn,
          kind: 'assistant',
          blocks: turn.blocks.slice(0, -1).concat(updated),
        };
      }
      return {
        ...turn,
        kind: 'assistant',
        blocks: [...turn.blocks, { type: 'text', content: (frame.payload as { text: string }).text, complete: false }],
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
