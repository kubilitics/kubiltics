import { useState, useCallback, type ReactNode } from 'react';
import { Trash2, RotateCcw, Scale, Tag, X, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
// Label dialog uses simple key=value input. For full label management, users go to resource detail page.

// ── Types ────────────────────────────────────────────────────────────────

/** Supported resource categories for determining which actions are available. */
export type BulkResourceType =
  | 'pods'
  | 'deployments'
  | 'statefulsets'
  | 'daemonsets'
  | 'services'
  | 'configmaps'
  | 'secrets'
  | 'replicasets'
  | 'jobs'
  | 'cronjobs'
  | string; // allow any k8s resource type

/** A single item result after a bulk operation attempt. */
export interface BulkOperationResult {
  key: string;
  success: boolean;
  error?: string;
}

/** Progress state for a running bulk operation. */
export interface BulkOperationProgress {
  /** Operation label, e.g. "Deleting" */
  label: string;
  /** Total items to process */
  total: number;
  /** Items processed so far */
  completed: number;
  /** Results collected so far */
  results: BulkOperationResult[];
}

export interface BulkActionBarProps {
  /** Number of selected items. Bar is hidden when 0. */
  selectedCount: number;
  /** Singular resource name for display (e.g. "pod", "deployment"). */
  resourceName: string;
  /** Resource type key — determines which action buttons appear. */
  resourceType: BulkResourceType;
  /** Deselect all callback. */
  onClearSelection: () => void;
  /** Bulk delete handler. Should return per-item results. */
  onBulkDelete?: () => Promise<BulkOperationResult[]>;
  /** Bulk restart handler (Deployments/StatefulSets/DaemonSets/Pods). */
  onBulkRestart?: () => Promise<BulkOperationResult[]>;
  /** Bulk scale handler (Deployments). Takes target replica count. */
  onBulkScale?: (replicas: number) => Promise<BulkOperationResult[]>;
  /** Bulk label handler. Takes key=value string to add to all selected resources. */
  onBulkLabel?: (label: string) => Promise<BulkOperationResult[]>;
  /** Extra action buttons to render alongside built-in ones. */
  children?: ReactNode;
}

// ── Helpers ──────────────────────────────────────────────────────────────

const RESTARTABLE: Set<string> = new Set([
  'pods',
  'deployments',
  'statefulsets',
  'daemonsets',
  'replicationcontrollers',
]);

const SCALABLE: Set<string> = new Set([
  'deployments',
  'statefulsets',
  'replicasets',
  'replicationcontrollers',
]);

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

// ── Component ────────────────────────────────────────────────────────────

export function BulkActionBar({
  selectedCount,
  resourceName,
  resourceType,
  onClearSelection,
  onBulkDelete,
  onBulkRestart,
  onBulkScale,
  onBulkLabel,
  children,
}: BulkActionBarProps) {
  const [progress, setProgress] = useState<BulkOperationProgress | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    action: 'delete' | 'restart' | 'scale' | 'label';
  }>({ open: false, action: 'delete' });
  const [scaleInput, setScaleInput] = useState('3');
  const [labelInput, setLabelInput] = useState('');
  const [lastResults, setLastResults] = useState<BulkOperationResult[] | null>(null);

  const canRestart = RESTARTABLE.has(resourceType) && !!onBulkRestart;
  const canScale = SCALABLE.has(resourceType) && !!onBulkScale;
  const canDelete = !!onBulkDelete;
  const canLabel = !!onBulkLabel;

  const isOperationRunning = progress !== null;

  const runOperation = useCallback(
    async (
      label: string,
      fn: () => Promise<BulkOperationResult[]>,
    ) => {
      setConfirmDialog({ open: false, action: 'delete' });
      setLastResults(null);
      setProgress({ label, total: selectedCount, completed: 0, results: [] });

      try {
        const results = await fn();
        setLastResults(results);
        const failures = results.filter((r) => !r.success);
        if (failures.length === 0) {
          onClearSelection();
        }
      } catch {
        // Unexpected error — show generic failure
        setLastResults([{ key: '*', success: false, error: 'Operation failed unexpectedly' }]);
      } finally {
        setProgress(null);
      }
    },
    [selectedCount, onClearSelection],
  );

  const handleConfirmAction = useCallback(async () => {
    switch (confirmDialog.action) {
      case 'delete':
        if (onBulkDelete) await runOperation('Deleting', onBulkDelete);
        break;
      case 'restart':
        if (onBulkRestart) await runOperation('Restarting', onBulkRestart);
        break;
      case 'scale': {
        const replicas = parseInt(scaleInput, 10);
        if (isNaN(replicas) || replicas < 0) return;
        if (onBulkScale) await runOperation('Scaling', () => onBulkScale(replicas));
        break;
      }
      case 'label': {
        if (!labelInput.includes('=') || !labelInput.trim()) return;
        if (onBulkLabel) await runOperation('Labeling', () => onBulkLabel(labelInput.trim()));
        break;
      }
    }
  }, [confirmDialog.action, onBulkDelete, onBulkRestart, onBulkScale, onBulkLabel, runOperation, scaleInput, labelInput]);

  const dismissResults = useCallback(() => setLastResults(null), []);

  const failures = lastResults?.filter((r) => !r.success) ?? [];
  const successes = lastResults?.filter((r) => r.success) ?? [];

  return (
    <>
      <AnimatePresence>
        {selectedCount > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 bg-background/95 backdrop-blur-lg border border-border shadow-2xl rounded-2xl"
            role="toolbar"
            aria-label={`Bulk actions for ${selectedCount} selected ${plural(selectedCount, resourceName)}`}
          >
            {/* Selected count badge */}
            <div className="flex items-center gap-2 pr-3 border-r border-border">
              <span className="inline-flex items-center justify-center h-7 min-w-[1.75rem] px-2 rounded-lg bg-primary text-primary-foreground text-sm font-bold tabular-nums">
                {selectedCount}
              </span>
              <span className="text-sm font-medium text-foreground whitespace-nowrap">
                {plural(selectedCount, resourceName)} selected
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearSelection}
                className="h-7 w-7 p-0 rounded-lg hover:bg-destructive/10 hover:text-destructive"
                aria-label="Clear selection"
                disabled={isOperationRunning}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Progress indicator */}
            {progress && (
              <div className="flex items-center gap-2 pr-3 border-r border-border">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  {progress.label}...
                </span>
              </div>
            )}

            {/* Result summary */}
            {lastResults && !progress && (
              <div className="flex items-center gap-2 pr-3 border-r border-border">
                {failures.length === 0 ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <span className="text-sm text-emerald-600 whitespace-nowrap">
                      {successes.length} succeeded
                    </span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <span className="text-sm text-amber-600 whitespace-nowrap">
                      {failures.length} failed, {successes.length} succeeded
                    </span>
                  </>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={dismissResults}
                  className="h-6 w-6 p-0 rounded-md"
                  aria-label="Dismiss results"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              {canRestart && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setConfirmDialog({ open: true, action: 'restart' })}
                  disabled={isOperationRunning}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Restart
                </Button>
              )}
              {canScale && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setConfirmDialog({ open: true, action: 'scale' })}
                  disabled={isOperationRunning}
                >
                  <Scale className="h-3.5 w-3.5" />
                  Scale
                </Button>
              )}
              {canLabel && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setConfirmDialog({ open: true, action: 'label' })}
                  disabled={isOperationRunning}
                >
                  <Tag className="h-3.5 w-3.5" />
                  Label
                </Button>
              )}
              {children}
              {canDelete && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setConfirmDialog({ open: true, action: 'delete' })}
                  disabled={isOperationRunning}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirmation dialog */}
      <Dialog
        open={confirmDialog.open}
        onOpenChange={(open) => {
          if (!open) setConfirmDialog({ open: false, action: confirmDialog.action });
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirmDialog.action === 'delete' && `Delete ${selectedCount} ${plural(selectedCount, resourceName)}?`}
              {confirmDialog.action === 'restart' && `Restart ${selectedCount} ${plural(selectedCount, resourceName)}?`}
              {confirmDialog.action === 'scale' && `Scale ${selectedCount} ${plural(selectedCount, resourceName)}`}
              {confirmDialog.action === 'label' && `Label ${selectedCount} ${plural(selectedCount, resourceName)}`}
            </DialogTitle>
            <DialogDescription>
              {confirmDialog.action === 'delete' &&
                `This will permanently delete ${selectedCount} ${plural(selectedCount, resourceName)}. This action cannot be undone.`}
              {confirmDialog.action === 'restart' &&
                `This will restart ${selectedCount} ${plural(selectedCount, resourceName)} by updating the restart annotation.`}
              {confirmDialog.action === 'scale' &&
                'Set the target replica count for all selected resources.'}
              {confirmDialog.action === 'label' &&
                'Add a label to all selected resources. To manage existing labels, open the resource detail page.'}
            </DialogDescription>
          </DialogHeader>

          {confirmDialog.action === 'scale' && (
            <div className="py-2">
              <label className="text-sm font-medium text-foreground">Replicas</label>
              <Input
                type="number"
                min={0}
                value={scaleInput}
                onChange={(e) => setScaleInput(e.target.value)}
                className="mt-1.5"
                placeholder="e.g. 3"
              />
            </div>
          )}

          {confirmDialog.action === 'label' && (
            <div className="py-2">
              <label className="text-sm font-medium text-foreground">Label (key=value)</label>
              <Input
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                className="mt-1.5"
                placeholder="e.g. env=production"
              />
              <p className="text-xs text-muted-foreground mt-2">To manage or remove existing labels, open the resource detail page.</p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setConfirmDialog({ open: false, action: confirmDialog.action })}
            >
              Cancel
            </Button>
            <Button
              variant={confirmDialog.action === 'delete' ? 'destructive' : 'default'}
              onClick={handleConfirmAction}
              disabled={
                (confirmDialog.action === 'scale' && (isNaN(parseInt(scaleInput, 10)) || parseInt(scaleInput, 10) < 0)) ||
                (confirmDialog.action === 'label' && (!labelInput.includes('=') || !labelInput.trim()))
              }
            >
              {confirmDialog.action === 'delete' && 'Delete'}
              {confirmDialog.action === 'restart' && 'Restart'}
              {confirmDialog.action === 'scale' && 'Scale'}
              {confirmDialog.action === 'label' && 'Apply Label'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Failure detail dialog */}
      <Dialog open={failures.length > 0 && lastResults !== null && !progress} onOpenChange={(open) => { if (!open) dismissResults(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {failures.length} {plural(failures.length, 'item')} failed
            </DialogTitle>
            <DialogDescription>
              {successes.length} succeeded, {failures.length} failed.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-60 overflow-y-auto space-y-1.5 py-2">
            {failures.map((f) => (
              <div
                key={f.key}
                className="flex items-start gap-2 px-3 py-2 bg-destructive/5 border border-destructive/20 rounded-lg text-sm"
              >
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <span className="font-medium">{f.key}</span>
                  {f.error && <p className="text-muted-foreground text-xs mt-0.5">{f.error}</p>}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end pt-2">
            <Button variant="outline" onClick={dismissResults}>
              Dismiss
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Progress-aware bulk executor ─────────────────────────────────────────

/**
 * Utility to execute a bulk operation with per-item progress tracking.
 * Each item is processed sequentially so the progress bar advances smoothly.
 *
 * @param keys - Selected resource keys ("namespace/name")
 * @param operation - Async function to run per key. Should throw on failure.
 * @param onProgress - Optional callback to update external progress state.
 * @returns Array of per-item results.
 */
export async function executeBulkOperation(
  keys: string[],
  operation: (key: string, ns: string, name: string) => Promise<void>,
  onProgress?: (completed: number, total: number) => void,
): Promise<BulkOperationResult[]> {
  const results: BulkOperationResult[] = [];
  const total = keys.length;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const [ns, name] = key.split('/');
    try {
      await operation(key, ns, name);
      results.push({ key, success: true });
    } catch (err) {
      results.push({
        key,
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
    onProgress?.(i + 1, total);
  }

  return results;
}
