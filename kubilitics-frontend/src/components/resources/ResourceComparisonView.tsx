import { useState, useMemo, useRef, useCallback, useEffect, lazy, Suspense } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
    X,
    GitCompare,
    FileText,
    Activity,
    ScrollText,
    Loader2,
    Plus,
    Minus,
    Equal,
    History,
    Upload,
    FileUp,
    Trash2,
    ArrowRight,
    FileCode2,
    ChevronRight,
    CheckCircle2,
    AlertCircle,
    Sparkles,
    ArrowRightLeft,
} from 'lucide-react';
import yaml from 'js-yaml';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
// NOTE: We use simple conditional rendering instead of Radix Tabs for the
// inner YAML/Metrics/Logs views to avoid Radix TabsContent layout issues
// (display: none / unmount behavior breaks scroll in embedded contexts).
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkline } from './PodSparkline';
import { getResource, getNodeMetrics, getPodLogsUrl, getMetricsSummary } from '@/services/backendApiClient';
import { resourceToYaml } from '@/hooks/useK8sResourceDetail';
import { parseRawLogs, type LogEntry } from '@/lib/logParser';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { computeDiff, YamlLineContent, getIntraLineDiff } from './YamlDiffUtils';
import { useK8sResourceList, type KubernetesResource, type ResourceType } from '@/hooks/useKubernetes';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { useThemeStore } from '@/stores/themeStore';

const LazyDiffEditor = lazy(() => import('@monaco-editor/react').then(m => ({ default: m.DiffEditor })));
const LazyMonacoEditor = lazy(() => import('@monaco-editor/react').then(m => ({ default: m.default })));

/* ─────────────────────────────────────────────────────────────────────────────
   Compare Mode Configuration
   ───────────────────────────────────────────────────────────────────────────── */
const COMPARE_MODES = {
  resources: {
    key: 'resources' as const,
    label: 'Resources',
    shortDesc: 'Side-by-side resource diff',
    icon: ArrowRightLeft,
    gradient: 'from-emerald-500 to-teal-500',
    activeBg: 'bg-emerald-50 dark:bg-emerald-950/40',
    activeText: 'text-emerald-700 dark:text-emerald-300',
    activeBorder: 'border-emerald-200 dark:border-emerald-800',
    accentColor: 'text-emerald-500',
  },
  lastApplied: {
    key: 'lastApplied' as const,
    label: 'Live vs Applied',
    shortDesc: 'Detect configuration drift',
    icon: History,
    gradient: 'from-blue-500 to-indigo-500',
    activeBg: 'bg-blue-50 dark:bg-blue-950/40',
    activeText: 'text-blue-700 dark:text-blue-300',
    activeBorder: 'border-blue-200 dark:border-blue-800',
    accentColor: 'text-blue-500',
  },
  customYaml: {
    key: 'customYaml' as const,
    label: 'Custom YAML',
    shortDesc: 'Compare against your YAML',
    icon: FileCode2,
    gradient: 'from-amber-500 to-orange-500',
    activeBg: 'bg-amber-50 dark:bg-amber-950/40',
    activeText: 'text-amber-700 dark:text-amber-300',
    activeBorder: 'border-amber-200 dark:border-amber-800',
    accentColor: 'text-amber-500',
  },
} as const;

type CompareMode = keyof typeof COMPARE_MODES;

/* ─────────────────────────────────────────────────────────────────────────────
   Monaco DiffEditor Wrapper — polished label bar + diff stats
   ───────────────────────────────────────────────────────────────────────────── */
