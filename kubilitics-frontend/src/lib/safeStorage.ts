/**
 * Safe localStorage wrapper for Zustand persist middleware.
 * Catches QuotaExceededError and DOMException to prevent store hydration failures.
 */
import type { StateStorage } from 'zustand/middleware';

export const safeLocalStorage: StateStorage = {
  getItem: (name: string): string | null => {
    try {
      return localStorage.getItem(name);
    } catch (error) {
      console.warn(`[SafeStorage] Failed to read "${name}":`, error);
      return null;
    }
  },
  setItem: (name: string, value: string): void => {
    try {
      localStorage.setItem(name, value);
    } catch (error) {
      console.warn(`[SafeStorage] Failed to write "${name}" (quota exceeded?):`, error);
      // Attempt to clear stale entries and retry once
      try {
        // Remove the item itself to make room, then retry
        localStorage.removeItem(name);
        localStorage.setItem(name, value);
      } catch {
        // Completely out of space — state will be in-memory only this session
        console.error(`[SafeStorage] Unable to persist "${name}" — running in-memory mode`);
      }
    }
  },
  removeItem: (name: string): void => {
    try {
      localStorage.removeItem(name);
    } catch (error) {
      console.warn(`[SafeStorage] Failed to remove "${name}":`, error);
    }
  },
};
