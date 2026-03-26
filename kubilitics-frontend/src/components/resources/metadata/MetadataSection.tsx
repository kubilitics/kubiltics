/**
 * MetadataSection — Composite component that renders a standard metadata block.
 *
 * Renders labels, annotations, taints (nodes), and tolerations (pods) in a
 * consistent order. This is the primary entry point for metadata rendering
 * on any resource detail page.
 *
 * Order (always the same):
 *   1. Labels
 *   2. Annotations
 *   3. Taints (nodes only)
 *   4. Tolerations (pods only)
 */

import { useNavigate } from 'react-router-dom';
import { Info, GitBranch } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SectionCard } from '../SectionCard';
import { getDetailPath } from '@/utils/resourceKindMapper';
import { LabelList } from './LabelList';
import { AnnotationList } from './AnnotationList';
import { TaintsList } from './TaintsList';
import { TolerationsList } from './TolerationsList';
import type { K8sMetadata, K8sTaint, K8sToleration, K8sOwnerReference } from './types';

export interface MetadataSectionProps {
  /** Resource metadata object (labels, annotations, ownerReferences, etc.). */
  metadata?: K8sMetadata;
  /** Show the metadata grid (name, namespace, UID, created, resourceVersion). Default: false. */
  showMetadataGrid?: boolean;
  /** Optional human-readable "Created" label (e.g. "2h ago"). */
  createdLabel?: string;
  /** Namespace for owner reference link resolution. */
  namespace?: string;
  /** Taints (nodes only) — pass node.spec.taints. */
  taints?: Array<{ key: string; value?: string; effect: string; timeAdded?: string }> | K8sTaint[];
  /** Tolerations (pods only) — pass pod.spec.tolerations. */
  tolerations?: Array<{
    key?: string; operator?: string; value?: string;
    effect?: string; tolerationSeconds?: number;
  }> | K8sToleration[];
  /** Maximum labels visible before "show more" (default: unlimited). */
  maxLabels?: number;
  /** Maximum annotations visible before "show more" (default: unlimited). */
  maxAnnotations?: number;
  /** Custom className. */
  className?: string;
}

export function MetadataSection({
  metadata,
  showMetadataGrid = false,
  createdLabel,
  namespace = '',
  taints,
  tolerations,
  maxLabels,
  maxAnnotations,
  className,
}: MetadataSectionProps) {
  const navigate = useNavigate();
  const labels = metadata?.labels ?? {};
  const annotations = metadata?.annotations ?? {};
  const ownerRefs = metadata?.ownerReferences ?? [];

  const createdDisplay = createdLabel
    ?? (metadata?.creationTimestamp ? new Date(metadata.creationTimestamp).toLocaleString() : '—');

  return (
    <div className={className ?? 'space-y-6'}>
      {/* 0. Metadata grid (optional) */}
      {showMetadataGrid && (
        <SectionCard icon={Info} title="Metadata" tooltip="Name, namespace, UID, created, resource version">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground mb-1">Name</p>
              <p className="font-mono truncate" title={metadata?.name}>{metadata?.name ?? '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Namespace</p>
              <p className="font-mono truncate" title={metadata?.namespace ?? 'Cluster-scoped'}>
                {metadata?.namespace ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">UID</p>
              <p className="font-mono text-xs truncate" title={metadata?.uid}>{metadata?.uid ?? '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Created</p>
              <p className="font-mono text-xs truncate" title={metadata?.creationTimestamp ?? ''}>
                {createdDisplay}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Resource Version</p>
              <p className="font-mono text-xs truncate" title={metadata?.resourceVersion ?? ''}>
                {metadata?.resourceVersion ?? '—'}
              </p>
            </div>
          </div>
        </SectionCard>
      )}

      {/* 1. Labels (always) */}
      <LabelList labels={labels} maxVisible={maxLabels} />

      {/* 2. Annotations (always) */}
      <AnnotationList annotations={annotations} maxVisible={maxAnnotations} />

      {/* 3. Taints (nodes only) */}
      {taints && taints.length > 0 && <TaintsList taints={taints} />}

      {/* 4. Tolerations (pods only) */}
      {tolerations && tolerations.length > 0 && <TolerationsList tolerations={tolerations} />}

      {/* 5. Owner References (if any) */}
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
                      className="gap-2 font-mono text-xs"
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
