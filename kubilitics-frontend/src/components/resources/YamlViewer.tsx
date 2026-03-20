import { useState, useCallback, useEffect } from 'react';
import { Copy, Download, Edit3, CheckCircle2, AlertCircle, RotateCcw, Save, X, FileCode, Search, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import yamlParser from 'js-yaml';

export interface YamlValidationError {
  line: number;
  message: string;
}

export interface YamlViewerProps {
  yaml: string;
  resourceName: string;
  editable?: boolean;
  onSave?: (yaml: string) => Promise<void> | void;
  /** Optional warning or notice (e.g. Pod immutability) shown below the description */
  warning?: React.ReactNode;
}

function validateYaml(yaml: string): YamlValidationError[] {
  const errors: YamlValidationError[] = [];

  try {
    const doc = yamlParser.load(yaml) as any;
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
  } catch (err: any) {
    let line = 1;
    let message = 'Invalid YAML';

    if (err.mark && err.mark.line !== undefined) {
      line = err.mark.line + 1;
      message = err.reason || err.message;
    } else {
      message = err.message || String(err);
    }

    errors.push({ line, message });
  }

  return errors;
}

export function YamlViewer({ yaml, resourceName, editable = false, onSave, warning }: YamlViewerProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedYaml, setEditedYaml] = useState(yaml);
  const [errors, setErrors] = useState<YamlValidationError[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isEditing) setEditedYaml(yaml);
  }, [yaml, isEditing]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(isEditing ? editedYaml : yaml);
    setCopied(true);
    toast.success('YAML copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  }, [isEditing, editedYaml, yaml]);

  const handleDownload = useCallback(() => {
    const content = isEditing ? editedYaml : yaml;
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
  }, [isEditing, editedYaml, yaml, resourceName]);

  const handleEdit = () => {
    setEditedYaml(yaml);
    setErrors([]);
    setEditorKey((k) => k + 1);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setEditedYaml(yaml);
    setErrors([]);
    setIsEditing(false);
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
      toast.success('Changes applied successfully');
    } catch (error) {
      console.error('Save failed:', error);
      toast.error('Failed to apply changes');
    } finally {
      setIsSaving(false);
    }
  };

  const isValid = errors.length === 0;
  const hasChanges = editedYaml !== yaml;
  const lineCount = (isEditing ? editedYaml : yaml).split('\n').length;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
      {/* ── VS Code-style title bar ── */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#f8fafc] border-b border-border/60">
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
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCancel}>
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopy}>
                    {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{copied ? 'Copied!' : 'Copy YAML'}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleDownload}>
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
            <div className="w-64 shrink-0 border-l border-border bg-[#fef2f2]">
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
                      className="px-2.5 py-2 rounded-lg bg-white border border-destructive/15 cursor-pointer hover:border-destructive/30 transition-colors"
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
          value={yaml}
          readOnly
          minHeight="600px"
          className="rounded-none border-0"
          fontSize="small"
        />
      )}
    </div>
  );
}
