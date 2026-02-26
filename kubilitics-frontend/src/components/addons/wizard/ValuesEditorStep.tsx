// T6.FE-03: ValuesEditorStep with YAML validation edge cases
// - Tabs → specific "use spaces" error
// - Empty string → valid (treated as {})
// - Multi-document YAML → extract first document, no crash
// - Reset to defaults button
// - Disables Next via yamlValidationError in store (read by InstallWizard)

import { useCallback, useEffect } from "react";
import * as yaml from "js-yaml";
import { useCatalogEntry } from "@/hooks/useAddOnCatalog";
import { useAddOnStore } from "@/stores/addonStore";
import { CodeEditor } from "@/components/editor/CodeEditor";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Info, FileText, Settings2, AlertCircle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

/** Validate YAML string and return an error message, or null if valid. */
function validateYaml(value: string): string | null {
    // Empty string is treated as an empty object — valid.
    const trimmed = value.trim();
    if (trimmed === "" || trimmed === "{}") return null;

    // YAML spec disallows literal tab characters in indentation.
    // Detect tabs before yaml.load() since the parser error is less user-friendly.
    if (/\t/.test(value)) {
        return "YAML does not allow tabs — use spaces for indentation";
    }

    // Multi-document YAML: split on document markers and parse only the first document
    // to avoid a YAMLException for multiple documents.
    const firstDoc = value.split(/^---\s*$/m)[0];

    try {
        const parsed = yaml.load(firstDoc);
        // Parsed value must be null (empty doc) or a plain object
        if (parsed !== null && typeof parsed !== "object") {
            return "Values must be a YAML mapping (key: value), not a scalar";
        }
    } catch (err: unknown) {
        if (err instanceof yaml.YAMLException) {
            return `Invalid YAML: ${err.message.split("\n")[0]}`;
        }
        return "Invalid YAML: unknown parse error";
    }

    return null;
}

export function ValuesEditorStep({ addonId }: { addonId: string }) {
    const { data: addon } = useCatalogEntry(addonId);
    const {
        valuesYaml,
        setValuesYaml,
        yamlValidationError,
        setYamlValidationError,
    } = useAddOnStore();

    // Seed default values from catalog when the step first loads
    useEffect(() => {
        if (addon && "default_values_yaml" in (addon as any) && !(addon as any).default_values_yaml) return;
        const defaultValues = (addon as any)?.default_values_yaml as string | undefined;
        if (defaultValues && !valuesYaml) {
            setValuesYaml(defaultValues);
            setYamlValidationError(validateYaml(defaultValues));
        }
    }, [addon]);

    const handleChange = useCallback(
        (newValue: string) => {
            setValuesYaml(newValue);
            setYamlValidationError(validateYaml(newValue));
        },
        [setValuesYaml, setYamlValidationError]
    );

    const handleReset = useCallback(() => {
        const defaultValues = (addon as any)?.default_values_yaml as string | undefined ?? "";
        setValuesYaml(defaultValues);
        setYamlValidationError(validateYaml(defaultValues));
    }, [addon, setValuesYaml, setYamlValidationError]);

    return (
        <div className="flex flex-col h-full gap-6">
            {/* Toolbar */}
            <div className="flex items-center justify-between p-4 bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800/50 rounded-xl">
                <div className="flex items-center gap-3">
                    <Settings2 className="h-5 w-5 text-blue-600" />
                    <div>
                        <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 italic">
                            Configuration (values.yaml)
                        </h4>
                        <p className="text-xs text-blue-700 dark:text-blue-300">
                            Customize the installation by overriding default parameters.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleReset}
                        className="gap-1.5 text-xs text-muted-foreground hover:text-primary h-8"
                        title="Reset to chart defaults"
                    >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Reset to defaults
                    </Button>
                    <div className="flex flex-col items-end">
                        <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">
                            Schema Validation
                        </span>
                        <span
                            className={cn(
                                "text-[10px] font-bold",
                                yamlValidationError ? "text-destructive" : "text-emerald-600"
                            )}
                        >
                            {yamlValidationError ? "ERROR" : "ACTIVE"}
                        </span>
                    </div>
                </div>
            </div>

            {/* Editor */}
            <div className="flex-1 min-h-[400px] border rounded-xl overflow-hidden shadow-inner bg-background relative">
                <div className="absolute top-0 right-0 p-3 z-10 pointer-events-none opacity-50">
                    <FileText className="h-6 w-6 text-muted-foreground" />
                </div>
                <CodeEditor
                    value={valuesYaml}
                    onChange={handleChange}
                    minHeight="100%"
                    className="h-full border-none"
                />
            </div>

            {/* YAML validation error (T6.FE-03) */}
            {yamlValidationError && (
                <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive py-3">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <AlertDescription className="text-[12px] leading-snug font-medium">
                        {yamlValidationError}
                    </AlertDescription>
                </Alert>
            )}

            {/* Info footer (shown only when no error) */}
            {!yamlValidationError && (
                <Alert className="bg-muted/50 border-none shadow-none">
                    <Info className="h-4 w-4" />
                    <AlertDescription className="text-[11px] leading-tight">
                        Values are validated against the add-on's JSON schema before dry-run.
                        Use standard Helm value paths to override configuration.
                    </AlertDescription>
                </Alert>
            )}
        </div>
    );
}
