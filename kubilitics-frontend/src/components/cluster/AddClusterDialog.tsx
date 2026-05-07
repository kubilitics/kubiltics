/**
 * AddClusterDialog — Headlamp-style cluster add flow.
 *
 * Primary path: show all kubeconfig-discovered contexts that aren't yet
 * registered — one click connects them. Secondary path: upload a file or
 * paste a kubeconfig when no contexts were auto-detected.
 *
 * Tab order:
 *  1. "Detected"  — only shown when unregistered discovered clusters exist
 *  2. "Upload"    — drag-drop or browse for a kubeconfig file
 *  3. "Paste"     — paste raw YAML
 */
import { useCallback, useMemo, useState, type DragEvent } from 'react';
import {
  Upload,
  ClipboardPaste,
  Loader2,
  Check,
  Server,
  FileCode2,
  CheckCircle2,
  Plug,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { addCluster, addClusterWithUpload } from '@/services/api/clusters';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterPresenceStore } from '@/stores/clusterPresenceStore';
import { parseKubeconfigContexts, bytesToBase64 } from '@/lib/kubeconfigUtils';
import { toast } from '@/components/ui/sonner';
import { logicalIdentityKey } from '@/types/resilient';
import type { DiscoveredCluster } from '@/types/resilient';
import { getProviderLogo, getProviderLabel } from '@/topology/icons/providerLogoMap';

export interface AddClusterDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful add; typically used to refetch the presence snapshot. */
  onAdded?: (contextName: string) => void;
}

// Normalise provider string → providerLogoMap key (mirrors ClusterPickerPage).
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
  if (n.endsWith('.aks') || n.includes('aks') || n.includes('azure')) return 'aks';
  if (n.startsWith('gke_') || n.includes('gke') || n.includes('gcp')) return 'gke';
  if (n.includes('openshift') || n.includes('-ocp')) return 'openshift';
  if (n.includes('rancher') || n.includes('rke')) return 'rancher';
  if (n.includes('k3s') || n.includes('k3d')) return 'k3s';
  return undefined;
}

const PRIMARY_CTA = cn(
  'gap-2 h-11 px-5 rounded-xl',
  'bg-primary hover:bg-primary/90 text-primary-foreground',
  'shadow-[var(--shadow-2)] hover:shadow-[var(--shadow-3)]',
  'transition-all duration-200 disabled:shadow-none',
);

