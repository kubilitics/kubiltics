/**
 * RelationshipTab — Reusable tab component showing 1-hop resource relationships.
 *
 * Drop this into any resource detail page's tab list. It lazy-loads topology data
 * only when the tab becomes visible (controlled by the `active` prop).
 *
 * Features:
 * - Mini React Flow graph with incoming/center/outgoing layout
 * - Clickable nodes that navigate to the resource's detail page
 * - Edge labels showing relationship type (owns, selects, mounts, routes-to)
 * - Loading skeleton while data loads
 * - Graceful empty state with link to full topology page
 * - Full dark mode support
 * - Responsive sizing
 */
import { useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Network, Loader2, AlertCircle, ArrowRight, RotateCcw } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useResourceRelationships } from '@/hooks/useResourceRelationships';
import { RelationshipMiniGraph } from './RelationshipMiniGraph';
import { kindToRoutePath, isClusterScoped } from '@/utils/resourceKindMapper';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface RelationshipTabProps {
  /** Kubernetes resource kind, e.g. "Deployment" */
  kind: string;
  /** Resource name */
  name: string;
  /** Resource namespace (omit for cluster-scoped resources) */
  namespace?: string;
  /** Whether this tab is currently visible/selected — controls lazy loading */
  active: boolean;
  /** Optional CSS class name */
  className?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function RelationshipTab({
  kind,
  name,
  namespace,
  active,
  className,
}: RelationshipTabProps) {
  const navigate = useNavigate();

  const { data, isLoading, error, refetch } = useResourceRelationships({
    kind,
    name,
    namespace,
    enabled: active,
  });

  // Navigate to a resource detail page when a graph node is clicked
  const handleNodeClick = useCallback(
    (nodeKind: string, nodeName: string, nodeNamespace: string) => {
      const routeSegment = kindToRoutePath(nodeKind);
      if (isClusterScoped(nodeKind) || !nodeNamespace) {
        navigate(`/${routeSegment}/${nodeName}`);
      } else {
        navigate(`/${routeSegment}/${nodeNamespace}/${nodeName}`);
      }
    },
    [navigate],
  );

  // ── Loading skeleton ──
  if (isLoading) {
    return (
      <div className={`space-y-4 ${className ?? ''}`}>
        <div className="flex items-center gap-3">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-5 w-40" />
        </div>
        <Skeleton className="h-[280px] w-full rounded-lg" />
        <div className="flex gap-3">
          <Skeleton className="h-8 w-28 rounded-md" />
          <Skeleton className="h-8 w-28 rounded-md" />
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <Alert variant="destructive" className={className}>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <div className="space-y-2">
            <p>Failed to load relationships: {error.message}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  // ── Empty state ──
  if (!data || (data.incoming.length === 0 && data.outgoing.length === 0)) {
    return (
      <Card className={`p-8 ${className ?? ''}`}>
        <div className="text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
            <Network className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">No relationships detected</h3>
            <p className="text-sm text-muted-foreground mt-1">
              This resource has no incoming or outgoing relationships in the current cluster topology.
            </p>
          </div>
          <Link to="/topology">
            <Button variant="outline" size="sm" className="gap-2">
              View full topology
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </Card>
    );
  }

  // ── Main content ──
  const totalRelationships = data.incoming.length + data.outgoing.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`space-y-4 ${className ?? ''}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-blue-100 dark:bg-blue-900/50 rounded-lg">
            <Network className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Relationships</h3>
            <p className="text-xs text-muted-foreground">
              {totalRelationships} relationship{totalRelationships !== 1 ? 's' : ''} found
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {data.incoming.length > 0 && (
            <Badge variant="secondary" className="text-[10px] font-medium">
              {data.incoming.length} incoming
            </Badge>
          )}
          {data.outgoing.length > 0 && (
            <Badge variant="secondary" className="text-[10px] font-medium">
              {data.outgoing.length} outgoing
            </Badge>
          )}
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => refetch()} title="Refresh">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Mini graph */}
      <RelationshipMiniGraph
        centerKind={kind}
        centerName={name}
        centerCategory={data.centerCategory}
        centerStatus={data.centerStatus}
        incoming={data.incoming}
        outgoing={data.outgoing}
        onNodeClick={handleNodeClick}
      />

      {/* Relationship summary list */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Incoming */}
        {data.incoming.length > 0 && (
          <Card className="p-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Incoming
            </h4>
            <div className="space-y-1.5">
              {data.incoming.map((n, i) => (
                <button
                  key={`in-${i}-${n.kind}-${n.name}`}
                  onClick={() => handleNodeClick(n.kind, n.name, n.namespace)}
                  className="
                    w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left
                    text-xs hover:bg-muted/60 transition-colors
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
                  "
                >
                  <Badge variant="outline" className="text-[9px] font-mono shrink-0">
                    {n.kind}
                  </Badge>
                  <span className="truncate font-medium text-foreground">{n.name}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                    {n.type.replace(/_/g, '-')}
                  </span>
                </button>
              ))}
            </div>
          </Card>
        )}

        {/* Outgoing */}
        {data.outgoing.length > 0 && (
          <Card className="p-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Outgoing
            </h4>
            <div className="space-y-1.5">
              {data.outgoing.map((n, i) => (
                <button
                  key={`out-${i}-${n.kind}-${n.name}`}
                  onClick={() => handleNodeClick(n.kind, n.name, n.namespace)}
                  className="
                    w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left
                    text-xs hover:bg-muted/60 transition-colors
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
                  "
                >
                  <Badge variant="outline" className="text-[9px] font-mono shrink-0">
                    {n.kind}
                  </Badge>
                  <span className="truncate font-medium text-foreground">{n.name}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                    {n.type.replace(/_/g, '-')}
                  </span>
                </button>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* Footer link to full topology */}
      <div className="flex justify-end">
        <Link to="/topology" className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
          Open full topology view
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </motion.div>
  );
}
