/**
 * TASK-CORE-001: Context Picker for Desktop Auto-Connect
 *
 * Displayed when the desktop app detects multiple kubeconfig contexts.
 * Card grid layout matching the Kubilitics design language:
 *  - Framer Motion stagger animations
 *  - Dark mode via CSS variables / Tailwind dark: prefix
 *  - Selected state with blue ring accent
 *  - Connect button triggers auto-connect flow
 *  - Paste / upload kubeconfig for clusters not in default kubeconfig
 */
import { useState, useCallback } from 'react';
import { motion, type Variants } from 'framer-motion';
import {
  Server,
  CheckCircle2,
  Circle,
  AlertCircle,
  Loader2,
  ArrowRight,
  Monitor,
  ClipboardPaste,
  FolderOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/BrandLogo';
import { getProviderLogo } from '@/topology/icons/providerLogoMap';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { addClusterWithUpload } from '@/services/backendApiClient';
import { extractContextFromKubeconfig, stringToBase64, bytesToBase64 } from '@/lib/kubeconfigUtils';
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

/** Detect cloud/local provider from context name + server URL (mirrors backend DetectProvider). */
function detectProviderFromContext(context: string, server: string): string | null {
  const ctx = context.toLowerCase();
  const srv = server.toLowerCase();
  // Cloud providers by server URL
  if (srv.includes('eks.') || srv.includes('amazonaws.com')) return 'eks';
  if (srv.includes('gke.') || srv.includes('googleapis.com')) return 'gke';
  if (srv.includes('azmk8s.io') || srv.includes('azure.com')) return 'aks';
  // Local providers by context name
  if (ctx.includes('docker-desktop') || ctx.includes('docker-for-desktop')) return 'docker-desktop';
  if (ctx.includes('minikube')) return 'minikube';
  if (ctx.startsWith('kind-') || ctx === 'kind') return 'kind';
  if (ctx.includes('rancher')) return 'rancher';
  if (ctx.includes('k3s') || srv.includes('k3s')) return 'k3s';
  return null;
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
  const queryClient = useQueryClient();
  const storedBackendUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedBackendUrl);

  const [pasteDialogOpen, setPasteDialogOpen] = useState(false);
  const [pasteContent, setPasteContent] = useState('');
  const [isPasting, setIsPasting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const handlePasteSubmit = useCallback(async () => {
    const trimmed = pasteContent.trim();
    if (!trimmed) { toast.error('Paste your kubeconfig content first'); return; }
    setIsPasting(true);
    try {
      const base64 = stringToBase64(trimmed);
      const contextName = extractContextFromKubeconfig(trimmed);
      await addClusterWithUpload(backendBaseUrl, base64, contextName);
      queryClient.invalidateQueries({ queryKey: ['backend', 'clusters'] });
      toast.success('Cluster added', { description: `Context: ${contextName}` });
      setPasteDialogOpen(false);
      setPasteContent('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add cluster');
    } finally { setIsPasting(false); }
  }, [pasteContent, backendBaseUrl, queryClient]);

  const handleFileUpload = useCallback(async (file: File) => {
    setIsUploading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const base64 = bytesToBase64(bytes);
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      const contextName = extractContextFromKubeconfig(text);
      await addClusterWithUpload(backendBaseUrl, base64, contextName);
      queryClient.invalidateQueries({ queryKey: ['backend', 'clusters'] });
      toast.success('Cluster added', { description: `Context: ${contextName}` });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add cluster');
    } finally { setIsUploading(false); }
  }, [backendBaseUrl, queryClient]);

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
        className="relative z-10 w-full max-w-5xl"
      >
        {/* Header — larger logo, compact text */}
        <motion.div variants={item} className="text-center mb-6">
          <div className="flex flex-col items-center justify-center gap-2 mb-3">
            <BrandLogo height={80} className="drop-shadow-xl" />
          </div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950/40 border border-blue-200/60 dark:border-blue-800/40 mb-3">
            <Monitor size={11} className="text-blue-500" />
            <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-widest">
              Desktop Mode
            </span>
          </div>
          <h1 className="text-lg font-semibold mb-1 tracking-[-0.02em] text-slate-900 dark:text-slate-100">
            Choose a context
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto font-medium">
            Select a detected context or add a cluster from a different kubeconfig.
          </p>
        </motion.div>

        {/* Split layout: contexts left, add-cluster right — equal halves */}
        <motion.div variants={item} className="flex flex-col lg:flex-row gap-6 mb-6">
          {/* Left: detected contexts */}
          <div className="w-full lg:w-1/2 min-w-0">
            <div className="flex items-center justify-between mb-2.5 px-0.5">
              <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                Detected Contexts
              </p>
              <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                {contexts.length} found
              </span>
            </div>
            <div className="space-y-2 max-h-[min(50vh,420px)] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-700">
              {contexts.map((ctx) => {
                const isSelected = selectedContext === ctx.context;
                return (
                  <motion.div key={ctx.context} variants={item}>
                    <button
                      type="button"
                      onClick={() => onSelect(ctx.context)}
                      className={cn(
                        'group relative w-full text-left rounded-lg border px-3 py-2.5 transition-all duration-200',
                        'bg-white dark:bg-[hsl(228,14%,11%)]',
                        'hover:shadow-sm',
                        'focus-visible:ring-2 focus-visible:ring-blue-500/50 outline-none',
                        isSelected
                          ? 'border-blue-400 dark:border-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.3)] bg-blue-50/40 dark:bg-blue-950/20'
                          : 'border-slate-200/80 dark:border-slate-700/60',
                      )}
                      aria-pressed={isSelected}
                      aria-label={`Select context ${ctx.name || ctx.context}`}
                    >
                      <div className="flex items-center gap-3">
                        {/* Icon — show provider logo when detected */}
                        {(() => {
                          const provider = detectProviderFromContext(ctx.context, ctx.server);
                          const logo = provider ? getProviderLogo(provider) : null;
                          return (
                            <div className={cn(
                              'w-8 h-8 rounded-md flex items-center justify-center shrink-0 transition-all duration-200',
                              isSelected
                                ? logo ? 'bg-white dark:bg-slate-800 ring-1 ring-blue-400 shadow-sm shadow-blue-500/20' : 'bg-gradient-to-br from-blue-500 to-blue-600 shadow-sm shadow-blue-500/20'
                                : 'bg-slate-100 dark:bg-slate-800 group-hover:bg-blue-50 dark:group-hover:bg-blue-950/30',
                            )}>
                              {logo ? (
                                <img src={logo} alt="" className="w-5 h-5" draggable={false} />
                              ) : (
                                <Server
                                  size={14}
                                  className={cn(
                                    'transition-colors duration-200',
                                    isSelected
                                      ? 'text-white'
                                      : 'text-slate-500 dark:text-slate-400 group-hover:text-blue-500',
                                  )}
                                />
                              )}
                            </div>
                          );
                        })()}

                        {/* Name + server */}
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {friendlyName(ctx.name || ctx.context)}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <StatusDot status={ctx.status} />
                            <span className="text-[11px] text-slate-400 dark:text-slate-500 font-medium truncate">
                              {displayServer(ctx.server, ctx.context) || friendlyName(ctx.context)}
                            </span>
                          </div>
                        </div>

                        {/* Right side: current badge or selection dot */}
                        <div className="shrink-0 flex items-center gap-2">
                          {ctx.isCurrent && (
                            <span className="text-[10px] font-bold uppercase tracking-widest text-blue-500 dark:text-blue-400">
                              current
                            </span>
                          )}
                          <div className={cn(
                            'w-4 h-4 rounded-full flex items-center justify-center transition-all duration-200',
                            isSelected
                              ? 'bg-blue-500 text-white'
                              : 'bg-slate-100 dark:bg-slate-800 text-transparent',
                          )}>
                            <CheckCircle2 size={10} />
                          </div>
                        </div>
                      </div>
                    </button>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* Right: add cluster from different kubeconfig */}
          <div className="w-full lg:w-1/2">
            <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2.5 px-0.5">
              Add from kubeconfig
            </p>
            <div className="space-y-3">
              {/* Paste kubeconfig card */}
              <button
                type="button"
                onClick={() => setPasteDialogOpen(true)}
                className={cn(
                  'group w-full text-left rounded-xl border-2 border-dashed p-5 transition-all duration-200',
                  'border-slate-200/80 dark:border-slate-700/60 bg-white dark:bg-[hsl(228,14%,11%)]',
                  'hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/30 dark:hover:bg-blue-950/20',
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/40 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/40 transition-colors shrink-0">
                    <ClipboardPaste size={18} className="text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Paste kubeconfig</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                      Paste YAML from clipboard or terminal output
                    </p>
                  </div>
                </div>
              </button>

              {/* Upload kubeconfig card */}
              <label
                className={cn(
                  'group w-full text-left rounded-xl border-2 border-dashed p-5 transition-all duration-200 block cursor-pointer',
                  'border-slate-200/80 dark:border-slate-700/60 bg-white dark:bg-[hsl(228,14%,11%)]',
                  'hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/30 dark:hover:bg-blue-950/20',
                  isUploading && 'opacity-60 pointer-events-none',
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/40 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/40 transition-colors shrink-0">
                    {isUploading
                      ? <Loader2 size={18} className="text-blue-500 animate-spin" />
                      : <FolderOpen size={18} className="text-blue-500" />
                    }
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Upload kubeconfig</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                      Select or drag & drop a kubeconfig file
                    </p>
                  </div>
                </div>
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
                />
              </label>

              {/* Help text */}
              <p className="text-[11px] text-slate-400 dark:text-slate-500 px-1 leading-relaxed">
                Run <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-[10px] font-mono">kubectl config view --raw</code> to get your kubeconfig.
              </p>
            </div>
          </div>
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
              className="w-[160px] rounded-xl h-11 text-sm font-semibold bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/50"
            >
              Cancel
            </Button>
          )}
          <Button
            size="lg"
            disabled={!selectedContext || isConnecting}
            onClick={onConnect}
            className={cn(
              'w-[160px] bg-blue-600 hover:bg-blue-700 text-white rounded-xl h-11 text-sm font-semibold',
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

      {/* Paste kubeconfig dialog */}
      <Dialog open={pasteDialogOpen} onOpenChange={setPasteDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardPaste className="h-5 w-5 text-blue-500" />
              Paste kubeconfig
            </DialogTitle>
            <DialogDescription>
              Paste the full contents of your kubeconfig YAML below. Run{' '}
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">kubectl config view --raw</code>{' '}
              to get it.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder={`apiVersion: v1\nkind: Config\nclusters:\n  - cluster:\n      server: https://...\n    name: my-cluster\ncontexts:\n  - context:\n      cluster: my-cluster\n      user: admin\n    name: my-cluster\ncurrent-context: my-cluster`}
            value={pasteContent}
            onChange={(e) => setPasteContent(e.target.value)}
            className="font-mono text-xs min-h-[220px] resize-y"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasteDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handlePasteSubmit} disabled={!pasteContent.trim() || isPasting}>
              {isPasting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add Cluster'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
