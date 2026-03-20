/**
 * TopologyAnnotations — Right-click context menu + note dialog for topology nodes.
 *
 * Features:
 * - Right-click context menu on topology nodes with "Add Note" / "Edit Note" / "Delete Note"
 * - Note dialog with text input
 * - Noted nodes show speech-bubble badge indicator
 * - Hover shows tooltip with note text
 * - Notes persisted via useTopologyAnnotations hook (TanStack Query)
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  useTopologyAnnotations,
  type TopologyAnnotation,
} from '@/hooks/useTopologyAnnotations';

// ─── Context Menu ───────────────────────────────────────────────────────────

export interface ContextMenuPosition {
  x: number;
  y: number;
  nodeId: string;
}

interface AnnotationContextMenuProps {
  position: ContextMenuPosition | null;
  hasNote: boolean;
  onAddNote: () => void;
  onEditNote: () => void;
  onDeleteNote: () => void;
  onClose: () => void;
}

export const AnnotationContextMenu = memo(function AnnotationContextMenu({
  position,
  hasNote,
  onAddNote,
  onEditNote,
  onDeleteNote,
  onClose,
}: AnnotationContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!position) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [position, onClose]);

  // Close on escape
  useEffect(() => {
    if (!position) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [position, onClose]);

  if (!position) return null;

  return (
    <AnimatePresence>
      <motion.div
        ref={menuRef}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.1 }}
        className="fixed z-[9999] min-w-[180px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
        style={{ left: position.x, top: position.y }}
        role="menu"
        aria-label="Node annotation actions"
      >
        {!hasNote ? (
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
            onClick={() => {
              onAddNote();
              onClose();
            }}
            role="menuitem"
          >
            <svg className="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Note
          </button>
        ) : (
          <>
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
              onClick={() => {
                onEditNote();
                onClose();
              }}
              role="menuitem"
            >
              <svg className="h-4 w-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit Note
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
              onClick={() => {
                onDeleteNote();
                onClose();
              }}
              role="menuitem"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete Note
            </button>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
});

// ─── Note Dialog ────────────────────────────────────────────────────────────

interface NoteDialogProps {
  open: boolean;
  initialText?: string;
  nodeLabel?: string;
  onSave: (text: string) => void;
  onCancel: () => void;
  isSaving?: boolean;
}

export const NoteDialog = memo(function NoteDialog({
  open,
  initialText = '',
  nodeLabel,
  onSave,
  onCancel,
  isSaving,
}: NoteDialogProps) {
  const [text, setText] = useState(initialText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(initialText);
  }, [initialText, open]);

  useEffect(() => {
    if (open) {
      // Focus textarea after animation
      const timer = setTimeout(() => textareaRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (text.trim()) onSave(text.trim());
      }
      if (e.key === 'Escape') onCancel();
    },
    [text, onSave, onCancel],
  );

  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[10000] flex items-center justify-center">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/30 dark:bg-black/50"
          onClick={onCancel}
        />

        {/* Dialog */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="relative z-10 w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-gray-800"
          role="dialog"
          aria-modal="true"
          aria-label={nodeLabel ? `Add note to ${nodeLabel}` : 'Add topology note'}
        >
          <h3 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
            {initialText ? 'Edit Note' : 'Add Note'}
            {nodeLabel && (
              <span className="ml-1 text-sm font-normal text-gray-500 dark:text-gray-400">
                — {nodeLabel}
              </span>
            )}
          </h3>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your note here..."
            className="h-28 w-full resize-none rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500 dark:focus:border-blue-400"
            maxLength={500}
            aria-label="Note text"
          />

          <div className="mt-1 text-right text-[11px] text-gray-400 dark:text-gray-500">
            {text.length}/500
          </div>

          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] text-gray-400 dark:text-gray-500">
              {navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'}+Enter to save
            </span>
            <div className="flex gap-2">
              <button
                onClick={onCancel}
                className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                onClick={() => text.trim() && onSave(text.trim())}
                disabled={!text.trim() || isSaving}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
});

// ─── Speech Bubble Badge ────────────────────────────────────────────────────

interface NoteBadgeProps {
  annotations: TopologyAnnotation[];
  /** Position offset from top-right of node */
  offsetX?: number;
  offsetY?: number;
}

