import { useState, useCallback, useEffect } from 'react';
import { Copy, Download, Edit3, CheckCircle2, AlertCircle, RotateCcw, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
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
    // Extract line number from js-yaml error if possible
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
  /** Bump to remount editable editor so it gets fresh value (e.g. after Reset). Avoids controlled sync overwriting typing. */
  const [editorKey, setEditorKey] = useState(0);

  // Sync editedYaml when parent yaml changes (e.g. after refetch) and we're not editing
  useEffect(() => {
    if (!isEditing) setEditedYaml(yaml);
  }, [yaml, isEditing]);

  const handleCopy = () => {
    navigator.clipboard.writeText(isEditing ? editedYaml : yaml);
    toast.success('YAML copied to clipboard');
  };

  const handleDownload = () => {
    const content = isEditing ? editedYaml : yaml;
    const blob = new Blob([content], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${resourceName}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('YAML downloaded');
  };

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
    setEditorKey((k) => k + 1); // Remount editor so it shows original yaml
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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="space-y-1.5">
          <CardTitle className="text-base">YAML Definition</CardTitle>
          <CardDescription>
            {isEditing ? 'Edit mode - make changes and apply' : 'View and edit the resource specification'}
          </CardDescription>
          {warning && <div className="text-sm text-muted-foreground pt-0.5">{warning}</div>}
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              {isValid ? (
                <Badge variant="outline" className="gap-1.5 text-primary border-primary/30 bg-primary/5">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Valid
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1.5 text-destructive border-destructive/30 bg-destructive/5">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {errors.length} error{errors.length > 1 ? 's' : ''}
                </Badge>
              )}
              <Button variant="ghost" size="sm" onClick={handleReset} disabled={!hasChanges} className="gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
              <Button variant="ghost" size="sm" onClick={handleCancel} className="gap-1.5">
                <X className="h-3.5 w-3.5" />
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={!isValid || !hasChanges || isSaving} className="gap-1.5">
                <Save className="h-3.5 w-3.5" />
                {isSaving ? 'Saving...' : 'Apply'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCopy}>
                <Copy className="h-3.5 w-3.5" />
                Copy
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownload}>
                <Download className="h-3.5 w-3.5" />
                Download
              </Button>
              {editable && onSave && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={handleEdit}>
                  <Edit3 className="h-3.5 w-3.5" />
                  Edit
                </Button>
              )}
            </>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isEditing ? (
          <div className="flex gap-4">
            <div className="flex-1">
              <CodeEditor
                key={`yaml-edit-${editorKey}`}
                value={editedYaml}
                onChange={handleYamlChange}
                minHeight="500px"
                className="rounded-lg"
              />
            </div>

            {errors.length > 0 && (
              <div className="w-56 shrink-0">
                <div className="h-full rounded-lg border border-border bg-muted/30 p-3">
                  <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-destructive" />
                    Errors
                  </h4>
                  <ScrollArea className="h-[460px]">
                    <div className="space-y-2">
                      {errors.map((error, i) => (
                        <div
                          key={i}
                          className="p-2 rounded bg-destructive/5 border border-destructive/20 text-sm"
                        >
                          <div className="text-destructive font-medium text-xs">Line {error.line}</div>
                          <p className="text-xs text-muted-foreground">{error.message}</p>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            )}
          </div>
        ) : (
          <CodeEditor
            value={yaml}
            readOnly
            minHeight="500px"
            className="rounded-lg"
          />
        )}
      </CardContent>
    </Card>
  );
}
