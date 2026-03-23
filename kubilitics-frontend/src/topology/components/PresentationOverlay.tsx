import { memo } from "react";
import { Monitor, X } from "lucide-react";

interface PresentationOverlayProps {
  clusterName?: string;
  namespace?: string;
  nodeCount: number;
  edgeCount: number;
  onExit: () => void;
}

/**
 * Floating glass-morphism panel shown in presentation mode.
 * Displays context info at bottom-left so the canvas stays clean.
 */
function PresentationOverlayInner({
  clusterName,
  namespace,
  nodeCount,
  edgeCount,
  onExit,
}: PresentationOverlayProps) {
  return (
    <>
      {/* Context panel — bottom-left */}
      <div className="absolute bottom-4 left-4 z-50 rounded-xl border border-white/20 dark:border-slate-700/50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md px-4 py-3 shadow-lg">
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-1">
          <Monitor className="h-3.5 w-3.5" />
          <span className="font-semibold">Kubilitics</span>
        </div>
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {clusterName ?? "Cluster"}
          {namespace && <span className="text-gray-500 dark:text-gray-400 font-normal"> / {namespace}</span>}
        </div>
        <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-500 dark:text-gray-400">
          <span>{nodeCount} resources</span>
          <span>{edgeCount} connections</span>
        </div>
      </div>

      {/* Exit button — top-right */}
      <button
        type="button"
        onClick={onExit}
        className="absolute top-4 right-4 z-50 flex items-center gap-1.5 rounded-lg border border-white/20 dark:border-slate-700/50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 shadow-md hover:bg-white dark:hover:bg-slate-800 transition-colors"
        aria-label="Exit presentation mode"
      >
        <X className="h-3.5 w-3.5" />
        Exit
      </button>
    </>
  );
}

export const PresentationOverlay = memo(PresentationOverlayInner);
