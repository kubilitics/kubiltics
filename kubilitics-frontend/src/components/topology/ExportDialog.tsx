/**
 * ExportDialog — Pre-export configuration dialog for topology exports
 *
 * Provides configurable options for title, description, legend, timestamp,
 * format (PNG/SVG), and resolution (1x/2x/3x). Auto-populates cluster name,
 * namespace filter, and generation timestamp. Includes a live preview thumbnail.
 *
 * Dark mode support via Tailwind CSS dark: variants.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { Download, FileImage, FileCode2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  exportTopologyAsPNG,
  exportTopologyAsSVG,
  type TopologyExportOptions,
  type ExportFormat,
  type ExportResolution,
} from '@/lib/topologyExport';
import { downloadFile } from '@/topology-engine';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ExportDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Callback to close the dialog. */
  onOpenChange: (open: boolean) => void;
  /** Auto-populated cluster name for metadata. */
  clusterName?: string;
  /** Active namespace filter for metadata. */
  namespaceFilter?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ExportDialog({
  open,
  onOpenChange,
  clusterName,
  namespaceFilter,
}: ExportDialogProps) {
  // ── Form state ──
  const [title, setTitle] = useState('Cluster Topology');
  const [description, setDescription] = useState('');
  const [includeLegend, setIncludeLegend] = useState(true);
  const [includeTimestamp, setIncludeTimestamp] = useState(true);
  const [format, setFormat] = useState<ExportFormat>('png');
  const [resolution, setResolution] = useState<ExportResolution>('2x');
  const [isExporting, setIsExporting] = useState(false);

  // ── Preview thumbnail ──
  const previewRef = useRef<HTMLCanvasElement>(null);
  const [previewReady, setPreviewReady] = useState(false);

  // Generate a simple preview thumbnail when the dialog opens
  useEffect(() => {
    if (!open) {
      setPreviewReady(false);
      return;
    }

    const generatePreview = async () => {
      try {
        const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null;
        if (!viewport || !previewRef.current) return;

        const { toPng } = await import('html-to-image');

        const dataUrl = await toPng(viewport, {
          backgroundColor: '#ffffff',
          pixelRatio: 0.3, // Low-res for fast preview
          quality: 0.6,
          filter: (node: HTMLElement) => {
            const cn = node.className?.toString() ?? '';
            return !cn.includes('react-flow__minimap') &&
                   !cn.includes('react-flow__controls') &&
                   !cn.includes('react-flow__background');
          },
        });

        const canvas = previewRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const img = new Image();
        img.onload = () => {
          const ratio = Math.min(canvas.width / img.width, canvas.height / img.height);
          const w = img.width * ratio;
          const h = img.height * ratio;
          const x = (canvas.width - w) / 2;
          const y = (canvas.height - h) / 2;

          ctx.fillStyle = '#f1f5f9';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, x, y, w, h);
          setPreviewReady(true);
        };
        img.src = dataUrl;
      } catch {
        // Preview is non-critical — silently fail
      }
    };

    // Small delay so the dialog renders first
    const t = setTimeout(generatePreview, 200);
    return () => clearTimeout(t);
  }, [open]);

  // ── Export handler ──
  const handleExport = useCallback(async () => {
    setIsExporting(true);
    const exportToast = toast.loading(`Exporting ${format.toUpperCase()}...`);

    try {
      const now = new Date();
      const options: TopologyExportOptions = {
        title,
        description: description || undefined,
        includeLegend,
        includeTimestamp,
        format,
        resolution,
        clusterName,
        namespaceFilter,
        generatedAt: now.toISOString(),
      };

      let blob: Blob | null = null;

      if (format === 'png') {
        blob = await exportTopologyAsPNG(options);
      } else {
        blob = await exportTopologyAsSVG(options);
      }

      if (!blob) {
        throw new Error('Export produced no data');
      }

      // Build filename
      const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
      const slug = title.replace(/[^a-zA-Z0-9]+/g, '-').replace(/(^-|-$)/g, '').toLowerCase();
      const filename = `${slug || 'topology'}-${ts}.${format}`;

      await downloadFile(blob, filename);
      toast.success(`${format.toUpperCase()} exported — check your downloads`, { id: exportToast });
      onOpenChange(false);
    } catch (err) {
      toast.error(
        `Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        { id: exportToast }
      );
    } finally {
      setIsExporting(false);
    }
  }, [title, description, includeLegend, includeTimestamp, format, resolution, clusterName, namespaceFilter, onOpenChange]);

  // ── Auto-populated metadata display ──
  const generatedAt = new Date().toLocaleString();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            Export Topology
          </DialogTitle>
          <DialogDescription>
            Configure your export settings before downloading.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Preview thumbnail */}
          <div className="relative rounded-lg overflow-hidden border border-border bg-slate-50 dark:bg-slate-900">
            <canvas
              ref={previewRef}
              width={480}
              height={160}
              className="w-full h-40 object-contain"
            />
            {!previewReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-50/80 dark:bg-slate-900/80">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Title */}
          <div className="grid gap-1.5">
            <Label htmlFor="export-title">Title</Label>
            <Input
              id="export-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Cluster Topology"
              className="h-9"
            />
          </div>

          {/* Description */}
          <div className="grid gap-1.5">
            <Label htmlFor="export-desc">Description (optional)</Label>
            <textarea
              id="export-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add context or notes..."
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
          </div>

          {/* Toggle options */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Checkbox
                id="export-legend"
                checked={includeLegend}
                onCheckedChange={(checked) => setIncludeLegend(checked === true)}
              />
              <Label htmlFor="export-legend" className="text-sm font-normal cursor-pointer">
                Include legend
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="export-timestamp"
                checked={includeTimestamp}
                onCheckedChange={(checked) => setIncludeTimestamp(checked === true)}
              />
              <Label htmlFor="export-timestamp" className="text-sm font-normal cursor-pointer">
                Include timestamp
              </Label>
            </div>
          </div>

          {/* Format + Resolution */}
          <div className="grid grid-cols-2 gap-4">
            {/* Format */}
            <div className="grid gap-1.5">
              <Label>Format</Label>
              <RadioGroup
                value={format}
                onValueChange={(v) => setFormat(v as ExportFormat)}
                className="flex gap-3"
              >
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="png" id="fmt-png" />
                  <Label htmlFor="fmt-png" className="flex items-center gap-1 text-sm font-normal cursor-pointer">
                    <FileImage className="h-3.5 w-3.5 text-muted-foreground" />
                    PNG
                  </Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="svg" id="fmt-svg" />
                  <Label htmlFor="fmt-svg" className="flex items-center gap-1 text-sm font-normal cursor-pointer">
                    <FileCode2 className="h-3.5 w-3.5 text-muted-foreground" />
                    SVG
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Resolution */}
            <div className="grid gap-1.5">
              <Label>Resolution</Label>
              <RadioGroup
                value={resolution}
                onValueChange={(v) => setResolution(v as ExportResolution)}
                className="flex gap-3"
              >
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="1x" id="res-1x" />
                  <Label htmlFor="res-1x" className="text-sm font-normal cursor-pointer">1x</Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="2x" id="res-2x" />
                  <Label htmlFor="res-2x" className="text-sm font-normal cursor-pointer">2x</Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="3x" id="res-3x" />
                  <Label htmlFor="res-3x" className="text-sm font-normal cursor-pointer">3x</Label>
                </div>
              </RadioGroup>
            </div>
          </div>

          {/* Auto-populated metadata (read-only display) */}
          <div className="rounded-lg border border-border bg-muted/50 px-3 py-2.5 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Metadata (auto-populated)
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
              {clusterName && (
                <span>Cluster: <span className="font-medium text-foreground">{clusterName}</span></span>
              )}
              {namespaceFilter && namespaceFilter !== 'all' && (
                <span>Namespace: <span className="font-medium text-foreground">{namespaceFilter}</span></span>
              )}
              <span>Generated: <span className="font-medium text-foreground">{generatedAt}</span></span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isExporting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={isExporting || !title.trim()}
            className="gap-1.5"
          >
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Export {format.toUpperCase()}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
