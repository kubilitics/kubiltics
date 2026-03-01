/**
 * DotNode — LOD Level 3 (zoom < 0.25)
 * Renders as a single colored dot. Minimal DOM for maximum performance.
 */
import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { getGradient, healthColor } from '../AGTDesignSystem';

interface DotNodeProps {
  kind: string;
  health?: string;
}

function DotNodeInner({ kind, health }: DotNodeProps) {
  const grad = getGradient(kind);
  const hColor = healthColor(health);

  return (
    <div style={{
      width: 12,
      height: 12,
      borderRadius: '50%',
      background: `linear-gradient(135deg, ${grad.from}, ${grad.to})`,
      border: `2px solid ${hColor}`,
      boxShadow: `0 0 4px ${grad.glow}`,
    }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

export const DotNode = React.memo(DotNodeInner);
