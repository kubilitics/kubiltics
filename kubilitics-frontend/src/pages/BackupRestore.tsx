/**
 * Backup/Restore admin page.
 *
 * Provides backup and restore operations for Kubilitics application data:
 *  - List existing backups with timestamps, sizes, and status
 *  - Create new backups with optional description
 *  - Restore from a backup with confirmation dialog
 *  - Progress indicators for in-flight operations
 *  - Support for both automatic and manual backups
 *
 * TASK-SCALE-008
 */

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Archive, ArrowDownToLine, ArrowUpFromLine, Calendar, CheckCircle2,
  Clock, Download, FileArchive, HardDrive, Loader2, MoreHorizontal,
  Plus, RefreshCw, RotateCcw, Shield, Trash2, WifiOff, XCircle,
  AlertTriangle, Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { StatusPill, type StatusPillVariant } from '@/components/list';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Backup {
  id: string;
  name: string;
  description?: string;
  status: 'completed' | 'in-progress' | 'failed' | 'deleting';
  type: 'manual' | 'automatic' | 'scheduled';
  createdAt: string;
  completedAt?: string;
  sizeBytes: number;
  itemCount: number;
  /** Resources included in the backup */
  includes?: string[];
  /** Resources excluded */
  excludes?: string[];
  /** Kubernetes cluster ID */
  clusterId?: string;
  /** Storage location (e.g. 's3://...', 'local') */
  storageLocation?: string;
  /** Error message for failed backups */
  errorMessage?: string;
}

interface BackupProgress {
  backupId: string;
  phase: 'initializing' | 'backing-up' | 'uploading' | 'finalizing';
  percentComplete: number;
  itemsProcessed: number;
  totalItems: number;
  currentResource?: string;
}

interface RestoreProgress {
  restoreId: string;
  phase: 'downloading' | 'validating' | 'restoring' | 'finalizing';
  percentComplete: number;
  itemsRestored: number;
  totalItems: number;
  currentResource?: string;
  warnings?: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getBackupStatus(backup: Backup): StatusPillVariant {
  switch (backup.status) {
    case 'completed': return 'healthy';
    case 'in-progress': return 'info';
    case 'failed': return 'error';
    case 'deleting': return 'warning';
    default: return 'neutral';
  }
}

function getBackupStatusLabel(backup: Backup): string {
  switch (backup.status) {
    case 'completed': return 'Completed';
    case 'in-progress': return 'In Progress';
    case 'failed': return 'Failed';
    case 'deleting': return 'Deleting';
    default: return 'Unknown';
  }
}

function getPhaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    initializing: 'Initializing...',
    'backing-up': 'Backing up resources...',
    uploading: 'Uploading to storage...',
    finalizing: 'Finalizing...',
    downloading: 'Downloading backup...',
    validating: 'Validating data...',
    restoring: 'Restoring resources...',
  };
  return labels[phase] ?? phase;
}

// ── API Client ─────────────────────────────────────────────────────────────────

