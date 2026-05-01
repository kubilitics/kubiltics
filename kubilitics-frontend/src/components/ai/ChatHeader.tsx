import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useChatStore, type Turn } from '@/stores/chatStore';
import { useActiveCluster } from '@/stores/clusterPresenceStore';
import { ChatStatusPill } from './ChatStatusPill';
import { Plus, Copy, X, History } from 'lucide-react';
import { toast } from 'sonner';

export function ChatHeader() {
  const togglePanel = useChatStore((s) => s.togglePanel);
  const newChat = useChatStore((s) => s.newChat);
  const restoreSession = useChatStore((s) => s.restoreSession);
  const transcripts = useChatStore((s) => s.transcripts);
  const chatHistory = useChatStore((s) => s.chatHistory);
  const activeCluster = useActiveCluster();

  const history = activeCluster ? (chatHistory?.[activeCluster.id] ?? []) : [];

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

  const onRestoreSession = (index: number) => {
    if (!activeCluster) return;
    restoreSession(activeCluster.id, index);
  };

  return (
    <div className="flex items-center justify-between border-b px-3 py-2">
      <div className="flex items-center gap-2">
        <ChatStatusPill variant="pill" />
      </div>
      <div className="flex items-center gap-1">
        {history.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Chat history">
                <History className="h-3.5 w-3.5 mr-1" />
                <span className="text-xs">History</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="text-xs">Past sessions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {history.map((session, i) => (
                <DropdownMenuItem
                  key={i}
                  className="flex flex-col items-start gap-0.5 cursor-pointer"
                  onClick={() => onRestoreSession(i)}
                >
                  <span className="text-xs font-medium truncate w-full">
                    {sessionPreview(session)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {sessionTimestamp(session)} · {session.filter(t => t.kind === 'user').length} messages
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
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

function sessionPreview(session: Turn[]): string {
  const first = session.find((t) => t.kind === 'user');
  if (!first || first.kind !== 'user') return 'Empty session';
  return first.text.length > 50 ? first.text.slice(0, 50) + '…' : first.text;
}

function sessionTimestamp(session: Turn[]): string {
  const first = session[0];
  if (!first) return '';
  const ts = 'startedAt' in first ? first.startedAt : undefined;
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
