// ClusterPickerPage — world-class two-pane cluster onboarding.
//
// Left pane:  all detected / connected clusters — one-click to connect.
// Right pane: add a new cluster via kubeconfig file upload or YAML paste.
//
// The "Add cluster" dialog is NOT used here — the right pane IS the add
// experience, inline. Cancel / Back navigates to the previous screen.
import { useCallback, useMemo, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Search,
  ServerOff,
  Upload,
  ClipboardPaste,
  Loader2,
  Check,
  FileCode2,
  CheckCircle2,
} from 'lucide-react';
import { motion } from 'framer-motion';

import { Card } from '@/components/ui/card';
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

type Reachability = 'reachable' | 'unreachable' | 'unknown';

interface MergedCluster {
  identity: LogicalIdentity;
  source: DiscoveredCluster['source'];
  reachability: Reachability;
  isConnected: boolean;
  connectedAt?: string;
  kubeconfigPath?: string;
  provider?: string;
}

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
  if (n.startsWith('arn:aws:eks') || n.includes('eks') || n.endsWith('.eks')) return 'eks';
  if (n.endsWith('.aks') || n.includes('aks') || n.includes('azure')) return 'aks';
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
  if (r === 'reachable') return 'reachable';
  if (r === 'unreachable') return 'unreachable';
  return 'reachability unknown';
}

function sourceBadgeLabel(source: DiscoveredCluster['source']): string {
  switch (source) {
    case 'kubeconfig': return 'kubeconfig';
    case 'secret': return 'secret';
    case 'manual': return 'manual';
    default: return source;
  }
}

// ─── Right-pane add-cluster form ────────────────────────────────────────────

type AddTab = 'upload' | 'paste';
type ContextPickerState = { contexts: string[]; selectedContext: string; pendingBase64: string } | null;

interface AddClusterPaneProps {
  backendBaseUrl: string;
  onAdded: () => void;
  onCancel?: () => void;
  showCancel: boolean;
}

