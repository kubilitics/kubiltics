import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Turn as TurnType } from '@/stores/chatStore';
import { Turn } from './messages/Turn';
import { UserMessage } from './messages/UserMessage';
import { SystemNotice } from './messages/SystemNotice';

interface Props {
  turns: TurnType[];
  systemNotices?: { id: string; message: string; afterIndex: number }[];
}

export function ChatTranscript({ turns, systemNotices = [] }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);

  type Item = { kind: 'turn'; turn: TurnType } | { kind: 'notice'; message: string; id: string };
  const items: Item[] = [];
  turns.forEach((t, i) => {
    items.push({ kind: 'turn', turn: t });
    const noticesHere = systemNotices.filter((n) => n.afterIndex === i);
    noticesHere.forEach((n) => items.push({ kind: 'notice', message: n.message, id: n.id }));
  });

  const virt = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 6,
  });

  useEffect(() => {
    if (items.length > 0) {
      virt.scrollToIndex(items.length - 1, { align: 'end' });
    }
  }, [items.length, virt]);

  if (items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-6">
        Ask me anything about your cluster.
      </div>
    );
  }

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto px-4 py-2">
      <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
        {virt.getVirtualItems().map((vi) => {
          const item = items[vi.index]!;
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={virt.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`,
              }}
            >
              {item.kind === 'turn' && item.turn.kind === 'user' && <UserMessage turn={item.turn} />}
              {item.kind === 'turn' && item.turn.kind === 'assistant' && <Turn turn={item.turn} />}
              {item.kind === 'notice' && <SystemNotice message={item.message} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
