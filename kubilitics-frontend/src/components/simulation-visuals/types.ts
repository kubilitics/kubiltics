/**
 * TypeScript interfaces for all 6 simulation visual components.
 * Data contracts match the backend API responses defined in
 * specs/Simulation-Visual-System-Design.md.
 */

export interface WaveResource {
  name: string;
  kind: string;
  namespace: string;
  score: number;
  status: 'removed' | 'unreachable' | 'degraded';
}

export interface Wave {
  depth: number;
  label: string;
  count: number;
  resources: WaveResource[];
}

export interface NamespaceImpact {
  namespace: string;
  totalResources: number;
  affectedResources: number;
  removedCount: number;
  unreachableCount: number;
  degradedCount: number;
  healthScoreBefore: number;
  healthScoreAfter: number;
}

export interface ScoreDimension {
  name: string;
  before: number;
  after: number;
  weight: number;
  delta: number;
}

export interface SPOFEntry {
  name: string;
  namespace: string;
  fanIn: number;
  blastRadius: number;
  reason?: string;
}

export interface SPOFDiff {
  beforeCount: number;
  afterCount: number;
  newSPOFs: SPOFEntry[];
  resolvedSPOFs: Array<{ name: string; namespace: string; reason?: string }>;
  existingSPOFs: SPOFEntry[];
}

export interface ClusterDimension {
  name: string;
  clusterAValue: number;
  clusterBValue: number;
  delta: number;
}

export interface AutoPilotFinding {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  blastRadius: number;
  targetKind: string;
  targetNamespace: string;
  targetName: string;
  description: string;
}
