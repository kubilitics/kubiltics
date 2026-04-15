import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Download, Edit3, CheckCircle2, AlertCircle, AlertTriangle, RotateCcw, RefreshCw, ShieldAlert, Save, X, FileCode, Search, Loader2, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import yamlParser from 'js-yaml';
import { filterYaml, toJson, wellKnownFoldPaths, isLargeResource, type YamlPreset } from '@/lib/yaml/filterYaml';
import { isConflictError } from '@/lib/conflictDetection';
import { YamlCopyMenu } from './YamlCopyMenu';
import { findFoldRange } from './yamlFoldRanges';
import type { editor as monacoEditor } from 'monaco-editor';

/**
 * Walk backward through YAML lines from the given 1-indexed cursor line to
 * compute a dot-path string (e.g. "spec.containers[0].env[3]"). Uses indent
 * tracking — every ancestor is the last key at a strictly smaller indent.
 * Returns "" when the cursor is at the document root or outside the file.
 */
function computeBreadcrumbPath(yaml: string, lineNumber: number): string {
  if (!yaml || lineNumber < 1) return '';
  const lines = yaml.split('\n');
  if (lineNumber > lines.length) return '';

  // Walk backward collecting ancestor keys by indent level.
  // Stack contains { key, indent, arrayIdx? } from outermost to innermost.
  const stack: Array<{ key: string; indent: number; arrayIdx?: number }> = [];
  const cursorIdx = lineNumber - 1;
  let lastSeenIndent = indentOfLine(lines[cursorIdx]);

  for (let i = cursorIdx; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim()) continue;
    const ind = indentOfLine(line);
    if (i !== cursorIdx && ind >= lastSeenIndent) continue;

    const stripped = line.slice(ind);

    // Array item marker: "- " at this indent. Compute index by counting
    // sibling "- " lines above at the same indent, stopping if indent drops.
    if (stripped.startsWith('- ')) {
      let count = 0;
      for (let j = i - 1; j >= 0; j--) {
        const jLine = lines[j];
        if (!jLine.trim()) continue;
        const jInd = indentOfLine(jLine);
        if (jInd < ind) break;
        if (jInd === ind && jLine.slice(jInd).startsWith('- ')) count++;
      }
      if (stack.length > 0) stack[0].arrayIdx = count;
      lastSeenIndent = ind;
      continue;
    }

    // Key line: "<ident>: ..."
    const keyMatch = stripped.match(/^([A-Za-z_][A-Za-z0-9_-]*):/);
    if (keyMatch) {
      stack.unshift({ key: keyMatch[1], indent: ind });
      lastSeenIndent = ind;
    }
  }

  return stack
    .map((s) => (s.arrayIdx !== undefined ? `${s.key}[${s.arrayIdx}]` : s.key))
    .join('.');
}

function indentOfLine(line: string): number {
  let i = 0;
  while (i < line.length && line[i] === ' ') i++;
  return i;
}

export interface YamlValidationError {
  line: number;
  message: string;
}

export interface YamlViewerProps {
  yaml: string;
  /** Parsed K8s resource object. When provided, enables the Clean/Raw filter. */
  resource?: unknown;
  resourceName: string;
  editable?: boolean;
  onSave?: (yaml: string) => Promise<void> | void;
  /** Fetch the latest YAML from the server (used for conflict resolution). */
  onFetchLatest?: () => Promise<string>;
  /** Optional warning or notice (e.g. Pod immutability) shown below the description */
  warning?: React.ReactNode;
}

function validateYaml(yaml: string): YamlValidationError[] {
  const errors: YamlValidationError[] = [];

  try {
    const doc = yamlParser.load(yaml) as Record<string, unknown>;
    if (!doc) return errors;

    if (!doc.apiVersion) {
      errors.push({ line: 1, message: 'Missing required field: apiVersion' });
    }
    if (!doc.kind) {
      errors.push({ line: 1, message: 'Missing required field: kind' });
    }
    if (!doc.metadata) {
      errors.push({ line: 1, message: 'Missing required field: metadata' });
    }
  } catch (err) {
    let line = 1;
    let message = 'Invalid YAML';

    if (err instanceof Error && (err as unknown as Record<string, unknown>).mark && (err as unknown as Record<string, unknown>).mark.line !== undefined) {
      line = ((err as unknown as Record<string, unknown>).mark.line as number) + 1;
      message = ((err as unknown as Record<string, unknown>).reason as string) || err.message;
    } else {
      message = err instanceof Error ? err.message : String(err);
    }

    errors.push({ line, message });
  }

  return errors;
}

