import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Edit3,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Copy,
  Download,
  RotateCcw,
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  EyeOff,
  Minus,
  Plus,
  GitCompare,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { NamespaceBadge } from '@/components/list';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { toast } from '@/components/ui/sonner';
import yamlParser from 'js-yaml';
import type * as monacoType from 'monaco-editor';

import { type YamlValidationError } from './YamlViewer';

export interface YamlEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceType: string;
  resourceName: string;
  namespace?: string;
  initialYaml: string;
  onSave: (yaml: string) => Promise<void> | void;
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

function stripManagedFields(rawYaml: string): string {
  try {
    const doc = yamlParser.load(rawYaml) as Record<string, unknown>;
    if (!doc || typeof doc !== 'object') return rawYaml;
    const meta = doc.metadata as Record<string, unknown> | undefined;
    if (meta && 'managedFields' in meta) {
      const stripped = { ...doc, metadata: { ...meta } };
      delete (stripped.metadata as Record<string, unknown>)['managedFields'];
      return yamlParser.dump(stripped, { lineWidth: -1, noRefs: true });
    }
    return rawYaml;
  } catch {
    return rawYaml;
  }
}

const FONT_SIZE_OPTIONS = [
  { label: 'S', value: 'small' as const },
  { label: 'M', value: 'medium' as const },
  { label: 'L', value: 'large' as const },
];

