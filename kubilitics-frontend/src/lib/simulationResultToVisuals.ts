/**
 * simulationResultToVisuals — transforms a SimulationResult (API response)
 * into the typed data structures consumed by the simulation-visuals components.
 *
 * Wave mapping:
 *   Wave 0 = removed_nodes (direct impact — the things that were killed)
 *   Wave 1 = modified_nodes (directly degraded neighbours)
 *   Wave 2 = downstream affected services (inferred from lost_edges + affected_services count)
 *
 * Namespace grouping:
 *   Groups removed + modified + added nodes by namespace, producing NamespaceImpact[].
 *
 * Score dimensions:
 *   The backend returns aggregate health_before / health_after.
 *   We decompose into 8 canonical K8s health dimensions with heuristic weighting
 *   so the ScoreDeltaWaterfall has meaningful per-dimension bars.
 *
 * SPOF diff:
 *   Directly maps new_spofs, resolved_spofs, spofs_before, spofs_after.
 */
import type { SimulationResult, NodeInfo, NodeDiff } from '@/services/api/simulation';
import type {
  Wave,
  WaveResource,
  NamespaceImpact,
  ScoreDimension,
  SPOFDiff,
  SPOFEntry as VisualSPOFEntry,
} from '@/components/simulation-visuals/types';

/* ── Wave builder ──────────────────────────────────────────────────── */

function nodeInfoToWaveResource(n: NodeInfo, status: WaveResource['status']): WaveResource {
  return {
    name: n.name,
    kind: n.kind,
    namespace: n.namespace,
    score: n.health_score,
    status,
  };
}

function nodeDiffToWaveResource(n: NodeDiff): WaveResource {
  return {
    name: n.name,
    kind: n.kind,
    namespace: n.namespace,
    score: n.score_after,
    status: n.score_after === 0 ? 'unreachable' : 'degraded',
  };
}

export function buildWaves(result: SimulationResult): Wave[] {
  const waves: Wave[] = [];

  // Wave 0: directly removed resources
  if (result.removed_nodes.length > 0) {
    waves.push({
      depth: 0,
      label: 'Direct Impact',
      count: result.removed_nodes.length,
      resources: result.removed_nodes.map((n) => nodeInfoToWaveResource(n, 'removed')),
    });
  }

  // Wave 1: modified (degraded / unreachable neighbours)
  if (result.modified_nodes.length > 0) {
    waves.push({
      depth: 1,
      label: 'Degraded Neighbours',
      count: result.modified_nodes.length,
      resources: result.modified_nodes.map(nodeDiffToWaveResource),
    });
  }

  // Wave 2: downstream services affected via lost edges
  // The backend gives us `affected_services` as a count; we don't have
  // per-resource detail, so we synthesize a summary wave.
  const downstreamCount = Math.max(
    0,
    result.affected_services - result.removed_nodes.length - result.modified_nodes.length,
  );
  if (downstreamCount > 0 || result.lost_edges.length > 0) {
    const edgeResources: WaveResource[] = result.lost_edges
      .filter(
        (e) =>
          !result.removed_nodes.some((n) => n.key === e.target) &&
          !result.modified_nodes.some((n) => n.key === e.target),
      )
      .slice(0, 20) // cap for UI readability
      .map((e) => {
        const parts = e.target.split('/');
        return {
          name: parts[parts.length - 1] || e.target,
          kind: parts[0] || 'Unknown',
          namespace: parts.length > 1 ? parts[1] : 'default',
          score: 0,
          status: 'unreachable' as const,
        };
      });

    waves.push({
      depth: 2,
      label: 'Downstream Services',
      count: Math.max(downstreamCount, edgeResources.length),
      resources: edgeResources,
    });
  }

  // Wave 3: new SPOFs introduced (these are a separate risk wave)
  if (result.new_spofs.length > 0) {
    waves.push({
      depth: waves.length,
      label: 'New Single Points of Failure',
      count: result.new_spofs.length,
      resources: result.new_spofs.map((s) => ({
        name: s.name,
        kind: s.kind,
        namespace: s.namespace,
        score: 0,
        status: 'degraded' as const,
      })),
    });
  }

  return waves;
}

/* ── Namespace impact builder ──────────────────────────────────────── */

interface NsAccumulator {
  namespace: string;
  total: Set<string>;
  affected: Set<string>;
  removedCount: number;
  unreachableCount: number;
  degradedCount: number;
}

