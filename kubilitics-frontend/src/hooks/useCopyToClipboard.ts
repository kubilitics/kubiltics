import { useState, useCallback, useRef } from 'react';
import { toast } from '@/components/ui/sonner';

interface UseCopyOptions {
  /** Duration the "copied" state lasts (ms) */
  resetDelay?: number;
  /** Show a toast notification */
  showToast?: boolean;
}

/**
 * Hook for copying text to clipboard with visual feedback.
 *
 * Returns:
 *   - copied: boolean — whether the copy was just performed
 *   - copy(text, label?) — function to trigger copy
 */
export function useCopyToClipboard(options: UseCopyOptions = {}) {
  const { resetDelay = 1500, showToast = true } = options;
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    async (text: string, label?: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);

        if (showToast) {
          toast.success(label ? `Copied ${label}` : 'Copied to clipboard', {
            duration: 2000,
          });
        }

        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => setCopied(false), resetDelay);
      } catch {
        toast.error('Failed to copy to clipboard');
      }
    },
    [resetDelay, showToast]
  );

  return { copied, copy };
}
