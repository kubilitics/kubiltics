/**
 * GenerateReportButton — triggers resilience report generation and provides
 * a report preview with PDF download capability.
 *
 * Place this in the cluster overview or dashboard page.
 */
import { useState, useCallback } from 'react';
import { FileText, Download, Loader2, ChevronDown, ChevronUp, AlertTriangle, Shield, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useResilienceReport } from '@/hooks/useResilienceReport';
import { generateResiliencePDF } from '@/lib/generateResiliencePDF';
import type { ResilienceReport, Recommendation } from '@/services/api/reports';

interface GenerateReportButtonProps {
  clusterId: string | undefined;
}

export function GenerateReportButton({ clusterId }: GenerateReportButtonProps) {
  const { generate, data, isLoading, error, reset } = useResilienceReport(clusterId);
  const [showPreview, setShowPreview] = useState(false);

  const handleGenerate = useCallback(() => {
    reset();
    setShowPreview(true);
    generate('json');
  }, [generate, reset]);

  const handleDownloadPDF = useCallback(async () => {
    if (!data) return;
    await generateResiliencePDF(data);
  }, [data]);

  if (!clusterId) return null;

  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        size="sm"
        onClick={handleGenerate}
        disabled={isLoading}
        className="gap-2"
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <FileText className="h-4 w-4" />
        )}
        {isLoading ? 'Generating Report...' : 'Generate Resilience Report'}
      </Button>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
          Failed to generate report: {error.message}
        </div>
      )}

      {showPreview && data && (
        <ReportPreview
          report={data}
          onDownloadPDF={handleDownloadPDF}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
}

// ── Report Preview ──────────────────────────────────────────────────────────

interface ReportPreviewProps {
  report: ResilienceReport;
  onDownloadPDF: () => void;
  onClose: () => void;
}

function ReportPreview({ report, onDownloadPDF, onClose }: ReportPreviewProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>('summary');
  const exec = report.executive_summary;

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  return (
    <div className="border rounded-lg bg-card text-card-foreground shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <div>
            <h3 className="text-sm font-semibold">Resilience Report</h3>
            <p className="text-xs text-muted-foreground">
              {report.cluster_name} &mdash; {new Date(report.generated_at).toLocaleDateString()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onDownloadPDF} className="gap-1">
            <Download className="h-3.5 w-3.5" />
            Download PDF
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      {/* Executive Summary */}
      <CollapsibleSection
        title="Executive Summary"
        icon={<Activity className="h-4 w-4" />}
        isOpen={expandedSection === 'summary'}
        onToggle={() => toggleSection('summary')}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <MetricCard label="Health Score" value={`${Math.round(exec.health_score)}/100`} level={exec.health_level} />
          <MetricCard label="Total Workloads" value={String(exec.total_workloads)} />
          <MetricCard label="SPOFs" value={String(exec.total_spofs)} level={exec.critical_spofs > 0 ? 'critical' : 'low'} />
          <MetricCard label="Namespaces at Risk" value={String(exec.namespaces_at_risk)} level={exec.namespaces_at_risk > 0 ? 'high' : 'low'} />
        </div>
        <p className="text-sm text-muted-foreground">{exec.top_risk}</p>
      </CollapsibleSection>

      {/* SPOF Inventory */}
      <CollapsibleSection
        title={`Single Points of Failure (${report.spof_inventory.items.length})`}
        icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
        isOpen={expandedSection === 'spofs'}
        onToggle={() => toggleSection('spofs')}
      >
        {report.spof_inventory.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No single points of failure detected.</p>
        ) : (
          <div className="space-y-1">
            <div className="grid grid-cols-[1fr_80px_1fr] gap-2 text-xs font-medium text-muted-foreground pb-1 border-b">
              <span>Resource</span>
              <span>Blast Radius</span>
              <span>Remediation</span>
            </div>
            {report.spof_inventory.items.slice(0, 10).map((item, i) => (
              <div key={i} className="grid grid-cols-[1fr_80px_1fr] gap-2 text-xs py-1">
                <span className="font-mono truncate">{item.kind}/{item.namespace}/{item.name}</span>
                <span className="font-semibold">{item.blast_radius.toFixed(1)}%</span>
                <span className="text-muted-foreground truncate">{item.remediation}</span>
              </div>
            ))}
            {report.spof_inventory.items.length > 10 && (
              <p className="text-xs text-muted-foreground pt-1">
                ... and {report.spof_inventory.items.length - 10} more (see PDF for full list)
              </p>
            )}
          </div>
        )}
      </CollapsibleSection>

      {/* Risk Ranking */}
      <CollapsibleSection
        title={`Risk Ranking (${report.risk_ranking.namespaces.length} namespaces)`}
        icon={<Shield className="h-4 w-4 text-red-500" />}
        isOpen={expandedSection === 'risk'}
        onToggle={() => toggleSection('risk')}
      >
        {report.risk_ranking.namespaces.length === 0 ? (
          <p className="text-sm text-muted-foreground">No namespace risk data available.</p>
        ) : (
          <div className="space-y-1">
            {report.risk_ranking.namespaces.map((ns, i) => (
              <div key={i} className="flex items-center justify-between text-xs py-1">
                <span className="font-mono">{ns.namespace}</span>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{ns.spof_count} SPOFs</span>
                  <PriorityBadge level={ns.level} />
                  <span className="w-12 text-right font-semibold">{ns.risk_score.toFixed(0)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {/* Recommendations */}
      <CollapsibleSection
        title={`Recommendations (${report.recommendations.length})`}
        icon={<FileText className="h-4 w-4 text-blue-500" />}
        isOpen={expandedSection === 'recs'}
        onToggle={() => toggleSection('recs')}
      >
        {report.recommendations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recommendations at this time.</p>
        ) : (
          <div className="space-y-2">
            {report.recommendations.slice(0, 8).map((rec, i) => (
              <RecommendationCard key={i} rec={rec} />
            ))}
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function CollapsibleSection({
  title,
  icon,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b last:border-b-0">
      <button
        onClick={onToggle}
        className="flex items-center justify-between w-full px-4 py-2.5 text-sm font-medium hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          {title}
        </div>
        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {isOpen && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

function MetricCard({ label, value, level }: { label: string; value: string; level?: string }) {
  const colorClass = level === 'critical' || level === 'poor'
    ? 'text-red-500'
    : level === 'high' || level === 'fair'
      ? 'text-amber-500'
      : level === 'excellent' || level === 'good'
        ? 'text-green-500'
        : '';

  return (
    <div className="bg-muted/50 rounded-md px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold ${colorClass}`}>{value}</div>
    </div>
  );
}

function PriorityBadge({ level }: { level: string }) {
  const variant = level === 'critical'
    ? 'destructive' as const
    : level === 'high'
      ? 'default' as const
      : 'secondary' as const;

  return <Badge variant={variant} className="text-[10px] px-1.5 py-0">{level}</Badge>;
}

function RecommendationCard({ rec }: { rec: Recommendation }) {
  return (
    <div className="flex gap-2 text-xs">
      <PriorityBadge level={rec.priority} />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{rec.title}</div>
        <div className="text-muted-foreground mt-0.5">{rec.description}</div>
        {rec.impact && (
          <div className="text-muted-foreground mt-0.5 italic">Impact: {rec.impact}</div>
        )}
      </div>
    </div>
  );
}