export function buildNamespaceImpacts(result: SimulationResult): NamespaceImpact[] {
  const map = new Map<string, NsAccumulator>();

  function getOrCreate(ns: string): NsAccumulator {
    let acc = map.get(ns);
    if (!acc) {
      acc = {
        namespace: ns,
        total: new Set(),
        affected: new Set(),
        removedCount: 0,
        unreachableCount: 0,
        degradedCount: 0,
      };
      map.set(ns, acc);
    }
    return acc;
  }

  // Count removed
  for (const n of result.removed_nodes) {
    const acc = getOrCreate(n.namespace);
    acc.total.add(n.key);
    acc.affected.add(n.key);
    acc.removedCount += 1;
  }

  // Count modified (degraded / unreachable)
  for (const n of result.modified_nodes) {
    const acc = getOrCreate(n.namespace);
    acc.total.add(n.key);
    acc.affected.add(n.key);
    if (n.score_after === 0) {
      acc.unreachableCount += 1;
    } else {
      acc.degradedCount += 1;
    }
  }

  // Count added (these are positive — not "affected" negatively but part of the ns)
  for (const n of result.added_nodes) {
    const acc = getOrCreate(n.namespace);
    acc.total.add(n.key);
  }

  // Derive health scores from the overall delta, proportionally distributed
  const overallDelta = result.health_before - result.health_after;
  const totalAffected = result.removed_nodes.length + result.modified_nodes.length;

  return Array.from(map.values()).map((acc) => {
    const nsAffectedCount = acc.removedCount + acc.unreachableCount + acc.degradedCount;
    const proportion = totalAffected > 0 ? nsAffectedCount / totalAffected : 0;
    const nsDelta = Math.round(overallDelta * proportion);

    return {
      namespace: acc.namespace,
      totalResources: Math.max(acc.total.size, nsAffectedCount),
      affectedResources: acc.affected.size,
      removedCount: acc.removedCount,
      unreachableCount: acc.unreachableCount,
      degradedCount: acc.degradedCount,
      healthScoreBefore: result.health_before,
      healthScoreAfter: Math.max(0, result.health_before - nsDelta),
    };
  });
}

/* ── Score dimensions builder ──────────────────────────────────────── */

/**
 * 8 canonical health dimensions for a Kubernetes cluster.
 * We heuristically distribute the overall health delta across dimensions
 * based on what kind of resources were affected.
 */
const DIMENSION_TEMPLATES: Array<{
  name: string;
  weight: number;
  /** Tags that indicate this dimension is affected */
  affectedByKinds: string[];
  /** Base sensitivity — how much this dimension is affected per unit of delta */
  sensitivity: number;
}> = [
  { name: 'Availability', weight: 20, affectedByKinds: ['Deployment', 'ReplicaSet', 'StatefulSet', 'Pod'], sensitivity: 1.0 },
  { name: 'Redundancy', weight: 15, affectedByKinds: ['Node', 'ReplicaSet', 'Deployment'], sensitivity: 0.9 },
  { name: 'Network', weight: 15, affectedByKinds: ['Service', 'Ingress', 'NetworkPolicy', 'Endpoints'], sensitivity: 0.8 },
  { name: 'Storage', weight: 10, affectedByKinds: ['PersistentVolumeClaim', 'PersistentVolume', 'StorageClass'], sensitivity: 0.6 },
  { name: 'Configuration', weight: 10, affectedByKinds: ['ConfigMap', 'Secret'], sensitivity: 0.4 },
  { name: 'Workload Health', weight: 15, affectedByKinds: ['Pod', 'Job', 'CronJob', 'DaemonSet'], sensitivity: 0.85 },
  { name: 'SPOF Risk', weight: 10, affectedByKinds: [], sensitivity: 0.7 },
  { name: 'Capacity', weight: 5, affectedByKinds: ['Node'], sensitivity: 0.5 },
];

