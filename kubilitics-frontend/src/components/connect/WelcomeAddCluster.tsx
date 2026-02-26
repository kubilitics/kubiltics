/**
 * Welcome Add Cluster — Lens-style first-run experience when no clusters are detected.
 * Short, sweet, insightful. Two primary actions: clipboard paste + file upload.
 */
import { useState, useCallback } from 'react';
import yaml from 'js-yaml';
import { motion } from 'framer-motion';
import {
  ClipboardPaste,
  FolderOpen,
  Loader2,
  ExternalLink,
  ArrowRight,
  Server,
  Zap,
  Check,
  Monitor,
} from 'lucide-react';
import { KubiliticsLogo } from '@/components/icons/KubernetesIcons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { addClusterWithUpload } from '@/services/backendApiClient';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface WelcomeAddClusterProps {
  backendBaseUrl: string;
  onClusterAdded: () => void;
  onDemoMode: () => void;
  onFileSelect: (file: File) => void;
  isUploading: boolean;
}

/**
 * Extract the best context name from a kubeconfig YAML string.
 * Reads only `current-context` and `contexts[].name` — never cluster or user names.
 */
function extractContextFromKubeconfig(text: string): string {
  try {
    const doc = yaml.load(text) as Record<string, unknown> | null;
    if (!doc || typeof doc !== 'object') return '';
    // Prefer current-context if set
    if (typeof doc['current-context'] === 'string' && doc['current-context']) {
      return doc['current-context'];
    }
    // Fall back to first context name
    const contextsRaw = doc['contexts'];
    if (Array.isArray(contextsRaw) && contextsRaw.length > 0) {
      const first = contextsRaw[0] as Record<string, unknown>;
      if (typeof first['name'] === 'string' && first['name']) return first['name'];
    }
    return '';
  } catch {
    return '';
  }
}

