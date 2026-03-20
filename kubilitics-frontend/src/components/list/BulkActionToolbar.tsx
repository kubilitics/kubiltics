import { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';

export interface BulkActionToolbarProps {
  /** Number of selected items */
  selectedCount: number;
  /** Singular resource name (e.g. "pod") */
  resourceName: string;
  /** Called to deselect all */
  onClearSelection: () => void;
  /** Action buttons or elements to render */
  children: ReactNode;
}

/**
 * A floating bulk action toolbar that appears when items are selected.
 * Animates in/out with slide-up + fade.
 */
export function BulkActionToolbar({
  selectedCount,
  resourceName,
  onClearSelection,
  children,
}: BulkActionToolbarProps) {
  const plural = selectedCount === 1 ? resourceName : `${resourceName}s`;

  return (
    <AnimatePresence>
      {selectedCount > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="flex items-center gap-3 px-4 py-2.5 bg-primary/5 dark:bg-primary/10 border border-primary/20 rounded-xl"
          role="toolbar"
          aria-label={`Bulk actions for ${selectedCount} selected ${plural}`}
        >
          <div className="flex items-center gap-2 pr-3 border-r border-primary/20">
            <span className="inline-flex items-center justify-center h-6 min-w-[1.5rem] px-1.5 rounded-md bg-primary text-primary-foreground text-xs font-bold tabular-nums">
              {selectedCount}
            </span>
            <span className="text-sm font-medium text-foreground">
              {plural} selected
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearSelection}
              className="h-6 w-6 p-0 rounded-md hover:bg-destructive/10 hover:text-destructive"
              aria-label="Clear selection"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
