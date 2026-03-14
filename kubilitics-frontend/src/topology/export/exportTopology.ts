import type { TopologyResponse, ViewMode } from "../types/topology";
import { EXPORT, CANVAS, getCategoryColor, STATUS_COLORS } from "../constants/designTokens";

// ─── Export bounds — computed from React Flow state or DOM ──────────────────

export interface ExportBounds {
  minX: number; minY: number; maxX: number; maxY: number;
}

// ─── Export context for dynamic filenames ─────────────────────────────────────

export interface ExportContext {
  viewMode?: ViewMode;
  selectedNamespaces?: Set<string>;
  clusterName?: string;
  /** Resource name for resource-scoped topology (e.g. "jenkins-0") */
  resourceName?: string;
  /** Resource kind for resource-scoped topology (e.g. "Pod") */
  resourceKind?: string;
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

  // For resource-scoped exports, use kind + resource name instead of generic view mode.
  // e.g. "docker-desktop-default-Pod-jenkins-0.png" instead of "docker-desktop-default-resource-<timestamp>.png"
  if (ctx?.resourceName) {
    if (ctx?.resourceKind) parts.push(ctx.resourceKind);
    parts.push(ctx.resourceName);
  } else if (ctx?.viewMode) {
    parts.push(ctx.viewMode);
  }

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

/**
 * DOM-based fallback for computing bounds. Handles both translate() and translate3d().
 * Prefer using React Flow's getNodes() and passing bounds from TopologyCanvas instead.
 */
function computeNodeBoundsFromDOM(viewport: HTMLElement): ExportBounds | null {
  const nodeEls = viewport.querySelectorAll(".react-flow__node");
  if (nodeEls.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  // Match both: translate(Xpx, Ypx) and translate3d(Xpx, Ypx, Zpx)
  const translateRe = /translate(?:3d)?\((-?[\d.]+)px,\s*(-?[\d.]+)px/;

  nodeEls.forEach((el) => {
    const node = el as HTMLElement;
    const style = node.style.transform || "";
    const match = style.match(translateRe);
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

// ─── Adaptive Export Scaling ─────────────────────────────────────────────────
//
// The core challenge: Topology content bounds can range from 2,000 px (small
// namespace) to 30,000+ px (default namespace with 300+ resources).
//
// Browser canvas has a hard limit of ~16,384 px per dimension. If we naively
// use scale(1) with pixelRatio 2, a 25,000 px wide topology would need
// 50,000 px — far beyond the limit. The pixelRatio would drop to 0.32,
// making everything blurry.
//
// SOLUTION: Adaptive scale factor.
// 1. Compute content bounds in flow coordinates (scale 1)
// 2. Pick a target output size (e.g., 8000x8000 max) that guarantees
//    pixelRatio >= 1.5 within browser limits
// 3. If content exceeds that, compute a scale factor < 1 to fit
// 4. Apply scale factor in the CSS transform (nodes still render at
//    their natural DOM size — the clone is scaled)
// 5. Always ensure pixelRatio >= 1.5 for crisp output

function computeExportParams(bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
  const contentW = bounds.maxX - bounds.minX;
  const contentH = bounds.maxY - bounds.minY;
  const padding = EXPORT.dynamicPadding(contentW, contentH);

  // Target: keep final pixel dimensions within browser canvas limit
  // with at least 1.5x pixel ratio for retina quality.
  // maxCanvasPixels = 16000, so at pixelRatio 1.5 → max dimension = 10666
  // We use 8000 as our comfortable target (gives us pixelRatio 2 headroom).
  const TARGET_MAX_DIM = 8000;
  const MIN_PIXEL_RATIO = 1.5;

  const rawWidth = contentW + padding * 2;
  const rawHeight = contentH + padding * 2;
  const rawMaxDim = Math.max(rawWidth, rawHeight);

  // If content fits within target at scale 1, use scale 1
  // Otherwise, shrink to fit
  let scale = 1;
  if (rawMaxDim > TARGET_MAX_DIM) {
    scale = TARGET_MAX_DIM / rawMaxDim;
  }

  const captureWidth = Math.ceil(rawWidth * scale);
  const captureHeight = Math.ceil(rawHeight * scale);
  const scaledPadding = padding * scale;

  // Compute best pixelRatio that stays within browser limits
  const maxDim = Math.max(captureWidth, captureHeight);
  const pixelRatio = Math.max(
    MIN_PIXEL_RATIO,
    Math.min(EXPORT.pngPixelRatio, EXPORT.maxCanvasPixels / maxDim)
  );

  return {
    scale,
    captureWidth,
    captureHeight,
    scaledPadding,
    pixelRatio,
    // For debug logging
    originalSize: `${Math.round(rawWidth)}x${Math.round(rawHeight)}`,
    exportSize: `${captureWidth}x${captureHeight}`,
    finalPixels: `${Math.round(captureWidth * pixelRatio)}x${Math.round(captureHeight * pixelRatio)}`,
  };
}

// ─── PNG Export — Adaptive quality capture ───────────────────────────────────

export async function captureFullTopologyPNG(
  filename: string,
  precomputedBounds?: ExportBounds
): Promise<void> {
  const viewport = document.querySelector(
    ".react-flow__viewport"
  ) as HTMLElement | null;
  if (!viewport) throw new Error("No viewport element found");

  const { toPng } = await import("html-to-image");

  // Prefer pre-computed bounds from React Flow state (always accurate).
  // Fall back to DOM parsing if not provided.
  const bounds = precomputedBounds ?? computeNodeBoundsFromDOM(viewport);
  if (!bounds) throw new Error("No nodes found to export");

  const params = computeExportParams(bounds);

  console.info(
    `[Export PNG] Content: ${params.originalSize}, Scale: ${params.scale.toFixed(3)}, ` +
    `Capture: ${params.exportSize}, PixelRatio: ${params.pixelRatio.toFixed(2)}, ` +
    `Final: ${params.finalPixels}`
  );

  const capturePromise = toPng(viewport, {
    backgroundColor: EXPORT.backgroundColor,
    pixelRatio: params.pixelRatio,
    width: params.captureWidth,
    height: params.captureHeight,
    quality: 1.0,
    style: {
      transform: `translate(${-bounds.minX * params.scale + params.scaledPadding}px, ${-bounds.minY * params.scale + params.scaledPadding}px) scale(${params.scale})`,
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

// ─── SVG Export — same adaptive approach ─────────────────────────────────────

export async function captureFullTopologySVG(
  filename: string,
  precomputedBounds?: ExportBounds
): Promise<void> {
  const viewport = document.querySelector(
    ".react-flow__viewport"
  ) as HTMLElement | null;
  if (!viewport) throw new Error("No viewport element found");

  const { toSvg } = await import("html-to-image");

  // Prefer pre-computed bounds from React Flow state (always accurate).
  const bounds = precomputedBounds ?? computeNodeBoundsFromDOM(viewport);
  if (!bounds) throw new Error("No nodes found to export");

  const params = computeExportParams(bounds);

  const capturePromise = toSvg(viewport, {
    backgroundColor: EXPORT.backgroundColor,
    width: params.captureWidth,
    height: params.captureHeight,
    style: {
      transform: `translate(${-bounds.minX * params.scale + params.scaledPadding}px, ${-bounds.minY * params.scale + params.scaledPadding}px) scale(${params.scale})`,
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
      const match = style.match(/translate(?:3d)?\((-?[\d.]+)px,\s*(-?[\d.]+)px/);
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
