/**
 * InlineTableActions — Hover-revealed action buttons on resource table rows
 *
 * TASK-UX-006: Inline Table Actions
 * Reduces clicks for common operations (scale, restart, delete, view YAML).
 */

import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  MoreHorizontal,
  Scale,
  RefreshCw,
  Trash2,
  FileCode,
  Copy,
  ExternalLink,
  Edit,
  Play,
  Pause,
  Square,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ActionType =
  | 'scale'
  | 'restart'
  | 'delete'
  | 'yaml'
  | 'edit'
  | 'copy-name'
  | 'open-detail'
  | 'pause'
  | 'resume'
  | 'stop';

export interface TableAction {
  id: ActionType;
  label: string;
  icon: LucideIcon;
  /** Action handler — receives the resource item */
  onClick: (item: unknown) => void;
  /** Variant for destructive actions */
  variant?: 'default' | 'destructive';
  /** Confirm dialog before executing */
  confirm?: boolean;
  /** Confirm message */
  confirmMessage?: string;
  /** Only show for certain resource kinds */
  kinds?: string[];
  /** Keyboard shortcut hint */
  shortcut?: string;
}

// ─── Default Actions for Resource Types ──────────────────────────────────────

export const DEFAULT_ACTIONS: Record<string, TableAction[]> = {
  deployment: [
    { id: 'scale', label: 'Scale', icon: Scale, onClick: () => {}, shortcut: 's' },
    { id: 'restart', label: 'Restart', icon: RefreshCw, onClick: () => {}, confirm: true, confirmMessage: 'Restart this deployment? All pods will be recreated.' },
    { id: 'yaml', label: 'View YAML', icon: FileCode, onClick: () => {}, shortcut: 'y' },
    { id: 'delete', label: 'Delete', icon: Trash2, onClick: () => {}, variant: 'destructive', confirm: true, confirmMessage: 'Delete this deployment? This action cannot be undone.' },
  ],
  statefulset: [
    { id: 'scale', label: 'Scale', icon: Scale, onClick: () => {} },
    { id: 'restart', label: 'Restart', icon: RefreshCw, onClick: () => {}, confirm: true },
    { id: 'yaml', label: 'View YAML', icon: FileCode, onClick: () => {} },
    { id: 'delete', label: 'Delete', icon: Trash2, onClick: () => {}, variant: 'destructive', confirm: true },
  ],
  pod: [
    { id: 'yaml', label: 'View YAML', icon: FileCode, onClick: () => {} },
    { id: 'delete', label: 'Delete', icon: Trash2, onClick: () => {}, variant: 'destructive', confirm: true, confirmMessage: 'Delete this pod?' },
  ],
  service: [
    { id: 'yaml', label: 'View YAML', icon: FileCode, onClick: () => {} },
    { id: 'delete', label: 'Delete', icon: Trash2, onClick: () => {}, variant: 'destructive', confirm: true },
  ],
  default: [
    { id: 'yaml', label: 'View YAML', icon: FileCode, onClick: () => {} },
    { id: 'delete', label: 'Delete', icon: Trash2, onClick: () => {}, variant: 'destructive', confirm: true },
  ],
};

// ─── Inline Action Button ────────────────────────────────────────────────────

