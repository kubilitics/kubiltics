import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './chatStore';

const reset = () => {
  useChatStore.setState(useChatStore.getState().__resetForTests(), true);
};

describe('chatStore', () => {
  beforeEach(reset);

  it('togglePanel toggles when no arg', () => {
    expect(useChatStore.getState().panelOpen).toBe(false);
    useChatStore.getState().togglePanel();
    expect(useChatStore.getState().panelOpen).toBe(true);
    useChatStore.getState().togglePanel();
    expect(useChatStore.getState().panelOpen).toBe(false);
  });

  it('togglePanel sets explicitly when given arg', () => {
    useChatStore.getState().togglePanel(true);
    expect(useChatStore.getState().panelOpen).toBe(true);
    useChatStore.getState().togglePanel(true);
    expect(useChatStore.getState().panelOpen).toBe(true);
  });

  it('appendUserTurn adds to per-cluster transcript', () => {
    useChatStore.getState().appendUserTurn('c1', {
      turnId: 't1', text: 'hi', startedAt: 1,
    });
    expect(useChatStore.getState().transcripts['c1']).toHaveLength(1);
    expect(useChatStore.getState().transcripts['c2']).toBeUndefined();
  });

  it('appendAssistantTurn starts streaming', () => {
    useChatStore.getState().appendAssistantTurn('c1', {
      turnId: 't1', anchorId: 'a1', blocks: [], state: 'streaming', startedAt: 1,
    });
    const turns = useChatStore.getState().transcripts['c1'];
    expect(turns[0].kind).toBe('assistant');
    if (turns[0].kind === 'assistant') {
      expect(turns[0].state).toBe('streaming');
    }
  });

  it('applyEventToActiveTurn appends text_delta', () => {
    useChatStore.getState().appendAssistantTurn('c1', {
      turnId: 't1', anchorId: 'a1', blocks: [], state: 'streaming', startedAt: 1,
    });
    useChatStore.getState().applyEventToActiveTurn('c1', {
      type: 'text_delta', payload: { anchor_id: 'a1', text: 'hello ' },
    });
    useChatStore.getState().applyEventToActiveTurn('c1', {
      type: 'text_delta', payload: { anchor_id: 'a1', text: 'world' },
    });
    const turn = useChatStore.getState().transcripts['c1'][0];
    if (turn.kind !== 'assistant') throw new Error('expected assistant');
    expect(turn.blocks).toHaveLength(1);
    expect(turn.blocks[0]).toEqual({ type: 'text', content: 'hello world', complete: false });
  });

  it('finishActiveTurn marks block complete and turn done', () => {
    useChatStore.getState().appendAssistantTurn('c1', {
      turnId: 't1', anchorId: 'a1', blocks: [], state: 'streaming', startedAt: 1,
    });
    useChatStore.getState().applyEventToActiveTurn('c1', {
      type: 'text_delta', payload: { anchor_id: 'a1', text: 'hi' },
    });
    useChatStore.getState().finishActiveTurn('c1', 100, undefined, { promptTokens: 10, completionTokens: 5 });
    const turn = useChatStore.getState().transcripts['c1'][0];
    if (turn.kind !== 'assistant') throw new Error('expected assistant');
    expect(turn.state).toBe('done');
    expect(turn.finishedAt).toBe(100);
    expect(turn.meta?.promptTokens).toBe(10);
    expect((turn.blocks[0] as { complete: boolean }).complete).toBe(true);
  });

  it('markAllHistorical flips every turn', () => {
    useChatStore.getState().appendUserTurn('c1', { turnId: 'u1', text: 'a', startedAt: 1 });
    useChatStore.getState().appendAssistantTurn('c1', {
      turnId: 't1', anchorId: 'a1', blocks: [], state: 'done', startedAt: 1, finishedAt: 2,
    });
    useChatStore.getState().markAllHistorical('c1');
    const turns = useChatStore.getState().transcripts['c1'];
    for (const t of turns) {
      if (t.kind === 'assistant') expect(t.state).toBe('historical');
    }
  });

  it('newChat clears the cluster transcript and session', () => {
    useChatStore.getState().setSession('c1', 'sess-1');
    useChatStore.getState().appendUserTurn('c1', { turnId: 'u1', text: 'a', startedAt: 1 });
    useChatStore.getState().newChat('c1');
    expect(useChatStore.getState().transcripts['c1']).toEqual([]);
    expect(useChatStore.getState().sessionByCluster['c1']).toBeUndefined();
  });

  it('unknown ServerFrame variant becomes UnknownBlock', () => {
    useChatStore.getState().appendAssistantTurn('c1', {
      turnId: 't1', anchorId: 'a1', blocks: [], state: 'streaming', startedAt: 1,
    });
    // Pick a variant the reducer has no explicit case for — the whole point
    // of this test is the default-branch fallback. Do NOT use a real variant
    // like plan_proposed; the reducer grew a real case for it and this
    // assertion regressed once already.
    useChatStore.getState().applyEventToActiveTurn('c1', {
      type: 'some_frame_the_reducer_does_not_know', payload: { whatever: 1 },
    } as never);
    const turn = useChatStore.getState().transcripts['c1'][0];
    if (turn.kind !== 'assistant') throw new Error('expected assistant');
    expect(turn.blocks[0]).toMatchObject({
      type: 'unknown',
      kind: 'some_frame_the_reducer_does_not_know',
    });
  });
});
