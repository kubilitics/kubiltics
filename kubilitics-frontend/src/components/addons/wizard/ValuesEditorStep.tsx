// T6.FE-03: ValuesEditorStep — pre-loads chart values.yaml from Artifact Hub via backend
// - Fetches GET /addons/catalog/{addonId}/values on mount (useAddonDefaultValues)
// - Seeds editor once when values arrive (only if user hasn't already typed anything)
// - Shows skeleton while loading, error banner on fetch failure
// - Tabs → specific "use spaces" error
// - Empty string → valid (treated as {})
// - Multi-document YAML → extract first document, no crash
// - Reset to defaults button reloads fetched content
// - Disables Next via yamlValidationError in store (read by InstallWizard)

import { useCallback, useEffect, useRef } from "react";
import * as yaml from "js-yaml";
import { useAddonDefaultValues } from "@/hooks/useAddOnCatalog";
import { useAddOnStore } from "@/stores/addonStore";
import { CodeEditor } from "@/components/editor/CodeEditor";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Info, FileText, Settings2, AlertCircle, RotateCcw, ServerCrash } from "lucide-react";
import { cn } from "@/lib/utils";

/** Validate YAML string and return an error message, or null if valid. */
function validateYaml(value: string): string | null {
    // Empty string is treated as an empty object — valid.
    const trimmed = value.trim();
    if (trimmed === "" || trimmed === "{}") return null;

    // YAML spec disallows literal tab characters in indentation.
    if (/\t/.test(value)) {
        return "YAML does not allow tabs — use spaces for indentation";
    }

    // Multi-document YAML: parse only the first document.
    const firstDoc = value.split(/^---\s*$/m)[0];

    try {
        const parsed = yaml.load(firstDoc);
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
    const {
        data: defaultValues,
        isLoading: isLoadingValues,
        isFetching: isFetchingValues,
        isError: isValuesError,
        refetch: refetchValues,
    } = useAddonDefaultValues(addonId);

    const {
        valuesYaml,
        setValuesYaml,
        yamlValidationError,
        setYamlValidationError,
    } = useAddOnStore();

    // Track whether we've already seeded the editor for this addonId so we don't
    // overwrite edits the user has made after the initial load.
    const seededForRef = useRef<string>("");

    // When addonId changes (user opened wizard for a different addon), clear the editor
    // so stale content from the previous addon is not shown while fresh values load.
    useEffect(() => {
        seededForRef.current = "";
        setValuesYaml("");
        setYamlValidationError(null);
    }, [addonId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Seed editor with fetched defaults when they arrive — but only once per addonId,
    // and only when the user hasn't already typed anything.
    //
    // IMPORTANT: guard on BOTH isLoadingValues AND isFetchingValues.
    // With staleTime:0 + refetchOnMount:"always", React Query returns stale cache data
    // (empty string "") immediately while isFetching:true. Without the isFetching guard,
    // seededForRef gets set with the stale "" value; when the real 58KB YAML arrives
    // the ref already equals addonId and we return early — editor stays empty.
    useEffect(() => {
        if (isLoadingValues || isFetchingValues) return; // wait for the real network response
        if (seededForRef.current === addonId) return;    // already seeded for this addon
        if (typeof defaultValues !== "string") return;

        seededForRef.current = addonId;

        // Only auto-fill if the editor is still empty (preserve manual edits on re-render)
        if (!valuesYaml && defaultValues) {
            setValuesYaml(defaultValues);
            setYamlValidationError(validateYaml(defaultValues));
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addonId, defaultValues, isLoadingValues, isFetchingValues]);

    const handleChange = useCallback(
        (newValue: string) => {
            setValuesYaml(newValue);
            setYamlValidationError(validateYaml(newValue));
        },
        [setValuesYaml, setYamlValidationError]
    );

    const handleReset = useCallback(() => {
        const resetTo = defaultValues ?? "";
        setValuesYaml(resetTo);
        setYamlValidationError(validateYaml(resetTo));
    }, [defaultValues, setValuesYaml, setYamlValidationError]);

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
                            {(isLoadingValues || isFetchingValues)
                                ? "Loading chart defaults from Artifact Hub…"
                                : "Customize the installation by overriding default parameters."}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleReset}
                        disabled={isLoadingValues || isFetchingValues || !defaultValues}
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

            {/* Loading skeleton — shown while we're fetching values and editor is still empty */}
            {(isLoadingValues || isFetchingValues) && !valuesYaml && (
                <div className="flex-1 min-h-[400px] border rounded-xl overflow-hidden bg-muted/30 p-4 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-4/5" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-1/2" />
                </div>
            )}

            {/* Editor — shown once values are fully fetched (or if user already has content) */}
            {((!isLoadingValues && !isFetchingValues) || valuesYaml) && (
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
            )}

            {/* Fetch error banner with retry */}
            {isValuesError && (
                <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive py-3">
                    <ServerCrash className="h-4 w-4 shrink-0" />
                    <AlertDescription className="text-[12px] leading-snug font-medium flex items-center justify-between gap-3">
                        <span>Could not load chart defaults from Artifact Hub. You can still type values manually.</span>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { seededForRef.current = ""; refetchValues(); }}
                            disabled={isFetchingValues}
                            className="shrink-0 h-7 px-3 text-[11px] border-destructive/30 hover:bg-destructive/10"
                        >
                            <RotateCcw className={cn("h-3 w-3 mr-1.5", isFetchingValues && "animate-spin")} />
                            {isFetchingValues ? "Retrying…" : "Retry"}
                        </Button>
                    </AlertDescription>
                </Alert>
            )}

            {/* YAML validation error */}
            {yamlValidationError && (
                <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive py-3">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <AlertDescription className="text-[12px] leading-snug font-medium">
                        {yamlValidationError}
                    </AlertDescription>
                </Alert>
            )}

            {/* Info footer (shown only when no error) */}
            {!yamlValidationError && !isValuesError && (
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