function ActionButton({
  action,
  item,
  onConfirmRequest,
}: {
  action: TableAction;
  item: unknown;
  onConfirmRequest?: (action: TableAction, item: unknown) => void;
}) {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      if (action.confirm && onConfirmRequest) {
        onConfirmRequest(action, item);
      } else {
        action.onClick(item);
      }
    },
    [action, item, onConfirmRequest]
  );

  const Icon = action.icon;

  return (
    <button
      onClick={handleClick}
      className={cn(
        'inline-flex items-center justify-center h-7 w-7 rounded-md transition-all duration-150',
        'opacity-0 group-hover/row:opacity-100 focus:opacity-100',
        'focus:outline-none focus:ring-2 focus:ring-primary/30',
        action.variant === 'destructive'
          ? 'text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-300'
          : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200'
      )}
      title={action.label + (action.shortcut ? ` (${action.shortcut})` : '')}
      aria-label={action.label}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

// ─── Row Actions Container ───────────────────────────────────────────────────

export interface InlineTableActionsProps {
  /** The resource item this row represents */
  item: unknown;
  /** Resource kind (deployment, pod, etc.) — determines available actions */
  kind?: string;
  /** Custom actions (overrides default) */
  actions?: TableAction[];
  /** Callback when a destructive action needs confirmation */
  onConfirmRequest?: (action: TableAction, item: unknown) => void;
  /** Additional className */
  className?: string;
}

/**
 * InlineTableActions — Render hover-revealed action buttons in a table row.
 *
 * @example
 * <tr className="group/row">
 *   <td>...</td>
 *   <td><InlineTableActions item={resource} kind="deployment" /></td>
 * </tr>
 */
export function InlineTableActions({
  item,
  kind = 'default',
  actions: customActions,
  onConfirmRequest,
  className,
}: InlineTableActionsProps) {
  const actions = customActions ?? DEFAULT_ACTIONS[kind.toLowerCase()] ?? DEFAULT_ACTIONS.default;

  return (
    <div className={cn('flex items-center gap-0.5 justify-end', className)}>
      {actions.map((action) => (
        <ActionButton
          key={action.id}
          action={action}
          item={item}
          onConfirmRequest={onConfirmRequest}
        />
      ))}
    </div>
  );
}

// ─── Batch Actions Toolbar ───────────────────────────────────────────────────

export interface BatchActionsToolbarProps {
  /** Number of selected items */
  selectedCount: number;
  /** Available batch actions */
  actions: Array<{
    id: string;
    label: string;
    icon: LucideIcon;
    onClick: () => void;
    variant?: 'default' | 'destructive';
  }>;
  /** Clear selection callback */
  onClearSelection: () => void;
  /** Additional className */
  className?: string;
}

/**
 * BatchActionsToolbar — Shows when multiple rows are selected.
 *
 * @example
 * {selectedItems.length > 0 && (
 *   <BatchActionsToolbar
 *     selectedCount={selectedItems.length}
 *     actions={[
 *       { id: 'restart', label: 'Restart Selected', icon: RefreshCw, onClick: handleBatchRestart },
 *       { id: 'delete', label: 'Delete Selected', icon: Trash2, onClick: handleBatchDelete, variant: 'destructive' },
 *     ]}
 *     onClearSelection={clearSelection}
 *   />
 * )}
 */
export function BatchActionsToolbar({
  selectedCount,
  actions,
  onClearSelection,
  className,
}: BatchActionsToolbarProps) {
  if (selectedCount === 0) return null;

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-2.5 rounded-xl',
        'bg-primary/5 dark:bg-primary/10 border border-primary/20 dark:border-primary/30',
        'animate-in slide-in-from-top-2 duration-200',
        className
      )}
      role="toolbar"
      aria-label={`Batch actions for ${selectedCount} selected items`}
    >
      <span className="text-sm font-semibold text-primary">
        {selectedCount} selected
      </span>

      <div className="h-4 w-px bg-primary/20 dark:bg-primary/30" />

      <div className="flex items-center gap-1">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              onClick={action.onClick}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                action.variant === 'destructive'
                  ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40'
                  : 'text-primary hover:bg-primary/10 dark:hover:bg-primary/20'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {action.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1" />

      <button
        onClick={onClearSelection}
        className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
      >
        Clear selection
      </button>
    </div>
  );
}

// ─── Row Selection Hook ──────────────────────────────────────────────────────

/**
 * Hook for managing table row selection state.
 *
 * @example
 * const { selectedIds, toggleItem, selectAll, clearSelection, isSelected } = useRowSelection<string>();
 */
export function useRowSelection<T extends string | number>() {
  const [selectedIds, setSelectedIds] = useState<Set<T>>(new Set());

  const toggleItem = useCallback((id: T) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: T[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const isSelected = useCallback(
    (id: T) => selectedIds.has(id),
    [selectedIds]
  );

  return {
    selectedIds,
    selectedCount: selectedIds.size,
    toggleItem,
    selectAll,
    clearSelection,
    isSelected,
  };
}
