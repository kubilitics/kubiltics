import { useEffect, useRef, useCallback } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
].join(', ');

export interface UseFocusTrapOptions {
  /** Whether the trap is currently active. Defaults to true. */
  enabled?: boolean;
  /** Called when the user presses Escape inside the trap. */
  onClose?: () => void;
  /** When true, the first focusable element receives focus when the trap activates. Defaults to true. */
  autoFocus?: boolean;
}

/**
 * Custom hook that traps keyboard focus within a container element.
 *
 * - Tab cycles through focusable elements inside the container.
 * - Shift+Tab cycles backwards.
 * - Escape calls the `onClose` callback (if provided).
 *
 * Returns a ref to attach to the container element.
 *
 * Works with modals, dialogs, popovers, and any other overlay that
 * requires focus containment per WAI-ARIA authoring practices.
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(
  options: UseFocusTrapOptions = {},
) {
  const { enabled = true, onClose, autoFocus = true } = options;
  const containerRef = useRef<T>(null);
  // Keep the latest onClose in a ref so we don't re-attach listeners on every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const getFocusableElements = useCallback((): HTMLElement[] => {
    if (!containerRef.current) return [];
    return Array.from(
      containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((el) => !el.hasAttribute('hidden') && getComputedStyle(el).display !== 'none'); // exclude hidden elements
  }, []);

  // Auto-focus the first focusable element when the trap activates
  useEffect(() => {
    if (!enabled || !autoFocus) return;
    // Small delay to let any animation/render complete
    const id = requestAnimationFrame(() => {
      const elements = getFocusableElements();
      if (elements.length > 0) {
        elements[0].focus();
      } else {
        // If there are no focusable children, focus the container itself
        containerRef.current?.focus();
      }
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, autoFocus]);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }

      if (e.key !== 'Tab') return;

      const elements = getFocusableElements();
      if (elements.length === 0) {
        e.preventDefault();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: if focus is on first element, wrap to last
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab: if focus is on last element, wrap to first
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    const container = containerRef.current;
    // Listen on the container so we don't interfere with other parts of the page
    container?.addEventListener('keydown', handleKeyDown);
    return () => {
      container?.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, getFocusableElements]);

  return containerRef;
}
