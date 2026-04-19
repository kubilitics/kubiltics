import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useChatStore } from '@/stores/chatStore';
import { useAIContextStore, type AIContext } from '@/stores/aiContextStore';

interface Props {
  context: AIContext;
  promptTemplate: string;
  variant?: 'default' | 'icon';
  className?: string;
}

export function AskAIButton({ context, promptTemplate, variant = 'default', className }: Props) {
  const onClick = () => {
    useChatStore.getState().togglePanel(true);
    useAIContextStore.getState().setExplicit(context);
    useChatStore.getState().setPrefilled(promptTemplate);
  };

  if (variant === 'icon') {
    return (
      <Button variant="ghost" size="icon" onClick={onClick} aria-label="Ask AI" className={className}>
        <Sparkles className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={onClick} aria-label="Ask AI" className={className}>
      <Sparkles className="h-3.5 w-3.5 mr-1" />
      Ask AI
    </Button>
  );
}
