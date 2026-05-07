// ClusterPickerPage — two-pane cluster onboarding.
//
// Left pane (50%):  detected / connected clusters — click to connect.
// Right pane (50%): add a new cluster via file upload or YAML paste.
// Bottom action bar: [Cancel] [Add Cluster] — spans both panes.
import { useCallback, useMemo, useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  ServerOff,
  Upload,
  ClipboardPaste,
  Loader2,
  Check,
  FileCode2,
  CheckCircle2,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { BrandLogo } from '@/components/BrandLogo';
import { cn } from '@/lib/utils';

import { useClusterPresenceStore, useActiveCluster } from '@/stores/clusterPresenceStore';
import { getEffectiveBackendBaseUrl, useBackendConfigStore } from '@/stores/backendConfigStore';
import type {
  DiscoveredCluster,
  LogicalIdentity,
  PresenceSnapshot,
  RegisteredCluster,
} from '@/types/resilient';
import { logicalIdentityKey } from '@/types/resilient';
import { addCluster, addClusterWithUpload } from '@/services/api/clusters';
import { parseKubeconfigContexts, bytesToBase64 } from '@/lib/kubeconfigUtils';
import { toast } from 'sonner';
import { getProviderLogo, getProviderLabel } from '@/topology/icons/providerLogoMap';

// ─── Types ───────────────────────────────────────────────────────────────────

type Reachability = 'reachable' | 'unreachable' | 'unknown';
type AddTab = 'upload' | 'paste';

interface MergedCluster {
  identity: LogicalIdentity;
  source: DiscoveredCluster['source'];
  reachability: Reachability;
  isConnected: boolean;
  connectedAt?: string;
  kubeconfigPath?: string;
  provider?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeProvider(raw?: string): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === 'aws') return 'eks';
  if (v === 'azure') return 'aks';
  if (v === 'gcp' || v === 'google') return 'gke';
  if (v === 'docker desktop' || v === 'docker-desktop') return 'docker-desktop';
  return v;
}

function inferProviderFromName(name: string): string | undefined {
  const n = name.toLowerCase();
  if (n.includes('docker-desktop') || n.includes('docker-for-desktop')) return 'docker-desktop';
  if (n.startsWith('kind-') || n === 'kind') return 'kind';
  if (n.includes('minikube')) return 'minikube';
  if (n.startsWith('arn:aws:eks') || n.includes('eks')) return 'eks';
  if (n.includes('aks') || n.includes('azure')) return 'aks';
  if (n.startsWith('gke_') || n.includes('gke') || n.includes('gcp')) return 'gke';
  if (n.includes('openshift') || n.includes('-ocp')) return 'openshift';
  if (n.includes('rancher') || n.includes('rke')) return 'rancher';
  if (n.includes('k3s') || n.includes('k3d')) return 'k3s';
  return undefined;
}

function mergeClusters(
  discovered: DiscoveredCluster[],
  registered: RegisteredCluster[],
  connectedKeys: Set<string>,
  connectedAtMap: Map<string, string>,
): MergedCluster[] {
  const byKey = new Map<string, MergedCluster>();
  for (const d of discovered) {
    const k = logicalIdentityKey(d.identity);
    byKey.set(k, {
      identity: d.identity,
      source: d.source,
      reachability: 'unknown',
      isConnected: connectedKeys.has(k),
      connectedAt: connectedAtMap.get(k),
      kubeconfigPath: d.kubeconfig_path,
      provider: normalizeProvider(d.provider) ?? inferProviderFromName(d.identity.name),
    });
  }
  for (const r of registered) {
    const k = logicalIdentityKey(r.identity);
    const prev = byKey.get(k);
    byKey.set(k, {
      identity: r.identity,
      source: r.source,
      reachability: r.reachable ? 'reachable' : 'unreachable',
      isConnected: connectedKeys.has(k) || prev?.isConnected || false,
      connectedAt: connectedAtMap.get(k) ?? prev?.connectedAt,
      kubeconfigPath: r.kubeconfig_path ?? prev?.kubeconfigPath,
      provider: normalizeProvider(r.provider) ?? prev?.provider ?? inferProviderFromName(r.identity.name),
    });
  }
  return Array.from(byKey.values());
}

