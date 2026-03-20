/**
 * KubeConfigSetup — Add Cluster wizard.
 *
 * Uses the EXACT same backend pipeline as ClusterConnect:
 *  1. Binary-safe base64 encoding (ArrayBuffer → Uint8Array → btoa)
 *  2. js-yaml context parsing (not regex) for multi-context detection
 *  3. Multi-context selection dialog when kubeconfig has >1 contexts
 *  4. Proper query cache invalidation + refetch after every mutation
 *  5. isBackendConfigured || isTauri() gate (handles dev proxy empty-URL case)
 *
 * This page is used from Settings → Add Cluster and must work identically to /connect.
 */
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, XCircle, Server, ArrowRight, Loader2,
  ClipboardPaste, FolderOpen, Zap, ArrowLeft,
} from 'lucide-react';
import yaml from 'js-yaml';
import { BrandLogo } from '@/components/BrandLogo';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { addClusterWithUpload, discoverClusters, type BackendCluster } from '@/services/backendApiClient';
import { backendClusterToCluster } from '@/lib/backendClusterAdapter';
import { useClustersFromBackend } from '@/hooks/useClustersFromBackend';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui/sonner';
import { isTauri } from '@/lib/tauri';
import { cn } from '@/lib/utils';

/* ── Helpers (copied from ClusterConnect for identical behavior) ── */

/**
 * Check if backend is effectively available.
 * In dev on localhost, backendBaseUrl is '' (Vite proxy) — that's valid.
 * In Tauri, backend is always available via sidecar.
 * isBackendConfigured() already handles both cases.
 */
function isEffectivelyConfigured(isConfigured: boolean): boolean {
  return isConfigured || isTauri();
}

/** Encode Uint8Array to standard base64 (with padding). Compatible with Go's base64.StdEncoding. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Extract context names from kubeconfig YAML text.
 * Uses js-yaml to parse properly — identical to ClusterConnect.parseKubeconfigContexts.
 */
function parseKubeconfigContexts(text: string): { contexts: string[]; currentContext: string } {
  try {
    const doc = yaml.load(text) as Record<string, unknown> | null;
    if (!doc || typeof doc !== 'object') return { contexts: [], currentContext: '' };
    const currentContext = typeof doc['current-context'] === 'string' ? doc['current-context'] : '';
    const contextsRaw = doc['contexts'];
    const contexts: string[] = [];
    if (Array.isArray(contextsRaw)) {
      for (const entry of contextsRaw) {
        if (entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>)['name'] === 'string') {
          const name = ((entry as Record<string, unknown>)['name'] as string).trim();
          if (name && !contexts.includes(name)) contexts.push(name);
        }
      }
    }
    return { contexts, currentContext };
  } catch {
    return { contexts: [], currentContext: '' };
  }
}

/* ── Animation variants ── */
const stagger = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};
const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] } },
};

/* ── Component ── */

