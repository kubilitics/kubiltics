/**
 * ResourceTopologyView — Resource-scoped topology using React Flow (xyflow).
 * Thin wrapper around ResourceTopologyV2View for backward compatibility.
 */
import { ResourceTopologyV2View } from '@/topology/ResourceTopologyV2View';

export interface ResourceTopologyViewProps {
  kind: string;
  namespace?: string | null;
  name?: string | null;
  sourceResourceType?: string;
  sourceResourceName?: string;
}

export function ResourceTopologyView({
  kind,
  namespace,
  name,
  sourceResourceType,
  sourceResourceName,
}: ResourceTopologyViewProps) {
  return (
    <ResourceTopologyV2View
      kind={kind}
      namespace={namespace}
      name={name}
      sourceResourceType={sourceResourceType}
      sourceResourceName={sourceResourceName}
    />
  );
}
