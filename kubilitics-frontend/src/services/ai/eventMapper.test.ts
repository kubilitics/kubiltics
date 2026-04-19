import { describe, it, expect } from 'vitest';
import { applyEventToTurn } from './eventMapper';
import type { AssistantTurn } from '@/stores/chatStore';

const baseTurn: AssistantTurn = {
  turnId: 't1', anchorId: 'a1', blocks: [], state: 'streaming', startedAt: 0,
};

describe('eventMapper.applyEventToTurn', () => {
  it('text_delta appends to growing TextBlock', () => {
    const r1 = applyEventToTurn(baseTurn, { type: 'text_delta', payload: { anchor_id: 'a1', text: 'hi ' } });
    const r2 = applyEventToTurn(r1.turn, { type: 'text_delta', payload: { anchor_id: 'a1', text: 'world' } });
    expect(r2.turn.blocks).toHaveLength(1);
    expect((r2.turn.blocks[0] as { content: string }).content).toBe('hi world');
    expect(r2.finished).toBe(false);
  });

  it('done returns finished=true', () => {
    const r = applyEventToTurn(baseTurn, { type: 'done', payload: { anchor_id: 'a1', prompt_tokens: 1, completion_tokens: 2 } });
    expect(r.finished).toBe(true);
  });

  it('error returns finished=true', () => {
    const r = applyEventToTurn(baseTurn, { type: 'error', payload: { code: 'Internal', message: 'boom' } });
    expect(r.finished).toBe(true);
  });

  it('unknown variant becomes UnknownBlock', () => {
    const r = applyEventToTurn(baseTurn, { type: 'plan_proposed', payload: { plan_id: 'p1' } } as never);
    expect(r.turn.blocks[0]).toMatchObject({ type: 'unknown', kind: 'plan_proposed' });
    expect(r.finished).toBe(false);
  });
});
