import { useEffect, useRef, useState } from 'react';
import { Send, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useChatStore } from '@/stores/chatStore';

interface Props {
  onSend: (text: string) => void;
  onStop: () => void;
  disabled: boolean;
  streaming: boolean;
  disabledPlaceholder?: string;
}

export function ChatInput({ onSend, onStop, disabled, streaming, disabledPlaceholder }: Props) {
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const prefilled = useChatStore((s) => s.prefilledText);
  const setPrefilled = useChatStore((s) => s.setPrefilled);

  useEffect(() => {
    if (prefilled !== undefined) {
      setText(prefilled);
      requestAnimationFrame(() => {
        const ta = taRef.current;
        if (ta) {
          ta.focus();
          ta.select();
        }
      });
      setPrefilled(undefined);
    }
  }, [prefilled, setPrefilled]);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t p-3 flex items-end gap-2">
      <textarea
        ref={taRef}
        value={disabled ? '' : text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        disabled={disabled}
        placeholder={disabled ? disabledPlaceholder ?? 'AI unavailable' : 'Ask about your cluster…'}
        rows={2}
        className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground caret-foreground selection:bg-primary/30 dark:selection:bg-primary/40 selection:text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        data-testid="chat-input"
      />
      {streaming ? (
        <Button variant="outline" size="icon" onClick={onStop} aria-label="Stop">
          <Square className="h-4 w-4" />
        </Button>
      ) : (
        <Button size="icon" onClick={submit} disabled={disabled || !text.trim()} aria-label="Send">
          <Send className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
