import { useEffect, useCallback } from "react";

export interface TopologyKeyboardHandlers {
  onFitView?: () => void;
  onFocusSearch?: () => void;
  onViewMode?: (mode: number) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onClearSelection?: () => void;
  onExport?: () => void;
  onToggleEdgeLabels?: () => void;
  onToggleMinimap?: () => void;
  onToggleHealthOverlay?: () => void;
  onToggleCostOverlay?: () => void;
  onScreenshot?: () => void;
  onShowHelp?: () => void;
  onNavigateBack?: () => void;
}

/**
 * All keyboard shortcuts per PRD Section 8.2:
 * F = fit to screen
 * 1-5 = view modes (Cluster, Namespace, Workload, Resource, RBAC)
 * +/- = zoom in/out
 * Escape = back/deselect/close panel
 * / = open search
 * E = toggle edge labels
 * M = toggle minimap
 * H = toggle health overlay
 * C = toggle cost overlay
 * S = export screenshot (PNG to clipboard)
 * ? = show shortcuts overlay
 * Backspace = navigate back
 */
export function useTopologyKeyboard(handlers: TopologyKeyboardHandlers) {
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const key = e.key;
      const noMod = !e.ctrlKey && !e.metaKey && !e.altKey;

      switch (key) {
        case "f":
        case "F":
          if (noMod) {
            e.preventDefault();
            handlers.onFitView?.();
          }
          break;

        case "/":
          if (noMod) {
            e.preventDefault();
            handlers.onFocusSearch?.();
          }
          break;

        case "1": case "2": case "3": case "4": case "5":
          if (noMod) {
            handlers.onViewMode?.(parseInt(key, 10));
          }
          break;

        case "+": case "=":
          e.preventDefault();
          handlers.onZoomIn?.();
          break;

        case "-":
          if (noMod) {
            e.preventDefault();
            handlers.onZoomOut?.();
          }
          break;

        case "Escape":
          handlers.onClearSelection?.();
          break;

        case "e": case "E":
          if (noMod) {
            e.preventDefault();
            handlers.onToggleEdgeLabels?.();
          }
          break;

        case "m": case "M":
          if (noMod) {
            e.preventDefault();
            handlers.onToggleMinimap?.();
          }
          break;

        case "h": case "H":
          if (noMod) {
            e.preventDefault();
            handlers.onToggleHealthOverlay?.();
          }
          break;

        case "c": case "C":
          if (noMod) {
            e.preventDefault();
            handlers.onToggleCostOverlay?.();
          }
          break;

        case "s": case "S":
          if (noMod) {
            e.preventDefault();
            handlers.onScreenshot?.();
          }
          break;

        case "?":
          e.preventDefault();
          handlers.onShowHelp?.();
          break;

        case "Backspace":
          if (noMod) {
            handlers.onNavigateBack?.();
          }
          break;
      }
    },
    [handlers]
  );

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);
}

/**
 * TopologyShortcutsOverlay: Modal displaying all keyboard shortcuts.
 */
export function TopologyShortcutsOverlay({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  if (!visible) return null;

  const shortcuts = [
    { key: "F", description: "Fit to screen" },
    { key: "1-5", description: "Switch view mode" },
    { key: "/", description: "Open search" },
    { key: "+/-", description: "Zoom in/out" },
    { key: "Esc", description: "Deselect / Close panel / Back" },
    { key: "E", description: "Toggle edge labels" },
    { key: "M", description: "Toggle minimap" },
    { key: "H", description: "Toggle health overlay" },
    { key: "C", description: "Toggle cost overlay" },
    { key: "S", description: "Screenshot to clipboard" },
    { key: "?", description: "Show shortcuts" },
    { key: "Backspace", description: "Navigate back" },
    { key: "Tab", description: "Cycle through nodes" },
    { key: "Enter", description: "Select focused node" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="w-96 rounded-lg border bg-background p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Keyboard Shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted"
          >
            {"✕"}
          </button>
        </div>
        <div className="space-y-2">
          {shortcuts.map((s) => (
            <div key={s.key} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{s.description}</span>
              <kbd className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                {s.key}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
