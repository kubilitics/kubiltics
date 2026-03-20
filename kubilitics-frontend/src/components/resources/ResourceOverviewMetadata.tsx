import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Info, Tags, FileText, GitBranch } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SectionCard } from './SectionCard';
import { getDetailPath } from '@/utils/resourceKindMapper';
import { cn } from '@/lib/utils';

const LABEL_COLORS = [
  'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
  'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
  'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
  'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30',
  'bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-500/30',
  'bg-lime-500/15 text-lime-700 dark:text-lime-300 border-lime-500/30',
  'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
  'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30',
  'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/30',
];

function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h << 5) - h + key.charCodeAt(i);
  return Math.abs(h);
}

const ANNOTATION_TRUNCATE_LEN = 80;

export interface ResourceOverviewMetadataProps {
  /** Resource metadata (name, namespace, uid, creationTimestamp, resourceVersion, labels, annotations, ownerReferences) */
  metadata: {
    name?: string;
    namespace?: string;
    uid?: string;
    creationTimestamp?: string;
    resourceVersion?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    ownerReferences?: Array<{ kind?: string; name?: string; uid?: string }>;
  };
  /** Optional relative created label (e.g. "2h ago") when creationTimestamp is not enough */
  createdLabel?: string;
  /** Current resource namespace for owner reference links (namespaced owners use this) */
  namespace?: string;
  /** Hide metadata grid when true (e.g. when shown elsewhere) */
  skipMetadataGrid?: boolean;
}

export function ResourceOverviewMetadata({
  metadata,
  createdLabel,
  namespace = '',
  skipMetadataGrid = false,
}: ResourceOverviewMetadataProps) {
  const navigate = useNavigate();
  const labels = metadata.labels ?? {};
  const annotations = metadata.annotations ?? {};
  const ownerRefs = metadata.ownerReferences ?? [];
  const labelEntries = Object.entries(labels);
  const annotationEntries = Object.entries(annotations);

  const createdDisplay = useMemo(() => {
    if (createdLabel) return createdLabel;
    if (metadata.creationTimestamp) return new Date(metadata.creationTimestamp).toLocaleString();
    return '—';
  }, [createdLabel, metadata.creationTimestamp]);

  const [expandedAnnotations, setExpandedAnnotations] = useState<Set<string>>(new Set());

  const toggleAnnotation = (key: string) => {
    setExpandedAnnotations((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {!skipMetadataGrid && (
        <SectionCard icon={Info} title="Metadata" tooltip="Name, namespace, UID, created, resource version">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground mb-1">Name</p>
              <p className="font-mono truncate" title={metadata.name}>{metadata.name ?? '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Namespace</p>
              <p className="font-mono truncate" title={metadata.namespace ?? 'Cluster-scoped'}>
                {metadata.namespace ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">UID</p>
              <p className="font-mono text-xs truncate" title={metadata.uid}>{metadata.uid ?? '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Created</p>
              <p className="font-mono text-xs truncate" title={metadata.creationTimestamp ?? ''}>{createdDisplay}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Resource Version</p>
              <p className="font-mono text-xs truncate" title={metadata.resourceVersion ?? ''}>
                {metadata.resourceVersion ?? '—'}
              </p>
            </div>
          </div>
        </SectionCard>
      )}

      <SectionCard icon={Tags} title="Labels" tooltip="Kubernetes labels">
        {labelEntries.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {labelEntries.map(([key, value]) => (
              <Badge
                key={key}
                variant="outline"
                className={cn('font-mono text-xs border', LABEL_COLORS[hashKey(key) % LABEL_COLORS.length])}
              >
                {key}={value}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No labels</p>
        )}
      </SectionCard>

      <SectionCard icon={FileText} title="Annotations" tooltip="Key-value annotations with expand">
        {annotationEntries.length > 0 ? (
          <div className="space-y-2">
            {annotationEntries.map(([key, value]) => {
              const strVal = String(value);
              const isLong = strVal.length > ANNOTATION_TRUNCATE_LEN;
              const expanded = expandedAnnotations.has(key);
              const displayVal = isLong && !expanded ? `${strVal.slice(0, ANNOTATION_TRUNCATE_LEN)}…` : strVal;
              return (
                <div
                  key={key}
                  className="flex flex-col gap-1 rounded-lg bg-muted/50 p-2 text-sm"
                >
                  <span className="font-mono text-muted-foreground text-xs">{key}</span>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-mono text-xs break-all whitespace-pre-wrap min-w-0">{displayVal}</p>
                    {isLong && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="shrink-0 h-7 text-xs"
                        onClick={() => toggleAnnotation(key)}
                      >
                        {expanded ? 'Collapse' : 'Expand'}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No annotations</p>
        )}
      </SectionCard>

      {ownerRefs.length > 0 && (
        <SectionCard icon={GitBranch} title="Owner References" tooltip="Parent resources">
          <div className="flex flex-wrap gap-2">
            {ownerRefs.map((ref, idx) => {
              const kind = ref.kind ?? 'Unknown';
              const name = ref.name ?? '—';
              const ns = namespace || '';
              const path = getDetailPath(kind, name, ns);
              return (
                <span key={ref.uid ?? idx}>
                  {path ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5 font-mono text-xs"
                      onClick={() => navigate(path)}
                    >
                      <GitBranch className="h-3.5 w-3.5" />
                      {kind} / {name}
                    </Button>
                  ) : (
                    <Badge variant="secondary" className="font-mono text-xs">
                      {kind} / {name}
                    </Badge>
                  )}
                </span>
              );
            })}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