export function AddClusterDialog({ open, onClose, onAdded }: AddClusterDialogProps) {
  const backendBaseUrl = useBackendConfigStore((s) => getEffectiveBackendBaseUrl(s.backendBaseUrl));

  // Presence data — we show unregistered discovered clusters as primary option.
  const discovered = useClusterPresenceStore((s) => s.discovered);
  const registered = useClusterPresenceStore((s) => s.registered);
  const applySnapshot = useClusterPresenceStore((s) => s.applySnapshot);
  const setActiveByLogicalIdentity = useClusterPresenceStore((s) => s.setActiveByLogicalIdentity);

  // Clusters that exist in kubeconfig but haven't been registered yet.
  const unregistered = useMemo<DiscoveredCluster[]>(() => {
    const regKeys = new Set(registered.map((r) => logicalIdentityKey(r.identity)));
    return discovered.filter((d) => !regKeys.has(logicalIdentityKey(d.identity)));
  }, [discovered, registered]);

  const hasDetected = unregistered.length > 0;

  const [tab, setTab] = useState<'detected' | 'upload' | 'paste'>(
    hasDetected ? 'detected' : 'upload',
  );
  const [isBusy, setIsBusy] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pasteContent, setPasteContent] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const [contexts, setContexts] = useState<string[] | null>(null);
  const [selectedContext, setSelectedContext] = useState<string | null>(null);
  const [pendingBase64, setPendingBase64] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPasteContent('');
    setContexts(null);
    setSelectedContext(null);
    setPendingBase64(null);
    setIsBusy(false);
    setBusyKey(null);
    setIsDragging(false);
    setTab(hasDetected ? 'detected' : 'upload');
  }, [hasDetected]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  // Register a kubeconfig-path-sourced cluster (the Headlamp one-click path).
  const handleConnectDetected = useCallback(async (cluster: DiscoveredCluster) => {
    const key = logicalIdentityKey(cluster.identity);
    if (busyKey === key) return;
    setBusyKey(key);
    try {
      const kubeconfigPath = cluster.kubeconfig_path ?? '~/.kube/config';
      const contextName = cluster.context_name ?? cluster.identity.name;
      const added = await addCluster(backendBaseUrl, kubeconfigPath, contextName);
      // Inject directly into presence store so the picker refreshes immediately.
      const store = useClusterPresenceStore.getState();
      const identity = {
        name: added.name ?? cluster.identity.name,
        serverUrl: (added as unknown as { server_url?: string }).server_url ?? cluster.identity.serverUrl,
      };
      const registeredEntry = {
        identity,
        source: 'kubeconfig' as const,
        context_name: added.context ?? contextName,
        kubeconfig_path: added.kubeconfig_path ?? kubeconfigPath,
        registered_at: added.created_at ?? new Date().toISOString(),
        reachable: added.status === 'connected',
        session_id: added.id,
        provider: added.provider,
      };
      const connectedEntry = {
        ...registeredEntry,
        connected_at: added.last_connected ?? new Date().toISOString(),
      };
      store.applySnapshot({
        discovered: store.discovered,
        registered: [
          ...store.registered.filter((r) => r.identity.name !== identity.name),
          registeredEntry,
        ],
        connected: [
          ...store.connected.filter((c) => c.identity.name !== identity.name),
          connectedEntry,
        ],
        last_used: null,
      });
      setActiveByLogicalIdentity(identity);
      toast.success('Cluster connected', { description: identity.name });
      onAdded?.(contextName);
      reset();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Couldn't connect`, { description: msg });
    } finally {
      setBusyKey(null);
    }
  }, [busyKey, backendBaseUrl, applySnapshot, setActiveByLogicalIdentity, onAdded, onClose, reset]);

  // Upload path.
  const submit = useCallback(async (base64: string, contextName: string) => {
    setIsBusy(true);
    try {
      await addClusterWithUpload(backendBaseUrl, base64, contextName);
      toast.success('Cluster added', { description: `Context: ${contextName}` });
      onAdded?.(contextName);
      reset();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Failed to add cluster', { description: msg });
    } finally {
      setIsBusy(false);
    }
  }, [backendBaseUrl, onAdded, onClose, reset]);

  const handleFile = useCallback(async (file: File) => {
    setIsBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const base64 = bytesToBase64(bytes);
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      const parsed = parseKubeconfigContexts(text);
      if (parsed.contexts.length <= 1) {
        const contextName = parsed.contexts[0] || parsed.currentContext || '';
        await submit(base64, contextName);
        return;
      }
      setContexts(parsed.contexts);
      setSelectedContext(parsed.currentContext || parsed.contexts[0]);
      setPendingBase64(base64);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Failed to read kubeconfig', { description: msg });
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
        const contextName = parsed.contexts[0] || parsed.currentContext || 'default';
        await submit(base64, contextName);
        return;
      }
      setContexts(parsed.contexts);
      setSelectedContext(parsed.currentContext || parsed.contexts[0]);
      setPendingBase64(base64);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Failed to parse kubeconfig', { description: msg });
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
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-2xl border-none p-0 gap-0 overflow-hidden">
        {/* Accent rail */}
        <div className="h-1 w-full bg-gradient-to-r from-primary via-primary/80 to-[hsl(263,70%,60%)]" />

        <div className="p-6 sm:p-7">
          <DialogHeader>
            <div className="flex items-start gap-4">
              <div className="h-11 w-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <Server className="h-5 w-5" />
              </div>
              <div className="flex flex-col gap-1 text-left">
                <DialogTitle className="text-xl font-semibold tracking-tight">
                  {hasDetected ? 'Connect a cluster' : 'Add a cluster'}
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  {hasDetected
                    ? 'Kubilitics detected these contexts in your kubeconfig. Click one to connect instantly.'
                    : 'Upload or paste a kubeconfig. The context you pick becomes a new cluster in Kubilitics.'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="mt-6">
            {/* Context picker — shown after parsing a multi-context kubeconfig */}
            {contexts ? (
              <div className="flex flex-col gap-4" data-testid="add-cluster-context-picker">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>Multiple contexts detected. Select the one to register:</span>
                </div>
                <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
                  {contexts.map((ctx) => {
                    const active = selectedContext === ctx;
                    return (
                      <button
                        key={ctx}
                        type="button"
                        onClick={() => setSelectedContext(ctx)}
                        className={cn(
                          'group flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-all',
                          active
                            ? 'border-primary/60 bg-primary/5 shadow-[var(--shadow-1)]'
                            : 'border-border/60 hover:border-border hover:bg-muted/40',
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={cn(
                            'h-8 w-8 shrink-0 rounded-lg flex items-center justify-center',
                            active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                          )}>
                            <Server className="h-4 w-4" />
                          </div>
                          <span className="text-sm font-medium text-foreground truncate">{ctx}</span>
                        </div>
                        <span className={cn(
                          'shrink-0 h-6 w-6 rounded-full flex items-center justify-center transition-colors',
                          active ? 'bg-primary text-primary-foreground' : 'bg-muted/60 text-transparent',
                        )}>
                          <Check className="h-3.5 w-3.5" />
                        </span>
                      </button>
                    );
                  })}
                </div>
                <DialogFooter className="gap-2 pt-2">
                  <Button variant="ghost" onClick={handleClose} disabled={isBusy} className="h-11 px-4 rounded-xl">
                    Cancel
                  </Button>
                  <Button
                    onClick={() => { if (selectedContext && pendingBase64) void submit(pendingBase64, selectedContext); }}
                    disabled={isBusy || !selectedContext}
                    className={PRIMARY_CTA}
                  >
                    {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Add cluster
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              <Tabs
                value={tab}
                onValueChange={(v) => setTab(v as 'detected' | 'upload' | 'paste')}
              >
                <TabsList
                  className={cn(
                    'grid h-11 p-1 rounded-xl bg-muted/60',
                    hasDetected ? 'grid-cols-3' : 'grid-cols-2',
                  )}
                >
                  {hasDetected && (
                    <TabsTrigger
                      value="detected"
                      className="gap-2 rounded-lg data-[state=active]:shadow-[var(--shadow-1)]"
                    >
                      <Plug className="h-4 w-4" />
                      Detected
                      <span className="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
                        {unregistered.length}
                      </span>
                    </TabsTrigger>
                  )}
                  <TabsTrigger value="upload" className="gap-2 rounded-lg data-[state=active]:shadow-[var(--shadow-1)]">
                    <Upload className="h-4 w-4" />
                    Upload
                  </TabsTrigger>
                  <TabsTrigger value="paste" className="gap-2 rounded-lg data-[state=active]:shadow-[var(--shadow-1)]">
                    <ClipboardPaste className="h-4 w-4" />
                    Paste
                  </TabsTrigger>
                </TabsList>

                {/* ── Detected tab ─────────────────────────────────────── */}
                {hasDetected && (
                  <TabsContent value="detected" className="mt-4">
                    <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto pr-1">
                      {unregistered.map((cluster) => {
                        const key = logicalIdentityKey(cluster.identity);
                        const provider = normalizeProvider(cluster.provider) ?? inferProviderFromName(cluster.identity.name);
                        const logo = getProviderLogo(provider);
                        const label = getProviderLabel(provider);
                        const isPending = busyKey === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            disabled={busyKey !== null}
                            onClick={() => void handleConnectDetected(cluster)}
                            className={cn(
                              'group flex items-center gap-4 rounded-xl border px-4 py-3.5 text-left',
                              'transition-all duration-150',
                              isPending
                                ? 'border-primary/60 bg-primary/5 opacity-80'
                                : 'border-border/60 hover:border-primary/40 hover:bg-muted/40 hover:shadow-[var(--shadow-1)]',
                              busyKey !== null && !isPending && 'opacity-50 cursor-not-allowed',
                            )}
                          >
                            {/* Provider logo / initial */}
                            <div className="h-10 w-10 shrink-0 rounded-xl bg-muted/50 border border-border/40 flex items-center justify-center overflow-hidden">
                              {logo ? (
                                <img src={logo} alt={label} className="h-6 w-6 object-contain" />
                              ) : (
                                <span className="text-base font-semibold text-muted-foreground">
                                  {cluster.identity.name.slice(0, 1).toUpperCase()}
                                </span>
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-semibold text-foreground truncate">
                                  {cluster.identity.name}
                                </span>
                                {provider && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal shrink-0">
                                    {label}
                                  </Badge>
                                )}
                              </div>
                              <div className="text-xs font-mono text-muted-foreground truncate mt-0.5">
                                {cluster.identity.serverUrl}
                              </div>
                            </div>

                            {/* CTA — spinner when pending, "Connect →" otherwise */}
                            <div className={cn(
                              'shrink-0 flex items-center gap-1.5 text-xs font-medium transition-colors',
                              isPending ? 'text-primary' : 'text-muted-foreground group-hover:text-primary',
                            )}>
                              {isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <Plug className="h-3.5 w-3.5" />
                                  Connect
                                </>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <DialogFooter className="gap-2 mt-5">
                      <Button variant="ghost" onClick={handleClose} disabled={busyKey !== null} className="h-11 px-4 rounded-xl">
                        Cancel
                      </Button>
                    </DialogFooter>
                  </TabsContent>
                )}

                {/* ── Upload tab ───────────────────────────────────────── */}
                <TabsContent value="upload" className="mt-5">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => document.getElementById('add-cluster-file-input')?.click()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        document.getElementById('add-cluster-file-input')?.click();
                      }
                    }}
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    className={cn(
                      'relative flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-8 py-10 cursor-pointer',
                      'transition-all duration-200',
                      isDragging
                        ? 'border-primary bg-primary/5 scale-[1.01]'
                        : 'border-border/60 hover:border-primary/40 hover:bg-muted/40',
                    )}
                    data-testid="add-cluster-dropzone"
                  >
                    <div className="h-14 w-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                      <Upload className="h-6 w-6" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-semibold text-foreground">
                        Drop your kubeconfig here
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        or <span className="text-primary font-medium">click to browse</span> · typically at{' '}
                        <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-muted/70 text-foreground/80">
                          ~/.kube/config
                        </span>
                      </p>
                    </div>
                    <input
                      id="add-cluster-file-input"
                      type="file"
                      accept=".yaml,.yml,.config,application/x-yaml,text/yaml,text/plain"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
                    />
                  </div>
                  <DialogFooter className="gap-2 mt-5">
                    <Button variant="ghost" onClick={handleClose} disabled={isBusy} className="h-11 px-4 rounded-xl">
                      Cancel
                    </Button>
                  </DialogFooter>
                </TabsContent>

                {/* ── Paste tab ────────────────────────────────────────── */}
                <TabsContent value="paste" className="mt-5">
                  <div className="relative rounded-2xl border border-border/60 bg-muted/30 focus-within:border-primary/40 focus-within:ring-4 focus-within:ring-primary/10 transition-all">
                    <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      <FileCode2 className="h-3.5 w-3.5" />
                      kubeconfig.yaml
                    </div>
                    <Textarea
                      value={pasteContent}
                      onChange={(e) => setPasteContent(e.target.value)}
                      placeholder={'apiVersion: v1\nkind: Config\nclusters:\n  - cluster:\n      server: https://…'}
                      className="min-h-[220px] font-mono text-xs border-0 bg-transparent rounded-none focus-visible:ring-0 focus-visible:ring-offset-0 resize-none"
                      data-testid="add-cluster-paste-area"
                    />
                  </div>
                  <DialogFooter className="gap-2 mt-5">
                    <Button variant="ghost" onClick={handleClose} disabled={isBusy} className="h-11 px-4 rounded-xl">
                      Cancel
                    </Button>
                    <Button
                      onClick={handlePasteSubmit}
                      disabled={isBusy || !pasteContent.trim()}
                      className={PRIMARY_CTA}
                      data-testid="add-cluster-paste-submit"
                    >
                      {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Add cluster
                    </Button>
                  </DialogFooter>
                </TabsContent>
              </Tabs>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
