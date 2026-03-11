import { useEffect, useCallback, useRef } from "react";
import { A11Y } from "../constants/designTokens";

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
 * Includes focus trap and Escape-to-close for WCAG compliance.
 */
export function TopologyShortcutsOverlay({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Auto-focus close button when visible
  useEffect(() => {
    if (visible) {
      closeRef.current?.focus();
    }
  }, [visible]);

  // Focus trap
  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visible, onClose]);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="w-[420px] rounded-xl border bg-background p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-gray-100">
              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <h2 className="text-base font-semibold">Keyboard Shortcuts</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className={`rounded-lg p-1.5 text-muted-foreground hover:bg-muted ${A11Y.focusRing} ${A11Y.transition}`}
            aria-label="Close shortcuts dialog"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="space-y-1">
          {shortcuts.map((s) => (
            <div key={s.key} className="flex items-center justify-between py-1.5 text-sm">
              <span className="text-muted-foreground">{s.description}</span>
              <kbd className="rounded-md bg-muted px-2.5 py-1 font-mono text-xs font-medium text-foreground border border-gray-200 shadow-sm">
                {s.key}
              </kbd>
            </div>
          ))}
        </div>
        <div className="mt-5 pt-4 border-t border-gray-100 text-center">
          <p className="text-[11px] text-muted-foreground">Press <kbd className="rounded bg-muted px-1 py-0.5 text-[10px] font-mono border">Esc</kbd> to close</p>
        </div>
      </div>
    </div>
  );
}