export function buildScoreDimensions(result: SimulationResult): {
  dimensions: ScoreDimension[];
  totalBefore: number;
  totalAfter: number;
} {
  const totalBefore = result.health_before;
  const totalAfter = result.health_after;
  const totalDelta = totalBefore - totalAfter; // positive means health dropped

  // Collect all affected kinds
  const affectedKindCounts = new Map<string, number>();
  for (const n of result.removed_nodes) {
    affectedKindCounts.set(n.kind, (affectedKindCounts.get(n.kind) ?? 0) + 1);
  }
  for (const n of result.modified_nodes) {
    affectedKindCounts.set(n.kind, (affectedKindCounts.get(n.kind) ?? 0) + 1);
  }

  // Calculate raw impact per dimension
  const rawImpacts = DIMENSION_TEMPLATES.map((tmpl) => {
    let impact = 0;

    // Kind-based impact
    for (const kind of tmpl.affectedByKinds) {
      const count = affectedKindCounts.get(kind) ?? 0;
      impact += count * tmpl.sensitivity;
    }

    // SPOF Risk dimension gets special treatment
    if (tmpl.name === 'SPOF Risk') {
      impact += result.new_spofs.length * 2;
    }

    return { tmpl, impact };
  });

  // Normalize: distribute totalDelta proportionally across dimensions
  const totalRawImpact = rawImpacts.reduce((sum, r) => sum + r.impact, 0);

  const dimensions: ScoreDimension[] = rawImpacts.map(({ tmpl, impact }) => {
    const beforeScore = totalBefore > 0 ? Math.round(totalBefore * (tmpl.weight / 100)) : tmpl.weight;
    let dimensionDelta = 0;

    if (totalRawImpact > 0 && totalDelta > 0) {
      dimensionDelta = -Math.round(totalDelta * (impact / totalRawImpact) * (tmpl.weight / 100));
    } else if (totalDelta > 0) {
      // Even distribution when we can't determine kind-based impact
      dimensionDelta = -Math.round(totalDelta * (tmpl.weight / 100));
    }

    // Scale before/after to 0-100 for the bar visualization
    const scaledBefore = Math.min(100, Math.round((beforeScore / tmpl.weight) * 100));
    const scaledAfter = Math.max(0, Math.min(100, scaledBefore + dimensionDelta));

    return {
      name: tmpl.name,
      before: scaledBefore,
      after: scaledAfter,
      weight: tmpl.weight,
      delta: scaledAfter - scaledBefore,
    };
  });

  return { dimensions, totalBefore, totalAfter };
}

/* ── SPOF diff builder ─────────────────────────────────────────────── */

export function buildSPOFDiff(result: SimulationResult): SPOFDiff {
  const newSPOFs: VisualSPOFEntry[] = result.new_spofs.map((s) => ({
    name: s.name,
    namespace: s.namespace,
    fanIn: 1, // backend doesn't provide fan-in yet; default to 1
    blastRadius: 0, // backend doesn't provide blast radius yet; default to 0
    reason: s.reason,
  }));

  const resolvedSPOFs = result.resolved_spofs.map((s) => ({
    name: s.name,
    namespace: s.namespace,
    reason: s.reason,
  }));

  // Existing SPOFs = spofs_before - resolved + new would be spofs_after,
  // but "existing" means the ones that haven't changed.
  const existingCount = Math.max(0, result.spofs_before - result.resolved_spofs.length);
  const existingSPOFs: VisualSPOFEntry[] = [];
  // We don't have detailed info for existing SPOFs from the backend,
  // so we leave the array empty. The component handles this gracefully.

  return {
    beforeCount: result.spofs_before,
    afterCount: result.spofs_after,
    newSPOFs,
    resolvedSPOFs,
    existingSPOFs,
  };
}

/* ── Top-level transformer ─────────────────────────────────────────── */

export interface SimulationVisualData {
  waves: Wave[];
  namespaceImpacts: NamespaceImpact[];
  scoreDimensions: ScoreDimension[];
  totalScoreBefore: number;
  totalScoreAfter: number;
  spofDiff: SPOFDiff;
}

/**
 * Transforms a raw SimulationResult into all the data structures needed
 * by the simulation visual system components.
 */
export function simulationResultToVisuals(result: SimulationResult): SimulationVisualData {
  const waves = buildWaves(result);
  const namespaceImpacts = buildNamespaceImpacts(result);
  const { dimensions: scoreDimensions, totalBefore, totalAfter } = buildScoreDimensions(result);
  const spofDiff = buildSPOFDiff(result);

  return {
    waves,
    namespaceImpacts,
    scoreDimensions,
    totalScoreBefore: totalBefore,
    totalScoreAfter: totalAfter,
    spofDiff,
  };
}
