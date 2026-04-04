import { useState, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Treemap, Cell, PieChart, Pie, LineChart, Line, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";

// ─── DESIGN SYSTEM FOR SIMULATION VISUALS ─────────────────────────
// This is a SEPARATE visual system from TopologyCanvas.
// It does NOT use ReactFlow or ELK. It renders IMPACT, not topology.
// Principle: "Show what matters, hide what doesn't"

const COLORS = {
  bg: "#0f1117",
  card: "#1a1d27",
  cardHover: "#22253a",
  border: "#2a2d3a",
  text: "#e2e8f0",
  textMuted: "#94a3b8",
  textDim: "#64748b",
  critical: "#ef4444",
  criticalBg: "#451a1a",
  high: "#f97316",
  highBg: "#452a1a",
  medium: "#eab308",
  mediumBg: "#3d3a1a",
  low: "#22c55e",
  lowBg: "#1a3a2a",
  info: "#3b82f6",
  infoBg: "#1a2a45",
  accent: "#8b5cf6",
  removed: "#ef4444",
  added: "#22c55e",
  modified: "#f97316",
  safe: "#22c55e",
  degraded: "#eab308",
  unreachable: "#ef4444",
};

// ─── 1. IMPACT CASCADE VIEW ──────────────────────────────────────
// The CORE simulation visual. Shows failure propagation as concentric rings.
// Replaces: overlaying colors on 5000 nodes nobody can see.
// Each ring = one hop of dependency. Width = number of affected resources.
function ImpactCascadeView({ onSelectWave }) {
  const [selectedWave, setSelectedWave] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);

  const waves = [
    {
      depth: 0, label: "FAILURE ORIGIN", count: 1,
      resources: [{ name: "auth-service", kind: "Deployment", ns: "auth", score: 82, status: "removed" }]
    },
    {
      depth: 1, label: "DIRECT DEPENDENTS", count: 7,
      resources: [
        { name: "user-api", kind: "Deployment", ns: "platform", score: 67, status: "unreachable" },
        { name: "payment-api", kind: "Deployment", ns: "payments", score: 71, status: "unreachable" },
        { name: "checkout-svc", kind: "Deployment", ns: "payments", score: 58, status: "degraded" },
        { name: "notification-svc", kind: "Deployment", ns: "comms", score: 42, status: "degraded" },
        { name: "admin-dashboard", kind: "Deployment", ns: "platform", score: 35, status: "degraded" },
        { name: "audit-logger", kind: "Deployment", ns: "security", score: 28, status: "degraded" },
        { name: "session-store", kind: "StatefulSet", ns: "auth", score: 61, status: "unreachable" },
      ]
    },
    {
      depth: 2, label: "TRANSITIVE IMPACT", count: 14,
      resources: [
        { name: "cart-service", kind: "Deployment", ns: "commerce", score: 52, status: "degraded" },
        { name: "order-processor", kind: "Deployment", ns: "commerce", score: 48, status: "degraded" },
        { name: "invoice-gen", kind: "Deployment", ns: "payments", score: 38, status: "degraded" },
        { name: "refund-svc", kind: "Deployment", ns: "payments", score: 44, status: "degraded" },
        { name: "email-sender", kind: "Deployment", ns: "comms", score: 22, status: "degraded" },
        { name: "sms-gateway", kind: "Deployment", ns: "comms", score: 18, status: "degraded" },
        { name: "report-builder", kind: "Deployment", ns: "analytics", score: 31, status: "degraded" },
        { name: "metrics-agg", kind: "Deployment", ns: "analytics", score: 25, status: "degraded" },
      ]
    },
    {
      depth: 3, label: "EDGE IMPACT", count: 4,
      resources: [
        { name: "cdn-purge", kind: "CronJob", ns: "infra", score: 12, status: "degraded" },
        { name: "backup-job", kind: "CronJob", ns: "infra", score: 8, status: "degraded" },
      ]
    }
  ];

  const totalAffected = waves.reduce((sum, w) => sum + w.count, 0);

  const statusColor = (s) => s === "removed" ? COLORS.removed : s === "unreachable" ? COLORS.unreachable : COLORS.degraded;

  return (
    <div style={{ background: COLORS.bg, padding: 24, borderRadius: 12, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h2 style={{ color: COLORS.text, margin: 0, fontSize: 20, fontWeight: 600 }}>Impact Cascade</h2>
          <p style={{ color: COLORS.textMuted, margin: "4px 0 0", fontSize: 13 }}>
            Failure of <span style={{ color: COLORS.critical, fontWeight: 600 }}>auth-service</span> affects{" "}
            <span style={{ color: COLORS.text, fontWeight: 600 }}>{totalAffected} resources</span> across{" "}
            <span style={{ color: COLORS.text, fontWeight: 600 }}>4 waves</span>
          </p>
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          {[
            { label: "Removed", color: COLORS.removed, count: 1 },
            { label: "Unreachable", color: COLORS.unreachable, count: 3 },
            { label: "Degraded", color: COLORS.degraded, count: 22 },
          ].map(l => (
            <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: l.color }} />
              <span style={{ color: COLORS.textMuted, fontSize: 12 }}>{l.label} ({l.count})</span>
            </div>
          ))}
        </div>
      </div>

      {/* Concentric ring visualization */}
      <div style={{ display: "flex", gap: 24 }}>
        {/* Left: Ring View */}
        <div style={{ flex: "0 0 340px", display: "flex", justifyContent: "center", alignItems: "center" }}>
          <svg viewBox="0 0 340 340" width={340} height={340}>
            {waves.slice().reverse().map((wave, ri) => {
              const idx = waves.length - 1 - ri;
              const radius = 40 + idx * 52;
              const opacity = idx === 0 ? 1 : 0.15 + (0.6 / waves.length) * (waves.length - idx);
              const isSelected = selectedWave === idx;
              const colors = [COLORS.critical, COLORS.high, COLORS.medium, COLORS.info];
              return (
                <g key={idx} onClick={() => { setSelectedWave(isSelected ? null : idx); }}
                  style={{ cursor: "pointer" }}>
                  <circle cx={170} cy={170} r={radius} fill="none"
                    stroke={colors[idx]} strokeWidth={isSelected ? 42 : 36}
                    opacity={isSelected ? 0.5 : opacity * 0.35} />
                  <circle cx={170} cy={170} r={radius} fill="none"
                    stroke={colors[idx]} strokeWidth={2}
                    opacity={isSelected ? 1 : 0.6}
                    strokeDasharray={idx === 0 ? "none" : "6 4"} />
                  <text x={170} y={170 - radius + 5} textAnchor="middle"
                    fill={colors[idx]} fontSize={isSelected ? 14 : 11}
                    fontWeight={isSelected ? 700 : 500} opacity={isSelected ? 1 : 0.8}>
                    {wave.count}
                  </text>
                </g>
              );
            })}
            {/* Center origin */}
            <circle cx={170} cy={170} r={24} fill={COLORS.criticalBg} stroke={COLORS.critical} strokeWidth={2} />
            <text x={170} y={167} textAnchor="middle" fill={COLORS.critical} fontSize={9} fontWeight={700}>AUTH</text>
            <text x={170} y={180} textAnchor="middle" fill={COLORS.critical} fontSize={7}>SERVICE</text>
          </svg>
        </div>

        {/* Right: Wave detail list */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          {waves.map((wave, idx) => {
            const colors = [COLORS.critical, COLORS.high, COLORS.medium, COLORS.info];
            const isOpen = selectedWave === idx;
            return (
              <div key={idx}
                onClick={() => setSelectedWave(isOpen ? null : idx)}
                style={{
                  background: isOpen ? COLORS.cardHover : COLORS.card,
                  border: `1px solid ${isOpen ? colors[idx] : COLORS.border}`,
                  borderRadius: 8, padding: "10px 14px", cursor: "pointer",
                  transition: "all 0.15s ease",
                }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: colors[idx] + "22", border: `2px solid ${colors[idx]}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: colors[idx], fontSize: 12, fontWeight: 700,
                    }}>{wave.count}</div>
                    <div>
                      <div style={{ color: COLORS.text, fontSize: 13, fontWeight: 600 }}>
                        Wave {idx}: {wave.label}
                      </div>
                      <div style={{ color: COLORS.textDim, fontSize: 11 }}>
                        {wave.resources.length} resources shown · {wave.count} total
                      </div>
                    </div>
                  </div>
                  <span style={{ color: COLORS.textDim, fontSize: 18 }}>{isOpen ? "▾" : "▸"}</span>
                </div>

                {isOpen && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                    {wave.resources.map((r, ri) => (
                      <div key={ri}
                        onMouseEnter={() => setHoveredNode(r.name)}
                        onMouseLeave={() => setHoveredNode(null)}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "6px 10px", borderRadius: 6,
                          background: hoveredNode === r.name ? COLORS.cardHover : "transparent",
                          transition: "background 0.1s ease",
                        }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{
                            width: 8, height: 8, borderRadius: "50%",
                            background: statusColor(r.status),
                          }} />
                          <span style={{ color: COLORS.text, fontSize: 12, fontWeight: 500 }}>{r.name}</span>
                          <span style={{
                            color: COLORS.textDim, fontSize: 10,
                            background: COLORS.bg, padding: "1px 6px", borderRadius: 4,
                          }}>{r.kind}</span>
                          <span style={{ color: COLORS.textDim, fontSize: 10 }}>{r.ns}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{
                            color: statusColor(r.status), fontSize: 11, fontWeight: 600,
                            textTransform: "uppercase",
                          }}>{r.status}</span>
                          <div style={{
                            background: COLORS.bg, borderRadius: 4, padding: "2px 8px",
                            minWidth: 36, textAlign: "center",
                          }}>
                            <span style={{ color: COLORS.textMuted, fontSize: 11, fontWeight: 600 }}>{r.score}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── 2. NAMESPACE HEATMAP ────────────────────────────────────────
// Shows impact distribution across namespaces as colored blocks.
// Replaces: trying to spot colored dots scattered across a 5000-node graph.
// One glance = "payments namespace is destroyed, auth is gone, comms is degraded"
function NamespaceHeatmap() {
  const [hoveredNs, setHoveredNs] = useState(null);

  const namespaces = [
    { name: "auth", total: 8, affected: 8, removed: 2, unreachable: 4, degraded: 2, healthBefore: 78, healthAfter: 0 },
    { name: "payments", total: 12, affected: 9, removed: 0, unreachable: 3, degraded: 6, healthBefore: 82, healthAfter: 34 },
    { name: "platform", total: 15, affected: 4, removed: 0, unreachable: 1, degraded: 3, healthBefore: 75, healthAfter: 58 },
    { name: "commerce", total: 10, affected: 3, removed: 0, unreachable: 0, degraded: 3, healthBefore: 71, healthAfter: 55 },
    { name: "comms", total: 6, affected: 4, removed: 0, unreachable: 0, degraded: 4, healthBefore: 65, healthAfter: 31 },
    { name: "analytics", total: 8, affected: 2, removed: 0, unreachable: 0, degraded: 2, healthBefore: 68, healthAfter: 52 },
    { name: "security", total: 5, affected: 1, removed: 0, unreachable: 0, degraded: 1, healthBefore: 85, healthAfter: 76 },
    { name: "infra", total: 14, affected: 2, removed: 0, unreachable: 0, degraded: 2, healthBefore: 90, healthAfter: 84 },
    { name: "monitoring", total: 7, affected: 0, removed: 0, unreachable: 0, degraded: 0, healthBefore: 88, healthAfter: 88 },
    { name: "kube-system", total: 20, affected: 0, removed: 0, unreachable: 0, degraded: 0, healthBefore: 92, healthAfter: 92 },
  ];

  const severity = (ns) => {
    const pct = ns.affected / ns.total;
    if (ns.removed > 0 || pct > 0.7) return COLORS.critical;
    if (ns.unreachable > 0 || pct > 0.4) return COLORS.high;
    if (pct > 0.1) return COLORS.medium;
    if (pct > 0) return COLORS.info;
    return COLORS.low;
  };

  return (
    <div style={{ background: COLORS.bg, padding: 24, borderRadius: 12, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <h2 style={{ color: COLORS.text, margin: "0 0 4px", fontSize: 20, fontWeight: 600 }}>Namespace Impact Map</h2>
      <p style={{ color: COLORS.textMuted, margin: "0 0 20px", fontSize: 13 }}>
        Block size = resource count · Color = impact severity · Click to drill into namespace topology
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {namespaces.sort((a, b) => b.total - a.total).map(ns => {
          const w = Math.max(80, Math.sqrt(ns.total) * 52);
          const h = Math.max(60, Math.sqrt(ns.total) * 42);
          const col = severity(ns);
          const isHovered = hoveredNs === ns.name;
          const pct = ns.total > 0 ? Math.round((ns.affected / ns.total) * 100) : 0;

          return (
            <div
              key={ns.name}
              onMouseEnter={() => setHoveredNs(ns.name)}
              onMouseLeave={() => setHoveredNs(null)}
              style={{
                width: w, height: h,
                background: isHovered ? col + "30" : col + "18",
                border: `2px solid ${isHovered ? col : col + "60"}`,
                borderRadius: 8, padding: 10, cursor: "pointer",
                transition: "all 0.15s ease",
                display: "flex", flexDirection: "column", justifyContent: "space-between",
                position: "relative", overflow: "hidden",
              }}>
              {/* Fill bar showing affected percentage */}
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0,
                height: `${pct}%`, background: col + "20",
                transition: "height 0.3s ease",
              }} />

              <div style={{ position: "relative", zIndex: 1 }}>
                <div style={{ color: COLORS.text, fontSize: 12, fontWeight: 600 }}>{ns.name}</div>
                <div style={{ color: COLORS.textDim, fontSize: 10 }}>{ns.total} resources</div>
              </div>
              <div style={{ position: "relative", zIndex: 1, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                <span style={{ color: col, fontSize: 18, fontWeight: 700 }}>
                  {pct > 0 ? `${pct}%` : "OK"}
                </span>
                {ns.affected > 0 && (
                  <span style={{ color: COLORS.textMuted, fontSize: 10 }}>
                    {ns.healthBefore} → {ns.healthAfter}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Hovered detail */}
      {hoveredNs && (() => {
        const ns = namespaces.find(n => n.name === hoveredNs);
        if (!ns) return null;
        return (
          <div style={{
            marginTop: 16, padding: 14, background: COLORS.card, borderRadius: 8,
            border: `1px solid ${COLORS.border}`, display: "flex", gap: 24, alignItems: "center",
          }}>
            <div>
              <div style={{ color: COLORS.text, fontSize: 14, fontWeight: 600 }}>{ns.name}</div>
              <div style={{ color: COLORS.textMuted, fontSize: 12 }}>{ns.total} total resources</div>
            </div>
            <div style={{ display: "flex", gap: 16 }}>
              {ns.removed > 0 && <Stat label="Removed" value={ns.removed} color={COLORS.removed} />}
              {ns.unreachable > 0 && <Stat label="Unreachable" value={ns.unreachable} color={COLORS.unreachable} />}
              {ns.degraded > 0 && <Stat label="Degraded" value={ns.degraded} color={COLORS.degraded} />}
              <Stat label="Unaffected" value={ns.total - ns.affected} color={COLORS.safe} />
            </div>
            <div style={{ marginLeft: "auto" }}>
              <div style={{ color: COLORS.textMuted, fontSize: 11 }}>Health Score</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: COLORS.text, fontSize: 16, fontWeight: 600 }}>{ns.healthBefore}</span>
                <span style={{ color: COLORS.textDim }}>→</span>
                <span style={{
                  color: ns.healthAfter < ns.healthBefore * 0.5 ? COLORS.critical :
                    ns.healthAfter < ns.healthBefore * 0.8 ? COLORS.high : COLORS.text,
                  fontSize: 16, fontWeight: 600
                }}>{ns.healthAfter}</span>
                <span style={{
                  color: COLORS.critical, fontSize: 12, fontWeight: 600,
                }}>({ns.healthAfter - ns.healthBefore})</span>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ color, fontSize: 18, fontWeight: 700 }}>{value}</div>
      <div style={{ color: COLORS.textDim, fontSize: 10 }}>{label}</div>
    </div>
  );
}

// ─── 3. SCORE DELTA WATERFALL ────────────────────────────────────
// Shows how each dimension of health changes before/after simulation.
// Replaces: a single number "78 → 42" with no explanation of WHY.
function ScoreDeltaWaterfall() {
  const dimensions = [
    { name: "SPOF Density", before: 85, after: 42, weight: 20 },
    { name: "PDB Coverage", before: 88, after: 88, weight: 15 },
    { name: "Redundancy", before: 72, after: 35, weight: 20 },
    { name: "HPA Coverage", before: 65, after: 52, weight: 10 },
    { name: "Dependency Depth", before: 78, after: 78, weight: 10 },
    { name: "Cross-NS Risk", before: 82, after: 61, weight: 10 },
    { name: "Resource Limits", before: 90, after: 90, weight: 10 },
    { name: "Network Isolation", before: 70, after: 70, weight: 5 },
  ];

  const chartData = dimensions.map(d => ({
    name: d.name,
    before: d.before,
    after: d.after,
    delta: d.after - d.before,
    weight: d.weight,
  }));

  const totalBefore = Math.round(dimensions.reduce((s, d) => s + d.before * d.weight / 100, 0));
  const totalAfter = Math.round(dimensions.reduce((s, d) => s + d.after * d.weight / 100, 0));

  return (
    <div style={{ background: COLORS.bg, padding: 24, borderRadius: 12, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h2 style={{ color: COLORS.text, margin: 0, fontSize: 20, fontWeight: 600 }}>Health Score Breakdown</h2>
          <p style={{ color: COLORS.textMuted, margin: "4px 0 0", fontSize: 13 }}>
            Before vs After simulation · Weighted contribution to overall health
          </p>
        </div>
        <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: COLORS.textMuted, fontSize: 11 }}>BEFORE</div>
            <div style={{ color: COLORS.text, fontSize: 28, fontWeight: 700 }}>{totalBefore}</div>
          </div>
          <div style={{ color: COLORS.critical, fontSize: 24 }}>→</div>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: COLORS.textMuted, fontSize: 11 }}>AFTER</div>
            <div style={{ color: COLORS.critical, fontSize: 28, fontWeight: 700 }}>{totalAfter}</div>
          </div>
          <div style={{
            background: COLORS.criticalBg, padding: "4px 12px", borderRadius: 6,
            color: COLORS.critical, fontSize: 16, fontWeight: 700,
          }}>
            {totalAfter - totalBefore} pts
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {dimensions.map((d, i) => {
          const delta = d.after - d.before;
          const isChanged = delta !== 0;
          return (
            <div key={d.name} style={{
              display: "grid", gridTemplateColumns: "160px 40px 1fr 60px",
              alignItems: "center", gap: 12,
              padding: "8px 12px", borderRadius: 6,
              background: isChanged ? COLORS.card : "transparent",
              border: isChanged ? `1px solid ${COLORS.border}` : "1px solid transparent",
            }}>
              <div>
                <span style={{ color: isChanged ? COLORS.text : COLORS.textDim, fontSize: 12, fontWeight: 500 }}>{d.name}</span>
                <span style={{ color: COLORS.textDim, fontSize: 10, marginLeft: 6 }}>({d.weight}%)</span>
              </div>
              <span style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "right" }}>{d.before}</span>
              <div style={{ position: "relative", height: 20 }}>
                {/* Before bar */}
                <div style={{
                  position: "absolute", top: 2, left: 0, height: 7,
                  width: `${d.before}%`, background: COLORS.info + "40",
                  borderRadius: 3,
                }} />
                {/* After bar */}
                <div style={{
                  position: "absolute", top: 11, left: 0, height: 7,
                  width: `${d.after}%`,
                  background: delta < -20 ? COLORS.critical + "80" : delta < 0 ? COLORS.high + "60" : COLORS.info + "40",
                  borderRadius: 3,
                }} />
                {/* Delta indicator */}
                {isChanged && (
                  <div style={{
                    position: "absolute", top: 0, left: `${Math.min(d.before, d.after)}%`,
                    width: `${Math.abs(delta)}%`, height: 20,
                    background: COLORS.critical + "15",
                    borderLeft: `2px dashed ${COLORS.critical}50`,
                    borderRight: `2px dashed ${COLORS.critical}50`,
                  }} />
                )}
              </div>
              <span style={{
                color: isChanged ? COLORS.critical : COLORS.textDim,
                fontSize: 12, fontWeight: isChanged ? 700 : 400, textAlign: "right",
              }}>
                {delta === 0 ? "—" : `${delta}`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 4. SPOF DIFF PANEL ─────────────────────────────────────────
// Shows exactly which SPOFs are created/resolved by the simulation.
// Replaces: a number "SPOFs: 3 → 7" with no context of WHICH ones.
function SPOFDiffPanel() {
  const newSPOFs = [
    { name: "payment-api", ns: "payments", fanIn: 9, blastRadius: 72, reason: "Lost 2 of 3 replicas when auth-service failed" },
    { name: "session-store", ns: "auth", fanIn: 5, blastRadius: 58, reason: "Dependent on auth-service; sole replica in affected AZ" },
    { name: "user-api", ns: "platform", fanIn: 7, blastRadius: 64, reason: "Lost only replica when auth dependency became unreachable" },
    { name: "checkout-svc", ns: "payments", fanIn: 4, blastRadius: 45, reason: "Scaled to 1 replica after payment-api degraded" },
  ];

  const resolvedSPOFs = [
    { name: "metrics-collector", ns: "monitoring", reason: "Was SPOF before; unaffected by this scenario" },
  ];

  const existingSPOFs = [
    { name: "config-store", ns: "platform", fanIn: 12, blastRadius: 81 },
    { name: "redis-primary", ns: "cache", fanIn: 8, blastRadius: 65 },
    { name: "cert-manager", ns: "security", fanIn: 3, blastRadius: 22 },
  ];

  return (
    <div style={{ background: COLORS.bg, padding: 24, borderRadius: 12, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ color: COLORS.text, margin: 0, fontSize: 20, fontWeight: 600 }}>SPOF Analysis</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{
            padding: "4px 12px", borderRadius: 6, background: COLORS.card,
            border: `1px solid ${COLORS.border}`,
          }}>
            <span style={{ color: COLORS.textMuted, fontSize: 11 }}>Before: </span>
            <span style={{ color: COLORS.text, fontSize: 14, fontWeight: 700 }}>3</span>
          </div>
          <span style={{ color: COLORS.critical, fontSize: 20, lineHeight: "28px" }}>→</span>
          <div style={{
            padding: "4px 12px", borderRadius: 6, background: COLORS.criticalBg,
            border: `1px solid ${COLORS.critical}40`,
          }}>
            <span style={{ color: COLORS.critical, fontSize: 11 }}>After: </span>
            <span style={{ color: COLORS.critical, fontSize: 14, fontWeight: 700 }}>7</span>
          </div>
          <div style={{
            padding: "4px 12px", borderRadius: 6, background: COLORS.criticalBg,
            color: COLORS.critical, fontSize: 13, fontWeight: 700,
          }}>+4 new</div>
        </div>
      </div>

      {/* New SPOFs */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ color: COLORS.critical, fontSize: 12, fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
          New SPOFs Created by Simulation
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {newSPOFs.map((s, i) => (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "1fr 80px 80px",
              padding: "10px 14px", borderRadius: 8,
              background: COLORS.criticalBg, border: `1px solid ${COLORS.critical}30`,
            }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: COLORS.critical, fontSize: 16 }}>⚠</span>
                  <span style={{ color: COLORS.text, fontSize: 13, fontWeight: 600 }}>{s.name}</span>
                  <span style={{ color: COLORS.textDim, fontSize: 10, background: COLORS.bg, padding: "1px 6px", borderRadius: 4 }}>{s.ns}</span>
                </div>
                <div style={{ color: COLORS.textMuted, fontSize: 11, marginTop: 4, marginLeft: 24 }}>{s.reason}</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ color: COLORS.textMuted, fontSize: 10 }}>Fan-In</div>
                <div style={{ color: COLORS.text, fontSize: 14, fontWeight: 600 }}>{s.fanIn}</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ color: COLORS.textMuted, fontSize: 10 }}>Blast</div>
                <div style={{ color: s.blastRadius > 60 ? COLORS.critical : COLORS.high, fontSize: 14, fontWeight: 600 }}>{s.blastRadius}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Existing SPOFs */}
      <div>
        <div style={{ color: COLORS.textDim, fontSize: 12, fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
          Pre-Existing SPOFs (unchanged)
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {existingSPOFs.map((s, i) => (
            <div key={i} style={{
              padding: "8px 14px", borderRadius: 8, background: COLORS.card,
              border: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", gap: 10,
            }}>
              <span style={{ color: COLORS.high, fontSize: 14 }}>⚠</span>
              <span style={{ color: COLORS.text, fontSize: 12 }}>{s.name}</span>
              <span style={{ color: COLORS.textDim, fontSize: 10 }}>{s.ns}</span>
              <span style={{ color: COLORS.textMuted, fontSize: 10, borderLeft: `1px solid ${COLORS.border}`, paddingLeft: 8 }}>
                blast: {s.blastRadius}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── 5. FLEET COMPARISON RADAR ───────────────────────────────────
// For Fleet X-Ray: compare 2 clusters on 8 structural dimensions.
// Replaces: a table of numbers that nobody can parse at a glance.
function FleetComparisonRadar() {
  const dimensions = [
    { dimension: "Health Score", clusterA: 82, clusterB: 62 },
    { dimension: "PDB Coverage", clusterA: 88, clusterB: 55 },
    { dimension: "HPA Coverage", clusterA: 72, clusterB: 72 },
    { dimension: "Net Policy", clusterA: 90, clusterB: 42 },
    { dimension: "Redundancy", clusterA: 85, clusterB: 60 },
    { dimension: "Resource Limits", clusterA: 92, clusterB: 78 },
    { dimension: "Low Blast Risk", clusterA: 75, clusterB: 45 },
    { dimension: "Low SPOF Count", clusterA: 90, clusterB: 50 },
  ];

  return (
    <div style={{ background: COLORS.bg, padding: 24, borderRadius: 12, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ color: COLORS.text, margin: 0, fontSize: 20, fontWeight: 600 }}>Fleet Structural Comparison</h2>
        <div style={{ display: "flex", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 12, height: 3, background: COLORS.info, borderRadius: 2 }} />
            <span style={{ color: COLORS.textMuted, fontSize: 12 }}>prod-east (82)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 12, height: 3, background: COLORS.high, borderRadius: 2 }} />
            <span style={{ color: COLORS.textMuted, fontSize: 12 }}>prod-west (62)</span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
        <div style={{ width: 360, height: 300 }}>
          <ResponsiveContainer>
            <RadarChart data={dimensions}>
              <PolarGrid stroke={COLORS.border} />
              <PolarAngleAxis dataKey="dimension" tick={{ fill: COLORS.textMuted, fontSize: 10 }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: COLORS.textDim, fontSize: 9 }} />
              <Radar name="prod-east" dataKey="clusterA" stroke={COLORS.info} fill={COLORS.info} fillOpacity={0.15} strokeWidth={2} />
              <Radar name="prod-west" dataKey="clusterB" stroke={COLORS.high} fill={COLORS.high} fillOpacity={0.15} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Delta list */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          {dimensions.map((d, i) => {
            const delta = d.clusterB - d.clusterA;
            const severity = delta < -20 ? COLORS.critical : delta < -10 ? COLORS.high : delta < 0 ? COLORS.medium : COLORS.safe;
            return (
              <div key={i} style={{
                display: "grid", gridTemplateColumns: "140px 60px 60px 1fr 50px",
                alignItems: "center", padding: "6px 10px", borderRadius: 6,
                background: delta < -15 ? severity + "10" : "transparent",
              }}>
                <span style={{ color: COLORS.text, fontSize: 12 }}>{d.dimension}</span>
                <span style={{ color: COLORS.info, fontSize: 12, textAlign: "center", fontWeight: 600 }}>{d.clusterA}</span>
                <span style={{ color: COLORS.high, fontSize: 12, textAlign: "center", fontWeight: 600 }}>{d.clusterB}</span>
                <div style={{ height: 6, background: COLORS.card, borderRadius: 3, position: "relative", overflow: "hidden" }}>
                  <div style={{
                    position: "absolute", top: 0, left: 0, height: "100%",
                    width: `${d.clusterA}%`, background: COLORS.info + "60", borderRadius: 3,
                  }} />
                  <div style={{
                    position: "absolute", top: 0, left: 0, height: "100%",
                    width: `${d.clusterB}%`, background: COLORS.high + "40", borderRadius: 3,
                    borderRight: `2px solid ${COLORS.high}`,
                  }} />
                </div>
                <span style={{ color: severity, fontSize: 11, fontWeight: 600, textAlign: "right" }}>
                  {delta > 0 ? "+" : ""}{delta}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── 6. AUTO-PILOT FINDINGS PRIORITY MATRIX ──────────────────────
// For Auto-Pilot: shows findings as a severity × blast radius scatter.
// Replaces: a flat list of findings you have to scroll through.
function AutoPilotMatrix() {
  const findings = [
    { name: "payment-db", rule: "SPOF", severity: "critical", blast: 72, ns: "payments", action: "Scale 1→2" },
    { name: "auth-cache", rule: "Missing PDB", severity: "high", blast: 65, ns: "auth", action: "Create PDB" },
    { name: "user-api", rule: "SPOF", severity: "high", blast: 58, ns: "platform", action: "Scale 1→2" },
    { name: "order-svc", rule: "Missing Limits", severity: "medium", blast: 48, ns: "commerce", action: "Set limits" },
    { name: "cart-svc", rule: "Missing PDB", severity: "medium", blast: 42, ns: "commerce", action: "Create PDB" },
    { name: "email-sender", rule: "Missing Limits", severity: "medium", blast: 22, ns: "comms", action: "Set limits" },
    { name: "log-shipper", rule: "No Anti-Affinity", severity: "low", blast: 15, ns: "infra", action: "Add spread" },
    { name: "debug-proxy", rule: "Missing Limits", severity: "low", blast: 8, ns: "infra", action: "Set limits" },
  ];

  const [hoveredFinding, setHoveredFinding] = useState(null);

  const severityY = { critical: 20, high: 100, medium: 180, low: 260 };
  const severityColor = { critical: COLORS.critical, high: COLORS.high, medium: COLORS.medium, low: COLORS.low };

  return (
    <div style={{ background: COLORS.bg, padding: 24, borderRadius: 12, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ color: COLORS.text, margin: 0, fontSize: 20, fontWeight: 600 }}>Auto-Pilot Priority Matrix</h2>
          <p style={{ color: COLORS.textMuted, margin: "4px 0 0", fontSize: 13 }}>
            Y-axis = severity · X-axis = blast radius · Size = fan-in · Top-right = fix first
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {["critical", "high", "medium", "low"].map(s => (
            <div key={s} style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "3px 8px", borderRadius: 4,
              background: severityColor[s] + "15",
            }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: severityColor[s] }} />
              <span style={{ color: COLORS.textMuted, fontSize: 11, textTransform: "capitalize" }}>{s}</span>
              <span style={{ color: severityColor[s], fontSize: 11, fontWeight: 600 }}>
                {findings.filter(f => f.severity === s).length}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 24 }}>
        <svg viewBox="0 0 500 300" width={500} height={300} style={{ overflow: "visible" }}>
          {/* Grid lines */}
          {[0, 25, 50, 75, 100].map(v => (
            <g key={v}>
              <line x1={v * 4.8 + 20} y1={10} x2={v * 4.8 + 20} y2={290} stroke={COLORS.border} strokeWidth={0.5} />
              <text x={v * 4.8 + 20} y={298} textAnchor="middle" fill={COLORS.textDim} fontSize={9}>{v}</text>
            </g>
          ))}
          {/* Severity bands */}
          {["critical", "high", "medium", "low"].map(s => (
            <g key={s}>
              <rect x={0} y={severityY[s] - 10} width={500} height={60} fill={severityColor[s] + "08"} rx={4} />
              <text x={8} y={severityY[s] + 24} fill={severityColor[s]} fontSize={9} fontWeight={600} opacity={0.6}
                transform={`rotate(-90, 8, ${severityY[s] + 24})`}>
                {s.toUpperCase()}
              </text>
            </g>
          ))}

          {/* Fix-first zone */}
          <rect x={260} y={0} width={240} height={140} fill={COLORS.critical + "08"} rx={8}
            stroke={COLORS.critical} strokeWidth={1} strokeDasharray="4 4" opacity={0.4} />
          <text x={380} y={136} textAnchor="middle" fill={COLORS.critical} fontSize={9} opacity={0.5}>FIX FIRST</text>

          {/* Dots */}
          {findings.map((f, i) => {
            const x = f.blast * 4.8 + 20;
            const y = severityY[f.severity] + 20 + (i % 3) * 12;
            const r = 8;
            const isHovered = hoveredFinding === f.name;
            return (
              <g key={f.name}
                onMouseEnter={() => setHoveredFinding(f.name)}
                onMouseLeave={() => setHoveredFinding(null)}
                style={{ cursor: "pointer" }}>
                <circle cx={x} cy={y} r={isHovered ? r + 4 : r}
                  fill={severityColor[f.severity] + "40"}
                  stroke={severityColor[f.severity]} strokeWidth={isHovered ? 2.5 : 1.5} />
                <text x={x} y={y + 3.5} textAnchor="middle" fill={COLORS.text}
                  fontSize={isHovered ? 8 : 7} fontWeight={500}>
                  {f.name.split("-")[0]}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Detail panel */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          {findings.map(f => (
            <div key={f.name}
              onMouseEnter={() => setHoveredFinding(f.name)}
              onMouseLeave={() => setHoveredFinding(null)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "6px 10px", borderRadius: 6,
                background: hoveredFinding === f.name ? COLORS.cardHover : "transparent",
                cursor: "pointer", transition: "background 0.1s ease",
              }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: severityColor[f.severity] }} />
                <span style={{ color: COLORS.text, fontSize: 12 }}>{f.name}</span>
                <span style={{ color: COLORS.textDim, fontSize: 10 }}>{f.rule}</span>
              </div>
              <div style={{
                padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600,
                background: severityColor[f.severity] + "20", color: severityColor[f.severity],
              }}>{f.action}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


// ─── MAIN APP: TABBED DEMO ──────────────────────────────────────
export default function SimulationVisualSystem() {
  const [activeTab, setActiveTab] = useState("cascade");

  const tabs = [
    { id: "cascade", label: "Impact Cascade", desc: "Wave-by-wave failure propagation" },
    { id: "heatmap", label: "Namespace Heatmap", desc: "Impact distribution at a glance" },
    { id: "waterfall", label: "Score Breakdown", desc: "Health dimension changes" },
    { id: "spof", label: "SPOF Analysis", desc: "New/existing single points of failure" },
    { id: "fleet", label: "Fleet Radar", desc: "Multi-cluster structural comparison" },
    { id: "autopilot", label: "Priority Matrix", desc: "Auto-Pilot findings severity × blast" },
  ];

  return (
    <div style={{ background: "#080a0f", minHeight: "100vh", padding: 24, fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ marginBottom: 24, textAlign: "center" }}>
        <h1 style={{ color: COLORS.text, margin: 0, fontSize: 24, fontWeight: 700 }}>
          Kubilitics Simulation Visual System
        </h1>
        <p style={{ color: COLORS.textMuted, margin: "6px 0 0", fontSize: 14 }}>
          Purpose-built visualization for simulation results — clear at any scale, no topology canvas dependency
        </p>
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex", gap: 4, marginBottom: 20, padding: 4,
        background: COLORS.card, borderRadius: 10, overflowX: "auto",
      }}>
        {tabs.map(tab => (
          <button key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1, padding: "10px 16px", borderRadius: 8,
              background: activeTab === tab.id ? COLORS.accent + "20" : "transparent",
              border: activeTab === tab.id ? `1px solid ${COLORS.accent}40` : "1px solid transparent",
              cursor: "pointer", textAlign: "center", minWidth: 130,
              transition: "all 0.15s ease",
            }}>
            <div style={{ color: activeTab === tab.id ? COLORS.text : COLORS.textMuted, fontSize: 13, fontWeight: 600 }}>
              {tab.label}
            </div>
            <div style={{ color: COLORS.textDim, fontSize: 10, marginTop: 2 }}>{tab.desc}</div>
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === "cascade" && <ImpactCascadeView />}
      {activeTab === "heatmap" && <NamespaceHeatmap />}
      {activeTab === "waterfall" && <ScoreDeltaWaterfall />}
      {activeTab === "spof" && <SPOFDiffPanel />}
      {activeTab === "fleet" && <FleetComparisonRadar />}
      {activeTab === "autopilot" && <AutoPilotMatrix />}

      {/* Design rationale */}
      <div style={{
        marginTop: 24, padding: 20, background: COLORS.card,
        borderRadius: 10, border: `1px solid ${COLORS.border}`,
      }}>
        <h3 style={{ color: COLORS.accent, margin: "0 0 8px", fontSize: 14, fontWeight: 600 }}>
          Why This Replaces Canvas Overlays
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <div style={{ color: COLORS.critical, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Current Problem</div>
            <ul style={{ color: COLORS.textMuted, fontSize: 12, margin: 0, paddingLeft: 16, lineHeight: 1.8 }}>
              <li>300+ nodes forces zoom to 0.15x — nodes become 12px dots</li>
              <li>1000+ nodes silently truncated — blast radius target may vanish</li>
              <li>200+ affected nodes = N² re-renders, FPS drops below 30</li>
              <li>Color overlay on invisible dots = invisible overlay</li>
            </ul>
          </div>
          <div>
            <div style={{ color: COLORS.safe, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>This System</div>
            <ul style={{ color: COLORS.textMuted, fontSize: 12, margin: 0, paddingLeft: 16, lineHeight: 1.8 }}>
              <li>Shows IMPACT not topology — 26 affected resources, not 5000 nodes</li>
              <li>Namespace heatmap = one glance, any cluster size</li>
              <li>Cascade rings scale from 1 to 10,000 affected — always clear</li>
              <li>Zero ReactFlow dependency — no zoom, no truncation, no layout engine</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
