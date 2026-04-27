import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Refined-operational sizing — picked to match the existing dense
// dashboard rhythm (Linear / Datadog reference). Not user-tunable
// magic numbers; bounds enforced everywhere width flows.
export const CHAT_PANEL_MIN_WIDTH = 320;
export const CHAT_PANEL_MAX_WIDTH = 720;
export const CHAT_PANEL_DEFAULT_WIDTH = 380;

export const clampPanelWidth = (n: number): number => {
  if (!Number.isFinite(n)) return CHAT_PANEL_DEFAULT_WIDTH;
  return Math.max(CHAT_PANEL_MIN_WIDTH, Math.min(CHAT_PANEL_MAX_WIDTH, Math.round(n)));
};

interface ChatPanelLayoutState {
  /** Current panel width in CSS pixels. Always within [MIN, MAX]. */
  width: number;
  /** True while the user is actively dragging the resize handle.
   *  Consumers (e.g. AppLayout main) disable transitions while true so
   *  the panel and content track the cursor without easing lag. */
  isResizing: boolean;
  setWidth: (px: number) => void;
  resetWidth: () => void;
  setResizing: (resizing: boolean) => void;
}

export const useChatPanelLayoutStore = create<ChatPanelLayoutState>()(
  persist(
    (set) => ({
      width: CHAT_PANEL_DEFAULT_WIDTH,
      isResizing: false,
      setWidth: (px) => set({ width: clampPanelWidth(px) }),
      resetWidth: () => set({ width: CHAT_PANEL_DEFAULT_WIDTH }),
      setResizing: (resizing) => set({ isResizing: resizing }),
    }),
    {
      name: 'kubilitics:chat-panel-layout',
      // Only persist the width — isResizing is ephemeral session state.
      partialize: (s) => ({ width: clampPanelWidth(s.width) }),
    },
  ),
);
