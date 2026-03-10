import { useEffect, useMemo } from "react";
import {
  useNodesState,
  useEdgesState,
  type Edge,
  type Node,
} from "@xyflow/react";
import type { TopologyResponse } from "../types/topology";
import type { BaseNodeData } from "../nodes/BaseNode";
import type { LabeledEdgeData } from "../edges/LabeledEdge";

const LAYOUT_GAP_X = 280;
const LAYOUT_GAP_Y = 120;

// Converts topology API response to React Flow nodes with a simple layered grid layout.
function topologyToFlow(
  data: TopologyResponse | null
): { nodes: Node<BaseNodeData>[]; edges: Edge<LabeledEdgeData>[] } {
  if (!data?.nodes?.length) {
    return { nodes: [], edges: [] };
  }
  const byLayer = new Map<number, typeof data.nodes>();
  for (const n of data.nodes) {
    const layer = n.layer ?? 0;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer)!.push(n);
  }
  const layers = Array.from(byLayer.keys()).sort((a, b) => a - b);
  const nodes: Node<BaseNodeData>[] = [];
  layers.forEach((layer, col) => {
    const list = byLayer.get(layer)!;
    list.forEach((tn, row) => {
      nodes.push({
        id: tn.id,
        type: "base",
        position: { x: col * LAYOUT_GAP_X, y: row * LAYOUT_GAP_Y },
        data: {
          kind: tn.kind,
          name: tn.name,
          namespace: tn.namespace || undefined,
          category: tn.category,
          status:
            tn.status === "healthy" || tn.status === "Ready" || tn.status === "Running"
              ? "healthy"
              : tn.status === "Pending" || tn.status === "Warning"
                ? "warning"
                : "error",
          statusReason: tn.statusReason ?? tn.status,
        },
      });
    });
  });
  const edges: Edge<LabeledEdgeData>[] = (data.edges ?? []).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "labeled",
    data: { label: e.label, detail: e.detail },
  }));
  return { nodes, edges };
}

export function useTopologyLayout(topology: TopologyResponse | null) {
  const { nodes: flowNodes, edges: flowEdges } = useMemo(
    () => topologyToFlow(topology),
    [topology]
  );
  const [nodes, setNodes, onNodesChange] =
    useNodesState<Node<BaseNodeData>>(flowNodes);
  const [edges, setEdges, onEdgesChange] =
    useEdgesState<Edge<LabeledEdgeData>>(flowEdges);

  useEffect(() => {
    setNodes(flowNodes);
    setEdges(flowEdges);
  }, [flowNodes, flowEdges, setNodes, setEdges]);

  return {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect: () => {},
  };
}
