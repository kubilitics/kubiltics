/**
 * AIContextButton — "Ask AI about this resource" button.
 * Placed on every resource detail page. Opens the AI assistant panel
 * pre-loaded with the resource context (kind, name, namespace, status).
 */
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAIStatus } from '@/hooks/useAIStatus';
import { cn } from '@/lib/utils';

interface AIContextButtonProps {
  /** Kubernetes resource kind (e.g. 'Pod', 'Deployment') */
  resourceKind: string;
  /** Resource name */
  resourceName: string;
  /** Resource namespace (empty for cluster-scoped) */
  namespace?: string;
  /** Current resource status for context */
  status?: string;
  /** Additional context to pass to the AI (e.g. events, conditions) */
  context?: string;
  /** Button variant */
  variant?: 'default' | 'outline' | 'ghost' | 'inline';
  /** Custom class */
  className?: string;
}

export function AIContextButton({
  resourceKind,
  resourceName,
  namespace,
  status,
  context,
  variant = 'outline',
  className,
}: AIContextButtonProps) {
  const aiStatus = useAIStatus();
  const isAvailable = aiStatus.status === 'active';

  const handleClick = () => {
    // Dispatch a custom event that the AIAssistant panel listens for
    const detail = {
      prompt: buildPrompt(resourceKind, resourceName, namespace, status, context),
      resourceKind,
      resourceName,
      namespace,
    };
    window.dispatchEvent(new CustomEvent('kubilitics:ai-investigate', { detail }));
  };

  if (aiStatus.status === 'unavailable') return null;

  if (variant === 'inline') {
    return (
      <button
        onClick={handleClick}
        disabled={!isAvailable}
        className={cn(
          'inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-50',
          className
        )}
        title={!isAvailable ? 'Configure AI in Settings to enable' : `Ask AI about this ${resourceKind}`}
      >
        <Sparkles className="h-3.5 w-3.5" />
        Ask AI
      </button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={variant === 'default' ? 'default' : variant}
          size="sm"
          onClick={handleClick}
          disabled={!isAvailable}
          className={cn('gap-1.5', className)}
        >
          <Sparkles className="h-4 w-4" />
          <span className="hidden sm:inline">
            {isAvailable ? `Ask AI` : 'AI unavailable'}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {isAvailable
          ? `Ask AI to investigate this ${resourceKind}`
          : 'Configure AI in Settings to enable AI investigation'}
      </TooltipContent>
    </Tooltip>
  );
}

function buildPrompt(kind: string, name: string, namespace?: string, status?: string, context?: string): string {
  const parts = [`Investigate this ${kind}: ${name}`];
  if (namespace) parts.push(`in namespace "${namespace}"`);
  if (status) parts.push(`— current status: ${status}`);
  if (context) parts.push(`\n\nAdditional context:\n${context}`);
  return parts.join(' ');
}
