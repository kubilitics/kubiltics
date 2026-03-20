import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface CollapsibleSectionProps {
  /** Section title */
  title: string;
  /** Optional icon */
  icon?: React.ElementType;
  /** Whether the section starts expanded */
  defaultOpen?: boolean;
  /** Optional badge/count to show in the header */
  badge?: ReactNode;
  /** Content of the section */
  children: ReactNode;
  /** Additional className for the outer wrapper */
  className?: string;
}

/**
 * A collapsible section for detail pages.
 * Header click toggles content visibility with a smooth animation.
 */
export function CollapsibleSection({
  title,
  icon: Icon,
  defaultOpen = true,
  badge,
  children,
  className,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={cn('border border-border rounded-xl overflow-hidden', className)}>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className={cn(
          'w-full flex items-center gap-3 px-5 py-3.5 text-left',
          'bg-muted/30 hover:bg-muted/50 transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'
        )}
        aria-expanded={isOpen}
      >
        {Icon && <Icon className="h-4 w-4 text-muted-foreground shrink-0" />}
        <span className="text-sm font-semibold text-foreground flex-1">{title}</span>
        {badge && <span className="mr-2">{badge}</span>}
        <ChevronDown
          className={cn(
            'h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-5 py-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
