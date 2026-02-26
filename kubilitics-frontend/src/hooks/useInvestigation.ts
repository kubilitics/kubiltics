import { useState, useRef, useCallback, useEffect } from 'react';
import * as aiService from '../services/aiService';
import type {
  Investigation,
  InvestigationEvent,
  InvestigationState,
  Finding,
  InvestigationStep,
  ToolCallRecord,
  InvestigationEventType,
  LLMToolEvent
} from '../services/aiService';

// ─── Hook state ───────────────────────────────────────────────────────────────

export interface InvestigationStreamState {
  investigation: Investigation | null;
  events: InvestigationEvent[];
  streamText: string;     // accumulated text tokens from LLM
  isStreaming: boolean;
  error: string | null;
}

// ─── useStartInvestigation ────────────────────────────────────────────────────

/**
 * Starts a new investigation and opens a WebSocket stream for real-time events.
 */
export function useInvestigation() {
  const [state, setState] = useState<InvestigationStreamState>({
    investigation: null,
    events: [],
    streamText: '',
    isStreaming: false,
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    clearPolling();
  }, [clearPolling]);

  // Cleanup on unmount
  useEffect(() => () => disconnect(), [disconnect]);

  /** Poll the REST endpoint to pick up state if WS fails. */
  const startPolling = useCallback((id: string) => {
    clearPolling();
    pollingRef.current = setInterval(async () => {
      try {
        const inv = await aiService.getInvestigation(id);
        setState(prev => ({ ...prev, investigation: inv }));
        if (
          inv.state === 'CONCLUDED' ||
          inv.state === 'FAILED' ||
          inv.state === 'CANCELLED'
        ) {
          clearPolling();
          setState(prev => ({ ...prev, isStreaming: false }));
        }
      } catch {
        // ignore polling errors
      }
    }, 2000);
  }, [clearPolling]);

  /** Open WebSocket stream for an existing investigation ID. */
  const connectStream = useCallback(
    (id: string) => {
      disconnect();

      const wsUrl = aiService.buildInvestigationWSUrl(id);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setState(prev => ({ ...prev, isStreaming: true, error: null }));
      };

      ws.onmessage = (msg) => {
        try {
          const ev: InvestigationEvent = JSON.parse(msg.data);

          setState(prev => {
            const events = [...prev.events, ev];
            let streamText = prev.streamText;
            let investigation = prev.investigation;

            if (ev.type === 'text' && ev.text_token) {
              streamText += ev.text_token;
            }

            // Merge findings and steps into local investigation snapshot
            if (investigation) {
              if (ev.type === 'finding' && ev.finding) {
                investigation = {
                  ...investigation,
                  state: ev.state,
                  findings: [...investigation.findings, ev.finding],
                };
              } else if (ev.type === 'step' && ev.step) {
                const existingIdx = investigation.steps.findIndex(
                  s => s.description === ev.step!.description
                );
                const steps = [...investigation.steps];
                if (existingIdx >= 0) {
                  steps[existingIdx] = ev.step;
                } else {
                  steps.push(ev.step);
                }
                investigation = { ...investigation, state: ev.state, steps };
              } else if (ev.type === 'conclusion' && ev.conclusion) {
                investigation = {
                  ...investigation,
                  state: ev.state,
                  conclusion: ev.conclusion,
                };
              } else if (ev.type === 'tool' && ev.tool_event?.phase === 'result') {
                const te = ev.tool_event;
                const rec: ToolCallRecord = {
                  tool_name: te.tool_name,
                  args: te.args ?? {},
                  result: te.result ?? '',
                  turn_index: te.turn_index,
                  timestamp: ev.timestamp,
                };
                investigation = {
                  ...investigation,
                  state: ev.state,
                  tool_calls: [...investigation.tool_calls, rec],
                };
              } else {
                investigation = { ...investigation, state: ev.state };
              }
            }

            return { ...prev, events, streamText, investigation };
          });

          if (ev.type === 'done') {
            // Fetch final state from REST to get full investigation
            aiService.getInvestigation(id)
              .then(inv =>
                setState(prev => ({ ...prev, investigation: inv, isStreaming: false }))
              )
              .catch(() => setState(prev => ({ ...prev, isStreaming: false })));
            ws.close();
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onerror = () => {
        setState(prev => ({
          ...prev,
          error: 'WebSocket error — falling back to polling',
          isStreaming: false,
        }));
        startPolling(id);
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
      };
    },
    [disconnect, startPolling]
  );

  /** Start a new investigation. Returns the investigation ID. */
  const startInvestigation = useCallback(
    async (description: string, type = 'general'): Promise<string> => {
      setState({
        investigation: null,
        events: [],
        streamText: '',
        isStreaming: false,
        error: null,
      });

      let resp: { id: string; type: string; description: string; state: string };
      try {
        resp = await aiService.createInvestigation({ description, type });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setState(prev => ({ ...prev, error: `Failed to start: ${msg}` }));
        throw err;
      }

      const inv: Investigation = {
        id: resp.id,
        type: resp.type,
        state: (resp.state as InvestigationState) || 'CREATED',
        description: resp.description,
        context: '',
        findings: [],
        tool_calls: [],
        conclusion: '',
        confidence: 0,
        steps: [],
        tokens_used: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {},
      };

      setState(prev => ({ ...prev, investigation: inv }));
      connectStream(resp.id);
      return resp.id;
    },
    [connectStream]
  );

  /** Cancel an in-progress investigation. */
  const cancelInvestigation = useCallback(
    async (id: string) => {
      await aiService.cancelInvestigation(id);
      disconnect();
      setState(prev => ({
        ...prev,
        isStreaming: false,
        investigation: prev.investigation
          ? { ...prev.investigation, state: 'CANCELLED' }
          : null,
      }));
    },
    [disconnect]
  );

  return {
    ...state,
    startInvestigation,
    cancelInvestigation,
    disconnect,
  };
}

// ─── useInvestigationList ─────────────────────────────────────────────────────

export function useInvestigationList() {
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await aiService.listInvestigations();
      setInvestigations(resp.investigations ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { investigations, loading, error, reload: load };
}
