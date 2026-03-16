import { useEffect, useRef } from 'react';

export interface UseFocusReturnOptions {
  /** Whether the dialog/overlay is currently open. */
  isOpen: boolean;
}

/**
 * Saves the previously focused element when a dialog opens and returns focus
 * to that element when the dialog closes.
 *
 * Designed to work alongside `useFocusTrap`: use `useFocusReturn` to
 * manage the restore-on-close behaviour, and `useFocusTrap` to contain
 * Tab navigation while the overlay is visible.
 *
 * Usage:
 * ```ts
 * useFocusReturn({ isOpen });
 * const trapRef = useFocusTrap({ enabled: isOpen, onClose: handleClose });
 * ```
 */
export function useFocusReturn({ isOpen }: UseFocusReturnOptions): void {
  const previousElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      // Capture whatever element was focused before the overlay opened
      previousElementRef.current = document.activeElement as HTMLElement | null;
    } else {
      // Dialog just closed -- restore focus
      const el = previousElementRef.current;
      if (el && typeof el.focus === 'function') {
        // Use requestAnimationFrame to let the DOM settle after the overlay
        // is removed (especially with exit animations).
        requestAnimationFrame(() => {
          // Guard: only restore if the element is still in the DOM
          if (el.isConnected) {
            el.focus();
          }
        });
      }
      previousElementRef.current = null;
    }
  }, [isOpen]);
}
