import React, { useEffect, useState, useRef } from 'react';
import type cytoscape from 'cytoscape';
import { Copy, ScrollText, FileText, Activity, Network, Bomb, Route, Edit, Trash2 } from 'lucide-react';

export interface ContextMenuAction {
  id: string;
  label: string;
  icon?: React.ReactNode;
  action: (nodeId: string) => Promise<void> | void;
  enabled?: boolean;
  danger?: boolean;
  divider?: boolean;
}

export interface ContextMenuProps {
  cy: cytoscape.Core;
  onAction?: (actionId: string, nodeId: string) => void;
}

/**
 * ContextMenu - Right-click context menu for topology nodes
 *
 * PRD Section 7.4: 11 items (9 actions + 2 separators)
 * 1. Copy Resource Name  2. View Logs  3. View Full YAML  4. Show Metrics
 * 5. ---  6. Inspect Dependencies  7. Compute Blast Radius  8. Trace User Journey
 * 9. ---  10. Edit Resource  11. Delete
 */
export const ContextMenu: React.FC<ContextMenuProps> = ({ cy, onAction }) => {
  const [menu, setMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    nodeId: string | null;
  }>({
    visible: false,
    x: 0,
    y: 0,
    nodeId: null,
  });

  const menuRef = useRef<HTMLDivElement>(null);

  // All 11 menu actions as specified in PRD Section 7.4
  const getActions = (nodeId: string): ContextMenuAction[] => {
    return [
      // 1. Copy Resource Name
      {
        id: 'copy-name',
        label: 'Copy Resource Name',
        icon: <Copy className="w-4 h-4" />,
        action: async (nodeId: string) => {
          const node = cy.getElementById(nodeId);
          if (node.length > 0) {
            const name = node.data('name') || nodeId;
            await navigator.clipboard.writeText(name);
            console.log('Copied resource name:', name);
          }
        },
      },

      // 2. View Logs (ADDED - was missing)
      {
        id: 'view-logs',
        label: 'View Logs',
        icon: <ScrollText className="w-4 h-4" />,
        action: (nodeId: string) => {
          onAction?.('view-logs', nodeId);
          console.log('View logs for:', nodeId);
        },
      },

      // 3. View Full YAML
      {
        id: 'view-yaml',
        label: 'View Full YAML',
        icon: <FileText className="w-4 h-4" />,
        action: (nodeId: string) => {
          onAction?.('view-yaml', nodeId);
          console.log('View YAML for:', nodeId);
        },
      },

      // 4. Show Metrics
      {
        id: 'show-metrics',
        label: 'Show Metrics',
        icon: <Activity className="w-4 h-4" />,
        action: (nodeId: string) => {
          onAction?.('show-metrics', nodeId);
          console.log('Show metrics for:', nodeId);
        },
      },

      // 5. --- (Separator) - PRD Section 7.4 order
      {
        id: 'separator-0',
        label: '',
        divider: true,
        action: () => {},
      },

      // 6. Inspect Dependencies
      {
        id: 'inspect-dependencies',
        label: 'Inspect Dependencies',
        icon: <Network className="w-4 h-4" />,
        action: (nodeId: string) => {
          onAction?.('inspect-dependencies', nodeId);
          console.log('Inspect dependencies for:', nodeId);
        },
      },

      // 7. Compute Blast Radius
      {
        id: 'compute-blast-radius',
        label: 'Compute Blast Radius',
        icon: <Bomb className="w-4 h-4" />,
        action: (nodeId: string) => {
          onAction?.('compute-blast-radius', nodeId);
          console.log('Compute blast radius for:', nodeId);
        },
      },

      // 8. Trace User Journey
      {
        id: 'trace-user-journey',
        label: 'Trace User Journey',
        icon: <Route className="w-4 h-4" />,
        action: (nodeId: string) => {
          onAction?.('trace-user-journey', nodeId);
          console.log('Trace user journey from:', nodeId);
        },
      },

      // 9. --- (Separator)
      {
        id: 'separator-1',
        label: '',
        divider: true,
        action: () => {},
      },

      // 10. Edit Resource
      {
        id: 'edit-resource',
        label: 'Edit Resource',
        icon: <Edit className="w-4 h-4" />,
        action: (nodeId: string) => {
          onAction?.('edit-resource', nodeId);
          console.log('Edit resource:', nodeId);
        },
      },

      // 11. Delete
      {
        id: 'delete-resource',
        label: 'Delete',
        icon: <Trash2 className="w-4 h-4" />,
        danger: true,
        action: (nodeId: string) => {
          onAction?.('delete-resource', nodeId);
          console.log('Delete resource:', nodeId);
        },
      },
    ];
  };

  // Setup right-click event listener
  useEffect(() => {
    if (!cy) return;

    const handleContextMenu = (event: cytoscape.EventObject) => {
      const target = event.target;

      // Only show context menu on nodes, not on background or edges
      if (!target.isNode || !target.isNode()) return;

      event.preventDefault?.();
      const nodeId = target.id();
      const position = event.renderedPosition || event.position;

      // Get viewport position for absolute positioning
      const container = cy.container();
      if (!container) return;

      const containerRect = container.getBoundingClientRect();

      setMenu({
        visible: true,
        x: containerRect.left + position.x,
        y: containerRect.top + position.y,
        nodeId,
      });
    };

    const handleClickOutside = () => {
      setMenu((prev) => ({ ...prev, visible: false }));
    };

    // Cytoscape cxttap event for right-click
    cy.on('cxttap', 'node', handleContextMenu);
    cy.on('tap', handleClickOutside); // Close on any regular click
    document.addEventListener('click', handleClickOutside);

    return () => {
      cy.off('cxttap', 'node', handleContextMenu);
      cy.off('tap', handleClickOutside);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [cy]);

  // Hide menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenu((prev) => ({ ...prev, visible: false }));
      }
    };

    if (menu.visible) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [menu.visible]);

  if (!menu.visible || !menu.nodeId) {
    return null;
  }

  const actions = getActions(menu.nodeId);

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[220px] bg-white rounded-lg border-2 border-slate-700 shadow-2xl overflow-hidden"
      style={{
        left: `${menu.x}px`,
        top: `${menu.y}px`,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {actions.map((action, index) => {
        if (action.divider) {
          return (
            <div
              key={action.id}
              className="h-px bg-slate-200 my-1"
            />
          );
        }

        return (
          <button
            key={action.id}
            onClick={async () => {
              if (menu.nodeId) {
                await action.action(menu.nodeId);
                setMenu((prev) => ({ ...prev, visible: false }));
              }
            }}
            disabled={action.enabled === false}
            className={`
              w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors
              ${
                action.danger
                  ? 'text-red-700 hover:bg-red-50 hover:text-red-900'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
              }
              ${action.enabled === false ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              first:rounded-t-lg last:rounded-b-lg
            `}
          >
            {action.icon && (
              <span className="flex-shrink-0">{action.icon}</span>
            )}
            <span className="flex-1 text-left">{action.label}</span>
          </button>
        );
      })}
    </div>
  );
};
