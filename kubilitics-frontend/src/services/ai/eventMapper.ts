import type { AssistantTurn, Block } from '@/stores/chatStore';
import type { ServerFrame } from './protocol';

export function applyEventToTurn(
  turn: AssistantTurn,
  frame: ServerFrame
): { turn: AssistantTurn; finished: boolean } {
  switch (frame.type) {
    case 'text_delta': {
      const lastBlock = turn.blocks[turn.blocks.length - 1];
      let blocks: Block[];
      if (lastBlock && lastBlock.type === 'text' && !lastBlock.complete) {
        blocks = turn.blocks.slice(0, -1).concat({
          ...lastBlock,
          content: lastBlock.content + frame.payload.text,
        });
      } else {
        blocks = [...turn.blocks, { type: 'text', content: frame.payload.text, complete: false }];
      }
      return { turn: { ...turn, blocks }, finished: false };
    }
    case 'done':
      return { turn, finished: true };
    case 'error':
      return { turn, finished: true };
    case 'render_block': {
      // Seal any open text block so the structured render appears
      // after prose the LLM emitted earlier in this turn.
      const blocks: Block[] = turn.blocks.map((b) =>
        b.type === 'text' && !b.complete ? { ...b, complete: true } : b,
      );
      blocks.push({
        type: 'render_block',
        renderType: frame.payload.render?.type ?? 'render_error',
        data: frame.payload.render?.data ?? null,
        summary: frame.payload.summary,
      });
      return { turn: { ...turn, blocks }, finished: false };
    }
    default:
      return {
        turn: {
          ...turn,
          blocks: [
            ...turn.blocks,
            { type: 'unknown', raw: (frame as { payload?: unknown }).payload, kind: frame.type },
          ],
        },
        finished: false,
      };
  }
}
