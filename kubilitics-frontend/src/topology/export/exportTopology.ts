import type { TopologyResponse } from "../types/topology";

/**
 * Export topology as JSON file download.
 */
export function exportTopologyJSON(topology: TopologyResponse | null, filename = "topology.json") {
  if (!topology) return;
  const blob = new Blob([JSON.stringify(topology, null, 2)], {
    type: "application/json",
  });
  downloadBlob(blob, filename);
}

/**
 * Export the React Flow canvas as PNG using html2canvas-like approach.
 * Captures the .react-flow__viewport element.
 */
export async function exportTopologyPNG(filename = "topology.png") {
  const viewport = document.querySelector(".react-flow__viewport") as HTMLElement | null;
  if (!viewport) return;

  try {
    // Dynamically import html-to-image
    const { toPng } = await import("html-to-image");
    const dataUrl = await toPng(viewport, {
      backgroundColor: "#ffffff",
      pixelRatio: 2,
      filter: (node: HTMLElement) => {
        // Exclude minimap and controls from export
        const className = node.className?.toString() ?? "";
        if (className.includes("react-flow__minimap")) return false;
        if (className.includes("react-flow__controls")) return false;
        return true;
      },
    });
    const link = document.createElement("a");
    link.download = filename;
    link.href = dataUrl;
    link.click();
  } catch {
    console.error("PNG export failed. Make sure html-to-image is installed.");
  }
}

/**
 * Export the React Flow canvas as SVG.
 */
export async function exportTopologySVG(filename = "topology.svg") {
  const viewport = document.querySelector(".react-flow__viewport") as HTMLElement | null;
  if (!viewport) return;

  try {
    const { toSvg } = await import("html-to-image");
    const dataUrl = await toSvg(viewport, {
      backgroundColor: "#ffffff",
      filter: (node: HTMLElement) => {
        const className = node.className?.toString() ?? "";
        if (className.includes("react-flow__minimap")) return false;
        if (className.includes("react-flow__controls")) return false;
        return true;
      },
    });
    const link = document.createElement("a");
    link.download = filename;
    link.href = dataUrl;
    link.click();
  } catch {
    console.error("SVG export failed. Make sure html-to-image is installed.");
  }
}

/**
 * Export topology as DrawIO XML for editing in draw.io/diagrams.net.
 */
export function exportTopologyDrawIO(topology: TopologyResponse | null, filename = "topology.drawio") {
  if (!topology) return;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile>
<diagram name="Topology" id="topology">
<mxGraphModel>
<root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
`;
  const categoryColors: Record<string, string> = {
    workload: "#dbeafe",
    networking: "#ede9fe",
    configuration: "#fef3c7",
    storage: "#cffafe",
    rbac: "#ffe4e6",
    cluster: "#f3f4f6",
    scaling: "#dcfce7",
    policy: "#ffedd5",
  };

  topology.nodes.forEach((n, i) => {
    const x = (i % 6) * 240;
    const y = Math.floor(i / 6) * 140;
    const fill = categoryColors[n.category] ?? "#ffffff";
    xml += `<mxCell id="${escXml(n.id)}" value="${escXml(n.kind + ': ' + n.name)}" style="rounded=1;fillColor=${fill};" vertex="1" parent="1">
<mxGeometry x="${x}" y="${y}" width="200" height="80" as="geometry"/>
</mxCell>
`;
  });

  for (const e of topology.edges) {
    xml += `<mxCell id="${escXml(e.id)}" value="${escXml(e.label)}" edge="1" source="${escXml(e.source)}" target="${escXml(e.target)}" parent="1">
<mxGeometry relative="1" as="geometry"/>
</mxCell>
`;
  }

  xml += `</root>
</mxGraphModel>
</diagram>
</mxfile>`;

  const blob = new Blob([xml], { type: "application/xml" });
  downloadBlob(blob, filename);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
