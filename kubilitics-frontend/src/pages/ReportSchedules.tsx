/**
 * T12: Report Schedules page.
 *
 * CRUD for recurring resilience report schedules with webhook delivery.
 * Schedules table + create/edit dialog with frequency, webhook URL/type, and enable toggle.
 */

import { useState, useCallback } from 'react';
import {
  CalendarClock,
  Plus,
  Pencil,
  Trash2,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCcw,
} from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { ConnectionRequiredBanner } from '@/components/layout/ConnectionRequiredBanner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  useReportSchedules,
  useCreateSchedule,
  useUpdateSchedule,
  useDeleteSchedule,
  useRunScheduleNow,
} from '@/hooks/useReportSchedules';
import type { ReportSchedule } from '@/services/api/schedules';

// ---- Helpers ----------------------------------------------------------------

const frequencyLabels: Record<string, string> = {
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  monthly: 'Monthly',
};

const webhookTypeLabels: Record<string, string> = {
  slack: 'Slack',
  teams: 'Teams',
  generic: 'Generic',
};

function formatDate(iso: string | undefined): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusBadge(status: string | undefined) {
  if (status === 'success') {
    return (
      <Badge variant="outline" className="border-emerald-500 text-emerald-600 dark:text-emerald-400 gap-1">
        <CheckCircle2 className="h-3 w-3" /> Success
      </Badge>
    );
  }
  if (status === 'failed') {
    return (
      <Badge variant="outline" className="border-red-500 text-red-600 dark:text-red-400 gap-1">
        <XCircle className="h-3 w-3" /> Failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-muted-foreground/40 text-muted-foreground gap-1">
      <Clock className="h-3 w-3" /> Pending
    </Badge>
  );
}

// ---- Form state -------------------------------------------------------------

interface ScheduleFormState {
  frequency: string;
  webhookUrl: string;
  webhookType: string;
  enabled: boolean;
}

const defaultForm: ScheduleFormState = {
  frequency: 'weekly',
  webhookUrl: '',
  webhookType: 'slack',
  enabled: true,
};

// ---- Component --------------------------------------------------------------

export default function ReportSchedules() {
  const { data: schedules, isLoading, error, refetch } = useReportSchedules();
  const createMutation = useCreateSchedule();
  const updateMutation = useUpdateSchedule();
  const deleteMutation = useDeleteSchedule();
  const runNowMutation = useRunScheduleNow();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ScheduleFormState>(defaultForm);

  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm(defaultForm);
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((s: ReportSchedule) => {
    setEditingId(s.id);
    setForm({
      frequency: s.frequency,
      webhookUrl: s.webhook_url,
      webhookType: s.webhook_type,
      enabled: s.enabled,
    });
    setDialogOpen(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.webhookUrl.trim()) {
      toast.error('Webhook URL is required');
      return;
    }
    try {
      if (editingId) {
        await updateMutation.mutateAsync({
          scheduleId: editingId,
          data: {
            frequency: form.frequency,
            webhook_url: form.webhookUrl,
            webhook_type: form.webhookType,
            enabled: form.enabled,
          },
        });
        toast.success('Schedule updated');
      } else {
        await createMutation.mutateAsync({
          frequency: form.frequency,
          webhook_url: form.webhookUrl,
          webhook_type: form.webhookType,
          enabled: form.enabled,
        });
        toast.success('Schedule created');
      }
      setDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save schedule');
    }
  }, [editingId, form, createMutation, updateMutation]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id);
      toast.success('Schedule deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete schedule');
    }
  }, [deleteMutation]);

  const handleRunNow = useCallback(async (id: string) => {
    try {
      await runNowMutation.mutateAsync(id);
      toast.success('Report execution queued');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to trigger report');
    }
  }, [runNowMutation]);

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="page-container" role="main" aria-label="Report Schedules">
      <div className="page-inner p-6 gap-6 flex flex-col">
        <ConnectionRequiredBanner />

        {/* Header */}
        <SectionOverviewHeader
          title="Report Schedules"
          description="Automated resilience reports delivered to your team on a recurring basis."
          icon={CalendarClock}
          onSync={() => refetch()}
          isSyncing={isLoading}
          showAiButton={false}
          extraActions={
            <Button onClick={openCreate} size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" /> New Schedule
            </Button>
          }
        />

        {/* Content */}
        <Card className="border-none soft-shadow glass-panel">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Configured Schedules</CardTitle>
          </CardHeader>
          <CardContent>
          {isLoading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading schedules...
            </div>
          )}

          {error && (
            <div className="text-center py-12">
              <p className="text-destructive mb-2">Failed to load schedules: {error.message}</p>
              <Button variant="outline" onClick={() => refetch()}>Retry</Button>
            </div>
          )}

          {!isLoading && !error && (!schedules || schedules.length === 0) && (
            <div className="text-center py-12 text-muted-foreground">
              <CalendarClock className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">
                No report schedules configured. Set up automated resilience reports to keep your team informed.
              </p>
              <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={openCreate}>
                <Plus className="h-4 w-4" /> Create your first schedule
              </Button>
            </div>
          )}

          {!isLoading && !error && schedules && schedules.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cluster</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead>Webhook</TableHead>
                  <TableHead>Next Run</TableHead>
                  <TableHead>Last Run</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map((s) => (
                  <TableRow key={s.id} className={cn(!s.enabled && 'opacity-50')}>
                    <TableCell className="font-mono text-xs">{s.cluster_id}</TableCell>
                    <TableCell>{frequencyLabels[s.frequency] ?? s.frequency}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="secondary" className="text-xs">
                          {webhookTypeLabels[s.webhook_type] ?? s.webhook_type}
                        </Badge>
                        <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                          {s.webhook_url}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{formatDate(s.next_run)}</TableCell>
                    <TableCell className="text-xs">{formatDate(s.last_run)}</TableCell>
                    <TableCell>{statusBadge(s.last_status)}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Run now"
                          onClick={() => handleRunNow(s.id)}
                          disabled={runNowMutation.isPending}
                        >
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Edit"
                          onClick={() => openEdit(s)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          title="Delete"
                          onClick={() => handleDelete(s.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Schedule' : 'New Report Schedule'}</DialogTitle>
            <DialogDescription>
              {editingId
                ? 'Update the schedule configuration below.'
                : 'Configure a recurring resilience report delivered via webhook.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {/* Frequency */}
            <div className="grid gap-1.5">
              <Label htmlFor="frequency">Frequency</Label>
              <Select value={form.frequency} onValueChange={(v) => setForm((f) => ({ ...f, frequency: v }))}>
                <SelectTrigger id="frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="biweekly">Biweekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Webhook URL */}
            <div className="grid gap-1.5">
              <Label htmlFor="webhook-url">Webhook URL</Label>
              <Input
                id="webhook-url"
                placeholder="https://hooks.slack.com/services/..."
                value={form.webhookUrl}
                onChange={(e) => setForm((f) => ({ ...f, webhookUrl: e.target.value }))}
              />
            </div>

            {/* Webhook Type */}
            <div className="grid gap-1.5">
              <Label htmlFor="webhook-type">Webhook Type</Label>
              <Select value={form.webhookType} onValueChange={(v) => setForm((f) => ({ ...f, webhookType: v }))}>
                <SelectTrigger id="webhook-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="slack">Slack</SelectItem>
                  <SelectItem value="teams">Teams</SelectItem>
                  <SelectItem value="generic">Generic</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Enabled Toggle */}
            <div className="flex items-center justify-between">
              <Label htmlFor="enabled">Enabled</Label>
              <Switch
                id="enabled"
                checked={form.enabled}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, enabled: checked }))}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving} className="gap-1.5">
              {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingId ? 'Save Changes' : 'Create Schedule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
