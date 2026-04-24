/**
 * AddClusterDialog — reusable modal for adding a cluster via kubeconfig.
 *
 * Extracted from pages/ClusterConnect.tsx so the "add cluster" flow can be
 * invoked from anywhere (picker page, welcome page, settings) without
 * routing to /connect. The /connect page itself is scheduled for deletion
 * once the remaining clusterStore callers migrate to clusterPresenceStore.
 *
 * Responsibilities (deliberately minimal):
 *  - Tabs for Upload vs Paste.
 *  - File picker / drag-drop for kubeconfig upload.
 *  - Textarea for kubeconfig paste.
 *  - Parses contexts; single-context path submits straight away, multi-context
 *    shows an inline context picker.
 *  - Calls backend addClusterWithUpload; caller decides how to refresh state
 *    (via onAdded callback — typically refetches presence snapshot).
 */
import { useCallback, useState, type DragEvent } from 'react';
import { Upload, ClipboardPaste, Loader2, Check } from 'lucide-react';
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
import { addClusterWithUpload } from '@/services/backendApiClient';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { parseKubeconfigContexts, bytesToBase64 } from '@/lib/kubeconfigUtils';
import { toast } from '@/components/ui/sonner';

export interface AddClusterDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful add; typically used to refetch the presence snapshot. */
  onAdded?: (contextName: string) => void;
}

export function AddClusterDialog({ open, onClose, onAdded }: AddClusterDialogProps) {
  const backendBaseUrl = useBackendConfigStore((s) => getEffectiveBackendBaseUrl(s.backendBaseUrl));
  const [tab, setTab] = useState<'upload' | 'paste'>('upload');
  const [isBusy, setIsBusy] = useState(false);
  const [pasteContent, setPasteContent] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  // Multi-context picker state (when kubeconfig has >1 context)
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
      // Multi-context: let user pick.
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
    if (!trimmed) {
      toast.error('Paste your kubeconfig content first');
      return;
    }
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a cluster</DialogTitle>
          <DialogDescription>
            Upload or paste a kubeconfig file. The context you select becomes
            a new cluster in Kubilitics.
          </DialogDescription>
        </DialogHeader>

        {contexts ? (
          // Multi-context picker pane
          <div className="flex flex-col gap-3" data-testid="add-cluster-context-picker">
            <p className="text-sm text-muted-foreground">
              This kubeconfig has multiple contexts. Pick the one to register:
            </p>
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
              {contexts.map((ctx) => (
                <button
                  key={ctx}
                  type="button"
                  onClick={() => setSelectedContext(ctx)}
                  className={cn(
                    'flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm',
                    selectedContext === ctx
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted',
                  )}
                >
                  <span>{ctx}</span>
                  {selectedContext === ctx && <Check className="h-4 w-4 text-primary" />}
                </button>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose} disabled={isBusy}>Cancel</Button>
              <Button
                onClick={() => {
                  if (selectedContext && pendingBase64) {
                    void submit(pendingBase64, selectedContext);
                  }
                }}
                disabled={isBusy || !selectedContext}
              >
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Add cluster
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'upload' | 'paste')}>
            <TabsList className="grid grid-cols-2">
              <TabsTrigger value="upload" className="gap-2">
                <Upload className="h-4 w-4" />
                Upload
              </TabsTrigger>
              <TabsTrigger value="paste" className="gap-2">
                <ClipboardPaste className="h-4 w-4" />
                Paste
              </TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="mt-4">
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
                  'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 cursor-pointer transition',
                  isDragging ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50',
                )}
                data-testid="add-cluster-dropzone"
              >
                <Upload className="h-8 w-8 text-muted-foreground" />
                <div className="text-center">
                  <p className="text-sm font-medium">Drop kubeconfig here or click to browse</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    YAML file, typically at ~/.kube/config
                  </p>
                </div>
                <input
                  id="add-cluster-file-input"
                  type="file"
                  accept=".yaml,.yml,.config,application/x-yaml,text/yaml,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                  }}
                />
              </div>
            </TabsContent>

            <TabsContent value="paste" className="mt-4">
              <Textarea
                value={pasteContent}
                onChange={(e) => setPasteContent(e.target.value)}
                placeholder="Paste your kubeconfig YAML here…"
                className="min-h-[200px] font-mono text-xs"
                data-testid="add-cluster-paste-area"
              />
              <DialogFooter className="mt-4">
                <Button variant="outline" onClick={handleClose} disabled={isBusy}>Cancel</Button>
                <Button
                  onClick={handlePasteSubmit}
                  disabled={isBusy || !pasteContent.trim()}
                  data-testid="add-cluster-paste-submit"
                >
                  {isBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Add cluster
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
