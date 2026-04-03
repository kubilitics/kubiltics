/**
 * GoldenTemplateConfig -- Configure and score golden templates.
 *
 * Route: /fleet/xray/templates
 *
 * Provides a form to create/edit golden templates with threshold values,
 * and a scores table showing each cluster's match % and gap count.
 */
import { useState } from 'react';
import {
  Plus,
  Trash2,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Pencil,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useXRayTemplates,
  useCreateXRayTemplate,
  useUpdateXRayTemplate,
  useDeleteXRayTemplate,
  useXRayTemplateScores,
} from '@/hooks/useFleetXray';
import { useFleetXrayStore } from '@/stores/fleetXrayStore';
import type { GoldenTemplate, GoldenTemplateInput } from '@/services/api/fleetXray';

// ── Form Defaults ────────────────────────────────────────────────────────────

const EMPTY_FORM: GoldenTemplateInput = {
  name: '',
  description: '',
  min_health_score: 80,
  max_spofs: 0,
  min_pdb_coverage: 80,
  min_hpa_coverage: 60,
  min_netpol_coverage: 70,
  max_blast_radius: 15,
};

// ── Template Form ────────────────────────────────────────────────────────────

function TemplateForm({
  initial,
  onSubmit,
  onCancel,
  isSubmitting,
  submitLabel,
}: {
  initial: GoldenTemplateInput;
  onSubmit: (data: GoldenTemplateInput) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  submitLabel: string;
}) {
  const [form, setForm] = useState<GoldenTemplateInput>(initial);

  function update<K extends keyof GoldenTemplateInput>(key: K, value: GoldenTemplateInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(form);
  }

  const fields: Array<{ key: keyof GoldenTemplateInput; label: string; type: 'text' | 'number' }> = [
    { key: 'name', label: 'Template Name', type: 'text' },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'min_health_score', label: 'Min Health Score', type: 'number' },
    { key: 'max_spofs', label: 'Max SPOFs', type: 'number' },
    { key: 'min_pdb_coverage', label: 'Min PDB Coverage (%)', type: 'number' },
    { key: 'min_hpa_coverage', label: 'Min HPA Coverage (%)', type: 'number' },
    { key: 'min_netpol_coverage', label: 'Min NetPol Coverage (%)', type: 'number' },
    { key: 'max_blast_radius', label: 'Max Blast Radius (%)', type: 'number' },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {fields.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{f.label}</label>
            <Input
              type={f.type}
              value={form[f.key]}
              onChange={(e) =>
                update(
                  f.key,
                  f.type === 'number' ? Number(e.target.value) : e.target.value as never,
                )
              }
              className="h-9"
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" size="sm" disabled={isSubmitting || !form.name.trim()}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function GoldenTemplateConfig() {
  const templatesQuery = useXRayTemplates();
  const createMutation = useCreateXRayTemplate();
  const updateMutation = useUpdateXRayTemplate();
  const deleteMutation = useDeleteXRayTemplate();

  const activeTemplateId = useFleetXrayStore((s) => s.activeTemplateId);
  const setActiveTemplateId = useFleetXrayStore((s) => s.setActiveTemplateId);

  const scoresQuery = useXRayTemplateScores(activeTemplateId);

  const [showForm, setShowForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<GoldenTemplate | null>(null);

  const templates = templatesQuery.data ?? [];
  const scores = scoresQuery.data?.scores ?? [];

  function handleCreate(data: GoldenTemplateInput) {
    createMutation.mutate(data, {
      onSuccess: () => setShowForm(false),
    });
  }

  function handleUpdate(data: GoldenTemplateInput) {
    if (!editingTemplate) return;
    updateMutation.mutate(
      { id: editingTemplate.id, input: data },
      { onSuccess: () => setEditingTemplate(null) },
    );
  }

  function handleDelete(id: string) {
    deleteMutation.mutate(id, {
      onSuccess: () => {
        if (activeTemplateId === id) setActiveTemplateId(null);
      },
    });
  }

  if (templatesQuery.isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Golden Templates</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Define target health thresholds and score your fleet against them
          </p>
        </div>
        <Button size="sm" onClick={() => { setShowForm(true); setEditingTemplate(null); }}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Template
        </Button>
      </div>

      {/* Create form */}
      {showForm && !editingTemplate && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-3">Create Golden Template</h3>
            <TemplateForm
              initial={EMPTY_FORM}
              onSubmit={handleCreate}
              onCancel={() => setShowForm(false)}
              isSubmitting={createMutation.isPending}
              submitLabel="Create Template"
            />
          </CardContent>
        </Card>
      )}

      {/* Edit form */}
      {editingTemplate && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-3">Edit: {editingTemplate.name}</h3>
            <TemplateForm
              initial={{
                name: editingTemplate.name,
                description: editingTemplate.description,
                min_health_score: editingTemplate.min_health_score,
                max_spofs: editingTemplate.max_spofs,
                min_pdb_coverage: editingTemplate.min_pdb_coverage,
                min_hpa_coverage: editingTemplate.min_hpa_coverage,
                min_netpol_coverage: editingTemplate.min_netpol_coverage,
                max_blast_radius: editingTemplate.max_blast_radius,
              }}
              onSubmit={handleUpdate}
              onCancel={() => setEditingTemplate(null)}
              isSubmitting={updateMutation.isPending}
              submitLabel="Save Changes"
            />
          </CardContent>
        </Card>
      )}

      {/* Templates list */}
      {templates.length === 0 && !showForm && (
        <div className="rounded-xl border border-dashed border-border/60 p-12 text-center">
          <ShieldCheck className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            No golden templates yet. Create one to start scoring your fleet.
          </p>
        </div>
      )}

      {templates.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((t) => (
            <Card
              key={t.id}
              className={cn(
                'border shadow-sm cursor-pointer transition-all hover:shadow-md',
                activeTemplateId === t.id
                  ? 'border-primary/50 ring-2 ring-primary/20'
                  : 'border-border/50',
              )}
              onClick={() => setActiveTemplateId(activeTemplateId === t.id ? null : t.id)}
            >
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold truncate">{t.name}</h4>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="p-1 rounded hover:bg-muted transition-colors"
                      onClick={(e) => { e.stopPropagation(); setEditingTemplate(t); setShowForm(false); }}
                      title="Edit template"
                    >
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                      onClick={(e) => { e.stopPropagation(); handleDelete(t.id); }}
                      title="Delete template"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </button>
                  </div>
                </div>
                {t.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{t.description}</p>
                )}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
                  <span>Health: {'>='}{t.min_health_score}</span>
                  <span>SPOFs: {'<='}{t.max_spofs}</span>
                  <span>PDB: {'>='}{t.min_pdb_coverage}%</span>
                  <span>HPA: {'>='}{t.min_hpa_coverage}%</span>
                  <span>NetPol: {'>='}{t.min_netpol_coverage}%</span>
                  <span>Blast: {'<='}{t.max_blast_radius}%</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Scores table */}
      {activeTemplateId && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-0">
            <div className="p-4 border-b border-border/50">
              <h3 className="text-sm font-semibold">
                Cluster Scores{scoresQuery.data ? ` -- ${scoresQuery.data.template_name}` : ''}
              </h3>
            </div>

            {scoresQuery.isLoading && (
              <div className="p-4 space-y-2">
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
              </div>
            )}

            {scoresQuery.isError && (
              <div className="p-6 text-center">
                <AlertTriangle className="h-6 w-6 text-red-500 mx-auto mb-2" />
                <p className="text-sm text-red-600 dark:text-red-400">Failed to load scores.</p>
              </div>
            )}

            {scores.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="p-3 text-left font-medium text-muted-foreground">Cluster</th>
                      <th className="p-3 text-right font-medium text-muted-foreground">Match %</th>
                      <th className="p-3 text-right font-medium text-muted-foreground">Gaps</th>
                      <th className="p-3 text-left font-medium text-muted-foreground">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scores.map((s) => (
                      <tr key={s.cluster_id} className="border-b border-border/30 hover:bg-muted/40 transition-colors">
                        <td className="p-3 font-medium">{s.cluster_name}</td>
                        <td className="p-3 text-right">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold tabular-nums',
                              s.match_percent >= 90
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                : s.match_percent >= 70
                                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                  : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
                            )}
                          >
                            {s.match_percent >= 90 && <CheckCircle2 className="h-3 w-3" />}
                            {s.match_percent.toFixed(0)}%
                          </span>
                        </td>
                        <td className="p-3 text-right tabular-nums">{s.gap_count}</td>
                        <td className="p-3">
                          {s.gaps?.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {s.gaps.map((g, i) => (
                                <span
                                  key={i}
                                  className="text-[10px] bg-muted px-1.5 py-0.5 rounded"
                                >
                                  {g}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-emerald-600">All thresholds met</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!scoresQuery.isLoading && !scoresQuery.isError && scores.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No cluster scores available for this template.
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