export default function KubeConfigSetup() {
  const navigate = useNavigate();
  const { setDemo, setClusters, setActiveCluster } = useClusterStore();
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const setCurrentClusterId = useBackendConfigStore((s) => s.setCurrentClusterId);
  const hasBackend = isEffectivelyConfigured(isBackendConfigured);

  const queryClient = useQueryClient();
  const clustersFromBackend = useClustersFromBackend();

  // ── UI state ──
  const [step, setStep] = useState<'upload' | 'validating' | 'connecting'>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);

  // Clipboard dialog
  const [clipboardOpen, setClipboardOpen] = useState(false);
  const [pasteContent, setPasteContent] = useState('');
  const [isPasting, setIsPasting] = useState(false);

  // File upload
  const [isUploading, setIsUploading] = useState(false);

  // Multi-context selection (identical to ClusterConnect)
  const [multiContextDialogOpen, setMultiContextDialogOpen] = useState(false);
  const [multiContextOptions, setMultiContextOptions] = useState<string[]>([]);
  const [multiContextCurrentContext, setMultiContextCurrentContext] = useState('');
  const [multiContextSelectedContext, setMultiContextSelectedContext] = useState('');
  const [multiContextBase64, setMultiContextBase64] = useState('');
  const [multiContextSubmitting, setMultiContextSubmitting] = useState(false);

  /* ── Shared: submit a single context to backend ── */
  const submitClusterWithContext = useCallback(async (base64: string, contextName: string) => {
    const result = await addClusterWithUpload(backendBaseUrl, base64, contextName);
    // Invalidate + refetch so cluster list is fresh
    await queryClient.invalidateQueries({ queryKey: ['backend', 'clusters'] });
    await queryClient.invalidateQueries({ queryKey: ['backend', 'clusters', 'discover'] });
    await clustersFromBackend.refetch();
    return result;
  }, [backendBaseUrl, queryClient, clustersFromBackend]);

  /** After successful add: connect to the cluster and navigate to dashboard */
  const connectToCluster = useCallback((result: BackendCluster) => {
    const cluster = backendClusterToCluster(result);
    setCurrentClusterId(result.id);
    // Preserve existing clusters from backend if available
    const allClusters = clustersFromBackend.data
      ? [...clustersFromBackend.data.map(backendClusterToCluster), cluster]
        .filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i) // dedupe
      : [cluster];
    setClusters(allClusters);
    setActiveCluster(cluster);
    setDemo(false);
    toast.success('Connected to cluster', { description: result.name });
    navigate('/dashboard', { replace: true });
  }, [setCurrentClusterId, setClusters, setActiveCluster, setDemo, navigate, clustersFromBackend.data]);

  const showError = useCallback((err: unknown, fallback: string) => {
    const msg = err instanceof Error ? err.message : err != null ? String(err) : '';
    if (msg && msg !== fallback) toast.error(fallback, { description: msg });
    else toast.error(fallback);
  }, []);

  /* ── File upload (binary-safe, identical to ClusterConnect.handleUploadedFile) ── */
  const handleFile = useCallback(async (file: File) => {
    if (!hasBackend) {
      toast.error('Backend not available', { description: 'Start the Kubilitics backend first' });
      return;
    }
    setStep('validating');
    setErrors([]);
    setProgress(0);
    setIsUploading(true);
    try {
      // Read as binary (not text) for binary-safe base64 — matches ClusterConnect
      const bytes = new Uint8Array(await file.arrayBuffer());
      setProgress(30);
      const base64 = bytesToBase64(bytes);
      setProgress(60);
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      const { contexts, currentContext } = parseKubeconfigContexts(text);

      if (contexts.length === 0) {
        // No contexts found — pass empty/current-context, backend handles it
        setProgress(80);
        const result = await submitClusterWithContext(base64, currentContext || '');
        setProgress(100);
        connectToCluster(result);
        return;
      }

      if (contexts.length === 1) {
        setProgress(80);
        const result = await submitClusterWithContext(base64, contexts[0]);
        setProgress(100);
        connectToCluster(result);
        return;
      }

      // Multiple contexts: show selection dialog
      setProgress(100);
      setMultiContextOptions(contexts);
      setMultiContextCurrentContext(currentContext);
      setMultiContextSelectedContext(currentContext || contexts[0]);
      setMultiContextBase64(base64);
      setMultiContextDialogOpen(true);
      setStep('upload'); // Return to upload state so user can interact with dialog
    } catch (err) {
      showError(err, 'Failed to add cluster');
      setStep('upload');
    } finally {
      setIsUploading(false);
      setProgress(0);
    }
  }, [hasBackend, submitClusterWithContext, connectToCluster, showError]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  /* ── Clipboard paste (identical pipeline to ClusterConnect.handlePasteSubmit) ── */
  const handlePasteSubmit = useCallback(async () => {
    const trimmed = pasteContent.trim();
    if (!trimmed) { toast.error('Paste your kubeconfig content first'); return; }
    if (!hasBackend) { toast.error('Backend not available', { description: 'Start the Kubilitics backend first' }); return; }

    setIsPasting(true);
    try {
      const encoder = new TextEncoder();
      const bytes = encoder.encode(trimmed);
      const base64 = bytesToBase64(bytes);
      const { contexts, currentContext } = parseKubeconfigContexts(trimmed);

      if (contexts.length > 1) {
        // Multiple contexts — show selection dialog
        setMultiContextOptions(contexts);
        setMultiContextCurrentContext(currentContext);
        setMultiContextSelectedContext(currentContext || contexts[0]);
        setMultiContextBase64(base64);
        setClipboardOpen(false);
        setPasteContent('');
        setMultiContextDialogOpen(true);
        return;
      }

      const contextName = contexts[0] || currentContext || 'default';
      const result = await submitClusterWithContext(base64, contextName);
      setClipboardOpen(false);
      setPasteContent('');
      connectToCluster(result);
    } catch (err) {
      showError(err, 'Failed to add cluster');
    } finally {
      setIsPasting(false);
    }
  }, [pasteContent, hasBackend, submitClusterWithContext, connectToCluster, showError]);

  /* ── Multi-context dialog submit ── */
  const handleMultiContextSubmit = useCallback(async () => {
    if (!multiContextSelectedContext || !multiContextBase64) return;
    setMultiContextSubmitting(true);
    try {
      const result = await submitClusterWithContext(multiContextBase64, multiContextSelectedContext);
      setMultiContextDialogOpen(false);
      connectToCluster(result);
    } catch (err) {
      showError(err, 'Failed to add cluster');
    } finally {
      setMultiContextSubmitting(false);
    }
  }, [multiContextSelectedContext, multiContextBase64, submitClusterWithContext, connectToCluster, showError]);

  /* ── Auto-detect from ~/.kube/config ── */
  const handleAutoDetect = useCallback(async () => {
    if (!hasBackend) {
      toast.error('Backend not available', { description: 'Start the Kubilitics backend first' });
      return;
    }
    setIsDetecting(true);
    try {
      const discovered = await discoverClusters(backendBaseUrl);
      if (discovered.length === 0) {
        toast.info('No new clusters found', { description: 'All contexts in ~/.kube/config are already registered' });
      } else {
        // Invalidate and refetch cluster list
        await queryClient.invalidateQueries({ queryKey: ['backend', 'clusters'] });
        await queryClient.invalidateQueries({ queryKey: ['backend', 'clusters', 'discover'] });
        await clustersFromBackend.refetch();

        const first = discovered[0];
        const cluster = backendClusterToCluster(first);
        setCurrentClusterId(first.id);
        const allClusters = clustersFromBackend.data
          ? [...clustersFromBackend.data.map(backendClusterToCluster), cluster]
            .filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i)
          : [cluster];
        setClusters(allClusters);
        setActiveCluster(cluster);
        setDemo(false);
        toast.success(`Discovered ${discovered.length} cluster${discovered.length > 1 ? 's' : ''}`, {
          description: discovered.map((c) => c.name).join(', '),
        });
        navigate('/dashboard', { replace: true });
      }
    } catch (err) {
      showError(err, 'Auto-detect failed');
    } finally {
      setIsDetecting(false);
    }
  }, [hasBackend, backendBaseUrl, queryClient, clustersFromBackend, setCurrentClusterId, setClusters, setActiveCluster, setDemo, navigate, showError]);

  /* ── Stepper ── */
  const stepIndex = step === 'upload' ? 0 : step === 'validating' ? 0 : 2;
  const steps = ['Add Config', 'Connect'];

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Subtle background texture */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--primary)/0.08),transparent)]" />

      <div className="relative container mx-auto max-w-3xl px-6 py-10">
        {/* ── Header ── */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex items-center justify-between mb-10"
        >
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="flex items-center gap-2.5">
            <BrandLogo height={28} />
            <span className="text-sm font-semibold tracking-tight text-foreground">Add Cluster</span>
          </div>
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        </motion.div>

        {/* ── Content ── */}
        <AnimatePresence mode="wait">
          {/* ───── Upload/Main Step ───── */}
          {(step === 'upload' || step === 'validating') && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.35 }}
            >
              <div className="text-center mb-10">
                <h1 className="text-2xl font-bold tracking-tight mb-2">Add a cluster</h1>
                <p className="text-sm text-muted-foreground">
                  Connect your Kubernetes cluster to Kubilitics
                </p>
              </div>

              {step === 'validating' ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="rounded-2xl border border-border bg-card p-12 text-center"
                >
                  <div className="space-y-5">
                    <Loader2 className="h-10 w-10 text-primary animate-spin mx-auto" />
                    <div>
                      <p className="font-medium text-foreground">
                        {isUploading ? 'Uploading kubeconfig...' : 'Connecting to cluster...'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">This should only take a moment</p>
                    </div>
                    <Progress value={progress} className="max-w-xs mx-auto h-1.5" />
                  </div>
                </motion.div>
              ) : (
                <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
                  {/* Auto-detect — prominent CTA when backend is available */}
                  {hasBackend && (
                    <motion.button
                      variants={fadeUp}
                      type="button"
                      onClick={handleAutoDetect}
                      disabled={isDetecting}
                      className={cn(
                        'w-full group relative overflow-hidden rounded-2xl border bg-card p-5 text-left transition-all duration-300',
                        'hover:shadow-lg hover:shadow-primary/5 hover:border-primary/40',
                        'border-primary/20 bg-gradient-to-r from-primary/[0.04] to-transparent',
                      )}
                    >
                      <div className="flex items-center gap-4">
                        <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
                          {isDetecting ? (
                            <Loader2 className="h-5 w-5 text-primary animate-spin" />
                          ) : (
                            <Zap className="h-5 w-5 text-primary" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-foreground">
                              {isDetecting ? 'Scanning...' : 'Auto-detect clusters'}
                            </p>
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-medium bg-primary/10 text-primary border-0">
                              Recommended
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Scan <code className="font-mono text-[10px] bg-muted/80 px-1 py-0.5 rounded">~/.kube/config</code> and register all contexts automatically
                          </p>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
                      </div>
                    </motion.button>
                  )}

                  {/* Divider */}
                  {hasBackend && (
                    <motion.div variants={fadeUp} className="relative py-1">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-border/60" />
                      </div>
                      <div className="relative flex justify-center">
                        <span className="bg-background px-3 text-[10px] uppercase tracking-widest text-muted-foreground/60 font-medium">
                          or add manually
                        </span>
                      </div>
                    </motion.div>
                  )}

                  {/* Clipboard + File — side by side */}
                  <div className="grid grid-cols-2 gap-3">
                    <motion.button
                      variants={fadeUp}
                      type="button"
                      onClick={() => setClipboardOpen(true)}
                      className={cn(
                        'group rounded-2xl border border-border bg-card p-5 text-left transition-all duration-300',
                        'hover:shadow-md hover:shadow-foreground/5 hover:border-foreground/15',
                      )}
                    >
                      <div className="h-10 w-10 rounded-xl bg-muted/80 flex items-center justify-center mb-4 group-hover:bg-muted transition-colors">
                        <ClipboardPaste className="h-5 w-5 text-foreground/70" />
                      </div>
                      <p className="font-semibold text-sm text-foreground">Paste from clipboard</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Paste kubeconfig YAML content directly
                      </p>
                    </motion.button>

                    <motion.label
                      variants={fadeUp}
                      className={cn(
                        'group rounded-2xl border border-dashed border-border bg-card p-5 text-left cursor-pointer transition-all duration-300',
                        'hover:shadow-md hover:shadow-foreground/5 hover:border-foreground/15',
                        isDragging && 'border-primary bg-primary/5 shadow-lg shadow-primary/10',
                      )}
                      onDrop={handleDrop}
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={() => setIsDragging(false)}
                    >
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                      />
                      <div className="h-10 w-10 rounded-xl bg-muted/80 flex items-center justify-center mb-4 group-hover:bg-muted transition-colors">
                        <FolderOpen className="h-5 w-5 text-foreground/70" />
                      </div>
                      <p className="font-semibold text-sm text-foreground">Upload file</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Browse or drag & drop a kubeconfig file
                      </p>
                    </motion.label>
                  </div>

                  {/* Helper text */}
                  <motion.div variants={fadeUp} className="text-center pt-2 space-y-1">
                    <p className="text-[11px] text-muted-foreground/70">
                      Kubeconfig is usually at <code className="font-mono bg-muted/60 px-1 py-0.5 rounded text-[10px]">~/.kube/config</code>
                      {' · '}
                      On macOS press <kbd className="font-mono bg-muted/60 px-1 py-0.5 rounded text-[10px] border border-border/50">⌘⇧.</kbd> in file picker to show hidden folders
                    </p>
                  </motion.div>
                </motion.div>
              )}

              {/* Errors */}
              {errors.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-5 p-4 rounded-xl bg-destructive/5 border border-destructive/15"
                >
                  <div className="flex items-center gap-2 text-destructive mb-2">
                    <XCircle className="h-4 w-4" />
                    <span className="text-sm font-semibold">Something went wrong</span>
                  </div>
                  <ul className="text-xs text-destructive/80 space-y-0.5 list-disc list-inside">
                    {errors.map((err, i) => <li key={i}>{err}</li>)}
                  </ul>
                </motion.div>
              )}
            </motion.div>
          )}

          {/* ───── Connecting Step ───── */}
          {step === 'connecting' && (
            <motion.div
              key="connecting"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-20"
            >
              <motion.div
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
                className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6"
              >
                <Server className="h-7 w-7 text-primary" />
              </motion.div>
              <h2 className="text-xl font-bold mb-1.5">Connecting to cluster</h2>
              <p className="text-sm text-muted-foreground">
                Establishing a secure connection...
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Clipboard paste dialog ── */}
      <Dialog open={clipboardOpen} onOpenChange={setClipboardOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ClipboardPaste className="h-4 w-4" />
              Paste kubeconfig
            </DialogTitle>
            <DialogDescription className="text-xs">
              Paste your kubeconfig YAML below. The cluster will be registered and connected.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder={`apiVersion: v1\nkind: Config\nclusters:\n  - cluster:\n      server: https://...\n    name: my-cluster\ncontexts:\n  - context:\n      cluster: my-cluster\n      user: admin\n    name: my-cluster\ncurrent-context: my-cluster`}
            value={pasteContent}
            onChange={(e) => setPasteContent(e.target.value)}
            className="font-mono text-xs min-h-[200px] resize-y bg-muted/30"
            autoFocus
          />
          <p className="text-[10px] text-muted-foreground">
            Run <code className="bg-muted px-1 py-0.5 rounded text-[10px] font-mono">kubectl config view --raw</code> to get your kubeconfig
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setClipboardOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handlePasteSubmit} disabled={!pasteContent.trim() || isPasting}>
              {isPasting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add Cluster'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Multi-context selection dialog (identical to ClusterConnect) ── */}
      <Dialog open={multiContextDialogOpen} onOpenChange={setMultiContextDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Server className="h-4 w-4" />
              Select a context
            </DialogTitle>
            <DialogDescription className="text-xs">
              Your kubeconfig contains {multiContextOptions.length} contexts. Select which one to add.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto py-1">
            {multiContextOptions.map((ctx) => {
              const selected = multiContextSelectedContext === ctx;
              const isCurrent = ctx === multiContextCurrentContext;
              return (
                <button
                  key={ctx}
                  type="button"
                  onClick={() => setMultiContextSelectedContext(ctx)}
                  className={cn(
                    'w-full flex items-center gap-3 p-3 rounded-lg text-left text-sm transition-all',
                    selected
                      ? 'bg-primary/10 border border-primary/30'
                      : 'bg-muted/30 border border-transparent hover:bg-muted/60',
                  )}
                >
                  <div className={cn(
                    'h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0',
                    selected ? 'border-primary bg-primary' : 'border-muted-foreground/30',
                  )}>
                    {selected && <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
                  </div>
                  <span className="font-medium truncate">{ctx}</span>
                  {isCurrent && (
                    <Badge variant="secondary" className="ml-auto text-[10px] shrink-0">
                      current-context
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setMultiContextDialogOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              onClick={handleMultiContextSubmit}
              disabled={!multiContextSelectedContext || multiContextSubmitting}
            >
              {multiContextSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add Cluster'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