function MonacoDiffView({ original, modified, originalLabel, modifiedLabel }: {
  original: string; modified: string; originalLabel: string; modifiedLabel: string;
}) {
  const { theme, resolvedTheme } = useThemeStore();
  const isDark = (theme === 'system' ? resolvedTheme : theme) === 'dark';

  const stats = useMemo(() => {
    const origLines = original.split('\n');
    const modLines = modified.split('\n');
    const origSet = new Set(origLines);
    const modSet = new Set(modLines);
    const added = modLines.filter(l => !origSet.has(l)).length;
    const removed = origLines.filter(l => !modSet.has(l)).length;
    const identical = added === 0 && removed === 0;
    return { added, removed, identical };
  }, [original, modified]);

  return (
    <div className="space-y-3">
      {/* Diff header bar */}
      <div className="flex items-center justify-between rounded-xl bg-muted/30 dark:bg-muted/15 border border-border/40 px-4 py-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-2 w-2 rounded-full bg-red-400/80 shrink-0" />
            <span className="text-sm font-medium text-foreground truncate">{originalLabel}</span>
          </div>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-2 w-2 rounded-full bg-emerald-400/80 shrink-0" />
            <span className="text-sm font-medium text-foreground truncate">{modifiedLabel}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          {stats.identical ? (
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              Identical
            </div>
          ) : (
            <>
              {stats.added > 0 && (
                <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/10 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  <Plus className="h-3 w-3" />{stats.added}
                </div>
              )}
              {stats.removed > 0 && (
                <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-red-500/10 text-xs font-semibold text-red-600 dark:text-red-400">
                  <Minus className="h-3 w-3" />{stats.removed}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Identical banner — full-width for maximum visibility */}
      {stats.identical && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
          <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">No differences detected</p>
            <p className="text-xs text-emerald-600/70 dark:text-emerald-400/60 mt-0.5">
              Both YAML configurations are identical — {original.split('\n').length} lines match exactly.
            </p>
          </div>
        </div>
      )}

      {/* Monaco diff editor — isolation + transform create a stacking context
           that forces WKWebView to clip Monaco's internal position:absolute elements
           (line number gutter, scroll decorations) within the overflow:hidden boundary.
           Without this, WKWebView lets them bleed through during scroll. */}
      <div className="rounded-xl border border-border/60 overflow-hidden shadow-sm ring-1 ring-black/[0.02] dark:ring-white/[0.02] relative isolate" style={{ transform: 'translateZ(0)', WebkitTransform: 'translateZ(0)' }}>
        <LazyDiffEditor
          original={original}
          modified={modified}
          language="yaml"
          theme={isDark ? 'kubilitics-dark' : 'kubilitics-light'}
          height="62vh"
          options={{
            readOnly: true,
            renderSideBySide: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 12,
            fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', 'Fira Code', Menlo, Monaco, monospace",
            lineNumbers: 'on',
            folding: true,
            wordWrap: 'off',
            padding: { top: 12, bottom: 12 },
          }}
        />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Compare Mode Pill Bar — gradient-coded, responsive, with active description
   ───────────────────────────────────────────────────────────────────────────── */
function CompareModePillBar({ value, onChange }: { value: CompareMode; onChange: (m: CompareMode) => void }) {
  return (
    <div className="flex items-center gap-2">
      {(Object.keys(COMPARE_MODES) as CompareMode[]).map((modeKey) => {
        const mode = COMPARE_MODES[modeKey];
        const Icon = mode.icon;
        const isActive = value === modeKey;

        return (
          <button
            key={modeKey}
            onClick={() => onChange(modeKey)}
            aria-pressed={isActive}
            className={cn(
              'group relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 border',
              isActive
                ? cn(mode.activeBg, mode.activeText, mode.activeBorder, 'shadow-sm')
                : 'bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40',
            )}
          >
            {/* Active gradient top accent */}
            {isActive && (
              <div className={cn(
                'absolute top-0 left-4 right-4 h-[2px] rounded-b-full bg-gradient-to-r',
                mode.gradient,
              )} />
            )}
            <Icon className={cn('h-4 w-4 shrink-0', isActive ? mode.accentColor : 'text-muted-foreground/60 group-hover:text-muted-foreground')} />
            <span>{mode.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Empty State — enterprise-grade with contextual illustration
   ───────────────────────────────────────────────────────────────────────────── */
function CompareEmptyState({ icon: Icon, title, description, accentGradient, children }: {
  icon: typeof GitCompare;
  title: string;
  description?: string;
  accentGradient?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-8">
      {/* Icon with subtle glow */}
      <div className="relative mb-5">
        <div className={cn(
          'absolute inset-0 blur-3xl opacity-15 rounded-full scale-[2]',
          accentGradient || 'bg-primary',
        )} />
        <div className="relative p-4 rounded-2xl bg-muted/40 dark:bg-muted/20 border border-border/40 shadow-sm">
          <Icon className="h-7 w-7 text-muted-foreground/50" />
        </div>
      </div>
      <p className="text-sm font-semibold text-foreground/80 mb-2">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground/60 max-w-md text-center leading-relaxed">
          {description}
        </p>
      )}
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Loading Skeleton — matches diff header bar layout
   ───────────────────────────────────────────────────────────────────────────── */
function DiffLoadingSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-xl bg-muted/20 border border-border/30 px-4 py-3 animate-pulse">
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-muted/60" />
          <div className="h-4 w-32 rounded bg-muted/50" />
          <div className="h-3.5 w-3.5 rounded bg-muted/30" />
          <div className="h-2 w-2 rounded-full bg-muted/60" />
          <div className="h-4 w-32 rounded bg-muted/50" />
        </div>
        <div className="flex gap-2">
          <div className="h-6 w-12 rounded-md bg-muted/40" />
          <div className="h-6 w-12 rounded-md bg-muted/40" />
        </div>
      </div>
      <div className="h-[62vh] rounded-xl bg-muted/15 border border-border/20">
        <div className="h-full flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/40" />
            <span className="text-xs text-muted-foreground/40">Loading diff...</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Custom YAML Drop Zone — split between upload CTA + Monaco editor
   ───────────────────────────────────────────────────────────────────────────── */
function YamlDropZone({ onYamlLoaded, customYaml, onCustomYamlChange, resourceName }: {
  onYamlLoaded: (text: string, fileName?: string) => void;
  customYaml: string;
  onCustomYamlChange: (text: string) => void;
  resourceName: string;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { theme, resolvedTheme } = useThemeStore();
  const isDark = (theme === 'system' ? resolvedTheme : theme) === 'dark';
  const dragCounter = useRef(0);

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      try {
        const parsed = yaml.load(text);
        onYamlLoaded(yaml.dump(parsed, { indent: 2, noRefs: true, lineWidth: -1 }), file.name);
        toast.success(`Loaded ${file.name}`);
      } catch {
        onYamlLoaded(text, file.name);
        toast.warning('File loaded but YAML parsing failed — showing raw content');
      }
    };
    reader.readAsText(file);
  }, [onYamlLoaded]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const hasContent = customYaml.trim().length > 0;

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="space-y-0"
    >
      {/* Toolbar above editor */}
      <div className="flex items-center justify-between px-4 py-2 bg-muted/20 dark:bg-muted/10 border border-border/40 border-b-0 rounded-t-xl">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-muted-foreground">Your YAML</span>
          <div className="h-3.5 w-px bg-border/50" />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs gap-2 text-muted-foreground hover:text-foreground"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp className="h-3 w-3" />
            Upload
          </Button>
          <span className="text-[10px] text-muted-foreground/40">or drag & drop</span>
        </div>
        {hasContent && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground/50 tabular-nums">
              {customYaml.split('\n').length} lines
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-destructive"
              onClick={() => onCustomYamlChange('')}
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </Button>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".yaml,.yml,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = '';
        }}
      />

      {/* Editor / drop zone */}
      <div className={cn(
        'relative border border-border/40 border-t-0 rounded-b-xl overflow-hidden transition-all duration-200',
        isDragging && 'ring-2 ring-primary/30 ring-offset-1',
      )}>
        {/* Drag overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm">
            <div className={cn(
              'p-5 rounded-2xl mb-4 border-2 border-dashed transition-all',
              'border-primary/40 bg-primary/5',
            )}>
              <Upload className="h-8 w-8 text-primary animate-bounce" />
            </div>
            <p className="text-sm font-semibold text-foreground">Drop your YAML file</p>
            <p className="text-xs text-muted-foreground/60 mt-1">.yaml, .yml, or .json</p>
          </div>
        )}

        <div className={cn('transition-opacity', isDragging && 'opacity-10')}>
          <Suspense fallback={
            <div className="h-72 flex items-center justify-center bg-muted/5">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
            </div>
          }>
            <LazyMonacoEditor
              value={customYaml}
              onChange={(val) => onCustomYamlChange(val ?? '')}
              language="yaml"
              theme={isDark ? 'kubilitics-dark' : 'kubilitics-light'}
              height={hasContent ? '320px' : '200px'}
              options={{
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 12,
                fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', 'Fira Code', Menlo, Monaco, monospace",
                lineNumbers: 'on',
                folding: true,
                wordWrap: 'on',
                padding: { top: 12, bottom: 12 },
                renderLineHighlight: 'gutter',
                tabSize: 2,
              }}
            />
          </Suspense>
        </div>
      </div>

      {/* CTA: Compare button when content is present */}
      {hasContent && (
        <div className="pt-4 flex items-center gap-3">
          <Button
            size="sm"
            className="gap-2 px-5 h-9 text-sm font-medium shadow-sm"
            onClick={() => {
              // Scroll up to show the diff (the parent will show MonacoDiffView)
              // This is a visual cue — the diff auto-renders once customYaml is set
              toast.success('Comparing YAML — scroll down for diff');
            }}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Compare
          </Button>
          <span className="text-xs text-muted-foreground/50">
            {customYaml.split('\n').length} lines vs {resourceName}
          </span>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Types & Helpers
   ───────────────────────────────────────────────────────────────────────────── */
/** Format bytes into human-readable string. */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(val >= 100 ? 0 : val >= 10 ? 1 : 2)} ${units[i]}`;
}

interface ResourceForComparison {
    name: string;
    namespace?: string;
    status: string;
    yaml: string;
    yamlLoading?: boolean;
    metrics?: {
        cpu: { data: number[]; value: string };
        memory: { data: number[]; value: string };
    };
    network?: {
        rx: number;
        tx: number;
    };
    metricsLoading?: boolean;
    logEntries?: LogEntry[];
    logsLoading?: boolean;
    dataUnavailable?: boolean;
}

interface ResourceComparisonViewProps {
    resourceType: ResourceType;
    resourceKind: string;
    namespace?: string;
    initialSelectedResources?: string[];
    clusterId?: string;
    backendBaseUrl?: string;
    isConnected?: boolean;
    embedded?: boolean;
}

const UNAVAILABLE_METRICS = {
    cpu: { data: [] as number[], value: '—' },
    memory: { data: [] as number[], value: '—' },
};

function valueToSparklineData(value: string): number[] {
    const num = parseFloat(value.replace(/[^0-9.]/g, ''));
    if (Number.isNaN(num)) return Array.from({ length: 20 }, () => 0);
    return Array.from({ length: 20 }, () => num);
}

/* ─────────────────────────────────────────────────────────────────────────────
   Fallback YamlDiffView (3-4 resource grid)
   ───────────────────────────────────────────────────────────────────────────── */
function YamlDiffView({
    leftName,
    rightName,
    leftYaml,
    rightYaml,
    leftLoading,
    rightLoading,
    embedded = false,
}: {
    leftName: string;
    rightName: string;
    leftYaml: string;
    rightYaml: string;
    leftLoading?: boolean;
    rightLoading?: boolean;
    embedded?: boolean;
}) {
    const diffLines = useMemo(() => {
        if (leftLoading || rightLoading || !leftYaml || !rightYaml) return [];
        const baseDiff = computeDiff(leftYaml, rightYaml);
        const processed: Array<unknown> = [];
        for (let i = 0; i < baseDiff.length; i++) {
            const current = baseDiff[i];
            const next = baseDiff[i + 1];
            if (current.type === 'removed' && next && next.type === 'added') {
                const { leftSegments, rightSegments } = getIntraLineDiff(current.content.left || '', next.content.right || '');
                processed.push({ ...current, type: 'modified-removed', segments: leftSegments });
                processed.push({ ...next, type: 'modified-added', segments: rightSegments });
                i++;
            } else {
                processed.push(current);
            }
        }
        return processed;
    }, [leftYaml, rightYaml, leftLoading, rightLoading]);

    const stats = useMemo(() => {
        return diffLines.reduce(
            (acc, line) => {
                if (line.type === 'added' || line.type === 'modified-added') acc.added++;
                else if (line.type === 'removed' || line.type === 'modified-removed') acc.removed++;
                else acc.unchanged++;
                return acc;
            },
            { added: 0, removed: 0, unchanged: 0 }
        );
    }, [diffLines]);

    if (leftLoading || rightLoading) return <DiffLoadingSkeleton />;

    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < diffLines.length; i++) {
        const line = diffLines[i];
        if (line.type === 'unchanged') {
            rows.push({ leftNum: line.lineNumber.left, leftContent: line.content.left, leftType: 'unchanged', rightNum: line.lineNumber.right, rightContent: line.content.right, rightType: 'unchanged' });
        } else if (line.type === 'removed' || line.type === 'modified-removed') {
            const next = diffLines[i + 1];
            if (next && (next.type === 'added' || next.type === 'modified-added')) {
                rows.push({ leftNum: line.lineNumber.left, leftContent: line.content.left, leftType: line.type, leftSegments: line.segments, rightNum: next.lineNumber.right, rightContent: next.content.right, rightType: next.type, rightSegments: next.segments });
                i++;
            } else {
                rows.push({ leftNum: line.lineNumber.left, leftContent: line.content.left, leftType: line.type, leftSegments: line.segments });
            }
        } else if (line.type === 'added' || line.type === 'modified-added') {
            rows.push({ rightNum: line.lineNumber.right, rightContent: line.content.right, rightType: line.type, rightSegments: line.segments });
        }
    }

    const scrollClass = embedded ? "h-auto overflow-hidden" : "h-[75vh] max-h-[800px] overflow-auto";

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 py-2">
                <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground font-medium">Differences:</span>
                    <Badge variant="outline" className="gap-1 bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30">
                        <Minus className="h-3 w-3" /> {stats.removed} removed
                    </Badge>
                    <Badge variant="outline" className="gap-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                        <Plus className="h-3 w-3" /> {stats.added} added
                    </Badge>
                </div>
            </div>
            <div className={cn("rounded-xl border border-border bg-card shadow-sm overflow-hidden", scrollClass)}>
                <table className="w-full border-collapse font-mono text-sm leading-relaxed table-fixed">
                    <thead className="sticky top-0 z-20 bg-muted/90 backdrop-blur border-b border-border shadow-sm">
                        <tr>
                            <th className="w-12 py-2 border-r border-border/10"></th>
                            <th className="px-4 py-2 text-left truncate">{leftName}</th>
                            <th className="w-12 py-2 border-l border-r border-border/10"></th>
                            <th className="px-4 py-2 text-left truncate">{rightName}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, i) => (
                            <tr key={i} className="hover:bg-muted/5 transition-colors">
                                <td className={cn("w-12 text-right pr-2 text-xs select-none py-0.5", row.leftType?.includes('removed') ? "bg-red-500/15" : "bg-muted/10")}>{row.leftNum || ''}</td>
                                <td className={cn("px-3 py-0.5 whitespace-pre overflow-x-auto", row.leftType?.includes('removed') ? "bg-red-500/10" : "opacity-80")}>
                                    {row.leftContent != null ? <YamlLineContent line={row.leftContent} segments={row.leftSegments} /> : null}
                                </td>
                                <td className={cn("w-12 text-right pr-2 text-xs select-none py-0.5 border-l", row.rightType?.includes('added') ? "bg-emerald-500/15" : "bg-muted/10")}>{row.rightNum || ''}</td>
                                <td className={cn("px-3 py-0.5 whitespace-pre overflow-x-auto", row.rightType?.includes('added') ? "bg-emerald-500/10" : "opacity-80")}>
                                    {row.rightContent != null ? <YamlLineContent line={row.rightContent} segments={row.rightSegments} /> : null}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {rows.length === 0 && (
                    <CompareEmptyState icon={Equal} title="No differences found" description="These resources have identical YAML configurations." />
                )}
            </div>
        </div>
    );
}

/* ═════════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═════════════════════════════════════════════════════════════════════════════ */
export function ResourceComparisonView({
    resourceType,
    resourceKind,
    namespace,
    initialSelectedResources,
    clusterId,
    backendBaseUrl,
    isConnected = false,
    embedded = false,
}: ResourceComparisonViewProps) {
    // ── Fresh state per resource — no cross-resource bleed ──
    // initialSelectedResources is the source of truth for which resource we're comparing.
    // When the user navigates to a different resource, this prop changes and we reset.
    const initialKey = JSON.stringify(initialSelectedResources ?? []);

    const [selectedResources, setSelectedResources] = useState<string[]>(initialSelectedResources ?? []);
    const [activeTab, setActiveTab] = useState('yaml');
    const [compareMode, setCompareMode] = useState<CompareMode>('resources');
    const [customYaml, setCustomYaml] = useState<string>('');

    // Reset all state when navigating to a different resource
    useEffect(() => {
      setSelectedResources(initialSelectedResources ?? []);
      setActiveTab('yaml');
      setCompareMode('resources');
      setCustomYaml('');
    }, [initialKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
    const canList = Boolean(clusterId && isBackendConfigured() && backendBaseUrl);
    const canFetch = Boolean(isConnected && clusterId && isBackendConfigured());

    const { data: listData } = useK8sResourceList<KubernetesResource>(resourceType, namespace, {
        limit: 500,
        enabled: canList,
    });

    const availableResources = useMemo(() => {
        return (listData?.items ?? []).map(item => ({
            name: item.metadata.name,
            namespace: item.metadata.namespace,
            status: (item.status?.phase as string) || (item.status?.conditions?.find((c: Record<string, unknown>) => c.type === 'Ready')?.status === 'True' ? 'Running' : 'Ready') || 'Unknown',
        }));
    }, [listData]);

    /* ── Queries ── */
    const resourceQueries = useQueries({
        queries: selectedResources.map(key => {
            const parts = key.split('/');
            const [ns, name] = parts.length === 2 ? [parts[0], parts[1]] : ['', parts[0]];
            return {
                queryKey: ['compare-resource', clusterId, resourceType, key],
                queryFn: async () => {
                    const raw = await getResource(backendBaseUrl!, clusterId!, resourceType, ns, name);
                    return resourceToYaml(raw as unknown as KubernetesResource);
                },
                enabled: canFetch && !!name,
            };
        }),
    });

    // Use unified metrics/summary for pods (includes network), fallback to basic for nodes
    const metricsQueries = useQueries({
        queries: selectedResources.map(key => {
            if (resourceType !== 'pods' && resourceType !== 'nodes') return { queryKey: ['skip-metrics'], enabled: false };
            const parts = key.split('/');
            const [ns, name] = parts.length === 2 ? [parts[0], parts[1]] : ['', parts[0]];
            return {
                queryKey: ['compare-metrics', clusterId, resourceType, key],
                queryFn: async () => {
                    if (resourceType === 'pods') {
                        // Unified summary includes network_rx/tx
                        const result = await getMetricsSummary(backendBaseUrl!, clusterId!, {
                            namespace: ns, resource_type: 'pod', resource_name: name,
                        });
                        const s = result.summary;
                        const pod = s?.pods?.[0];
                        return {
                            CPU: s?.total_cpu ?? '0m',
                            Memory: s?.total_memory ?? '0Mi',
                            network_rx: pod?.network_rx_bytes ?? 0,
                            network_tx: pod?.network_tx_bytes ?? 0,
                        };
                    }
                    const nm = await getNodeMetrics(backendBaseUrl!, clusterId!, name);
                    return { CPU: nm.CPU, Memory: nm.Memory, network_rx: 0, network_tx: 0 };
                },
                enabled: canFetch && !!name,
            };
        }),
    });

    const logsQueries = useQueries({
        queries: selectedResources.map(key => {
            if (resourceType !== 'pods') return { queryKey: ['skip-logs'], enabled: false };
            const parts = key.split('/');
            const [ns, name] = parts.length === 2 ? [parts[0], parts[1]] : ['', parts[0]];
            return {
                queryKey: ['compare-logs', clusterId, resourceType, key],
                queryFn: async () => {
                    const url = getPodLogsUrl(backendBaseUrl!, clusterId!, ns, name, { tail: 200, follow: false });
                    const res = await fetch(url);
                    if (!res.ok) throw new Error('Failed to fetch logs');
                    return res.text();
                },
                enabled: canFetch && !!name,
            };
        }),
    });

    const resourcesData: ResourceForComparison[] = useMemo(() => {
        return selectedResources.map((key, i) => {
            const parts = key.split('/');
            const [ns, name] = parts.length === 2 ? [parts[0], parts[1]] : ['', parts[0]];
            const res = availableResources.find(r => r.name === name && (ns === '' || r.namespace === ns));
            const yamlData = resourceQueries[i]?.data;
            const m = metricsQueries[i]?.data as { CPU?: string; Memory?: string; network_rx?: number; network_tx?: number } | undefined;
            const logText = logsQueries[i]?.data as string | undefined;
            return {
                name,
                namespace: ns,
                status: res?.status || 'Unknown',
                yaml: canFetch && yamlData ? yamlData : '',
                yamlLoading: canFetch && resourceQueries[i]?.isLoading,
                metrics: canFetch && m ? {
                    cpu: { data: valueToSparklineData(m.CPU ?? '0'), value: m.CPU ?? '—' },
                    memory: { data: valueToSparklineData(m.Memory ?? '0'), value: m.Memory ?? '—' },
                } : (resourceType === 'pods' || resourceType === 'nodes' ? UNAVAILABLE_METRICS : undefined),
                network: canFetch && m ? { rx: m.network_rx ?? 0, tx: m.network_tx ?? 0 } : undefined,
                metricsLoading: canFetch && metricsQueries[i]?.isLoading,
                logEntries: canFetch && logText != null ? parseRawLogs(logText) : undefined,
                logsLoading: canFetch && logsQueries[i]?.isLoading,
                dataUnavailable: !canFetch,
            };
        });
    }, [selectedResources, availableResources, canFetch, resourceQueries, metricsQueries, logsQueries, resourceType]);

    const handleAdd = (key: string) => {
        if (selectedResources.length >= 4) {
            toast.error('Maximum 4 resources can be compared');
            return;
        }
        if (!selectedResources.includes(key)) {
            setSelectedResources([...selectedResources, key]);
        }
    };

    const hasMetrics = resourceType === 'pods' || resourceType === 'nodes';
    const hasLogs = resourceType === 'pods';
    const activeMode = COMPARE_MODES[compareMode];

    return (
        <div className="flex flex-col">
            {/* ═══ Header: Title + Resource Selector (merged into one bar) ═══ */}
            <div className="px-6 py-3.5 border-b bg-muted/15 dark:bg-muted/5">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/15">
                            <GitCompare className="h-[18px] w-[18px] text-primary" />
                        </div>
                        <div>
                            <h2 className="text-sm font-semibold tracking-tight text-foreground">{resourceKind} Comparison</h2>
                            <p className="text-xs text-muted-foreground/60 mt-0.5">{activeMode.shortDesc}</p>
                        </div>
                    </div>
                    {selectedResources.length > 0 && (
                      <div className="text-xs font-medium text-muted-foreground/60 tabular-nums">
                        {selectedResources.length} of 4
                      </div>
                    )}
                </div>

                {/* Resource selector row */}
                <div className="flex items-center gap-2">
                    <Select onValueChange={handleAdd}>
                        <SelectTrigger className="w-56 h-8 text-xs bg-background border-border/50">
                            <SelectValue placeholder={`Add ${resourceKind}...`} />
                        </SelectTrigger>
                        <SelectContent>
                            {availableResources
                                .filter(r => !selectedResources.includes(r.namespace ? `${r.namespace}/${r.name}` : r.name))
                                .map(r => {
                                    const key = r.namespace ? `${r.namespace}/${r.name}` : r.name;
                                    return (
                                        <SelectItem key={key} value={key}>
                                            <div className="flex items-center gap-2">
                                                <span className="truncate">{r.name}</span>
                                                {r.namespace && <span className="text-muted-foreground/50 text-[10px]">{r.namespace}</span>}
                                            </div>
                                        </SelectItem>
                                    );
                                })}
                        </SelectContent>
                    </Select>

                    {selectedResources.length > 0 && <div className="h-4 w-px bg-border/30" />}

                    <div className="flex items-center gap-2 overflow-x-auto flex-1 min-w-0">
                        {selectedResources.map((key, idx) => (
                            <div
                              key={key}
                              className={cn(
                                'group flex items-center gap-2 pl-2 pr-1 py-1 rounded-lg border transition-all duration-150 shrink-0',
                                'bg-background hover:shadow-sm',
                                idx === 0 ? 'border-red-200 dark:border-red-900/50' : 'border-emerald-200 dark:border-emerald-900/50',
                              )}
                            >
                                <div className={cn(
                                  'h-1.5 w-1.5 rounded-full shrink-0',
                                  idx === 0 ? 'bg-red-400' : 'bg-emerald-400',
                                )} />
                                <span className="text-xs font-semibold text-foreground whitespace-nowrap">
                                  {key.split('/').pop()}
                                </span>
                                {key.includes('/') && (
                                  <span className="text-xs text-muted-foreground font-mono">{key.split('/')[0]}</span>
                                )}
                                <button
                                  onClick={() => setSelectedResources(selectedResources.filter(k => k !== key))}
                                  className="p-0.5 rounded-md hover:bg-destructive/10 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                                  aria-label={`Remove ${key.split('/').pop()}`}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* ═══ View Tabs (simple conditional — no Radix Tabs) ═══ */}
            <div>
                {/* Tab bar */}
                <div className="px-6 py-2 border-b bg-background">
                    <div className="inline-flex h-11 items-center justify-center rounded-xl bg-muted/60 p-1 text-muted-foreground gap-0.5">
                      {[
                        { id: 'yaml', label: 'YAML', icon: FileText, show: true },
                        { id: 'metrics', label: 'Metrics', icon: Activity, show: hasMetrics },
                        { id: 'logs', label: 'Logs', icon: ScrollText, show: hasLogs },
                      ].filter(t => t.show).map(t => (
                        <button
                          key={t.id}
                          onClick={() => setActiveTab(t.id)}
                          className={cn(
                            'inline-flex items-center justify-center whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200',
                            activeTab === t.id
                              ? 'bg-background text-foreground shadow-sm font-semibold'
                              : 'text-muted-foreground hover:text-foreground/80',
                          )}
                        >
                          <t.icon className="h-4 w-4 mr-2" /> {t.label}
                        </button>
                      ))}
                    </div>
                </div>

                {/* ─── YAML view ─── */}
                {activeTab === 'yaml' && (
                  <div>
                    {/* ═══ Compare Mode Pill Bar ═══ */}
                    <div className="px-6 py-2 border-b bg-background">
                      <CompareModePillBar value={compareMode} onChange={setCompareMode} />
                    </div>

                    <div className="px-6 py-5">
                      {/* ─── Mode: Resources ─── */}
                      {compareMode === 'resources' && (
                        <>
                          {resourcesData.length < 2 ? (
                            <CompareEmptyState
                              icon={ArrowRightLeft}
                              title="Select at least 2 resources"
                              description={`Add ${resourceKind}s from the dropdown above. Side-by-side Monaco diff for 2, or grid view for 3–4.`}
                              accentGradient="bg-emerald-500"
                            />
                          ) : resourcesData.some(r => r.yamlLoading) ? (
                            <DiffLoadingSkeleton />
                          ) : (
                            /* For 2+ resources: show pairwise Monaco diffs.
                               2 resources = 1 diff. 3 = first vs 2nd, first vs 3rd.
                               4 = first vs 2nd, first vs 3rd, first vs 4th. */
                            <div className="space-y-6">
                              {resourcesData.slice(1).map((res, i) => (
                                <Suspense key={`${resourcesData[0].name}-${res.name}`} fallback={<DiffLoadingSkeleton />}>
                                  <MonacoDiffView
                                    originalLabel={resourcesData[0].name}
                                    modifiedLabel={res.name}
                                    original={resourcesData[0].yaml}
                                    modified={res.yaml}
                                  />
                                </Suspense>
                              ))}
                            </div>
                          )}
                        </>
                      )}

                      {/* ─── Mode: Live vs Last Applied ─── */}
                      {compareMode === 'lastApplied' && (() => {
                        const firstResource = resourcesData[0];
                        if (!firstResource) return (
                          <CompareEmptyState
                            icon={History}
                            title="Select a resource to detect drift"
                            description="Choose a resource above to compare the live cluster state against the last-applied configuration from kubectl apply."
                            accentGradient="bg-blue-500"
                          />
                        );
                        if (firstResource.yamlLoading) return <DiffLoadingSkeleton />;

                        let lastAppliedJson: string | undefined;
                        try {
                          const parsed = yaml.load(firstResource.yaml) as Record<string, unknown>;
                          const meta = parsed?.metadata as Record<string, unknown>;
                          const ann = meta?.annotations as Record<string, string>;
                          lastAppliedJson = ann?.['kubectl.kubernetes.io/last-applied-configuration'];
                        } catch { /* parse failed */ }

                        if (!lastAppliedJson) return (
                          <CompareEmptyState
                            icon={AlertCircle}
                            title="No last-applied configuration"
                            description={`"${firstResource.name}" doesn't have a last-applied annotation. This is only present on resources managed with kubectl apply.`}
                            accentGradient="bg-amber-500"
                          >
                            <div className="mt-5 px-4 py-3 rounded-xl bg-muted/30 dark:bg-muted/15 border border-border/30 max-w-md">
                              <p className="text-xs text-muted-foreground/70 font-mono leading-relaxed">
                                <span className="text-emerald-500">$</span> kubectl apply -f {firstResource.name}.yaml
                              </p>
                              <p className="text-[10px] text-muted-foreground/40 mt-1">
                                Apply the resource declaratively to enable drift detection.
                              </p>
                            </div>
                          </CompareEmptyState>
                        );

                        let lastAppliedYaml = '';
                        try {
                          const parsed = JSON.parse(lastAppliedJson);
                          lastAppliedYaml = resourceToYaml(parsed);
                        } catch { lastAppliedYaml = '# Failed to parse last-applied-configuration'; }

                        let liveYaml = firstResource.yaml;
                        try {
                          const liveObj = yaml.load(liveYaml) as Record<string, unknown>;
                          if (liveObj?.metadata) {
                            const meta = liveObj.metadata as Record<string, unknown>;
                            delete meta.managedFields;
                            delete meta.resourceVersion;
                            delete meta.uid;
                            delete meta.creationTimestamp;
                            delete meta.generation;
                            if (meta.annotations) {
                              const ann = { ...(meta.annotations as Record<string, string>) };
                              delete ann['kubectl.kubernetes.io/last-applied-configuration'];
                              meta.annotations = Object.keys(ann).length > 0 ? ann : undefined;
                            }
                          }
                          delete liveObj.status;
                          liveYaml = yaml.dump(liveObj, { indent: 2, noRefs: true, lineWidth: -1 });
                        } catch { /* use raw */ }

                        return (
                          <Suspense fallback={<DiffLoadingSkeleton />}>
                            <MonacoDiffView
                              originalLabel="Last Applied"
                              modifiedLabel="Live State"
                              original={lastAppliedYaml}
                              modified={liveYaml}
                            />
                          </Suspense>
                        );
                      })()}

                      {/* ─── Mode: Custom YAML ─── */}
                      {compareMode === 'customYaml' && (() => {
                        const firstResource = resourcesData[0];
                        const clusterYaml = firstResource?.yaml || '';

                        if (!firstResource) return (
                          <CompareEmptyState
                            icon={FileCode2}
                            title="Select a resource first"
                            description="Choose a cluster resource above, then paste or upload your own YAML to compare against it."
                            accentGradient="bg-amber-500"
                          />
                        );

                        return (
                          <div className="space-y-5">
                            {/* Context bar: what are we comparing against */}
                            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-muted/20 dark:bg-muted/10 border border-border/30">
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <FileText className="h-3.5 w-3.5" />
                                <span>Cluster resource</span>
                              </div>
                              <Badge variant="secondary" className="text-xs font-semibold gap-2 px-2">
                                {firstResource.name}
                              </Badge>
                              <ArrowRight className="h-3 w-3 text-muted-foreground/30" />
                              <span className="text-xs text-muted-foreground">
                                {customYaml ? 'your YAML' : 'paste or upload below'}
                              </span>
                            </div>

                            {/* Show diff when custom YAML is present, editor when not */}
                            {customYaml ? (
                              <div className="space-y-4">
                                {/* Toolbar */}
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="gap-2 text-xs bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800">
                                      <FileCode2 className="h-3 w-3" />
                                      Custom YAML
                                    </Badge>
                                    <span className="text-[10px] text-muted-foreground/40 tabular-nums">
                                      {customYaml.split('\n').length} lines
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 px-2 text-xs gap-2 text-muted-foreground hover:text-foreground"
                                      onClick={() => setCustomYaml('')}
                                    >
                                      <Trash2 className="h-3 w-3" />
                                      Reset
                                    </Button>
                                  </div>
                                </div>

                                {/* Diff view */}
                                <Suspense fallback={<DiffLoadingSkeleton />}>
                                  <MonacoDiffView
                                    originalLabel={firstResource.name}
                                    modifiedLabel="Custom YAML"
                                    original={clusterYaml}
                                    modified={customYaml}
                                  />
                                </Suspense>
                              </div>
                            ) : (
                              <YamlDropZone
                                customYaml={customYaml}
                                onCustomYamlChange={setCustomYaml}
                                onYamlLoaded={(text) => setCustomYaml(text)}
                                resourceName={firstResource.name}
                              />
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* ─── Metrics view ─── */}
                {activeTab === 'metrics' && hasMetrics && (
                    <div className="p-6">
                        {resourcesData.length === 0 ? (
                          <CompareEmptyState icon={Activity} title="No resources selected" description="Add resources above to compare their CPU, memory, and network metrics." />
                        ) : (
                          <div className="space-y-6">
                            {/* CPU */}
                            <Card className="shadow-sm overflow-hidden">
                                <CardHeader className="bg-muted/10 dark:bg-muted/5 border-b py-3">
                                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                    <div className="h-2 w-2 rounded-full bg-blue-500" /> CPU Usage
                                  </CardTitle>
                                </CardHeader>
                                <CardContent className="pt-4">
                                    <div className={cn("grid gap-4", resourcesData.length <= 2 ? "grid-cols-2" : resourcesData.length === 3 ? "grid-cols-3" : "grid-cols-4")}>
                                        {resourcesData.map(res => (
                                            <div key={res.name} className="p-4 bg-muted/15 dark:bg-muted/8 rounded-xl border border-border/20 space-y-3">
                                                <div className="flex items-start justify-between gap-2">
                                                    <span className="text-xs font-medium truncate text-foreground/80 leading-tight">{res.name}</span>
                                                    <span className="text-sm font-semibold tabular-nums text-foreground shrink-0">{res.metrics?.cpu.value ?? '—'}</span>
                                                </div>
                                                {res.metrics && <Sparkline data={res.metrics.cpu.data} width={200} height={40} color="hsl(217 91% 60%)" showLive />}
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Memory */}
                            <Card className="shadow-sm overflow-hidden">
                                <CardHeader className="bg-muted/10 dark:bg-muted/5 border-b py-3">
                                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                    <div className="h-2 w-2 rounded-full bg-violet-500" /> Memory Usage
                                  </CardTitle>
                                </CardHeader>
                                <CardContent className="pt-4">
                                    <div className={cn("grid gap-4", resourcesData.length <= 2 ? "grid-cols-2" : resourcesData.length === 3 ? "grid-cols-3" : "grid-cols-4")}>
                                        {resourcesData.map(res => (
                                            <div key={res.name} className="p-4 bg-muted/15 dark:bg-muted/8 rounded-xl border border-border/20 space-y-3">
                                                <div className="flex items-start justify-between gap-2">
                                                    <span className="text-xs font-medium truncate text-foreground/80 leading-tight">{res.name}</span>
                                                    <span className="text-sm font-semibold tabular-nums text-foreground shrink-0">{res.metrics?.memory.value ?? '—'}</span>
                                                </div>
                                                {res.metrics && <Sparkline data={res.metrics.memory.data} width={200} height={40} color="hsl(263 70% 50%)" showLive />}
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Network Rx */}
                            {resourceType === 'pods' && (
                              <Card className="shadow-sm overflow-hidden">
                                  <CardHeader className="bg-muted/10 dark:bg-muted/5 border-b py-3">
                                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                      <div className="h-2 w-2 rounded-full bg-cyan-500" /> Network Received (Rx)
                                    </CardTitle>
                                  </CardHeader>
                                  <CardContent className="pt-4">
                                      <div className={cn("grid gap-4", resourcesData.length <= 2 ? "grid-cols-2" : resourcesData.length === 3 ? "grid-cols-3" : "grid-cols-4")}>
                                          {resourcesData.map(res => {
                                              const rx = res.network?.rx ?? 0;
                                              return (
                                                <div key={res.name} className="p-4 bg-muted/15 dark:bg-muted/8 rounded-xl border border-border/20 space-y-3">
                                                    <div className="flex items-start justify-between gap-2">
                                                      <span className="text-xs font-medium truncate text-foreground/80 leading-tight">{res.name}</span>
                                                      <span className="text-sm font-semibold tabular-nums text-foreground shrink-0">{formatBytes(rx)}</span>
                                                    </div>
                                                    <Sparkline data={valueToSparklineData(String(rx / 1024))} width={200} height={40} color="hsl(187 80% 42%)" showLive />
                                                </div>
                                              );
                                          })}
                                      </div>
                                  </CardContent>
                              </Card>
                            )}

                            {/* Network Tx */}
                            {resourceType === 'pods' && (
                              <Card className="shadow-sm overflow-hidden">
                                  <CardHeader className="bg-muted/10 dark:bg-muted/5 border-b py-3">
                                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                      <div className="h-2 w-2 rounded-full bg-orange-500" /> Network Transmitted (Tx)
                                    </CardTitle>
                                  </CardHeader>
                                  <CardContent className="pt-4">
                                      <div className={cn("grid gap-4", resourcesData.length <= 2 ? "grid-cols-2" : resourcesData.length === 3 ? "grid-cols-3" : "grid-cols-4")}>
                                          {resourcesData.map(res => {
                                              const tx = res.network?.tx ?? 0;
                                              return (
                                                <div key={res.name} className="p-4 bg-muted/15 dark:bg-muted/8 rounded-xl border border-border/20 space-y-3">
                                                    <div className="flex items-start justify-between gap-2">
                                                      <span className="text-xs font-medium truncate text-foreground/80 leading-tight">{res.name}</span>
                                                      <span className="text-sm font-semibold tabular-nums text-foreground shrink-0">{formatBytes(tx)}</span>
                                                    </div>
                                                    <Sparkline data={valueToSparklineData(String(tx / 1024))} width={200} height={40} color="hsl(25 95% 53%)" showLive />
                                                </div>
                                              );
                                          })}
                                      </div>
                                  </CardContent>
                              </Card>
                            )}
                          </div>
                        )}
                    </div>
                )}

                {/* ─── Logs view ─── */}
                {activeTab === 'logs' && hasLogs && (
                    <div className="p-6">
                        {resourcesData.length === 0 ? (
                          <CompareEmptyState icon={ScrollText} title="No resources selected" description="Add pods above to compare their log output." />
                        ) : (
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full">
                            {resourcesData.map(res => {
                                const entries = res.logEntries ?? [];
                                const errorCount = entries.filter(e => e.level === 'error').length;
                                const warnCount = entries.filter(e => e.level === 'warn').length;
                                return (
                                  <Card key={res.name} className="flex flex-col overflow-hidden min-h-[400px] shadow-sm">
                                      {/* Log header with stats */}
                                      <CardHeader className="py-2 px-4 border-b bg-slate-950 flex-row items-center justify-between space-y-0">
                                        <CardTitle className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                                          <ScrollText className="h-3.5 w-3.5 text-zinc-500" />
                                          {res.name}
                                        </CardTitle>
                                        <div className="flex items-center gap-2">
                                          {errorCount > 0 && (
                                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">
                                              {errorCount} error{errorCount > 1 ? 's' : ''}
                                            </span>
                                          )}
                                          {warnCount > 0 && (
                                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
                                              {warnCount} warn{warnCount > 1 ? 's' : ''}
                                            </span>
                                          )}
                                          <span className="text-[10px] text-zinc-600 tabular-nums">{entries.length} lines</span>
                                        </div>
                                      </CardHeader>
                                      <CardContent className="flex-1 bg-slate-950 text-zinc-100 p-0 overflow-auto">
                                          {res.logsLoading ? (
                                              <div className="p-6 flex flex-col items-center justify-center gap-2 text-zinc-500 h-full">
                                                <Loader2 className="h-5 w-5 animate-spin" />
                                                <span className="text-xs">Loading logs...</span>
                                              </div>
                                          ) : entries.length === 0 ? (
                                              <div className="p-6 flex flex-col items-center justify-center text-zinc-600 h-full">
                                                <ScrollText className="h-6 w-6 mb-2 opacity-30" />
                                                <span className="text-xs">No log entries</span>
                                              </div>
                                          ) : (
                                              <div className="font-mono text-xs leading-[1.6]">
                                                  {entries.map((entry, idx) => {
                                                    const levelDot = entry.level === 'error' ? 'bg-red-400'
                                                      : entry.level === 'warn' ? 'bg-amber-400'
                                                      : entry.level === 'debug' ? 'bg-zinc-600'
                                                      : 'bg-zinc-700';
                                                    const msgColor = entry.level === 'error' ? 'text-red-300'
                                                      : entry.level === 'warn' ? 'text-amber-300'
                                                      : entry.level === 'debug' ? 'text-zinc-500'
                                                      : 'text-zinc-300';
                                                    const rowBg = entry.level === 'error' ? 'bg-red-500/[0.06]'
                                                      : entry.level === 'warn' ? 'bg-amber-500/[0.04]'
                                                      : '';
                                                    // Format timestamp: strip date prefix if all same day
                                                    const ts = entry.timestamp;
                                                    const shortTs = ts.includes('T') ? ts.split('T')[1]?.replace(/Z$/, '') ?? ts : ts;
                                                    return (
                                                      <div
                                                        key={idx}
                                                        className={cn(
                                                          'flex items-start gap-0 hover:bg-white/[0.03] transition-colors border-b border-zinc-900/50',
                                                          rowBg,
                                                        )}
                                                      >
                                                        {/* Line number */}
                                                        <span className="w-10 shrink-0 text-right pr-2 py-1 text-zinc-700 select-none border-r border-zinc-800/50 tabular-nums">
                                                          {idx + 1}
                                                        </span>
                                                        {/* Level dot */}
                                                        <span className="w-5 shrink-0 flex items-center justify-center py-1.5">
                                                          <span className={cn('h-1.5 w-1.5 rounded-full', levelDot)} />
                                                        </span>
                                                        {/* Timestamp */}
                                                        <span className="text-zinc-600 shrink-0 py-1 pr-2 tabular-nums whitespace-nowrap">
                                                          {shortTs}
                                                        </span>
                                                        {/* Message */}
                                                        <span className={cn('py-1 pr-3 break-all', msgColor)}>
                                                          {entry.message}
                                                        </span>
                                                      </div>
                                                    );
                                                  })}
                                              </div>
                                          )}
                                      </CardContent>
                                  </Card>
                                );
                            })}
                          </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
