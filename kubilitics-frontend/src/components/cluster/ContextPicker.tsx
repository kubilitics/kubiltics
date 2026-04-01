/**
 * TASK-CORE-001: Context Picker for Desktop Auto-Connect
 *
 * Displayed when the desktop app detects multiple kubeconfig contexts.
 * Card grid layout matching the Kubilitics design language:
 *  - Framer Motion stagger animations
 *  - Dark mode via CSS variables / Tailwind dark: prefix
 *  - Selected state with blue ring accent
 *  - Connect button triggers auto-connect flow
 */
import { motion, type Variants } from 'framer-motion';
import {
  Server,
  CheckCircle2,
  Circle,
  AlertCircle,
  Loader2,
  ArrowRight,
  Monitor,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/BrandLogo';
import type { DiscoveredContext } from '@/hooks/useAutoConnect';

const container: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.1,
    },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
  },
};

function StatusDot({ status }: { status: DiscoveredContext['status'] }) {
  switch (status) {
    case 'healthy':
      return <CheckCircle2 size={14} className="text-emerald-500" />;
    case 'unhealthy':
      return <AlertCircle size={14} className="text-red-400" />;
    case 'checking':
      return <Loader2 size={14} className="text-blue-400 animate-spin" />;
    default:
      return <Circle size={14} className="text-slate-400" />;
  }
}

/** Extract a human-readable display name from a kubeconfig context/cluster name. */
function friendlyName(name: string): string {
  if (!name) return name;
  // EKS: arn:aws:eks:us-east-1:123456:cluster/my-cluster → my-cluster
  const eksMatch = name.match(/cluster\/(.+)$/);
  if (eksMatch) return eksMatch[1];
  // GKE: gke_project_zone_cluster → cluster
  const gkeMatch = name.match(/^gke_[^_]+_[^_]+_(.+)$/);
  if (gkeMatch) return gkeMatch[1];
  // Kind: kind-my-cluster → my-cluster
  if (name.startsWith('kind-')) return name;
  return name;
}

/** Format server URL for display. Recognizes local clusters. */
function displayServer(server: string, context: string): string {
  if (!server) return '';
  // Recognize well-known local clusters by context name
  const ctxLower = context.toLowerCase();
  if (ctxLower === 'docker-desktop' || ctxLower === 'docker-for-desktop') return 'Docker Desktop';
  if (ctxLower.startsWith('kind-')) return `Kind (local)`;
  if (ctxLower === 'minikube') return 'Minikube (local)';
  if (ctxLower === 'rancher-desktop') return 'Rancher Desktop';
  if (ctxLower.startsWith('colima')) return 'Colima (local)';
  // Cloud clusters — show the hostname
  try {
    const url = new URL(server.startsWith('http') ? server : `https://${server}`);
    const host = url.hostname;
    // Hide raw IPs for localhost
    if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return 'localhost:' + url.port;
    // EKS: long hash.region.eks.amazonaws.com → region (EKS)
    const eksHost = host.match(/\.([^.]+)\.eks\.amazonaws\.com$/);
    if (eksHost) return `${eksHost[1]} (EKS)`;
    // GKE: container.googleapis.com
    if (host.includes('googleapis.com')) return 'GKE';
    // AKS: *.azmk8s.io
    if (host.includes('azmk8s.io')) return 'AKS';
    return host;
  } catch {
    return server.length > 35 ? server.slice(0, 32) + '...' : server;
  }
}

export interface ContextPickerProps {
  contexts: DiscoveredContext[];
  selectedContext: string | null;
  onSelect: (contextName: string) => void;
  onConnect: () => void;
  onCancel?: () => void;
  isConnecting: boolean;
  error: string | null;
}

