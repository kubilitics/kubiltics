import type { TopologyResponse, ViewMode } from "../types/topology";

// ─── Export context for dynamic filenames ─────────────────────────────────────

export interface ExportContext {
  viewMode?: ViewMode;
  selectedNamespaces?: Set<string>;
  clusterId?: string;
}

function buildFilename(base: string, ext: string, ctx?: ExportContext): string {
  const parts: string[] = ["kubilitics-topology"];

  if (ctx?.clusterId) parts.push(ctx.clusterId);

  if (ctx?.selectedNamespaces && ctx.selectedNamespaces.size > 0) {
    const nsList = Array.from(ctx.selectedNamespaces);
    if (nsList.length <= 3) {
      parts.push(nsList.join("-"));
    } else {
      parts.push(`${nsList.length}-namespaces`);
    }
  }

  if (ctx?.viewMode) parts.push(ctx.viewMode);

  const date = new Date().toISOString().slice(0, 10);
  parts.push(date);

  return `${parts.join("-")}.${ext}`;
}

// ─── Helpers to compute full node bounds from DOM ─────────────────────────────

function computeNodeBounds(viewport: HTMLElement) {
  const nodeElements = viewport.querySelectorAll(".react-flow__node");
  if (nodeElements.length === 0) return null;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  nodeElements.forEach((el) => {
    const node = el as HTMLElement;
    const style = node.style.transform || "";
    const match = style.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
    if (match) {
      const x = parseFloat(match[1]);
      const y = parseFloat(match[2]);
      const w = node.offsetWidth;
      const h = node.offsetHeight;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    }
  });

  if (!isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
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
  downloadBlob(blob, buildFilename("topology", "json", ctx));
}

// ─── PNG Export — Full topology at high resolution ────────────────────────────

/**
 * Captures the FULL topology (all nodes, not just visible viewport) at high
 * resolution. Strategy: temporarily adjust the container and viewport transform
 * to show all content at scale 1, render at 4x pixel ratio for crisp zoom.
 */
export async function exportTopologyPNG(ctx?: ExportContext) {
  const container = document.querySelector(".react-flow") as HTMLElement | null;
  const viewport = document.querySelector(
    ".react-flow__viewport"
  ) as HTMLElement | null;
  if (!container || !viewport) return;

  try {
    const { toPng } = await import("html-to-image");

    const bounds = computeNodeBounds(viewport);
    if (!bounds) return;

    const padding = 60;
    const fullWidth = bounds.maxX - bounds.minX + padding * 2;
    const fullHeight = bounds.maxY - bounds.minY + padding * 2;

    // Save original styles
    const origTransform = viewport.style.transform;
    const origContainerWidth = container.style.width;
    const origContainerHeight = container.style.height;
    const origContainerOverflow = container.style.overflow;
    const origContainerPosition = container.style.position;

    // Temporarily resize container & reset viewport transform to show all nodes
    container.style.width = `${fullWidth}px`;
    container.style.height = `${fullHeight}px`;
    container.style.overflow = "visible";
    container.style.position = "relative";
    viewport.style.transform = `translate(${-bounds.minX + padding}px, ${-bounds.minY + padding}px) scale(1)`;

    await new Promise((r) => setTimeout(r, 80));

    const dataUrl = await toPng(container, {
      backgroundColor: "#f8f9fb",
      width: fullWidth,
      height: fullHeight,
      pixelRatio: 4, // High resolution — crisp even when zoomed in
      style: {
        width: `${fullWidth}px`,
        height: `${fullHeight}px`,
      },
      filter: (node: HTMLElement) => {
        const className = node.className?.toString() ?? "";
        if (className.includes("react-flow__minimap")) return false;
        if (className.includes("react-flow__controls")) return false;
        if (className.includes("react-flow__background")) return false;
        return true;
      },
    });

    // Restore
    viewport.style.transform = origTransform;
    container.style.width = origContainerWidth;
    container.style.height = origContainerHeight;
    container.style.overflow = origContainerOverflow;
    container.style.position = origContainerPosition;

    const link = document.createElement("a");
    link.download = buildFilename("topology", "png", ctx);
    link.href = dataUrl;
    link.click();
  } catch (err) {
    console.error("PNG export failed:", err);
  }
}

// ─── SVG Export — Full topology ───────────────────────────────────────────────

export async function exportTopologySVG(ctx?: ExportContext) {
  const container = document.querySelector(".react-flow") as HTMLElement | null;
  const viewport = document.querySelector(
    ".react-flow__viewport"
  ) as HTMLElement | null;
  if (!container || !viewport) return;

  try {
    const { toSvg } = await import("html-to-image");

    const bounds = computeNodeBounds(viewport);
    if (!bounds) return;

    const padding = 60;
    const fullWidth = bounds.maxX - bounds.minX + padding * 2;
    const fullHeight = bounds.maxY - bounds.minY + padding * 2;

    const origTransform = viewport.style.transform;
    const origContainerWidth = container.style.width;
    const origContainerHeight = container.style.height;
    const origContainerOverflow = container.style.overflow;
    const origContainerPosition = container.style.position;

    container.style.width = `${fullWidth}px`;
    container.style.height = `${fullHeight}px`;
    container.style.overflow = "visible";
    container.style.position = "relative";
    viewport.style.transform = `translate(${-bounds.minX + padding}px, ${-bounds.minY + padding}px) scale(1)`;

    await new Promise((r) => setTimeout(r, 80));

    const dataUrl = await toSvg(container, {
      backgroundColor: "#f8f9fb",
      width: fullWidth,
      height: fullHeight,
      filter: (node: HTMLElement) => {
        const className = node.className?.toString() ?? "";
        if (className.includes("react-flow__minimap")) return false;
        if (className.includes("react-flow__controls")) return false;
        if (className.includes("react-flow__background")) return false;
        return true;
      },
    });

    viewport.style.transform = origTransform;
    container.style.width = origContainerWidth;
    container.style.height = origContainerHeight;
    container.style.overflow = origContainerOverflow;
    container.style.position = origContainerPosition;

    const link = document.createElement("a");
    link.download = buildFilename("topology", "svg", ctx);
    link.href = dataUrl;
    link.click();
  } catch (err) {
    console.error("SVG export failed:", err);
  }
}

// ─── Draw.io Export — Uses actual topology positions and edges ─────────────────

/**
 * Generates a Draw.io XML file that preserves the actual topology layout,
 * including node positions from ELK layout and all edge connections.
 * Users can open this in draw.io/diagrams.net to:
 * - Edit the topology diagram with full diagramming tools
 * - Add annotations, notes, or architecture documentation
 * - Rearrange nodes for custom presentations
 * - Export to PDF/PNG/SVG with draw.io's own renderer
 * - Share editable architecture diagrams with teams
 */
export function exportTopologyDrawIO(
  topology: TopologyResponse | null,
  ctx?: ExportContext
) {
  if (!topology) return;

  // Get actual node positions from the DOM
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
  downloadBlob(blob, buildFilename("topology", "drawio", ctx));
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
