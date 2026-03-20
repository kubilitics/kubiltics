import { useState, useEffect } from "react";
import { X, Mouse, Keyboard, Search, Download, Layers } from "lucide-react";
import { A11Y } from "./constants/designTokens";

const STORAGE_KEY = "kubilitics-topology-onboarded";

const tips = [
  {
    icon: <Mouse className="h-5 w-5 text-blue-500" />,
    title: "Navigate the canvas",
    detail: "Scroll to zoom, drag to pan. Click any node to see its details.",
  },
  {
    icon: <Layers className="h-5 w-5 text-emerald-500" />,
    title: "Switch perspectives",
    detail: "Use Cluster, Namespace, Workload views to explore from different angles.",
  },
  {
    icon: <Search className="h-5 w-5 text-violet-500" />,
    title: "Search resources",
    detail: "Press / to search. Use kind:Pod, ns:default, or status:error for filters.",
  },
  {
    icon: <Keyboard className="h-5 w-5 text-amber-500" />,
    title: "Keyboard shortcuts",
    detail: "Press ? to see all shortcuts. F to fit view, 1-5 to switch modes.",
  },
  {
    icon: <Download className="h-5 w-5 text-pink-500" />,
    title: "Export your topology",
    detail: "Export as PNG, SVG, PDF, JSON, or Draw.io for documentation and sharing.",
  },
];

export function TopologyWelcomeTips() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setVisible(true);
      }
    } catch {
      // localStorage unavailable
    }
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // ignore
    }
  };

  if (!visible) return null;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/20 backdrop-blur-sm">
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-gray-200 overflow-hidden animate-in fade-in zoom-in-95 duration-300"
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to Topology"
      >
        {/* Header */}
        <div className="relative bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-6 py-5 text-white">
          <button
            type="button"
            className="absolute top-3 right-3 rounded-full p-1 hover:bg-white/20 transition-colors"
            onClick={dismiss}
            aria-label="Close welcome tips"
          >
            <X className="h-4 w-4" />
          </button>
          <h2 className="text-lg font-bold">Welcome to Topology</h2>
          <p className="text-sm text-white/80 mt-1">
            Visualize and explore your Kubernetes infrastructure
          </p>
        </div>

        {/* Tips */}
        <div className="px-6 py-4 space-y-3">
          {tips.map((tip, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5 w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center">
                {tip.icon}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900">{tip.title}</div>
                <div className="text-xs text-gray-500 leading-relaxed mt-0.5">{tip.detail}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-6 py-4 flex items-center justify-between bg-gray-50/50">
          <span className="text-[11px] text-gray-400">Press ? anytime for keyboard shortcuts</span>
          <button
            type="button"
            className={`rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:from-blue-700 hover:to-indigo-700 shadow-sm ${A11Y.focusRing} ${A11Y.transition}`}
            onClick={dismiss}
            autoFocus
          >
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
}