export function WelcomeAddCluster({
  backendBaseUrl,
  onClusterAdded,
  onDemoMode,
  onFileSelect,
  isUploading,
}: WelcomeAddClusterProps) {
  const queryClient = useQueryClient();
  const [clipboardOpen, setClipboardOpen] = useState(false);
  const [pasteContent, setPasteContent] = useState('');
  const [isPasting, setIsPasting] = useState(false);

  const handlePasteSubmit = useCallback(async () => {
    const trimmed = pasteContent.trim();
    if (!trimmed) {
      toast.error('Paste your kubeconfig content first');
      return;
    }
    setIsPasting(true);
    try {
      // Encode as UTF-8 bytes → base64 (standard, with padding) — compatible with Go's base64.StdEncoding
      const bytes = new TextEncoder().encode(trimmed);
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      const base64 = btoa(binary);
      const contextName = extractContextFromKubeconfig(trimmed);
      await addClusterWithUpload(backendBaseUrl, base64, contextName);
      queryClient.invalidateQueries({ queryKey: ['backend', 'clusters'] });
      toast.success('Cluster added', { description: `Context: ${contextName}` });
      setClipboardOpen(false);
      setPasteContent('');
      onClusterAdded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add cluster');
    } finally {
      setIsPasting(false);
    }
  }, [pasteContent, backendBaseUrl, queryClient, onClusterAdded]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) onFileSelect(file);
    },
    [onFileSelect]
  );

  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  return (
    <div className="min-h-screen bg-background flex">
      <div className="flex-1 flex items-center justify-center p-8">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-xl"
        >
          {/* Branding */}
          <div className="text-center mb-12">
            <div className="flex items-center justify-center gap-3 mb-6">
              <KubiliticsLogo size={48} className="text-primary" />
              <span className="text-3xl font-bold tracking-tight">Kubilitics</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mb-2">
              Add your first cluster
            </h1>
            <p className="text-muted-foreground">
              Choose how you'd like to add your kubeconfig
            </p>
          </div>

          {/* Primary actions — two cards */}
          <div className="grid gap-4 sm:grid-cols-2 mb-10">
            <motion.button
              type="button"
              onClick={() => setClipboardOpen(true)}
              disabled={isUploading}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="flex flex-col items-center gap-4 p-8 rounded-2xl border-2 border-border bg-card hover:border-primary/50 hover:bg-primary/5 transition-all duration-200 text-left group"
            >
              <div className="p-4 rounded-2xl bg-primary/10 group-hover:bg-primary/20 transition-colors">
                <ClipboardPaste className="h-8 w-8 text-primary" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-lg">From clipboard</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Paste kubeconfig YAML
                </p>
              </div>
            </motion.button>

            <motion.label
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="flex flex-col items-center gap-4 p-8 rounded-2xl border-2 border-dashed border-border bg-muted/30 hover:border-primary/50 hover:bg-primary/5 transition-all duration-200 cursor-pointer"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
            >
              <input
                type="file"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onFileSelect(e.target.files[0])}
              />
              {isUploading ? (
                <Loader2 className="h-8 w-8 text-primary animate-spin" />
              ) : (
                <div className="p-4 rounded-2xl bg-primary/10 group-hover:bg-primary/20 transition-colors">
                  <KubiliticsLogo className="h-8 w-8 text-primary" />
                </div>
              )}
              <div className="text-center">
                <p className="font-semibold text-lg">From filesystem</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Upload or drag & drop
                </p>
              </div>
            </motion.label>
          </div>

          {/* Help link */}
          <p className="text-center text-sm text-muted-foreground mb-8">
            <a
              href="https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-primary hover:underline"
            >
              How to add clusters in Kubilitics
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </p>

          {/* Demo mode */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">or</span>
            </div>
          </div>
          <Button
            variant="ghost"
            className="mt-6 w-full text-muted-foreground hover:text-foreground"
            onClick={onDemoMode}
          >
            Try Demo Mode
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </motion.div>
      </div>

      {/* Right panel — value props */}
      <div className="hidden lg:flex w-[380px] bg-gradient-to-br from-primary to-primary/80 items-center justify-center p-12">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          className="text-center text-primary-foreground"
        >
          <KubiliticsLogo size={56} className="mx-auto mb-6 opacity-90" />
          <h2 className="text-xl font-bold mb-3">The Kubernetes Operating System</h2>
          <p className="text-sm opacity-80 mb-8">
            Make Kubernetes understandable, explorable, and calm.
          </p>
          <div className="space-y-4 text-left">
            {[
              { icon: Monitor, text: 'Desktop-first, works offline' },
              { icon: Server, text: 'Or deploy in-cluster via Helm' },
              { icon: Zap, text: '50+ resource types supported' },
              { icon: Check, text: '100% open source (Apache 2.0)' },
            ].map((point, i) => (
              <motion.div
                key={point.text}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.1 }}
                className="flex items-center gap-3"
              >
                <div className="p-1.5 rounded-lg bg-white/20">
                  <point.icon className="h-4 w-4" />
                </div>
                <span className="text-sm opacity-90">{point.text}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Clipboard paste dialog */}
      <Dialog open={clipboardOpen} onOpenChange={setClipboardOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardPaste className="h-5 w-5" />
              Add Kubeconfig from clipboard
            </DialogTitle>
            <DialogDescription>
              Paste your kubeconfig YAML below. The cluster will be registered and you can connect immediately.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder={`apiVersion: v1\nkind: Config\nclusters:\n  - cluster:\n      server: https://...\n    name: my-cluster\ncontexts:\n  - context:\n      cluster: my-cluster\n      user: admin\n    name: my-cluster\ncurrent-context: my-cluster`}
            value={pasteContent}
            onChange={(e) => setPasteContent(e.target.value)}
            className="font-mono text-xs min-h-[220px] resize-y"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            Run <code className="bg-muted px-1 rounded text-xs">kubectl config view --raw</code> to get your kubeconfig
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClipboardOpen(false)}>
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
