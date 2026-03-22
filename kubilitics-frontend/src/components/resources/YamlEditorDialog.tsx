import { useState, useEffect, useCallback } from 'react';
import { Edit3, AlertCircle, CheckCircle2, Loader2, Copy, Download, RotateCcw } from 'lucide-react';
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
import { toast } from 'sonner';
import yamlParser from 'js-yaml';

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

  useEffect(() => {
    if (open) {
      setYaml(initialYaml);
      setErrors([]);
      setHasChanges(false);
    }
  }, [open, initialYaml]);

  const handleYamlChange = useCallback((value: string) => {
    setYaml(value);
    setHasChanges(value !== initialYaml);
    const validationErrors = validateYaml(value);
    setErrors(validationErrors);
  }, [initialYaml]);

  const handleSave = async () => {
    if (errors.length > 0) return;

    setIsSaving(true);
    try {
      await onSave(yaml);
      onOpenChange(false);
      toast.success('Changes applied successfully');
    } catch (error) {
      console.error('Save failed:', error);
      toast.error('Failed to apply changes');
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
    setYaml(initialYaml);
    setErrors([]);
    setHasChanges(false);
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
            <div className="flex items-center gap-2">
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
              <CodeEditor
                value={yaml}
                onChange={handleYamlChange}
                minHeight="100%"
                className="h-full rounded-lg"
              />
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