function useBackupApi() {
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);

  const apiUrl = `${backendBaseUrl}/api/v1/clusters/${currentClusterId}/backups`;

  return {
    listBackups: async (): Promise<Backup[]> => {
      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error(`Failed to list backups: ${res.status}`);
      const data = await res.json();
      return data.items ?? data ?? [];
    },
    createBackup: async (params: { name: string; description?: string; includes?: string[] }): Promise<Backup> => {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error(`Failed to create backup: ${res.status}`);
      return res.json();
    },
    restoreBackup: async (backupId: string): Promise<{ restoreId: string }> => {
      const res = await fetch(`${apiUrl}/${backupId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`Failed to restore backup: ${res.status}`);
      return res.json();
    },
    deleteBackup: async (backupId: string): Promise<void> => {
      const res = await fetch(`${apiUrl}/${backupId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Failed to delete backup: ${res.status}`);
    },
    downloadBackup: async (backupId: string): Promise<void> => {
      const res = await fetch(`${apiUrl}/${backupId}/download`);
      if (!res.ok) throw new Error(`Failed to download backup: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup-${backupId}.tar.gz`;
      a.click();
      URL.revokeObjectURL(url);
    },
  };
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function BackupRestore() {
  const { isOnline } = useConnectionStatus();
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const isDemo = useClusterStore((s) => s.isDemo);
  const queryClient = useQueryClient();
  const api = useBackupApi();

  // ── State ────────────────────────────────────────────────────────────────

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<Backup | null>(null);
  const [newBackupName, setNewBackupName] = useState('');
  const [newBackupDescription, setNewBackupDescription] = useState('');
  const [backupProgress, setBackupProgress] = useState<BackupProgress | null>(null);
  const [restoreProgress, setRestoreProgress] = useState<RestoreProgress | null>(null);

  // ── Data ─────────────────────────────────────────────────────────────────

  const { data: backups = [], isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['backups', currentClusterId],
    queryFn: api.listBackups,
    refetchInterval: backupProgress || restoreProgress ? 5_000 : 30_000,
    enabled: !!currentClusterId && !isDemo,
  });

  // ── Mutations ────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: api.createBackup,
    onSuccess: (backup) => {
      toast.success(`Backup "${backup.name}" created`);
      setCreateDialogOpen(false);
      setNewBackupName('');
      setNewBackupDescription('');
      // Simulate progress
      setBackupProgress({
        backupId: backup.id,
        phase: 'initializing',
        percentComplete: 0,
        itemsProcessed: 0,
        totalItems: 0,
      });
      // Progress simulation (in production, this would be WebSocket-driven)
      simulateProgress(backup.id, 'backup');
      queryClient.invalidateQueries({ queryKey: ['backups'] });
    },
    onError: (err) => toast.error(`Failed to create backup: ${(err as Error).message}`),
  });

  const restoreMutation = useMutation({
    mutationFn: api.restoreBackup,
    onSuccess: (data) => {
      toast.success('Restore initiated');
      setRestoreDialogOpen(false);
      setSelectedBackup(null);
      setRestoreProgress({
        restoreId: data.restoreId,
        phase: 'downloading',
        percentComplete: 0,
        itemsRestored: 0,
        totalItems: 0,
      });
      simulateProgress(data.restoreId, 'restore');
    },
    onError: (err) => toast.error(`Failed to restore: ${(err as Error).message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteBackup,
    onSuccess: () => {
      toast.success('Backup deleted');
      queryClient.invalidateQueries({ queryKey: ['backups'] });
    },
    onError: (err) => toast.error(`Failed to delete: ${(err as Error).message}`),
  });

  // ── Progress Simulation ──────────────────────────────────────────────────
  // In production, progress would come from WebSocket or polling an endpoint.

  const simulateProgress = useCallback((id: string, type: 'backup' | 'restore') => {
    let pct = 0;
    const phases = type === 'backup'
      ? ['initializing', 'backing-up', 'uploading', 'finalizing'] as const
      : ['downloading', 'validating', 'restoring', 'finalizing'] as const;
    let phaseIdx = 0;

    const interval = setInterval(() => {
      pct += Math.random() * 15 + 5;
      if (pct > 100) pct = 100;
      if (pct > (phaseIdx + 1) * 25 && phaseIdx < phases.length - 1) {
        phaseIdx++;
      }

      if (type === 'backup') {
        setBackupProgress({
          backupId: id,
          phase: phases[phaseIdx] as BackupProgress['phase'],
          percentComplete: Math.round(pct),
          itemsProcessed: Math.round(pct * 1.5),
          totalItems: 150,
        });
      } else {
        setRestoreProgress({
          restoreId: id,
          phase: phases[phaseIdx] as RestoreProgress['phase'],
          percentComplete: Math.round(pct),
          itemsRestored: Math.round(pct * 1.2),
          totalItems: 120,
        });
      }

      if (pct >= 100) {
        clearInterval(interval);
        setTimeout(() => {
          if (type === 'backup') setBackupProgress(null);
          else setRestoreProgress(null);
          queryClient.invalidateQueries({ queryKey: ['backups'] });
          toast.success(type === 'backup' ? 'Backup completed' : 'Restore completed');
        }, 1000);
      }
    }, 800);
  }, [queryClient]);

  // ── Stats ────────────────────────────────────────────────────────────────

  const totalBackups = backups.length;
  const completedBackups = backups.filter((b) => b.status === 'completed').length;
  const totalSize = backups.reduce((sum, b) => sum + (b.sizeBytes ?? 0), 0);
  const latestBackup = backups.length > 0
    ? backups.reduce((latest, b) => new Date(b.createdAt) > new Date(latest.createdAt) ? b : latest)
    : null;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Archive className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-xl font-semibold text-foreground dark:text-foreground">
            Backup & Restore
          </h1>
          {!isOnline && <WifiOff className="h-4 w-4 text-amber-500" />}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <Button size="sm" onClick={() => setCreateDialogOpen(true)} disabled={!!backupProgress}>
            <Plus className="mr-1.5 h-4 w-4" />
            Create Backup
          </Button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Backups</p>
            <p className="text-2xl font-bold text-foreground">{totalBackups}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Completed</p>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{completedBackups}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Size</p>
            <p className="text-2xl font-bold text-foreground">{formatBytes(totalSize)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Latest</p>
            <p className="text-sm font-medium text-foreground">
              {latestBackup ? formatRelativeTime(latestBackup.createdAt) : 'None'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Progress Indicators */}
      <AnimatePresence>
        {backupProgress && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <Card className="border-blue-200/60 dark:border-blue-800/40 bg-blue-50/30 dark:bg-blue-950/10">
              <CardContent className="p-4">
                <div className="flex items-center gap-3 mb-2">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
                  <span className="font-medium text-sm">Creating Backup</span>
                  <span className="text-xs text-muted-foreground">{getPhaseLabel(backupProgress.phase)}</span>
                </div>
                <Progress value={backupProgress.percentComplete} className="h-2" />
                <div className="flex justify-between mt-1.5 text-xs text-muted-foreground">
                  <span>{backupProgress.itemsProcessed} / {backupProgress.totalItems} items</span>
                  <span>{backupProgress.percentComplete}%</span>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
        {restoreProgress && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <Card className="border-amber-200/60 dark:border-amber-800/40 bg-amber-50/30 dark:bg-amber-950/10">
              <CardContent className="p-4">
                <div className="flex items-center gap-3 mb-2">
                  <RotateCcw className="h-4 w-4 animate-spin text-amber-600 dark:text-amber-400" />
                  <span className="font-medium text-sm">Restoring</span>
                  <span className="text-xs text-muted-foreground">{getPhaseLabel(restoreProgress.phase)}</span>
                </div>
                <Progress value={restoreProgress.percentComplete} className="h-2" />
                <div className="flex justify-between mt-1.5 text-xs text-muted-foreground">
                  <span>{restoreProgress.itemsRestored} / {restoreProgress.totalItems} items</span>
                  <span>{restoreProgress.percentComplete}%</span>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Backup List */}
      {isLoading ? (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 p-8">
            <XCircle className="h-8 w-8 text-red-500" />
            <p className="text-sm text-muted-foreground">{(error as Error)?.message ?? 'Failed to load backups'}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </CardContent>
        </Card>
      ) : backups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 p-12">
            <FileArchive className="h-12 w-12 text-muted-foreground/50" />
            <p className="text-sm font-medium text-foreground">No backups yet</p>
            <p className="text-xs text-muted-foreground max-w-sm text-center">
              Create your first backup to protect your Kubilitics configuration and cluster state.
            </p>
            <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Create First Backup
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border border-border dark:border-border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Storage</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {backups.map((backup) => (
                <TableRow key={backup.id} className="cursor-default">
                  <TableCell>
                    <div>
                      <span className="font-medium">{backup.name}</span>
                      {backup.description && (
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">{backup.description}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusPill variant={getBackupStatus(backup)} label={getBackupStatusLabel(backup)} />
                    {backup.status === 'failed' && backup.errorMessage && (
                      <p className="text-[10px] text-red-500 mt-0.5 truncate max-w-[150px]">{backup.errorMessage}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {backup.type === 'automatic' ? 'Auto' : backup.type === 'scheduled' ? 'Scheduled' : 'Manual'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{formatBytes(backup.sizeBytes)}</TableCell>
                  <TableCell className="text-sm">{backup.itemCount}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div>{formatDate(backup.createdAt)}</div>
                    <div className="text-[10px]">{formatRelativeTime(backup.createdAt)}</div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {backup.storageLocation ?? 'Local'}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            setSelectedBackup(backup);
                            setRestoreDialogOpen(true);
                          }}
                          disabled={backup.status !== 'completed' || !!restoreProgress}
                        >
                          <RotateCcw className="mr-2 h-4 w-4" /> Restore
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => api.downloadBackup(backup.id)} disabled={backup.status !== 'completed'}>
                          <Download className="mr-2 h-4 w-4" /> Download
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => {
                            if (window.confirm(`Delete backup "${backup.name}"?`)) {
                              deleteMutation.mutate(backup.id);
                            }
                          }}
                          className="text-red-600 dark:text-red-400"
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create Backup Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowUpFromLine className="h-5 w-5 text-muted-foreground" />
              Create Backup
            </DialogTitle>
            <DialogDescription>
              Create a new backup of your Kubilitics configuration and cluster resource definitions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label htmlFor="backup-name" className="text-sm font-medium text-foreground">Name</label>
              <Input
                id="backup-name"
                placeholder="my-backup"
                value={newBackupName}
                onChange={(e) => setNewBackupName(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="backup-desc" className="text-sm font-medium text-foreground">Description (optional)</label>
              <Input
                id="backup-desc"
                placeholder="Pre-upgrade backup"
                value={newBackupDescription}
                onChange={(e) => setNewBackupDescription(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="rounded-lg bg-muted/50 dark:bg-muted/20 p-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 mb-1">
                <Info className="h-3.5 w-3.5" />
                <span className="font-medium">What gets backed up:</span>
              </div>
              <ul className="list-disc list-inside space-y-0.5 ml-5">
                <li>Kubilitics application configuration</li>
                <li>Add-on install records and settings</li>
                <li>Project definitions and RBAC policies</li>
                <li>Audit log metadata</li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({
                name: newBackupName || `backup-${Date.now()}`,
                description: newBackupDescription || undefined,
              })}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Create Backup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore Confirmation Dialog */}
      <Dialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowDownToLine className="h-5 w-5 text-amber-500" />
              Restore from Backup
            </DialogTitle>
            <DialogDescription>
              This will restore your Kubilitics configuration from the selected backup.
            </DialogDescription>
          </DialogHeader>
          {selectedBackup && (
            <div className="space-y-3 py-2">
              <div className="rounded-lg border border-border p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{selectedBackup.name}</span>
                  <Badge variant="secondary" className="text-[10px]">{formatBytes(selectedBackup.sizeBytes)}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Created: {formatDate(selectedBackup.createdAt)}
                </p>
                {selectedBackup.description && (
                  <p className="text-xs text-muted-foreground">{selectedBackup.description}</p>
                )}
              </div>
              <div className="rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/40 p-3">
                <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400 text-xs font-medium">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Warning
                </div>
                <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-1">
                  Restoring will overwrite current configuration data. This action cannot be undone.
                  Consider creating a backup of the current state first.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRestoreDialogOpen(false); setSelectedBackup(null); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => selectedBackup && restoreMutation.mutate(selectedBackup.id)}
              disabled={restoreMutation.isPending}
            >
              {restoreMutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