export function ContextPicker({
  contexts,
  selectedContext,
  onSelect,
  onConnect,
  onCancel,
  isConnecting,
  error,
}: ContextPickerProps) {
  return (
    <div className="relative min-h-screen bg-gradient-to-b from-slate-50 via-white to-blue-50/30 dark:from-[hsl(228,14%,7%)] dark:via-[hsl(228,14%,9%)] dark:to-[hsl(228,14%,11%)] text-foreground overflow-hidden flex flex-col items-center justify-center px-6 py-8">
      {/* Ambient light orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-200/20 dark:bg-blue-900/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-indigo-200/20 dark:bg-indigo-900/20 rounded-full blur-[120px]" />
      </div>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="relative z-10 w-full max-w-3xl"
      >
        {/* Header */}
        <motion.div variants={item} className="text-center mb-8">
          <div className="flex flex-col items-center justify-center gap-3 mb-4">
            <BrandLogo height={56} className="drop-shadow-lg" />
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-950/40 border border-blue-200/60 dark:border-blue-800/40 mb-4">
            <Monitor size={13} className="text-blue-500" />
            <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-widest">
              Desktop Mode
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold mb-2 tracking-[-0.03em] leading-[1.1] text-slate-900 dark:text-slate-100">
            Choose a context
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed font-medium">
            Multiple kubeconfig contexts detected. Select one to connect.
          </p>
        </motion.div>

        {/* Context Grid */}
        <motion.div
          variants={container}
          className={cn(
            'grid gap-3 mb-6',
            contexts.length <= 3 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' :
            contexts.length <= 6 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' :
            'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
          )}
        >
          {contexts.map((ctx) => {
            const isSelected = selectedContext === ctx.context;
            return (
              <motion.div key={ctx.context} variants={item}>
                <button
                  type="button"
                  onClick={() => onSelect(ctx.context)}
                  className={cn(
                    'group relative w-full text-left rounded-xl border p-4 transition-all duration-300',
                    'bg-white dark:bg-[hsl(228,14%,11%)]',
                    'hover:-translate-y-0.5 hover:shadow-md',
                    'focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[hsl(228,14%,7%)]',
                    'outline-none',
                    isSelected
                      ? 'border-blue-400 dark:border-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.3)] shadow-blue-500/10 bg-blue-50/30 dark:bg-blue-950/20'
                      : 'border-slate-200/80 dark:border-slate-700/60 shadow-sm',
                  )}
                  aria-pressed={isSelected}
                  aria-label={`Select context ${ctx.name || ctx.context}`}
                >
                  {/* Selection indicator */}
                  <div className={cn(
                    'absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center transition-all duration-300',
                    isSelected
                      ? 'bg-blue-500 text-white scale-100'
                      : 'bg-slate-100 dark:bg-slate-800 text-transparent scale-90',
                  )}>
                    <CheckCircle2 size={12} />
                  </div>

                  {/* Icon */}
                  <div className={cn(
                    'w-9 h-9 rounded-lg flex items-center justify-center mb-3 transition-all duration-300',
                    isSelected
                      ? 'bg-gradient-to-br from-blue-500 to-blue-600 shadow-md shadow-blue-500/20'
                      : 'bg-slate-100 dark:bg-slate-800 group-hover:bg-blue-50 dark:group-hover:bg-blue-950/30',
                  )}>
                    <Server
                      size={16}
                      className={cn(
                        'transition-colors duration-300',
                        isSelected
                          ? 'text-white'
                          : 'text-slate-500 dark:text-slate-400 group-hover:text-blue-500',
                      )}
                    />
                  </div>

                  {/* Context name */}
                  <div className="pr-6">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate mb-0.5">
                      {friendlyName(ctx.name || ctx.context)}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate">
                      {friendlyName(ctx.context)}
                    </p>
                  </div>

                  {/* Server + status */}
                  <div className="flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-800">
                    <StatusDot status={ctx.status} />
                    <span className="text-[11px] text-slate-400 dark:text-slate-500 font-medium truncate">
                      {displayServer(ctx.server, ctx.context)}
                    </span>
                    {ctx.isCurrent && (
                      <span className="ml-auto shrink-0 text-[10px] font-bold uppercase tracking-widest text-blue-500 dark:text-blue-400">
                        current
                      </span>
                    )}
                  </div>
                </button>
              </motion.div>
            );
          })}
        </motion.div>

        {/* Error */}
        {error && (
          <motion.div
            variants={item}
            className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200/60 dark:border-red-800/40 text-sm text-red-700 dark:text-red-300 font-medium"
          >
            <AlertCircle size={14} className="shrink-0" />
            {error}
          </motion.div>
        )}

        {/* Action Buttons */}
        <motion.div variants={item} className="flex items-center justify-center gap-3">
          {onCancel && (
            <Button
              size="lg"
              variant="outline"
              onClick={onCancel}
              className="min-w-[140px] rounded-xl h-12 text-sm font-semibold"
            >
              Cancel
            </Button>
          )}
          <Button
            size="lg"
            disabled={!selectedContext || isConnecting}
            onClick={onConnect}
            className={cn(
              'min-w-[200px] bg-blue-600 hover:bg-blue-700 text-white rounded-xl h-12 text-sm font-semibold',
              'transition-all duration-300 shadow-md shadow-blue-600/20 hover:shadow-lg hover:shadow-blue-600/30',
              'disabled:opacity-50 disabled:cursor-not-allowed border-0',
            )}
          >
            {isConnecting ? (
              <>
                <Loader2 size={16} className="mr-2 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                Connect
                <ArrowRight size={16} className="ml-2" />
              </>
            )}
          </Button>
        </motion.div>
      </motion.div>
    </div>
  );
}
