/**
 * CompactNode — LOD Level 2 (0.25 < zoom < 0.5)
 * Renders a condensed card: kind-color bar + icon + name only.
 */
import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { getGradient, healthColor, KindIcon } from '../AGTDesignSystem';
import type { TopologyNode } from '../../types/topology.types';

interface CompactNodeProps {
  node: TopologyNode;
  selected?: boolean;
}

function CompactNodeInner({ node, selected }: CompactNodeProps) {
  const grad = getGradient(node.kind);
  const health = node.computed?.health ?? 'unknown';
  const hColor = healthColor(health);

  return (
    <div style={{
      width: 130,
      borderRadius: 8,
      border: selected ? `2px solid ${grad.from}` : '1px solid rgba(0,0,0,0.1)',
      background: '#FFFFFF',
      overflow: 'hidden',
      cursor: 'pointer',
      boxShadow: selected
        ? `0 0 0 2px ${grad.from}, 0 4px 12px rgba(0,0,0,0.1)`
        : '0 1px 3px rgba(0,0,0,0.06)',
    }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />

      <div style={{ height: 3, background: `linear-gradient(90deg, ${grad.from}, ${grad.to})` }} />

      <div style={{
        padding: '4px 8px',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: hColor, flexShrink: 0,
        }} />
        <KindIcon kind={node.kind} size={11} />
        <span style={{
          fontSize: 10, fontWeight: 600, color: '#1E293B',
          fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          flex: 1,
        }}>
          {node.name}
        </span>
      </div>
    </div>
  );
}

export const CompactNode = React.memo(CompactNodeInner);
