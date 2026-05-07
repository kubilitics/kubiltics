/**
 * AddClusterDialog — adds a cluster from a kubeconfig file not already
 * on the system. Upload a file or paste raw YAML. The picker page already
 * shows all auto-detected contexts; this dialog is only for NEW ones.
 */
import { useCallback, useState, type DragEvent } from 'react';
import {
  Upload,
  ClipboardPaste,
  Loader2,
  Check,
  Server,
  FileCode2,
  CheckCircle2,
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
import { cn } from '@/lib/utils';
import { addClusterWithUpload } from '@/services/api/clusters';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { parseKubeconfigContexts, bytesToBase64 } from '@/lib/kubeconfigUtils';
import { toast } from '@/components/ui/sonner';

export interface AddClusterDialogProps {
  open: boolean;
  onClose: () => void;
  onAdded?: (contextName: string) => void;
}

const PRIMARY_CTA = cn(
  'gap-2 h-11 px-5 rounded-xl',
  'bg-primary hover:bg-primary/90 text-primary-foreground',
  'shadow-[var(--shadow-2)] hover:shadow-[var(--shadow-3)]',
  'transition-all duration-200 disabled:shadow-none',
);

export function AddClusterDialog({ open, onClose, onAdded }: AddClusterDialogProps) {
  const backendBaseUrl = useBackendConfigStore((s) => getEffectiveBackendBaseUrl(s.backendBaseUrl));
  const [tab, setTab] = useState<'upload' | 'paste'>('upload');
  const [isBusy, setIsBusy] = useState(false);
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
    setIsDragging(false);
    setTab('upload');
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

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
        <div className="h-1 w-full bg-gradient-to-r from-primary via-primary/80 to-[hsl(263,70%,60%)]" />

        <div className="p-6 sm:p-7">
          <DialogHeader>
            <div className="flex items-start gap-4">
              <div className="h-11 w-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <Server className="h-5 w-5" />
              </div>
              <div className="flex flex-col gap-1 text-left">
                <DialogTitle className="text-xl font-semibold tracking-tight">
                  Add a cluster
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  Upload or paste a kubeconfig to register a new cluster context.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="mt-6">
            {contexts ? (
              /* Multi-context picker */
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
              <Tabs value={tab} onValueChange={(v) => setTab(v as 'upload' | 'paste')}>
                <TabsList className="grid grid-cols-2 h-11 p-1 rounded-xl bg-muted/60">
                  <TabsTrigger value="upload" className="gap-2 rounded-lg data-[state=active]:shadow-[var(--shadow-1)]">
                    <Upload className="h-4 w-4" />
                    Upload file
                  </TabsTrigger>
                  <TabsTrigger value="paste" className="gap-2 rounded-lg data-[state=active]:shadow-[var(--shadow-1)]">
                    <ClipboardPaste className="h-4 w-4" />
                    Paste YAML
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="upload" className="mt-5">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => document.getElementById('add-cluster-file-input')?.click()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') document.getElementById('add-cluster-file-input')?.click();
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
                      <p className="text-sm font-semibold text-foreground">Drop your kubeconfig here</p>
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
