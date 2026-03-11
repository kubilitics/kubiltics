import type { TopologyResponse, ViewMode } from "../types/topology";

// ─── Export context for dynamic filenames ─────────────────────────────────────

export interface ExportContext {
  viewMode?: ViewMode;
  selectedNamespaces?: Set<string>;
  clusterName?: string;
}

export function buildExportFilename(ext: string, ctx?: ExportContext): string {
  const parts: string[] = [];

  if (ctx?.clusterName) parts.push(ctx.clusterName);

  if (ctx?.selectedNamespaces && ctx.selectedNamespaces.size > 0) {
    const nsList = Array.from(ctx.selectedNamespaces);
    if (nsList.length <= 3) {
      parts.push(nsList.join("-"));
    } else {
      parts.push(`${nsList.length}-namespaces`);
    }
  }

  if (ctx?.viewMode) parts.push(ctx.viewMode);

  // Timestamp for uniqueness across multiple exports
  const ts = Date.now();
  parts.push(String(ts));

  return `${parts.length > 1 ? parts.join("-") : `topology-${ts}`}.${ext}`;
}

// ─── JSON Export ──────────────────────────────────────────────────────────────

export function exportTopologyJSON(
  topology: TopologyResponse | null,
  ctx?: ExportContext
) {
  if (!topology) return;
  const blob = new Blob([JSON.stringify(topology, null, 2)], {
    type: "application/json",
  });
  downloadBlob(blob, buildExportFilename("json", ctx));
}

// ─── Shared filter: exclude minimap, controls, background from export ────────

function exportFilter(node: HTMLElement): boolean {
  const cn = node.className?.toString() ?? "";
  if (cn.includes("react-flow__minimap")) return false;
  if (cn.includes("react-flow__controls")) return false;
  if (cn.includes("react-flow__background")) return false;
  return true;
}

// ─── Compute content bounds from all nodes in flow coordinates ───────────────

