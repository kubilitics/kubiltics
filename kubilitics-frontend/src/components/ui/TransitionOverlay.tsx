/**
 * TransitionOverlay — reusable filter-transition overlay
 * Shows a sonar-ripple animation over content during data transitions.
 * Used on Topology canvas and available for any page with filter-driven refetches.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { Network } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TransitionOverlayProps {
  /** Whether the overlay is visible */
  visible: boolean;
  /** Optional message shown during transition */
  message?: string;
  /** 'canvas' for topology graph overlays, 'table' for list pages */
  variant?: 'canvas' | 'table';
  /** Additional className */
  className?: string;
}

export function TransitionOverlay({
  visible,
  message,
  variant = 'canvas',
  className,
}: TransitionOverlayProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className={cn(
            'absolute inset-0 z-30 flex items-center justify-center pointer-events-none',
            variant === 'canvas'
              ? 'bg-background/60 backdrop-blur-[2px]'
              : 'bg-background/40',
            className,
          )}
        >
          <div className="flex flex-col items-center gap-3">
            {/* Sonar ripple — two concentric expanding rings */}
            <div className="relative w-12 h-12">
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-primary/30"
                animate={{ scale: [1, 1.8], opacity: [0.6, 0] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}
              />
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-primary/30"
                animate={{ scale: [1, 1.8], opacity: [0.6, 0] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut', delay: 0.4 }}
              />
              <div className="absolute inset-2 rounded-full bg-primary/10 flex items-center justify-center">
                <Network className="h-4 w-4 text-primary/60" />
              </div>
            </div>
            {message && (
              <span className="text-xs font-medium text-muted-foreground tracking-wide">
                {message}
              </span>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
