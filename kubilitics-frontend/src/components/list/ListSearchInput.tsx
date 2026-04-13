import * as React from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface ListSearchInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  inputClassName?: string;
}

/**
 * Shared search input for list pages.
 * - Left-aligned search icon
 * - Right-aligned clear (X) button when input has text
 * - Matches the gold-standard toolbar styling used across list pages
 *
 * Debouncing should be handled by the caller (e.g. via `useDebouncedValue`)
 * so filter state stays snappy in the input while deferring expensive work.
 */
export function ListSearchInput({
  value,
  onChange,
  placeholder = 'Search...',
  ariaLabel,
  className,
  inputClassName,
}: ListSearchInputProps) {
  return (
    <div className={cn('relative w-full min-w-0', className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel ?? placeholder}
        className={cn(
          'w-full h-10 pl-9 pr-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50 transition-all',
          inputClassName
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
