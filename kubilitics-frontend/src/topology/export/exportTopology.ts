import type { TopologyResponse, ViewMode } from "../types/topology";
import { EXPORT, CANVAS, getCategoryColor, STATUS_COLORS } from "../constants/designTokens";

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
  if (!viewport) throw new Error("No viewport element found");

  const { toPng } = await import("html-to-image");

  const bounds = computeNodeBounds(viewport);
  if (!bounds) throw new Error("No nodes found to export");

  const { minX, minY, maxX, maxY } = bounds;
  const contentW = maxX - minX;
  const contentH = maxY - minY;
  const padding = EXPORT.dynamicPadding(contentW, contentH);
  const captureWidth = Math.ceil(contentW + padding * 2);
  const captureHeight = Math.ceil(contentH + padding * 2);

  // At scale 1, nodes are full-size. Use 2x for retina. Clamp to browser canvas limits.
  const maxDim = Math.max(captureWidth, captureHeight);
  const pixelRatio = Math.min(EXPORT.pngPixelRatio, EXPORT.maxCanvasPixels / maxDim);

  // Wrap in timeout protection
  const capturePromise = toPng(viewport, {
    backgroundColor: EXPORT.backgroundColor,
    pixelRatio,
    width: captureWidth,
    height: captureHeight,
    quality: 1.0,
    style: {
      transform: `translate(${-minX + padding}px, ${-minY + padding}px) scale(1)`,
      transformOrigin: "top left",
    },
    filter: exportFilter,
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Export timed out")), EXPORT.timeoutMs)
  );

  const dataUrl = await Promise.race([capturePromise, timeoutPromise]);

  const link = document.createElement("a");
  link.download = filename;
  link.href = dataUrl;
  link.click();
}

// ─── SVG Export — same scale-1 approach ──────────────────────────────────────

export async function captureFullTopologySVG(
  filename: string
): Promise<void> {
  const viewport = document.querySelector(
    ".react-flow__viewport"
  ) as HTMLElement | null;
  if (!viewport) throw new Error("No viewport element found");

  const { toSvg } = await import("html-to-image");

  const bounds = computeNodeBounds(viewport);
  if (!bounds) throw new Error("No nodes found to export");

  const { minX, minY, maxX, maxY } = bounds;
  const contentW = maxX - minX;
  const contentH = maxY - minY;
  const padding = EXPORT.dynamicPadding(contentW, contentH);
  const captureWidth = Math.ceil(contentW + padding * 2);
  const captureHeight = Math.ceil(contentH + padding * 2);

  const capturePromise = toSvg(viewport, {
    backgroundColor: EXPORT.backgroundColor,
    width: captureWidth,
    height: captureHeight,
    style: {
      transform: `translate(${-minX + padding}px, ${-minY + padding}px) scale(1)`,
      transformOrigin: "top left",
    },
    filter: exportFilter,
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Export timed out")), EXPORT.timeoutMs)
  );

  const dataUrl = await Promise.race([capturePromise, timeoutPromise]);

  const link = document.createElement("a");
  link.download = filename;
  link.href = dataUrl;
  link.click();
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

  // Use centralized design tokens instead of inline duplicates
  const statusBorderColors = STATUS_COLORS;

  const getCategoryBg = (cat: string) => getCategoryColor(cat).bg;

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
    const fill = getCategoryBg(n.category);
    const border = statusBorderColors[n.status as keyof typeof statusBorderColors] ?? "#9ca3af";

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
