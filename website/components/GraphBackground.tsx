"use client";

import { useEffect, useRef } from "react";

const NODE_TYPES = ["deploy", "service", "pvc", "configmap", "pod", "ingress", "secret"] as const;
type NodeType = typeof NODE_TYPES[number];

const COLOR_MAP: Record<NodeType, string> = {
    deploy: "#4F7BF7",
    service: "#2FC8B8",
    pvc: "#9B7CF4",
    configmap: "#F5A623",
    pod: "#2FD07D",
    ingress: "#F56C42",
    secret: "#EC4899",
};

interface GNode {
    x: number; y: number;
    vx: number; vy: number;
    r: number; type: NodeType;
    opacity: number; opDir: number;
    pulsePhase: number;
}

interface GEdge {
    from: number; to: number;
    dashOffset: number; speed: number;
    alpha: number;
}

function hexToRgba(hex: string, a: number) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
}

function makeNodes(count: number, w: number, h: number): GNode[] {
    return Array.from({ length: count }, (_, i) => ({
        x: (Math.random() * 0.8 + 0.1) * w,
        y: (Math.random() * 0.8 + 0.1) * h,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        r: 3 + Math.random() * 3,
        type: NODE_TYPES[i % NODE_TYPES.length],
        opacity: 0.35 + Math.random() * 0.5,
        opDir: Math.random() > 0.5 ? 1 : -1,
        pulsePhase: Math.random() * Math.PI * 2,
    }));
}

function makeEdges(nodes: GNode[]): GEdge[] {
    const edges: GEdge[] = [];
    const maxDist = 200;
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const dx = nodes[j].x - nodes[i].x;
            const dy = nodes[j].y - nodes[i].y;
            if (Math.sqrt(dx * dx + dy * dy) < maxDist && Math.random() > 0.5) {
                edges.push({
                    from: i, to: j,
                    dashOffset: Math.random() * 20,
                    speed: 0.06 + Math.random() * 0.1,
                    alpha: 0.06 + Math.random() * 0.1,
                });
            }
        }
    }
    return edges;
}

export default function GraphBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rafRef = useRef<number>(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        let w = canvas.clientWidth;
        let h = canvas.clientHeight;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);

        const COUNT = Math.min(36, Math.floor((w * h) / 20000));
        let nodes = makeNodes(COUNT, w, h);
        let edges = makeEdges(nodes);
        let tick = 0;

        const resize = () => {
            w = canvas.clientWidth;
            h = canvas.clientHeight;
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            ctx.scale(dpr, dpr);
            nodes = makeNodes(COUNT, w, h);
            edges = makeEdges(nodes);
        };

        window.addEventListener("resize", resize);

        const draw = () => {
            tick++;
            ctx.clearRect(0, 0, w, h);

            // Update nodes
            nodes.forEach((n) => {
                n.x += n.vx; n.y += n.vy;
                if (n.x < 20 || n.x > w - 20) n.vx *= -1;
                if (n.y < 20 || n.y > h - 20) n.vy *= -1;
                n.opacity += n.opDir * 0.003;
                if (n.opacity > 0.88 || n.opacity < 0.12) n.opDir *= -1;
                n.pulsePhase += 0.018;
            });

            // Edges
            edges.forEach((e) => {
                e.dashOffset -= e.speed;
                const a = nodes[e.from], b = nodes[e.to];
                const dx = b.x - a.x, dy = b.y - a.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 220) return;
                const alpha = e.alpha * (1 - dist / 220) * Math.min(a.opacity, b.opacity);
                ctx.save();
                ctx.strokeStyle = hexToRgba("#4F7BF7", alpha);
                ctx.lineWidth = 0.8;
                ctx.setLineDash([4, 9]);
                ctx.lineDashOffset = e.dashOffset;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
                ctx.restore();
            });

            // Nodes
            nodes.forEach((n) => {
                const color = COLOR_MAP[n.type];
                const pulsed = n.r + Math.sin(n.pulsePhase) * 0.8;

                // outer glow
                const grd = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, pulsed * 5);
                grd.addColorStop(0, hexToRgba(color, n.opacity * 0.15));
                grd.addColorStop(1, "rgba(0,0,0,0)");
                ctx.beginPath();
                ctx.arc(n.x, n.y, pulsed * 5, 0, Math.PI * 2);
                ctx.fillStyle = grd;
                ctx.fill();

                // ring
                ctx.beginPath();
                ctx.arc(n.x, n.y, pulsed + 3, 0, Math.PI * 2);
                ctx.strokeStyle = hexToRgba(color, n.opacity * 0.2);
                ctx.lineWidth = 0.7;
                ctx.stroke();

                // core
                ctx.beginPath();
                ctx.arc(n.x, n.y, pulsed, 0, Math.PI * 2);
                ctx.fillStyle = hexToRgba(color, n.opacity * 0.85);
                ctx.fill();
            });

            rafRef.current = requestAnimationFrame(draw);
        };

        draw();
        return () => {
            cancelAnimationFrame(rafRef.current);
            window.removeEventListener("resize", resize);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none select-none"
            aria-hidden="true"
        />
    );
}
