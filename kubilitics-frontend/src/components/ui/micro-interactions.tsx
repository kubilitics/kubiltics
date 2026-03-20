/**
 * Micro-Interactions — Animated UI components for lively feedback
 *
 * TASK-UX-012: UI feels alive and responsive to state changes
 */

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useSpring, useTransform } from 'framer-motion';
import { cn } from '@/lib/utils';

// ─── Animated Counter Badge ──────────────────────────────────────────────────

interface AnimatedCounterProps {
  value: number;
  className?: string;
  /** Duration of the count animation in ms */
  duration?: number;
}

/**
 * AnimatedCounter — Badge counter that animates when value changes.
 *
 * @example
 * <AnimatedCounter value={podCount} className="text-sm font-bold" />
 */
export function AnimatedCounter({ value, className, duration = 300 }: AnimatedCounterProps) {
  const spring = useSpring(value, {
    stiffness: 200,
    damping: 30,
    duration: duration / 1000,
  });
  const display = useTransform(spring, (current) => Math.round(current));
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    spring.set(value);
  }, [value, spring]);

  useEffect(() => {
    const unsubscribe = display.on('change', (v) => setDisplayValue(v));
    return unsubscribe;
  }, [display]);

  return (
    <motion.span
      key={value}
      className={className}
      initial={{ scale: 1 }}
      animate={{ scale: [1, 1.15, 1] }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
    >
      {displayValue}
    </motion.span>
  );
}

// ─── Pulse on Update Card ────────────────────────────────────────────────────

interface PulseOnUpdateProps {
  /** Trigger value — when this changes, the pulse fires */
  trigger: unknown;
  children: React.ReactNode;
  className?: string;
  /** Pulse color (CSS class) */
  pulseColor?: string;
}

/**
 * PulseOnUpdate — Briefly pulses when data updates via WebSocket.
 *
 * @example
 * <PulseOnUpdate trigger={resource.resourceVersion}>
 *   <Card>...</Card>
 * </PulseOnUpdate>
 */
export function PulseOnUpdate({
  trigger,
  children,
  className,
  pulseColor = 'ring-primary/30',
}: PulseOnUpdateProps) {
  const [isPulsing, setIsPulsing] = useState(false);
  const prevTrigger = useRef(trigger);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      prevTrigger.current = trigger;
      return;
    }

    if (trigger !== prevTrigger.current) {
      prevTrigger.current = trigger;
      setIsPulsing(true);
      const timer = setTimeout(() => setIsPulsing(false), 600);
      return () => clearTimeout(timer);
    }
  }, [trigger]);

  return (
    <div
      className={cn(
        'transition-shadow duration-600',
        isPulsing && `ring-2 ${pulseColor} shadow-lg`,
        className
      )}
    >
      {children}
    </div>
  );
}

// ─── Toast Notification ──────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastData {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration?: number;
}

const TOAST_ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

const TOAST_STYLES: Record<ToastType, string> = {
  success: 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-200',
  error: 'bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-800/50 text-red-800 dark:text-red-200',
  warning: 'bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-200',
  info: 'bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800/50 text-blue-800 dark:text-blue-200',
};

/**
 * StateChangeToast — Animated toast for significant state changes.
 *
 * @example
 * <StateChangeToast toast={{ id: '1', type: 'error', title: 'Pod crashed', description: 'nginx-abc123 in production' }} onDismiss={...} />
 */
export function StateChangeToast({
  toast,
  onDismiss,
}: {
  toast: ToastData;
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, toast.duration ?? 5000);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.95 }}
      transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
      className={cn(
        'flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-sm max-w-sm',
        TOAST_STYLES[toast.type]
      )}
      role="alert"
    >
      <span className="text-lg font-bold leading-none mt-0.5">
        {TOAST_ICONS[toast.type]}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">{toast.title}</p>
        {toast.description && (
          <p className="text-xs mt-0.5 opacity-80">{toast.description}</p>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="text-xs opacity-50 hover:opacity-100 transition-opacity shrink-0 mt-0.5"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </motion.div>
  );
}

// ─── Toast Container ─────────────────────────────────────────────────────────

/**
 * ToastContainer — Renders a stack of toasts with animations.
 *
 * @example
 * <ToastContainer toasts={toasts} onDismiss={removeToast} />
 */
export function ToastContainer({
  toasts,
  onDismiss,
  position = 'bottom-right',
}: {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
  position?: 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left';
}) {
  const positionClasses: Record<string, string> = {
    'top-right': 'top-4 right-4',
    'bottom-right': 'bottom-4 right-4',
    'top-left': 'top-4 left-4',
    'bottom-left': 'bottom-4 left-4',
  };

  return (
    <div
      className={cn(
        'fixed z-[100] flex flex-col gap-2 pointer-events-none',
        positionClasses[position]
      )}
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto">
            <StateChangeToast toast={toast} onDismiss={onDismiss} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ─── Page Transition Wrapper ─────────────────────────────────────────────────

/**
 * PageTransition — Smooth page exit → enter animations.
 *
 * @example
 * <PageTransition>
 *   <DashboardPage />
 * </PageTransition>
 */
export function PageTransition({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{
        duration: 0.2,
        ease: [0.23, 1, 0.32, 1],
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─── Staggered Children ──────────────────────────────────────────────────────

/**
 * StaggeredReveal — Children appear sequentially with 50ms delay.
 *
 * @example
 * <StaggeredReveal>
 *   <Card>1</Card>
 *   <Card>2</Card>
 *   <Card>3</Card>
 * </StaggeredReveal>
 */
export function StaggeredReveal({
  children,
  staggerDelay = 0.05,
  className,
}: {
  children: React.ReactNode;
  staggerDelay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: {
            staggerChildren: staggerDelay,
          },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * StaggeredChild — Wrap each child in StaggeredReveal.
 */
export function StaggeredChild({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 10 },
        visible: { opacity: 1, y: 0 },
      }}
      transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─── Scale on Press ──────────────────────────────────────────────────────────

/**
 * Pressable — Scale-down effect on press for buttons and cards.
 */
export function Pressable({
  children,
  className,
  scale = 0.97,
  ...props
}: {
  children: React.ReactNode;
  className?: string;
  scale?: number;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <motion.div
      whileTap={{ scale }}
      transition={{ duration: 0.1 }}
      className={className}
      {...(props as Record<string, unknown>)}
    >
      {children}
    </motion.div>
  );
}