function sortClusters(list: MergedCluster[]): MergedCluster[] {
  return [...list].sort((a, b) => {
    if (a.isConnected !== b.isConnected) return a.isConnected ? -1 : 1;
    if (a.isConnected && b.isConnected) {
      const ta = a.connectedAt ?? '', tb = b.connectedAt ?? '';
      if (ta !== tb) return ta < tb ? 1 : -1;
    }
    return a.identity.name.localeCompare(b.identity.name);
  });
}

function reachabilityDotClass(r: Reachability): string {
  if (r === 'reachable') return 'bg-[hsl(var(--success))]';
  if (r === 'unreachable') return 'bg-[hsl(var(--destructive))]';
  return 'bg-muted-foreground/40';
}

function reachabilityTitle(r: Reachability): string {
  if (r === 'reachable') return 'Reachable';
  if (r === 'unreachable') return 'Unreachable';
  return 'Unknown';
}

function sourceBadgeLabel(s: DiscoveredCluster['source']): string {
  if (s === 'kubeconfig') return 'kubeconfig';
  if (s === 'secret') return 'secret';
  return s;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function ClusterPickerPage() {
  const navigate = useNavigate();

  // Presence store
  const discovered   = useClusterPresenceStore((s) => s.discovered);
  const registered   = useClusterPresenceStore((s) => s.registered);
  const connected    = useClusterPresenceStore((s) => s.connected);
  const setActive    = useClusterPresenceStore((s) => s.setActiveByLogicalIdentity);
  const applySnap    = useClusterPresenceStore((s) => s.applySnapshot);
  const backendUrl   = useBackendConfigStore((s) => getEffectiveBackendBaseUrl(s.backendBaseUrl));
  const activeCluster = useActiveCluster();
  const hasActive    = activeCluster !== null;

  // ── Cluster list ──────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const clusters = useMemo<MergedCluster[]>(() => {
    const cKeys = new Set(connected.map((c) => logicalIdentityKey(c.identity)));
    const cAtMap = new Map(connected.map((c) => [logicalIdentityKey(c.identity), c.connected_at]));
    return sortClusters(mergeClusters(discovered, registered, cKeys, cAtMap));
  }, [discovered, registered, connected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clusters;
    return clusters.filter((c) =>
      c.identity.name.toLowerCase().includes(q) || c.identity.serverUrl.toLowerCase().includes(q)
    );
  }, [clusters, query]);

  const refreshSnapshot = useCallback(async () => {
    try {
      const res = await fetch(`${backendUrl}/api/v1/presence`, { credentials: 'include' });
      if (res.ok) applySnap(await res.json() as PresenceSnapshot);
    } catch { /* best-effort */ }
  }, [backendUrl, applySnap]);

  const handlePick = useCallback(async (c: MergedCluster) => {
    const key = logicalIdentityKey(c.identity);
    if (pendingKey === key) return;
    if (c.source !== 'kubeconfig' || c.isConnected) {
      setActive(c.identity);
      navigate('/dashboard');
      return;
    }
    setPendingKey(key);
    try {
      const kubePath = c.kubeconfigPath ?? '~/.kube/config';
      const added = await addCluster(backendUrl, kubePath, c.identity.name);
      const store = useClusterPresenceStore.getState();
      const identity = {
        name: added.name ?? c.identity.name,
        serverUrl: (added as unknown as { server_url?: string }).server_url ?? c.identity.serverUrl,
      };
      const reg = {
        identity, source: 'kubeconfig' as const,
        context_name: added.context ?? c.identity.name,
        kubeconfig_path: added.kubeconfig_path ?? kubePath,
        registered_at: added.created_at ?? new Date().toISOString(),
        reachable: added.status === 'connected',
        session_id: added.id, provider: added.provider,
      };
      store.applySnapshot({
        discovered: store.discovered,
        registered: [...store.registered.filter((r) => r.identity.name !== identity.name), reg],
        connected: [...store.connected.filter((c2) => c2.identity.name !== identity.name), { ...reg, connected_at: added.last_connected ?? new Date().toISOString() }],
        last_used: null,
      });
      setActive(identity);
      void refreshSnapshot();
      navigate('/dashboard');
    } catch (err) {
      toast.error(`Couldn't connect`, { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setPendingKey(null);
    }
  }, [pendingKey, backendUrl, setActive, refreshSnapshot, navigate]);

  // ── Add-cluster right pane state ──────────────────────────────────────────
  const [addTab, setAddTab] = useState<AddTab>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [pasteContent, setPasteContent] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  // Context picker shown when kubeconfig has multiple contexts
  const [picker, setPicker] = useState<{ contexts: string[]; selected: string; base64: string } | null>(null);
  // Pending file (processed but awaiting submit — single context path)
  const [pendingFile, setPendingFile] = useState<{ base64: string; contextName: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetAddForm = useCallback(() => {
    setPasteContent('');
    setPicker(null);
    setPendingFile(null);
    setIsDragging(false);
    setAddTab('upload');
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setIsAdding(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const base64 = bytesToBase64(bytes);
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      const parsed = parseKubeconfigContexts(text);
      if (parsed.contexts.length <= 1) {
        setPendingFile({ base64, contextName: parsed.contexts[0] || parsed.currentContext || '' });
      } else {
        setPicker({ contexts: parsed.contexts, selected: parsed.currentContext || parsed.contexts[0], base64 });
      }
    } catch (err) {
      toast.error('Failed to read kubeconfig', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsAdding(false);
    }
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }, [handleFile]);

  // Can the "Add Cluster" button be clicked?
  const canAdd = (() => {
    if (isAdding) return false;
    if (picker) return !!picker.selected;
    if (addTab === 'upload') return !!pendingFile;
    return pasteContent.trim().length > 0;
  })();

  const handleAddCluster = useCallback(async () => {
    if (!canAdd) return;
    setIsAdding(true);
    try {
      let base64 = '';
      let contextName = '';

      if (picker) {
        base64 = picker.base64;
        contextName = picker.selected;
      } else if (addTab === 'upload' && pendingFile) {
        base64 = pendingFile.base64;
        contextName = pendingFile.contextName;
      } else {
        const trimmed = pasteContent.trim();
        const bytes = new TextEncoder().encode(trimmed);
        base64 = bytesToBase64(bytes);
        const parsed = parseKubeconfigContexts(trimmed);
        if (parsed.contexts.length > 1) {
          setPicker({ contexts: parsed.contexts, selected: parsed.currentContext || parsed.contexts[0], base64 });
          setIsAdding(false);
          return;
        }
        contextName = parsed.contexts[0] || parsed.currentContext || 'default';
      }

      await addClusterWithUpload(backendUrl, base64, contextName);
      toast.success('Cluster added', { description: `Context: ${contextName}` });
      resetAddForm();
      void refreshSnapshot();
    } catch (err) {
      toast.error('Failed to add cluster', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsAdding(false);
    }
  }, [canAdd, picker, addTab, pendingFile, pasteContent, backendUrl, resetAddForm, refreshSnapshot]);

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col bg-background" role="main" aria-label="Clusters">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="flex items-center justify-center px-6 py-4 border-b border-border/40 shrink-0">
        <motion.div
          className="flex items-center gap-2.5"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <BrandLogo mark height={30} className="rounded-lg" />
          <span className="text-sm font-semibold tracking-[0.1em] text-foreground">KUBILITICS</span>
        </motion.div>
      </header>

      {/* ── Two panes ─────────────────────────────────────────────── */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 overflow-hidden">

        {/* ── Left pane — cluster list ─────────────────────────────── */}
        <div className="flex flex-col overflow-hidden border-b md:border-b-0 md:border-r border-border/40">
          {/* Pane header */}
          <div className="px-6 py-5 border-b border-border/40 shrink-0 space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight text-foreground">Your clusters</h2>
              <Badge variant="secondary" className="gap-1 font-normal text-xs">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Live
              </Badge>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" aria-hidden />
              <input
                type="search"
                placeholder="Search by name or URL…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search clusters"
                className={cn(
                  'w-full h-10 pl-9 pr-4 rounded-xl',
                  'bg-muted/40 border border-border/60',
                  'text-sm placeholder:text-muted-foreground/60',
                  'transition-[border-color,background-color] duration-150',
                  'hover:border-border focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 focus:bg-background',
                )}
              />
            </div>
          </div>

          {/* Cluster list */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2" role="list" aria-label="Available clusters">
            {clusters.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-4 py-16 text-center" data-testid="cluster-picker-empty">
                <div className="h-14 w-14 rounded-2xl bg-muted/60 flex items-center justify-center">
                  <ServerOff className="h-6 w-6 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">No clusters detected</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-relaxed">
                    Kubilitics scanned <code className="font-mono">~/.kube/config</code> and found nothing.
                    Add one using the panel on the right.
                  </p>
                </div>
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-12">No clusters match your search.</p>
            ) : (
              filtered.map((c) => {
                const key = logicalIdentityKey(c.identity);
                const logo = getProviderLogo(c.provider);
                const label = getProviderLabel(c.provider);
                const isPending = pendingKey === key;
                return (
                  <motion.button
                    key={key}
                    type="button"
                    onClick={() => { void handlePick(c); }}
                    disabled={pendingKey !== null}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18 }}
                    className={cn(
                      'w-full text-left flex items-center gap-4 px-4 py-3.5 rounded-xl border',
                      'transition-all duration-150',
                      isPending
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border/50 bg-card hover:border-primary/30 hover:bg-muted/30 hover:shadow-[var(--shadow-1)]',
                      pendingKey !== null && !isPending && 'opacity-50 cursor-not-allowed',
                    )}
                    aria-label={`Open cluster ${c.identity.name}`}
                    data-testid="cluster-picker-card"
                  >
                    {/* Provider logo */}
                    <div className="relative shrink-0">
                      <div className="h-10 w-10 rounded-xl bg-muted/50 border border-border/40 flex items-center justify-center overflow-hidden">
                        {logo
                          ? <img src={logo} alt={label} className="h-6 w-6 object-contain" />
                          : <span className="text-sm font-bold text-muted-foreground">{c.identity.name.slice(0, 1).toUpperCase()}</span>
                        }
                      </div>
                      <span
                        className={cn('absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background', reachabilityDotClass(c.reachability))}
                        title={reachabilityTitle(c.reachability)}
                      />
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground truncate">{c.identity.name}</span>
                        {c.isConnected && (
                          <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-[10px] px-1.5 shrink-0">
                            Active
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs font-mono text-muted-foreground truncate mt-0.5">{c.identity.serverUrl}</div>
                      {label && <div className="text-[11px] text-muted-foreground/70 mt-0.5">{label}</div>}
                    </div>

                    {/* Right side */}
                    <div className="shrink-0 flex items-center gap-1.5">
                      <Badge variant="outline" className="font-normal text-[10px] px-1.5">{sourceBadgeLabel(c.source)}</Badge>
                      {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                    </div>
                  </motion.button>
                );
              })
            )}
          </div>
        </div>

        {/* ── Right pane — add cluster ─────────────────────────────── */}
        <div className="flex flex-col overflow-hidden bg-muted/10">
          {/* Pane header */}
          <div className="px-6 py-5 border-b border-border/40 shrink-0">
            <h2 className="text-lg font-bold tracking-tight text-foreground">Add a cluster</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Upload or paste a kubeconfig to register a new context
            </p>
          </div>

          {/* Pane body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            <AnimatePresence mode="wait">
              {picker ? (
                /* Multi-context picker */
                <motion.div
                  key="picker"
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  className="space-y-3"
                >
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                    <span>Multiple contexts found — select one:</span>
                  </div>
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {picker.contexts.map((ctx) => {
                      const active = picker.selected === ctx;
                      return (
                        <button
                          key={ctx}
                          type="button"
                          onClick={() => setPicker({ ...picker, selected: ctx })}
                          className={cn(
                            'w-full flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-all',
                            active
                              ? 'border-primary/60 bg-primary/5 shadow-[var(--shadow-1)]'
                              : 'border-border/60 hover:border-border hover:bg-muted/40',
                          )}
                        >
                          <span className="text-sm font-medium truncate">{ctx}</span>
                          <span className={cn(
                            'shrink-0 h-5 w-5 rounded-full flex items-center justify-center',
                            active ? 'bg-primary text-primary-foreground' : 'bg-muted/60 text-transparent',
                          )}>
                            <Check className="h-3 w-3" />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => setPicker(null)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-3.5 w-3.5" /> Clear selection
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="form"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-5"
                >
                  {/* Tab switcher */}
                  <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-muted/50 border border-border/30">
                    {(['upload', 'paste'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => { setAddTab(t); setPendingFile(null); }}
                        className={cn(
                          'flex items-center justify-center gap-2 h-9 rounded-lg text-xs font-medium transition-all',
                          addTab === t
                            ? 'bg-background shadow-[var(--shadow-1)] text-foreground'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {t === 'upload' ? <Upload className="h-3.5 w-3.5" /> : <ClipboardPaste className="h-3.5 w-3.5" />}
                        {t === 'upload' ? 'Upload file' : 'Paste YAML'}
                      </button>
                    ))}
                  </div>

                  {addTab === 'upload' && (
                    pendingFile ? (
                      /* File processed — show confirmation */
                      <div className="flex items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/5 px-4 py-3">
                        <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                          <Check className="h-4 w-4 text-emerald-600" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">
                            {pendingFile.contextName || 'kubeconfig loaded'}
                          </p>
                          <p className="text-xs text-muted-foreground">Ready to add. Click "Add Cluster" below.</p>
                        </div>
                        <button type="button" onClick={() => setPendingFile(null)} className="shrink-0 text-muted-foreground hover:text-foreground">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => fileInputRef.current?.click()}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                        className={cn(
                          'flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed py-10 cursor-pointer',
                          'transition-all duration-200 select-none',
                          isDragging
                            ? 'border-primary bg-primary/5 scale-[1.01]'
                            : 'border-border/50 hover:border-primary/40 hover:bg-muted/20',
                        )}
                        data-testid="add-cluster-dropzone"
                      >
                        {isAdding
                          ? <Loader2 className="h-8 w-8 text-primary animate-spin" />
                          : (
                            <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                              <Upload className="h-5 w-5 text-primary" />
                            </div>
                          )
                        }
                        <div className="text-center">
                          <p className="text-sm font-semibold text-foreground">Drop kubeconfig here</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            or <span className="text-primary font-medium">click to browse</span>
                          </p>
                          <p className="font-mono text-[11px] text-muted-foreground/60 mt-2">~/.kube/config</p>
                        </div>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".yaml,.yml,.config,application/x-yaml,text/yaml,text/plain"
                          className="hidden"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
                        />
                      </div>
                    )
                  )}

                  {addTab === 'paste' && (
                    <div className="rounded-2xl border border-border/60 bg-muted/20 overflow-hidden focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 transition-all">
                      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <FileCode2 className="h-3 w-3" />
                        kubeconfig.yaml
                      </div>
                      <Textarea
                        value={pasteContent}
                        onChange={(e) => setPasteContent(e.target.value)}
                        placeholder={'apiVersion: v1\nkind: Config\nclusters:\n  - cluster:\n      server: https://…'}
                        className="min-h-[200px] font-mono text-xs border-0 bg-transparent rounded-none focus-visible:ring-0 focus-visible:ring-offset-0 resize-none"
                        data-testid="add-cluster-paste-area"
                      />
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* ── Bottom action bar — spans both panes ──────────────────── */}
      <div className="border-t border-border/40 bg-background/80 backdrop-blur px-6 py-4 flex items-center justify-end gap-3 shrink-0">
        {hasActive && (
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(-1)}
            className="h-10 px-5 rounded-xl border-border/60 text-sm"
          >
            Cancel
          </Button>
        )}
        <Button
          type="button"
          onClick={() => { void handleAddCluster(); }}
          disabled={!canAdd || isAdding}
          className={cn(
            'h-10 px-6 rounded-xl text-sm font-medium gap-2',
            'bg-primary hover:bg-primary/90 text-primary-foreground',
            'shadow-[var(--shadow-2)] hover:shadow-[var(--shadow-3)]',
            'transition-all duration-200 disabled:shadow-none disabled:opacity-50',
          )}
        >
          {isAdding && <Loader2 className="h-4 w-4 animate-spin" />}
          Add Cluster
        </Button>
      </div>
    </div>
  );
}

export default ClusterPickerPage;
