/**
 * P2-8: Tauri-only flag for AI sidecar availability.
 * When false or null (in Tauri), no requests to the AI backend (port 8081) are made.
 * Set by SyncAIAvailable from invoke('get_ai_status'). In browser, requests are not gated.
 */
import { create } from 'zustand';
import { isTauri } from '@/lib/tauri';

interface AiAvailableState {
  /** In Tauri: true when get_ai_status().available, false otherwise, null before first check. */
  aiAvailable: boolean | null;
  setAIAvailable: (available: boolean) => void;
}

export const useAiAvailableStore = create<AiAvailableState>()((set) => ({
  aiAvailable: null,
  setAIAvailable: (available) => set({ aiAvailable: available }),
}));

/** For use in aiService and useAIStatus: true only when we may send requests to the AI backend. */
export function getAIAvailableForRequest(): boolean {
  if (!isTauri()) return true;
  return useAiAvailableStore.getState().aiAvailable === true;
}

/** Call before any direct fetch to AI backend; throws when in Tauri and AI is not available. */
export function guardAIAvailable(): void {
  if (!getAIAvailableForRequest()) {
    throw new Error('AI backend is not available.');
  }
}
