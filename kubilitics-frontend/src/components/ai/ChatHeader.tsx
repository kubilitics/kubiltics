import { Button } from '@/components/ui/button';
import { useChatStore, type Turn } from '@/stores/chatStore';
import { useClusterStore } from '@/stores/clusterStore';
import { ChatStatusPill } from './ChatStatusPill';
import { Plus, Copy, X } from 'lucide-react';
import { toast } from 'sonner';

export function ChatHeader() {
  const togglePanel = useChatStore((s) => s.togglePanel);
  const newChat = useChatStore((s) => s.newChat);
  const transcripts = useChatStore((s) => s.transcripts);
  const activeCluster = useClusterStore((s) => s.activeCluster);

  const onNewChat = () => {
    if (activeCluster) newChat(activeCluster.id);
  };

  const onCopy = async () => {
    if (!activeCluster) return;
    const turns = transcripts[activeCluster.id] ?? [];
    const text = turnsToText(turns);
    await navigator.clipboard.writeText(text);
    toast.success('Transcript copied');
  };

  return (
    <div className="flex items-center justify-between border-b px-3 py-2">
      <div className="flex items-center gap-2">
        <ChatStatusPill variant="pill" />
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onNewChat} aria-label="New chat">
          <Plus className="h-3.5 w-3.5 mr-1" />
          <span className="text-xs">New chat</span>
        </Button>
        <Button variant="ghost" size="icon" onClick={onCopy} aria-label="Copy transcript">
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => togglePanel(false)} aria-label="Close panel">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function turnsToText(turns: Turn[]): string {
  return turns.map((t) => {
    if (t.kind === 'user') return `You: ${t.text}`;
    const text = t.blocks
      .filter((b) => b.type === 'text')
      .map((b) => (b as { content: string }).content)
      .join('');
    return `AI: ${text}`;
  }).join('\n\n');
}