export function YamlViewer({ yaml, resource, resourceName, editable = false, onSave, onFetchLatest, warning }: YamlViewerProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedYaml, setEditedYaml] = useState(yaml);
  const [errors, setErrors] = useState<YamlValidationError[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [conflictDetected, setConflictDetected] = useState(false);
  const [preset, setPreset] = useState<YamlPreset>('clean');
  const previousPresetRef = useRef<YamlPreset>('clean');
  const [mode, setMode] = useState<'yaml' | 'json'>('yaml');
  const previousModeRef = useRef<'yaml' | 'json'>('yaml');
  const editorInstanceRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
  const [breadcrumbPath, setBreadcrumbPath] = useState('');
  const [isLargeBannerDismissed, setIsLargeBannerDismissed] = useState(false);

  const displayYaml = useMemo(() => {
    if (!resource) return yaml;
    if (preset === 'raw' && mode === 'yaml') return yaml;
    try {
      const filtered = filterYaml(resource, preset);
      return mode === 'json'
        ? toJson(filtered, { indent: 2 })
        : yamlParser.dump(filtered, {
            indent: 2,
            noArrayIndent: false,
            skipInvalid: true,
            flowLevel: -1,
            noRefs: true,
            lineWidth: -1,
          });
    } catch {
      return yaml;
    }
  }, [preset, mode, resource, yaml]);

  const showLargeBanner = !isEditing && !isLargeBannerDismissed && isLargeResource(displayYaml);

  const foldLineRange = useCallback(
    (range: { startLine: number; endLine: number } | null) => {
      const editor = editorInstanceRef.current;
      if (!editor || !range) return;
      editor.setSelection({
        startLineNumber: range.startLine,
        startColumn: 1,
        endLineNumber: range.endLine,
        endColumn: 1,
      } as unknown as monacoEditor.IRange);
      editor.getAction('editor.foldSelected')?.run();
    },
    [],
  );

  const stripsByPreset: Record<YamlPreset, string[]> = {
    raw: [],
    clean: ['metadata.managedFields'],
    'apply-ready': ['metadata.managedFields', 'status'],
  };
  const alreadyStripped = stripsByPreset[preset];

  const cleanYaml = useMemo(() => {
    if (!resource) return yaml;
    try {
      return yamlParser.dump(filterYaml(resource, 'clean'), {
        indent: 2, noArrayIndent: false, skipInvalid: true, flowLevel: -1, noRefs: true, lineWidth: -1,
      });
    } catch {
      return yaml;
    }
  }, [resource, yaml]);

  const applyReadyYaml = useMemo(() => {
    if (!resource) return yaml;
    try {
      return yamlParser.dump(filterYaml(resource, 'apply-ready'), {
        indent: 2, noArrayIndent: false, skipInvalid: true, flowLevel: -1, noRefs: true, lineWidth: -1,
      });
    } catch {
      return yaml;
    }
  }, [resource, yaml]);

  const jsonText = useMemo(() => {
    if (!resource) return yaml;
    try {
      return toJson(filterYaml(resource, 'apply-ready'), { indent: 2 });
    } catch {
      return yaml;
    }
  }, [resource, yaml]);

  const kubectlApplyCommand = useMemo(
    () => `cat <<'EOF' | kubectl apply -f -\n${applyReadyYaml.trimEnd()}\nEOF`,
    [applyReadyYaml],
  );

  useEffect(() => {
    const editor = editorInstanceRef.current;
    if (!editor) return;
    const disposable = editor.onDidChangeCursorPosition((evt) => {
      setBreadcrumbPath(computeBreadcrumbPath(displayYaml, evt.position.lineNumber));
    });
    return () => disposable.dispose();
  }, [displayYaml]);

  useEffect(() => {
    if (!showLargeBanner) return;
    // Fire once per large state entry. We intentionally omit foldLineRange and
    // displayYaml from deps because we want a single auto-fold when the banner
    // first appears — not on every displayYaml change.
    const statusRange = findFoldRange(displayYaml, 'status');
    const templateRange = findFoldRange(displayYaml, 'spec.template');
    if (statusRange) foldLineRange(statusRange);
    if (templateRange) foldLineRange(templateRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLargeBanner]);

  // Auto-enter edit mode when ?edit=1 is in URL (triggered by header Edit button)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('edit') === '1' && editable && !isEditing) {
      setIsEditing(true);
      // Clean up the URL param
      params.delete('edit');
      const newUrl = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`;
      window.history.replaceState({}, '', newUrl);
    }
  }, [editable, isEditing]);

  useEffect(() => {
    if (!isEditing) {
      setEditedYaml(yaml);
      setConflictDetected(false);
    }
  }, [yaml, isEditing]);

  const handleMenuCopy = useCallback((label: string, text: string) => {
    void window.navigator.clipboard?.writeText(text);
    toast.success(`Copied ${label}`);
  }, []);

  const handleDownload = useCallback(() => {
    const content = isEditing ? editedYaml : displayYaml;
    const blob = new Blob([content], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${resourceName}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    toast.success(`Downloaded ${resourceName}.yaml`);
  }, [isEditing, editedYaml, displayYaml, resourceName]);

  const handleEdit = () => {
    previousPresetRef.current = preset;
    previousModeRef.current = mode;
    setEditedYaml(yaml);
    setErrors([]);
    setEditorKey((k) => k + 1);
    setPreset('raw');
    setMode('yaml');
    setIsEditing(true);
  };

  const handleCancel = () => {
    setEditedYaml(yaml);
    setErrors([]);
    setIsEditing(false);
    setPreset(previousPresetRef.current);
    setMode(previousModeRef.current);
  };

  const handleReset = () => {
    setEditedYaml(yaml);
    setErrors([]);
    setEditorKey((k) => k + 1);
  };

  const handleYamlChange = useCallback((value: string) => {
    setEditedYaml(value);
    setErrors(validateYaml(value));
  }, []);

  const handleSave = async () => {
    if (errors.length > 0 || !onSave) return;

    setIsSaving(true);
    try {
      await onSave(editedYaml);
      setIsEditing(false);
      setPreset(previousPresetRef.current);
      setMode(previousModeRef.current);
      setConflictDetected(false);
      toast.success('Changes applied successfully');
    } catch (error) {
      console.error('Save failed:', error);
      if (isConflictError(error)) {
        setConflictDetected(true);
        toast.warning('Conflict detected — the resource was modified by another user or controller');
      } else {
        toast.error('Failed to apply changes');
      }
    } finally {
      setIsSaving(false);
    }
  };

  /** Force-save: update the resourceVersion in the user's YAML to the server's latest, then retry. */
  const handleForceSave = async () => {
    if (!onSave || !onFetchLatest) return;

    setIsSaving(true);
    try {
      const latestYaml = await onFetchLatest();
      const forcedYaml = replaceResourceVersion(editedYaml, latestYaml);
      await onSave(forcedYaml);
      setIsEditing(false);
      setPreset(previousPresetRef.current);
      setMode(previousModeRef.current);
      setConflictDetected(false);
      toast.success('Changes force-applied successfully');
    } catch (error) {
      console.error('Force save failed:', error);
      if (isConflictError(error)) {
        toast.error('Resource was modified again. Please reload and retry.');
      } else {
        toast.error(error instanceof Error ? error.message : 'Force save failed');
      }
    } finally {
      setIsSaving(false);
    }
  };

  /** Reload the editor with the server's latest YAML, discarding the user's changes. */
  const handleReloadLatest = async () => {
    if (!onFetchLatest) return;

    try {
      const latestYaml = await onFetchLatest();
      setEditedYaml(latestYaml);
      setErrors(validateYaml(latestYaml));
      setConflictDetected(false);
      setEditorKey((k) => k + 1);
      toast.success('Reloaded latest version from server');
    } catch {
      toast.error('Failed to fetch latest version');
    }
  };

  const isValid = errors.length === 0;
  const hasChanges = editedYaml !== yaml;
  const lineCount = (isEditing ? editedYaml : displayYaml).split('\n').length;

  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden shadow-[var(--shadow-1)]">
      {/* ── VS Code-style title bar ── */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 dark:bg-muted/20 border-b border-border/50">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2">
            <FileCode className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-semibold text-foreground truncate">{resourceName}.yaml</span>
          </div>
          <Separator orientation="vertical" className="h-4" />
          <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
            {lineCount} lines
          </span>
          {isEditing && (
            <>
              <Separator orientation="vertical" className="h-4" />
              {isValid ? (
                <Badge variant="outline" className="gap-1 h-5 text-[10px] font-semibold text-emerald-600 border-emerald-500/30 bg-emerald-500/5 px-1.5">
                  <CheckCircle2 className="h-3 w-3" />
                  Valid
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 h-5 text-[10px] font-semibold text-destructive border-destructive/30 bg-destructive/5 px-1.5">
                  <AlertCircle className="h-3 w-3" />
                  {errors.length} error{errors.length > 1 ? 's' : ''}
                </Badge>
              )}
              {hasChanges && (
                <Badge variant="outline" className="h-5 text-[10px] font-semibold text-amber-600 border-amber-500/30 bg-amber-500/5 px-1.5">
                  Modified
                </Badge>
              )}
            </>
          )}
        </div>

        {/* ── Toolbar actions ── */}
        <div className="flex items-center gap-1">
          {resource && (
            <>
              <div className="inline-flex items-center rounded-md border border-border bg-background p-0.5 mr-1">
                <Button
                  variant={preset === 'clean' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-6 text-[11px] font-medium px-2.5 rounded-sm"
                  onClick={() => setPreset('clean')}
                  disabled={isEditing}
                  aria-pressed={preset === 'clean'}
                  title="Hide managedFields"
                >
                  Clean
                </Button>
                <Button
                  variant={preset === 'apply-ready' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-6 text-[11px] font-medium px-2.5 rounded-sm"
                  onClick={() => setPreset('apply-ready')}
                  disabled={isEditing}
                  aria-pressed={preset === 'apply-ready'}
                  title="Remove server-managed fields"
                >
                  Apply-ready
                </Button>
                <Button
                  variant={preset === 'raw' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-6 text-[11px] font-medium px-2.5 rounded-sm"
                  onClick={() => setPreset('raw')}
                  disabled={isEditing}
                  aria-pressed={preset === 'raw'}
                  title="Show full YAML"
                >
                  Raw
                </Button>
              </div>
              <div className="inline-flex items-center rounded-md border border-border bg-background p-0.5 mr-1">
                <Button
                  variant={mode === 'yaml' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-6 text-[11px] font-medium px-2.5 rounded-sm"
                  onClick={() => setMode('yaml')}
                  disabled={isEditing}
                  aria-pressed={mode === 'yaml'}
                >
                  YAML
                </Button>
                <Button
                  variant={mode === 'json' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-6 text-[11px] font-medium px-2.5 rounded-sm"
                  onClick={() => setMode('json')}
                  disabled={isEditing}
                  aria-pressed={mode === 'json'}
                >
                  JSON
                </Button>
              </div>
              <Separator orientation="vertical" className="h-4 mx-1" />
            </>
          )}
          {isEditing ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleReset} disabled={!hasChanges}>
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Reset changes</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCancel} aria-label="Cancel editing">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Cancel editing</TooltipContent>
              </Tooltip>
              <Separator orientation="vertical" className="h-4 mx-1" />
              <Button
                size="sm"
                className="h-7 text-xs font-semibold gap-1.5 px-3 rounded-lg"
                onClick={handleSave}
                disabled={!isValid || !hasChanges || isSaving}
              >
                {isSaving ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Save className="h-3 w-3" />
                )}
                {isSaving ? 'Applying…' : 'Apply Changes'}
              </Button>
            </>
          ) : (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs font-medium gap-1 px-2"
                    disabled={isEditing}
                    aria-label="Fold menu"
                  >
                    Fold <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onSelect={() => editorInstanceRef.current?.getAction('editor.foldAll')?.run()}>
                    Fold All
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => editorInstanceRef.current?.getAction('editor.unfoldAll')?.run()}>
                    Unfold All
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {wellKnownFoldPaths().map((p) => {
                    const disabled = alreadyStripped.includes(p.path);
                    return (
                      <DropdownMenuItem
                        key={p.path}
                        disabled={disabled}
                        onSelect={() => foldLineRange(findFoldRange(displayYaml, p.path))}
                      >
                        {p.label}
                        {disabled && <span className="ml-auto text-[10px] text-muted-foreground">hidden</span>}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
              <Separator orientation="vertical" className="h-4 mx-1" />
              <YamlCopyMenu
                cleanYaml={cleanYaml}
                applyReadyYaml={applyReadyYaml}
                rawYaml={yaml}
                jsonText={jsonText}
                kubectlApplyCommand={kubectlApplyCommand}
                onCopy={handleMenuCopy}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleDownload} aria-label="Download YAML">
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Download YAML</TooltipContent>
              </Tooltip>
              {editable && onSave && (
                <>
                  <Separator orientation="vertical" className="h-4 mx-1" />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 text-xs font-medium gap-1.5 px-2.5" onClick={handleEdit}>
                        <Edit3 className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Edit YAML definition</TooltipContent>
                  </Tooltip>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Warning banner ── */}
      {warning && (
        <div className="px-4 py-2 text-xs text-muted-foreground bg-amber-500/5 border-b border-amber-500/20">
          {warning}
        </div>
      )}

      {!isEditing && preset === 'raw' && resource && (
        <div className="px-4 py-1.5 text-[11px] text-muted-foreground bg-muted/20 border-b border-border">
          Showing full YAML including <code className="font-mono">managedFields</code>.
        </div>
      )}

      {showLargeBanner && (
        <div className="px-4 py-2 text-xs bg-amber-500/10 border-b border-amber-500/30 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-amber-800 dark:text-amber-400">
              Large resource ({Math.round(displayYaml.length / 1024)} KB).
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              <code className="font-mono">status</code> and <code className="font-mono">spec.template</code> auto-folded for performance.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px] px-2 shrink-0"
            onClick={() => setIsLargeBannerDismissed(true)}
            aria-label="Dismiss large resource warning"
          >
            Dismiss
          </Button>
        </div>
      )}

      {!isEditing && breadcrumbPath && resource && (
        <div className="px-4 py-1 text-[11px] text-muted-foreground bg-slate-50 dark:bg-slate-900/50 border-b border-border flex items-center gap-1 font-mono overflow-x-auto">
          {breadcrumbPath.split('.').map((seg, i, arr) => (
            <span key={i} className="flex items-center gap-1 whitespace-nowrap">
              <span>{seg}</span>
              {i < arr.length - 1 && <span className="text-muted-foreground/40">›</span>}
            </span>
          ))}
        </div>
      )}

      {/* ── Conflict banner ── */}
      {conflictDetected && isEditing && (
        <div className="px-4 py-3 bg-amber-500/5 border-b border-amber-500/30 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-400">
              Conflict detected
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              This resource was modified since you started editing. Your save was rejected to prevent overwriting those changes.
            </p>
            <div className="flex items-center gap-2 mt-2">
              {onFetchLatest && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] gap-1 px-2"
                    onClick={handleReloadLatest}
                    disabled={isSaving}
                  >
                    <RefreshCw className="h-3 w-3" />
                    Reload Latest
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] gap-1 px-2 text-amber-700 dark:text-amber-400 border-amber-500/40 hover:bg-amber-500/10"
                    onClick={handleForceSave}
                    disabled={isSaving}
                  >
                    <ShieldAlert className="h-3 w-3" />
                    Force Save
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[11px] px-2"
                onClick={() => setConflictDetected(false)}
              >
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Editor area ── */}
      {isEditing ? (
        <div className="flex">
          <div className="flex-1 min-w-0">
            <CodeEditor
              key={`yaml-edit-${editorKey}`}
              value={editedYaml}
              onChange={handleYamlChange}
              minHeight="600px"
              className="rounded-none border-0"
              fontSize="small"
            />
          </div>

          {errors.length > 0 && (
            <div className="w-64 shrink-0 border-l border-border bg-destructive/5 dark:bg-destructive/10">
              <div className="px-3 py-2 border-b border-destructive/20 flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                <span className="text-xs font-semibold text-destructive">
                  Problems ({errors.length})
                </span>
              </div>
              <ScrollArea className="h-[560px]">
                <div className="p-2 space-y-1.5">
                  {errors.map((error, i) => (
                    <div
                      key={i}
                      className="px-2.5 py-2 rounded-lg bg-white dark:bg-slate-900 border border-destructive/15 cursor-pointer hover:border-destructive/30 transition-colors"
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[10px] font-mono font-bold text-destructive tabular-nums">
                          Ln {error.line}
                        </span>
                      </div>
                      <p className="text-[11px] text-foreground/70 leading-relaxed">{error.message}</p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      ) : (
        <CodeEditor
          value={displayYaml}
          language={mode}
          readOnly
          minHeight="600px"
          className="rounded-none border-0"
          fontSize="small"
          onEditorReady={(e) => { editorInstanceRef.current = e; }}
        />
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Replace the resourceVersion in the user's YAML with the one from the server's
 * latest YAML so a force-save can succeed.
 */
function replaceResourceVersion(userYaml: string, serverYaml: string): string {
  try {
    const userDoc = yamlParser.load(userYaml) as Record<string, unknown>;
    const serverDoc = yamlParser.load(serverYaml) as Record<string, unknown>;
    if (!userDoc || !serverDoc) return userYaml;

    const serverMeta = serverDoc.metadata as Record<string, unknown> | undefined;
    const userMeta = userDoc.metadata as Record<string, unknown> | undefined;
    if (serverMeta?.resourceVersion && userMeta) {
      userMeta.resourceVersion = serverMeta.resourceVersion;
    }
    return yamlParser.dump(userDoc, { lineWidth: -1, noRefs: true });
  } catch {
    return userYaml;
  }
}