export function YamlEditorDialog({
  open,
  onOpenChange,
  resourceType,
  resourceName,
  namespace,
  initialYaml,
  onSave,
}: YamlEditorDialogProps) {
  const [yaml, setYaml] = useState(initialYaml);
  const [errors, setErrors] = useState<YamlValidationError[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [showManagedFields, setShowManagedFields] = useState(false);
  const [fontSize, setFontSize] = useState<'small' | 'medium' | 'large'>('small');
  const [showDiff, setShowDiff] = useState(false);
  const editorRef = useRef<monacoType.editor.IStandaloneCodeEditor | null>(null);

  // Strip managed fields once (not per-render) — avoids load/dump round-trip on every keystroke
  const strippedInitialYaml = useMemo(() => stripManagedFields(initialYaml), [initialYaml]);

  // When dialog opens or managed fields toggle changes, reset the editor content
  useEffect(() => {
    if (open) {
      setYaml(showManagedFields ? initialYaml : strippedInitialYaml);
      setErrors([]);
      setHasChanges(false);
      setShowDiff(false);
    }
  }, [open, initialYaml, showManagedFields, strippedInitialYaml]);

  // Correct baseline for change detection — depends on managed fields toggle
  const baseline = showManagedFields ? initialYaml : strippedInitialYaml;

  const handleYamlChange = useCallback((value: string) => {
    setYaml(value);
    setHasChanges(value !== baseline);
    const validationErrors = validateYaml(value);
    setErrors(validationErrors);
  }, [baseline]);

  const handleSave = async () => {
    if (errors.length > 0) return;

    setIsSaving(true);
    try {
      await onSave(yaml);
      onOpenChange(false);
      toast.success('Changes applied successfully');
    } catch (error) {
      console.error('Save failed:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to apply changes');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(yaml);
    toast.success('YAML copied to clipboard');
  };

  const handleDownload = () => {
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${resourceName}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    toast.success('YAML downloaded');
  };

  const handleReset = () => {
    setYaml(baseline);
    setErrors([]);
    setHasChanges(false);
  };

  const handleFoldAll = () => editorRef.current?.trigger('fold', 'editor.foldAll', null);
  const handleUnfoldAll = () => editorRef.current?.trigger('unfold', 'editor.unfoldAll', null);

  const currentSizeIndex = FONT_SIZE_OPTIONS.findIndex((o) => o.value === fontSize);

  const handleFontSizeUp = () => {
    if (currentSizeIndex < FONT_SIZE_OPTIONS.length - 1) {
      setFontSize(FONT_SIZE_OPTIONS[currentSizeIndex + 1].value);
    }
  };

  const handleFontSizeDown = () => {
    if (currentSizeIndex > 0) {
      setFontSize(FONT_SIZE_OPTIONS[currentSizeIndex - 1].value);
    }
  };

  const isValid = errors.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-full bg-primary/10">
              <Edit3 className="h-5 w-5 text-primary" />
            </div>
            <DialogTitle className="text-xl">Edit {resourceType}</DialogTitle>
          </div>
          <DialogDescription className="text-left flex items-center gap-2">
            Editing{' '}
            <span className="font-mono font-medium text-foreground">{resourceName}</span>
            {namespace && (
              <>
                {' '}in <NamespaceBadge namespace={namespace} />
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col gap-4 min-h-0">
          {/* Toolbar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isValid ? (
                <Badge variant="outline" className="gap-1.5 text-primary border-primary/30 bg-primary/5">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Valid YAML
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1.5 text-destructive border-destructive/30 bg-destructive/5">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {errors.length} {errors.length === 1 ? 'error' : 'errors'}
                </Badge>
              )}
              {hasChanges && (
                <Badge variant="secondary" className="text-xs">
                  Unsaved changes
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              {/* Fold / Unfold */}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleFoldAll}
                title="Fold All"
                disabled={showDiff}
                className="gap-1 px-2"
              >
                <ChevronsDownUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleUnfoldAll}
                title="Unfold All"
                disabled={showDiff}
                className="gap-1 px-2"
              >
                <ChevronsUpDown className="h-3.5 w-3.5" />
              </Button>

              {/* Managed Fields toggle */}
              <Button
                variant={showManagedFields ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setShowManagedFields((v) => !v)}
                title={showManagedFields ? 'Hide Managed Fields' : 'Show Managed Fields'}
                className="gap-1 px-2"
              >
                {showManagedFields ? (
                  <Eye className="h-3.5 w-3.5" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" />
                )}
              </Button>

              {/* Diff toggle */}
              <Button
                variant={showDiff ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setShowDiff((v) => !v)}
                title="Toggle Diff View"
                disabled={!hasChanges}
                className="gap-1 px-2"
              >
                <GitCompare className="h-3.5 w-3.5" />
              </Button>

              <div className="w-px h-5 bg-border mx-1" />

              {/* Font size controls */}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleFontSizeDown}
                disabled={currentSizeIndex <= 0}
                className="px-1.5"
                title="Decrease font size"
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs font-medium text-muted-foreground w-4 text-center select-none">
                {FONT_SIZE_OPTIONS[currentSizeIndex].label}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleFontSizeUp}
                disabled={currentSizeIndex >= FONT_SIZE_OPTIONS.length - 1}
                className="px-1.5"
                title="Increase font size"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>

              <div className="w-px h-5 bg-border mx-1" />

              {/* Copy / Download / Reset */}
              <Button variant="ghost" size="sm" onClick={handleCopy} className="gap-1.5">
                <Copy className="h-3.5 w-3.5" />
                Copy
              </Button>
              <Button variant="ghost" size="sm" onClick={handleDownload} className="gap-1.5">
                <Download className="h-3.5 w-3.5" />
                Download
              </Button>
              <Button variant="ghost" size="sm" onClick={handleReset} disabled={!hasChanges} className="gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            </div>
          </div>

          {/* Editor */}
          <div className="flex-1 flex gap-4 min-h-0">
            <div className="flex-1 min-h-0">
              {showDiff ? (
                <YamlDiffPanel original={baseline} modified={yaml} fontSize={fontSize} />
              ) : (
                <CodeEditor
                  value={yaml}
                  onChange={handleYamlChange}
                  minHeight="100%"
                  className="h-full rounded-lg"
                  fontSize={fontSize}
                  onEditorReady={(editor) => { editorRef.current = editor; }}
                />
              )}
            </div>

            {/* Validation Panel */}
            {errors.length > 0 && (
              <div className="w-64 shrink-0">
                <div className="h-full rounded-lg border border-border bg-muted/30 p-3">
                  <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-destructive" />
                    Validation Errors
                  </h4>
                  <ScrollArea className="h-[calc(100%-2rem)]">
                    <div className="space-y-2">
                      {errors.map((error, i) => (
                        <div
                          key={i}
                          className="p-2 rounded bg-destructive/5 border border-destructive/20 text-sm"
                        >
                          <div className="flex items-center gap-1.5 text-destructive font-medium mb-0.5">
                            <span className="font-mono text-xs">Line {error.line}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{error.message}</p>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!isValid || !hasChanges || isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Apply Changes
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Diff Panel ────────────────────────────────────────────────────────────────

const diffFontSizeMap = { small: 13, medium: 15, large: 17 } as const;

function YamlDiffPanel({
  original,
  modified,
  fontSize,
}: {
  original: string;
  modified: string;
  fontSize: 'small' | 'medium' | 'large';
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monacoType.editor.IDiffEditor | null>(null);

  useEffect(() => {
    let disposed = false;

    async function initDiff() {
      const monaco = await import('monaco-editor');
      if (disposed || !containerRef.current) return;

      const editor = monaco.editor.createDiffEditor(containerRef.current, {
        readOnly: true,
        automaticLayout: true,
        fontSize: diffFontSizeMap[fontSize],
        fontFamily:
          '"JetBrains Mono", "SF Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        lineHeight: 22,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderSideBySide: true,
        padding: { top: 12, bottom: 12 },
        folding: true,
        lineNumbers: 'on',
        glyphMargin: false,
        renderOverviewRuler: false,
        originalEditable: false,
      });

      const originalModel = monaco.editor.createModel(original, 'yaml');
      const modifiedModel = monaco.editor.createModel(modified, 'yaml');
      editor.setModel({ original: originalModel, modified: modifiedModel });
      editorRef.current = editor;
    }

    initDiff();

    return () => {
      disposed = true;
      const model = editorRef.current?.getModel();
      editorRef.current?.dispose();
      model?.original?.dispose();
      model?.modified?.dispose();
      editorRef.current = null;
    };
    // Re-create on content or fontSize change
  }, [original, modified, fontSize]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full rounded-xl border border-border overflow-hidden bg-[#FAFCFF]"
    />
  );
}