function AddClusterPane({ backendBaseUrl, onAdded, onCancel, showCancel }: AddClusterPaneProps) {
  const [tab, setTab] = useState<AddTab>('upload');
  const [isBusy, setIsBusy] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [pasteContent, setPasteContent] = useState('');
  const [picker, setPicker] = useState<ContextPickerState>(null);

  const reset = useCallback(() => {
    setIsBusy(false);
    setIsDragging(false);
    setPasteContent('');
    setPicker(null);
    setTab('upload');
  }, []);

  const submit = useCallback(async (base64: string, contextName: string) => {
    setIsBusy(true);
    try {
      await addClusterWithUpload(backendBaseUrl, base64, contextName);
      toast.success('Cluster added', { description: `Context: ${contextName}` });
      reset();
      onAdded();
    } catch (err) {
      toast.error('Failed to add cluster', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsBusy(false);
    }
  }, [backendBaseUrl, onAdded, reset]);

  const handleFile = useCallback(async (file: File) => {
    setIsBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const base64 = bytesToBase64(bytes);
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      const parsed = parseKubeconfigContexts(text);
      if (parsed.contexts.length <= 1) {
        await submit(base64, parsed.contexts[0] || parsed.currentContext || '');
        return;
      }
      setPicker({ contexts: parsed.contexts, selectedContext: parsed.currentContext || parsed.contexts[0], pendingBase64: base64 });
    } catch (err) {
      toast.error('Failed to read kubeconfig', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsBusy(false);
    }
  }, [submit]);

  const handlePasteSubmit = useCallback(async () => {
    const trimmed = pasteContent.trim();
    if (!trimmed) { toast.error('Paste your kubeconfig content first'); return; }
    setIsBusy(true);
    try {
      const bytes = new TextEncoder().encode(trimmed);
      const base64 = bytesToBase64(bytes);
      const parsed = parseKubeconfigContexts(trimmed);
      if (parsed.contexts.length <= 1) {
        await submit(base64, parsed.contexts[0] || parsed.currentContext || 'default');
        return;
      }
      setPicker({ contexts: parsed.contexts, selectedContext: parsed.currentContext || parsed.contexts[0], pendingBase64: base64 });
    } catch (err) {
      toast.error('Failed to parse kubeconfig', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsBusy(false);
    }
  }, [pasteContent, submit]);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }, [handleFile]);

  return (
    <div className="flex flex-col h-full">
      {/* Pane header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-border/50">
        <div>
          <h2 className="text-base font-semibold text-foreground">Add a cluster</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Connect a kubeconfig not already detected
          </p>
        </div>
        {showCancel && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            className="rounded-xl h-8 px-3 text-xs gap-1.5 border-border/60 text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">
        {picker ? (
          /* Multi-context picker */
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
              <span>Multiple contexts found — pick one:</span>
            </div>
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
              {picker.contexts.map((ctx) => {
                const active = picker.selectedContext === ctx;
                return (
                  <button
                    key={ctx}
                    type="button"
                    onClick={() => setPicker({ ...picker, selectedContext: ctx })}
                    className={cn(
                      'flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-all',
                      active
                        ? 'border-primary/60 bg-primary/5 shadow-[var(--shadow-1)]'
                        : 'border-border/60 hover:border-border hover:bg-muted/40',
                    )}
                  >
                    <span className="text-sm font-medium text-foreground truncate">{ctx}</span>
                    <span className={cn(
                      'shrink-0 h-5 w-5 rounded-full flex items-center justify-center transition-colors',
                      active ? 'bg-primary text-primary-foreground' : 'bg-muted/60 text-transparent',
                    )}>
                      <Check className="h-3 w-3" />
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="ghost" onClick={() => setPicker(null)} className="h-10 px-4 rounded-xl flex-1">
                Back
              </Button>
              <Button
                onClick={() => void submit(picker.pendingBase64, picker.selectedContext)}
                disabled={isBusy || !picker.selectedContext}
                className="h-10 px-4 rounded-xl flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add cluster'}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Tab switcher */}
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-muted/50">
              {(['upload', 'paste'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn(
                    'flex items-center justify-center gap-2 h-9 rounded-lg text-xs font-medium transition-all',
                    tab === t
                      ? 'bg-background shadow-[var(--shadow-1)] text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t === 'upload' ? <Upload className="h-3.5 w-3.5" /> : <ClipboardPaste className="h-3.5 w-3.5" />}
                  {t === 'upload' ? 'Upload file' : 'Paste YAML'}
                </button>
              ))}
            </div>

            {tab === 'upload' && (
              <div
                role="button"
                tabIndex={0}
                onClick={() => document.getElementById('cluster-file-input')?.click()}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') document.getElementById('cluster-file-input')?.click(); }}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={cn(
                  'flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-8 cursor-pointer',
                  'transition-all duration-200 select-none',
                  isDragging
                    ? 'border-primary bg-primary/5 scale-[1.01]'
                    : 'border-border/60 hover:border-primary/40 hover:bg-muted/30',
                )}
                data-testid="add-cluster-dropzone"
              >
                {isBusy ? (
                  <Loader2 className="h-8 w-8 text-primary animate-spin" />
                ) : (
                  <div className="h-12 w-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                    <Upload className="h-5 w-5" />
                  </div>
                )}
                <div className="text-center">
                  <p className="text-sm font-semibold text-foreground">Drop kubeconfig here</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    or <span className="text-primary font-medium">click to browse</span>
                  </p>
                  <p className="text-[11px] font-mono text-muted-foreground/70 mt-2">~/.kube/config</p>
                </div>
                <input
                  id="cluster-file-input"
                  type="file"
                  accept=".yaml,.yml,.config,application/x-yaml,text/yaml,text/plain"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
                />
              </div>
            )}

            {tab === 'paste' && (
              <div className="flex flex-col gap-3">
                <div className="relative rounded-2xl border border-border/60 bg-muted/30 focus-within:border-primary/40 focus-within:ring-4 focus-within:ring-primary/10 transition-all overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <FileCode2 className="h-3.5 w-3.5" />
                    kubeconfig.yaml
                  </div>
                  <Textarea
                    value={pasteContent}
                    onChange={(e) => setPasteContent(e.target.value)}
                    placeholder={'apiVersion: v1\nkind: Config\nclusters:\n  - cluster:\n      server: https://…'}
                    className="min-h-[180px] font-mono text-xs border-0 bg-transparent rounded-none focus-visible:ring-0 focus-visible:ring-offset-0 resize-none"
                    data-testid="add-cluster-paste-area"
                  />
                </div>
                <Button
                  onClick={handlePasteSubmit}
                  disabled={isBusy || !pasteContent.trim()}
                  className="h-10 rounded-xl w-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-[var(--shadow-2)]"
                  data-testid="add-cluster-paste-submit"
                >
                  {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add cluster'}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function ClusterPickerPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const activeCluster = useActiveCluster();
  const hasActiveCluster = activeCluster !== null;

  const discovered = useClusterPresenceStore((s) => s.discovered);
  const registered = useClusterPresenceStore((s) => s.registered);
  const connected = useClusterPresenceStore((s) => s.connected);
  const setActiveByLogicalIdentity = useClusterPresenceStore((s) => s.setActiveByLogicalIdentity);
  const applySnapshot = useClusterPresenceStore((s) => s.applySnapshot);
  const backendBaseUrl = useBackendConfigStore((s) => getEffectiveBackendBaseUrl(s.backendBaseUrl));

  const refreshSnapshot = useCallback(async () => {
    try {
      const res = await fetch(`${backendBaseUrl}/api/v1/presence`, { credentials: 'include' });
      if (!res.ok) return;
      const snap: PresenceSnapshot = await res.json();
      applySnapshot(snap);
    } catch { /* best-effort */ }
  }, [backendBaseUrl, applySnapshot]);

  const clusters = useMemo<MergedCluster[]>(() => {
    const connectedKeys = new Set(connected.map((c) => logicalIdentityKey(c.identity)));
    const connectedAtMap = new Map(connected.map((c) => [logicalIdentityKey(c.identity), c.connected_at]));
    return sortClusters(mergeClusters(discovered, registered, connectedKeys, connectedAtMap));
  }, [discovered, registered, connected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clusters;
    return clusters.filter((c) =>
      c.identity.name.toLowerCase().includes(q) || c.identity.serverUrl.toLowerCase().includes(q)
    );
  }, [clusters, query]);

  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const handlePick = async (cluster: MergedCluster) => {
    const key = logicalIdentityKey(cluster.identity);
    const isKubeconfigOnly = cluster.source === 'kubeconfig' && !cluster.isConnected;

    if (!isKubeconfigOnly) {
      setActiveByLogicalIdentity(cluster.identity);
      navigate('/dashboard');
      return;
    }

    if (pendingKey === key) return;
    setPendingKey(key);
    try {
      const kubeconfigPath = cluster.kubeconfigPath ?? '~/.kube/config';
      const added = await addCluster(backendBaseUrl, kubeconfigPath, cluster.identity.name);
      const store = useClusterPresenceStore.getState();
      const identity = {
        name: added.name ?? cluster.identity.name,
        serverUrl: (added as unknown as { server_url?: string }).server_url ?? cluster.identity.serverUrl,
      };
      const registeredEntry = {
        identity,
        source: 'kubeconfig' as const,
        context_name: added.context ?? cluster.identity.name,
        kubeconfig_path: added.kubeconfig_path ?? kubeconfigPath,
        registered_at: added.created_at ?? new Date().toISOString(),
        reachable: added.status === 'connected',
        session_id: added.id,
        provider: added.provider,
      };
      const connectedEntry = { ...registeredEntry, connected_at: added.last_connected ?? new Date().toISOString() };
      store.applySnapshot({
        discovered: store.discovered,
        registered: [...store.registered.filter((r) => r.identity.name !== identity.name), registeredEntry],
        connected: [...store.connected.filter((c) => c.identity.name !== identity.name), connectedEntry],
        last_used: null,
      });
      setActiveByLogicalIdentity(identity);
      void refreshSnapshot();
      navigate('/dashboard');
    } catch (err) {
      toast.error(`Couldn't connect to ${cluster.identity.name}`, {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background" role="main" aria-label="Clusters">

      {/* ── Top bar ────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border/40 shrink-0">
        <div className="w-32">
          {hasActiveCluster && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigate(-1)}
              className="gap-1.5 h-9 px-3 rounded-xl border-border/60 text-sm font-medium"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </Button>
          )}
        </div>

        <motion.div
          className="flex items-center gap-2.5"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <BrandLogo mark height={32} className="rounded-lg" />
          <span className="text-sm font-semibold tracking-[0.1em] text-foreground">KUBILITICS</span>
        </motion.div>

        <div className="w-32" />
      </header>

      {/* ── Two-pane body ──────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">

        {/* Left pane — cluster list */}
        <div className="flex-1 flex flex-col overflow-hidden border-b md:border-b-0 md:border-r border-border/40">

          {/* Left header */}
          <div className="px-6 py-5 border-b border-border/50 shrink-0">
            <div className="flex items-center gap-2 mb-4">
              <h1 className="text-xl font-bold tracking-tight text-foreground">Your clusters</h1>
              <Badge variant="secondary" className="font-normal gap-1.5">
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
                  'text-sm text-foreground placeholder:text-muted-foreground/60',
                  'transition-[border-color,background-color] duration-150',
                  'hover:border-border focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 focus:bg-background',
                )}
              />
            </div>
          </div>

          {/* Left body — cluster list */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5" role="list" aria-label="Available clusters">
            {clusters.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 py-16 text-center">
                <div className="h-14 w-14 rounded-2xl bg-muted/60 flex items-center justify-center">
                  <ServerOff className="h-6 w-6 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-base font-semibold text-foreground">No clusters found</p>
                  <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                    Kubilitics scanned <code className="font-mono text-foreground/80">~/.kube/config</code> and
                    found no contexts. Add one using the panel on the right.
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
                  <motion.div
                    key={key}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    data-testid="cluster-picker-card"
                  >
                    <button
                      type="button"
                      onClick={() => { void handlePick(c); }}
                      disabled={pendingKey !== null}
                      className={cn(
                        'w-full text-left flex items-center gap-4 px-4 py-4 rounded-2xl border',
                        'transition-all duration-150',
                        isPending
                          ? 'border-primary/40 bg-primary/5'
                          : 'border-border/50 bg-card hover:border-primary/30 hover:bg-muted/30 hover:shadow-[var(--shadow-1)]',
                        pendingKey !== null && !isPending && 'opacity-50 cursor-not-allowed',
                      )}
                      aria-label={`Open cluster ${c.identity.name}`}
                    >
                      {/* Provider logo */}
                      <div className="relative shrink-0">
                        <div className="h-11 w-11 rounded-xl bg-muted/50 border border-border/40 flex items-center justify-center overflow-hidden">
                          {logo ? (
                            <img src={logo} alt={label} className="h-7 w-7 object-contain" />
                          ) : (
                            <span className="text-base font-bold text-muted-foreground">
                              {c.identity.name.slice(0, 1).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <span
                          className={cn(
                            'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background',
                            reachabilityDotClass(c.reachability),
                          )}
                          role="img"
                          aria-label={reachabilityTitle(c.reachability)}
                          title={reachabilityTitle(c.reachability)}
                        />
                      </div>

                      {/* Cluster info */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-foreground truncate max-w-[280px]">
                            {c.identity.name}
                          </span>
                          {c.isConnected && (
                            <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-[10px] px-1.5">
                              Active
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs font-mono text-muted-foreground truncate mt-0.5">
                          {c.identity.serverUrl}
                        </div>
                        {c.provider && (
                          <div className="text-[11px] text-muted-foreground mt-1">{label}</div>
                        )}
                      </div>

                      {/* Right side */}
                      <div className="shrink-0 flex items-center gap-2">
                        <Badge variant="outline" className="font-normal text-[10px] px-1.5">
                          {sourceBadgeLabel(c.source)}
                        </Badge>
                        {isPending && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                      </div>
                    </button>
                  </motion.div>
                );
              })
            )}
          </div>
        </div>

        {/* Right pane — add cluster */}
        <div className="w-full md:w-[380px] shrink-0 bg-muted/20">
          <AddClusterPane
            backendBaseUrl={backendBaseUrl}
            onAdded={() => { void refreshSnapshot(); }}
            onCancel={() => navigate(-1)}
            showCancel={hasActiveCluster}
          />
        </div>
      </div>
    </div>
  );
}

export default ClusterPickerPage;
