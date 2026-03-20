import { Copy, Check } from 'lucide-react';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { cn } from '@/lib/utils';

interface CopyableValueProps {
  /** The value to display and copy */
  value: string;
  /** Human label for the toast (e.g. "IP address") */
  label?: string;
  /** Whether to show the value in monospace font */
  mono?: boolean;
  /** Additional className */
  className?: string;
  /** Show toast on copy (default true) */
  showToast?: boolean;
}

/**
 * A value that can be copied to clipboard on click.
 * Shows a copy icon on hover, checkmark after copy.
 */
export function CopyableValue({
  value,
  label,
  mono = true,
  className,
  showToast = true,
}: CopyableValueProps) {
  const { copied, copy } = useCopyToClipboard({ showToast });

  if (!value) return <span className="text-muted-foreground">—</span>;

  return (
    <button
      type="button"
      onClick={() => copy(value, label)}
      className={cn(
        'inline-flex items-center gap-1.5 group/copy max-w-full text-left',
        'rounded-md px-1.5 py-0.5 -mx-1.5 -my-0.5',
        'hover:bg-muted/60 active:bg-muted transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
      aria-label={`Copy ${label || value}`}
    >
      <span className={cn('truncate', mono && 'font-mono text-[13px]')}>
        {value}
      </span>
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0 transition-colors" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground/0 group-hover/copy:text-muted-foreground shrink-0 transition-colors" />
      )}
    </button>
  );
}
