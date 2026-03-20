import React, { useEffect, useState, useRef } from 'react';
import type cytoscape from 'cytoscape';
import { Activity, FileText } from 'lucide-react';

export interface TooltipData {
  nodeId: string;
  kind: string;
  name: string;
  namespace?: string;
  status?: string;
  replicas?: number;
  cpuPercent?: number;
  memoryPercent?: number;
}

export interface HoverTooltipProps {
  cy: cytoscape.Core;
  onViewDetails?: (nodeId: string) => void;
  onViewLogs?: (nodeId: string) => void;
}

/**
 * HoverTooltip - Rich tooltip that appears on node hover
 *
 * PRD Section 7.2: "Billion Dollar Feature"
 *
 * Shows:
 * - Resource kind icon (initials badge)
 * - Name (bold)
 * - Namespace
 * - Status badge (green/yellow/red)
 * - Key metrics (replicas, CPU%, Memory%)
 * - Quick action buttons (View Details, View Logs)
 *
 * Positioned 12px right, 12px down from cursor
 */
export const HoverTooltip: React.FC<HoverTooltipProps> = ({
  cy,
  onViewDetails,
  onViewLogs,
}) => {
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    data: TooltipData | null;
  }>({
    visible: false,
    x: 0,
    y: 0,
    data: null,
  });

  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cy) return;

    const handleMouseOver = (event: cytoscape.EventObject) => {
      const node = event.target;
      const position = event.renderedPosition || event.position;

      // Extract node data
      const data: TooltipData = {
        nodeId: node.id(),
        kind: node.data('kind') || 'Unknown',
        name: node.data('name') || node.id(),
        namespace: node.data('namespace'),
        status: node.data('status'),
        replicas: node.data('replicas'),
        cpuPercent: node.data('cpuPercent'),
        memoryPercent: node.data('memoryPercent'),
      };

      setTooltip({
        visible: true,
        x: position.x + 12, // 12px offset right (PRD requirement)
        y: position.y + 12, // 12px offset down (PRD requirement)
        data,
      });
    };

    const handleMouseOut = () => {
      setTooltip({
        visible: false,
        x: 0,
        y: 0,
        data: null,
      });
    };

    const handleMouseMove = (event: cytoscape.EventObject) => {
      if (tooltip.visible && event.target.isNode && event.target.isNode()) {
        const position = event.renderedPosition || event.position;
        setTooltip((prev) => ({
          ...prev,
          x: position.x + 12,
          y: position.y + 12,
        }));
      }
    };

    cy.on('mouseover', 'node', handleMouseOver);
    cy.on('mouseout', 'node', handleMouseOut);
    cy.on('mousemove', 'node', handleMouseMove);

    return () => {
      cy.off('mouseover', 'node', handleMouseOver);
      cy.off('mouseout', 'node', handleMouseOut);
      cy.off('mousemove', 'node', handleMouseMove);
    };
  }, [cy, tooltip.visible]);

  if (!tooltip.visible || !tooltip.data) {
    return null;
  }

  const { data, x, y } = tooltip;

  // Determine status color
  const getStatusColor = (status?: string): string => {
    switch (status?.toLowerCase()) {
      case 'running':
      case 'active':
      case 'healthy':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'pending':
      case 'warning':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'failed':
      case 'error':
      case 'unhealthy':
        return 'bg-red-100 text-red-800 border-red-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  return (
    <div
      ref={tooltipRef}
      className="fixed z-50 pointer-events-auto"
      style={{
        left: `${x}px`,
        top: `${y}px`,
        width: '300px',
      }}
    >
      {/* Tooltip Container */}
      <div className="bg-white rounded-lg border-2 border-slate-700 shadow-2xl">
        {/* Header: Kind Badge + Name */}
        <div className="px-4 py-3 border-b border-slate-200">
          <div className="flex items-start gap-3">
            {/* Kind Icon (Initials Badge) */}
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center mt-0.5">
              <span className="text-sm font-bold text-white">
                {data.kind.substring(0, 3).toUpperCase()}
              </span>
            </div>

            {/* Name & Namespace */}
            <div className="flex-1 min-w-0">
              <div className="font-bold text-slate-900 text-sm leading-snug break-words">
                {data.name}
              </div>
              {data.namespace && (
                <div className="text-xs text-slate-500 truncate">
                  {data.namespace}
                </div>
              )}
            </div>

            {/* Status Badge */}
            {data.status && (
              <div
                className={`px-2 py-1 rounded text-xs font-semibold border ${getStatusColor(
                  data.status
                )}`}
              >
                {data.status}
              </div>
            )}
          </div>
        </div>

        {/* Metrics Section */}
        {(data.replicas !== undefined ||
          data.cpuPercent !== undefined ||
          data.memoryPercent !== undefined) && (
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
            <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
              Metrics
            </div>
            <div className="grid grid-cols-3 gap-3">
              {data.replicas !== undefined && (
                <div>
                  <div className="text-xs text-slate-500">Replicas</div>
                  <div className="text-sm font-bold text-slate-900">
                    {data.replicas}
                  </div>
                </div>
              )}
              {data.cpuPercent !== undefined && (
                <div>
                  <div className="text-xs text-slate-500">CPU</div>
                  <div className="text-sm font-bold text-slate-900">
                    {data.cpuPercent.toFixed(1)}%
                  </div>
                </div>
              )}
              {data.memoryPercent !== undefined && (
                <div>
                  <div className="text-xs text-slate-500">Memory</div>
                  <div className="text-sm font-bold text-slate-900">
                    {data.memoryPercent.toFixed(1)}%
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="px-3 py-2 flex items-center gap-2">
          {onViewDetails && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onViewDetails(data.nodeId);
              }}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              Details
            </button>
          )}
          {onViewLogs && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onViewLogs(data.nodeId);
              }}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded transition-colors"
            >
              <Activity className="w-3.5 h-3.5" />
              Logs
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