export const NoteBadge = memo(function NoteBadge({
  annotations,
  offsetX = -4,
  offsetY = -4,
}: NoteBadgeProps) {
  const [hovered, setHovered] = useState(false);

  if (annotations.length === 0) return null;

  const latestNote = annotations[annotations.length - 1];

  return (
    <div
      className="absolute"
      style={{ top: offsetY, right: offsetX }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Speech bubble icon */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white shadow-sm ring-2 ring-white dark:ring-gray-800"
        aria-label={`${annotations.length} note${annotations.length > 1 ? 's' : ''}`}
      >
        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zm-4 0H9v2h2V9z"
            clipRule="evenodd"
          />
        </svg>
      </motion.div>

      {/* Tooltip on hover */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-gray-200 bg-white p-2.5 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-800"
          >
            {annotations.map((ann) => (
              <div key={ann.id} className="mb-1 last:mb-0">
                <p className="text-gray-700 dark:text-gray-200">{ann.text}</p>
                <p className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">
                  {new Date(ann.createdAt).toLocaleDateString()}
                  {ann.author && ` by ${ann.author}`}
                </p>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

// ─── Controller Hook ────────────────────────────────────────────────────────

/**
 * useAnnotationController — Orchestrates context menu, dialog, and API calls.
 * Wire this into your topology canvas component.
 */
export function useAnnotationController(clusterId: string | undefined) {
  const {
    annotations,
    hasAnnotation,
    getNodeAnnotations,
    createAnnotation,
    updateAnnotation,
    deleteAnnotation,
    isCreating,
    isDeleting,
    isLoading,
    error,
  } = useTopologyAnnotations(clusterId);

  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null);
  const [dialogState, setDialogState] = useState<{
    open: boolean;
    nodeId: string;
    nodeLabel: string;
    editingAnnotationId?: string;
    initialText?: string;
  }>({ open: false, nodeId: '', nodeLabel: '' });

  // Handle right-click on a topology node
  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, nodeId: string) => {
      event.preventDefault();
      event.stopPropagation();
      setContextMenu({ x: event.clientX, y: event.clientY, nodeId });
    },
    [],
  );

  // Open dialog for adding a new note
  const openAddDialog = useCallback(
    (nodeId: string, nodeLabel: string) => {
      setDialogState({
        open: true,
        nodeId,
        nodeLabel,
        initialText: '',
      });
    },
    [],
  );

  // Open dialog for editing an existing note
  const openEditDialog = useCallback(
    (nodeId: string, nodeLabel: string) => {
      const nodeAnnotations = getNodeAnnotations(nodeId);
      if (nodeAnnotations.length === 0) return;
      const latest = nodeAnnotations[nodeAnnotations.length - 1];
      setDialogState({
        open: true,
        nodeId,
        nodeLabel,
        editingAnnotationId: latest.id,
        initialText: latest.text,
      });
    },
    [getNodeAnnotations],
  );

  // Save note (create or update)
  const handleSave = useCallback(
    async (text: string) => {
      try {
        if (dialogState.editingAnnotationId) {
          await updateAnnotation({
            id: dialogState.editingAnnotationId,
            text,
          });
        } else {
          await createAnnotation({
            nodeId: dialogState.nodeId,
            text,
          });
        }
        setDialogState((prev) => ({ ...prev, open: false }));
      } catch {
        // Error is surfaced via the hook's error state
      }
    },
    [dialogState, createAnnotation, updateAnnotation],
  );

  // Delete note for a node
  const handleDelete = useCallback(
    async (nodeId: string) => {
      const nodeAnnotations = getNodeAnnotations(nodeId);
      for (const ann of nodeAnnotations) {
        await deleteAnnotation(ann.id);
      }
    },
    [getNodeAnnotations, deleteAnnotation],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const closeDialog = useCallback(
    () => setDialogState((prev) => ({ ...prev, open: false })),
    [],
  );

  return {
    // State
    annotations,
    contextMenu,
    dialogState,
    isLoading,
    isCreating,
    isDeleting,
    error,

    // Queries
    hasAnnotation,
    getNodeAnnotations,

    // Actions
    handleNodeContextMenu,
    openAddDialog,
    openEditDialog,
    handleSave,
    handleDelete,
    closeContextMenu,
    closeDialog,
  };
}
