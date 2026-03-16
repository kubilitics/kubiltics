/**
 * useDirection — Hook returning the current text direction (RTL or LTR).
 *
 * Detects direction from:
 *   1. The `dir` attribute on <html> or <body>
 *   2. The `lang` attribute on <html>
 *   3. The CSS computed direction of the body
 *
 * Listens for changes to the `dir` and `lang` attributes via MutationObserver
 * and automatically updates.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  detectDirection,
  setDirection as setDocDirection,
  isRTLLanguage,
  type Direction,
} from '../lib/rtlSupport';

export interface UseDirectionReturn {
  /** Current text direction: 'rtl' or 'ltr'. */
  direction: Direction;
  /** Whether the current direction is RTL. */
  isRTL: boolean;
  /** Programmatically set the document direction. */
  setDirection: (dir: Direction) => void;
  /** Toggle between RTL and LTR. */
  toggleDirection: () => void;
}

export function useDirection(): UseDirectionReturn {
  const [direction, setDirectionState] = useState<Direction>(() => {
    if (typeof document === 'undefined') return 'ltr';
    return detectDirection();
  });

  // Listen for changes to dir/lang attributes on <html>
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
      return;
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === 'attributes' &&
          (mutation.attributeName === 'dir' || mutation.attributeName === 'lang')
        ) {
          setDirectionState(detectDirection());
        }
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['dir', 'lang'],
    });

    // Also observe body if it exists
    if (document.body) {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['dir'],
      });
    }

    return () => observer.disconnect();
  }, []);

  const setDirection = useCallback((dir: Direction) => {
    setDocDirection(dir);
    setDirectionState(dir);
  }, []);

  const toggleDirection = useCallback(() => {
    const newDir = direction === 'rtl' ? 'ltr' : 'rtl';
    setDocDirection(newDir);
    setDirectionState(newDir);
  }, [direction]);

  const isRTL = direction === 'rtl';

  return useMemo(
    () => ({
      direction,
      isRTL,
      setDirection,
      toggleDirection,
    }),
    [direction, isRTL, setDirection, toggleDirection],
  );
}