function computeNodeBounds(viewport: HTMLElement): {
  minX: number; minY: number; maxX: number; maxY: number;
} | null {
  const nodeEls = viewport.querySelectorAll(".react-flow__node");
  if (nodeEls.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  nodeEls.forEach((el) => {
    const node = el as HTMLElement;
    const style = node.style.transform || "";
    const match = style.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
    if (match) {
      const x = parseFloat(match[1]);
      const y = parseFloat(match[2]);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + node.offsetWidth);
      maxY = Math.max(maxY, y + node.offsetHeight);
    }
  });

  return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

// ─── PNG Export — Full-quality capture at scale 1 ────────────────────────────
//
// Called from TopologyCanvas AFTER onlyRenderVisibleElements=false
// so ALL nodes exist in the DOM.
//
// KEY APPROACH: Instead of capturing at whatever zoom fitView sets (which
// makes nodes tiny for large topologies), we capture the .react-flow__viewport
// at SCALE 1 with a style override. This means:
// - Every node renders at its full CSS size (not zoomed down)
// - Capture dimensions = actual content bounds in flow coordinates
// - Result is a crisp, full-size image regardless of node count
//
// The html-to-image `style` option applies the override to the cloned element
// only — the actual DOM is never modified.

export async function captureFullTopologyPNG(
  filename: string
): Promise<void> {
  const viewport = document.querySelector(
    ".react-flow__viewport"
  ) as HTMLElement | null;
  if (!viewport) return;

  try {
    const { toPng } = await import("html-to-image");

    const bounds = computeNodeBounds(viewport);
    if (!bounds) return;

    const { minX, minY, maxX, maxY } = bounds;
    const padding = 80; // generous padding for edges curving outside nodes
    const captureWidth = Math.ceil(maxX - minX + padding * 2);
    const captureHeight = Math.ceil(maxY - minY + padding * 2);

    // pixelRatio: at scale 1, nodes are already full-size.
    // Use 2x for retina-quality. Clamp if canvas would exceed browser limits.
    const maxDim = Math.max(captureWidth, captureHeight);
    const pixelRatio = Math.min(2, 16000 / maxDim);

    const dataUrl = await toPng(viewport, {
      backgroundColor: "#f8f9fb",
      pixelRatio,
      width: captureWidth,
      height: captureHeight,
      quality: 1.0,
      style: {
        // Override viewport transform: render at scale 1, positioned so
        // the top-left-most node sits at (padding, padding)
        transform: `translate(${-minX + padding}px, ${-minY + padding}px) scale(1)`,
        transformOrigin: "top left",
      },
      filter: exportFilter,
    });

    const link = document.createElement("a");
    link.download = filename;
    link.href = dataUrl;
    link.click();
  } catch (err) {
    console.error("PNG export failed:", err);
  }
}

// ─── SVG Export — same scale-1 approach ──────────────────────────────────────

export async function captureFullTopologySVG(
  filename: string
): Promise<void> {
  const viewport = document.querySelector(
    ".react-flow__viewport"
  ) as HTMLElement | null;
  if (!viewport) return;

  try {
    const { toSvg } = await import("html-to-image");

    const bounds = computeNodeBounds(viewport);
    if (!bounds) return;

    const { minX, minY, maxX, maxY } = bounds;
    const padding = 80;
    const captureWidth = Math.ceil(maxX - minX + padding * 2);
    const captureHeight = Math.ceil(maxY - minY + padding * 2);

    const dataUrl = await toSvg(viewport, {
      backgroundColor: "#f8f9fb",
      width: captureWidth,
      height: captureHeight,
      style: {
        transform: `translate(${-minX + padding}px, ${-minY + padding}px) scale(1)`,
        transformOrigin: "top left",
      },
      filter: exportFilter,
    });

    const link = document.createElement("a");
    link.download = filename;
    link.href = dataUrl;
    link.click();
  } catch (err) {
    console.error("SVG export failed:", err);
  }
}

// ─── Draw.io Export — Uses actual topology positions and edges ─────────────────

export function exportTopologyDrawIO(
  topology: TopologyResponse | null,
  ctx?: ExportContext
) {
  if (!topology) return;

  const viewport = document.querySelector(".react-flow__viewport");
  const positionMap = new Map<
    string,
    { x: number; y: number; w: number; h: number }
  >();

  if (viewport) {
    const nodeElements = viewport.querySelectorAll(".react-flow__node");
    nodeElements.forEach((el) => {
      const node = el as HTMLElement;
      const id = node.getAttribute("data-id");
      if (!id) return;
      const style = node.style.transform || "";
      const match = style.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
      if (match) {
        positionMap.set(id, {
          x: parseFloat(match[1]),
          y: parseFloat(match[2]),
          w: node.offsetWidth || 230,
          h: node.offsetHeight || 100,
        });
      }
    });
  }

  const statusBorderColors: Record<string, string> = {
    healthy: "#059669",
    warning: "#d97706",
    error: "#dc2626",
    unknown: "#9ca3af",
  };

  const categoryColors: Record<string, string> = {
    compute: "#dbeafe",
    networking: "#ede9fe",
    config: "#fef3c7",
    storage: "#cffafe",
    security: "#ffe4e6",
    scheduling: "#f3f4f6",
    scaling: "#dcfce7",
    custom: "#f1f5f9",
  };

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile>
<diagram name="Kubilitics Topology" id="topology">
<mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="1100" pageHeight="850" math="0" shadow="0">
<root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
`;

  topology.nodes.forEach((n, i) => {
    const pos = positionMap.get(n.id);
    const x = pos?.x ?? (i % 6) * 280;
    const y = pos?.y ?? Math.floor(i / 6) * 160;
    const w = pos?.w ?? 230;
    const h = pos?.h ?? 100;
    const fill = categoryColors[n.category] ?? "#ffffff";
    const border = statusBorderColors[n.status] ?? "#9ca3af";

    const label = `${n.kind}&#xa;${n.name}${n.namespace ? "&#xa;(" + n.namespace + ")" : ""}`;
    xml += `<mxCell id="${escXml(n.id)}" value="${escXml(label)}" style="rounded=1;whiteSpace=wrap;html=0;fillColor=${fill};strokeColor=${border};strokeWidth=2;fontSize=11;fontFamily=Inter;align=left;verticalAlign=top;spacingLeft=8;spacingTop=6;" vertex="1" parent="1">
<mxGeometry x="${Math.round(x)}" y="${Math.round(y)}" width="${Math.round(w)}" height="${Math.round(h)}" as="geometry"/>
</mxCell>
`;
  });

  for (const e of topology.edges) {
    const label = e.label ? escXml(e.label) : "";
    xml += `<mxCell id="${escXml(e.id)}" value="${label}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#6b7280;strokeWidth=1;fontSize=9;fontColor=#6b7280;" edge="1" source="${escXml(e.source)}" target="${escXml(e.target)}" parent="1">
<mxGeometry relative="1" as="geometry"/>
</mxCell>
`;
  }

  xml += `</root>
</mxGraphModel>
</diagram>
</mxfile>`;

  const blob = new Blob([xml], { type: "application/xml" });
  downloadBlob(blob, buildExportFilename("drawio", ctx));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
