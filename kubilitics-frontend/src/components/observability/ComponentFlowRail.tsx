/**
 * ComponentFlowRail — horizontal pipeline of 4 component cards connected by
 * directional arrows, showing the tracing install flow:
 *   cert-manager → otel-operator → kubilitics-collector → trace-ingestion
 *
 * Stacks vertically below 768px. Connector lines color emerald when both
 * adjacent cards are 'ready'. Each card animates in with a 50ms stagger.
 */
import { useReducedMotion, motion, AnimatePresence } from 'framer-motion';
import { Check, AlertCircle, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TracingComponent, ComponentStatus } from '@/services/api/observability';

interface ComponentFlowRailProps {
  components: TracingComponent[];
  className?: string;
}

// ─── Status helpers ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  ComponentStatus,
  {
    dotClass: string;
    label: string;
    labelClass: string;
    pulse: boolean;
    shimmer: boolean;
  }
> = {
  ready: {
    dotClass: 'bg-emerald-500',
    label: 'READY',
    labelClass: 'text-emerald-600 dark:text-emerald-400',
    pulse: false,
    shimmer: false,
  },
  installing: {
    dotClass: 'bg-amber-500 animate-pulse',
    label: 'INSTALLING',
    labelClass: 'text-amber-600 dark:text-amber-400',
    pulse: true,
    shimmer: true,
  },
  missing: {
    dotClass: 'border-2 border-border bg-transparent',
    label: 'WAITING',
    labelClass: 'text-muted-foreground',
    pulse: false,
    shimmer: false,
  },
  'no-data': {
    dotClass: 'bg-amber-400',
    label: 'NO DATA',
    labelClass: 'text-amber-600 dark:text-amber-400',
    pulse: false,
    shimmer: false,
  },
};

function StatusDot({ status }: { status: ComponentStatus }) {
  const cfg = STATUS_CONFIG[status];
  if (status === 'ready') {
    return (
      <span className="relative flex h-2 w-2">
        <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
    );
  }
  if (status === 'installing') {
    return (
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
      </span>
    );
  }
  return <span className={cn('inline-flex h-2 w-2 rounded-full', cfg.dotClass)} />;
}

function StatusLabel({ status }: { status: ComponentStatus }) {
  const cfg = STATUS_CONFIG[status];
  if (cfg.shimmer) {
    return (
      <span
        className={cn(
          'text-[11px] font-semibold tracking-[0.08em] uppercase tabular-nums',
          'relative overflow-hidden',
          cfg.labelClass,
        )}
      >
        <span className="relative z-10">{cfg.label}</span>
        {/* shimmer overlay */}
        <span
          className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/30 to-transparent"
          aria-hidden
        />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'text-[11px] font-semibold tracking-[0.08em] uppercase tabular-nums',
        cfg.labelClass,
      )}
    >
      {cfg.label}
    </span>
  );
}

/** Secondary fact: version, pod status, or endpoint count */
function SecondaryFact({ component }: { component: TracingComponent }) {
  if (component.version_installed) {
    return (
      <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
        v{component.version_installed}
      </span>
    );
  }
  if (component.pod_status) {
    return (
      <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
        {component.pod_status}
      </span>
    );
  }
  if (component.service_endpoints !== undefined) {
    return (
      <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
        {component.service_endpoints} endpoint{component.service_endpoints !== 1 ? 's' : ''}
      </span>
    );
  }
  if (component.version_required) {
    return (
      <span className="font-mono text-[11px] text-muted-foreground/50 tabular-nums">
        requires v{component.version_required}
      </span>
    );
  }
  return null;
}

// ─── Connector ───────────────────────────────────────────────────────────────

function HorizontalConnector({ active }: { active: boolean }) {
  return (
    <div
      className="hidden md:flex items-center justify-center shrink-0 w-8"
      aria-hidden
    >
      <div
        className={cn(
          'flex-1 h-px transition-colors duration-500',
          active ? 'bg-emerald-500' : 'bg-border',
        )}
      />
      <ChevronRight
        className={cn(
          'h-4 w-4 -ml-1 shrink-0 transition-colors duration-500',
          active ? 'text-emerald-500' : 'text-muted-foreground/40',
        )}
      />
    </div>
  );
}

function VerticalConnector({ active }: { active: boolean }) {
  return (
    <div
      className="flex md:hidden flex-col items-center h-6 shrink-0"
      aria-hidden
    >
      <div
        className={cn(
          'w-px flex-1 transition-colors duration-500',
          active ? 'bg-emerald-500' : 'bg-border',
        )}
      />
      <ChevronDown
        className={cn(
          'h-4 w-4 -mt-1 shrink-0 transition-colors duration-500',
          active ? 'text-emerald-500' : 'text-muted-foreground/40',
        )}
      />
    </div>
  );
}

// ─── Single card ─────────────────────────────────────────────────────────────

interface ComponentCardProps {
  component: TracingComponent;
  index: number;
  reducedMotion: boolean;
}

function ComponentCard({ component, index, reducedMotion }: ComponentCardProps) {
  const cfg = STATUS_CONFIG[component.status];
  const isReady = component.status === 'ready';

  const cardVariants = {
    hidden: reducedMotion
      ? { opacity: 0 }
      : { opacity: 0, y: 8 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.2,
        ease: 'easeOut',
        delay: index * 0.05,
      },
    },
  };

  // Pulse outline animation when status just became ready
  const readyPulseVariants = {
    initial: { boxShadow: '0 0 0 0px rgba(16,185,129,0)' },
    pulse: {
      boxShadow: [
        '0 0 0 0px rgba(16,185,129,0)',
        '0 0 0 3px rgba(16,185,129,0.35)',
        '0 0 0 0px rgba(16,185,129,0)',
      ],
      transition: {
        duration: 0.4,
        repeat: 2,
        ease: 'easeOut',
      },
    },
  };

  return (
    <motion.div
      className={cn(
        'flex-1 min-h-[140px] rounded-lg border border-border/60 bg-card p-6',
        'flex flex-col gap-2 glass-panel soft-shadow',
        component.status === 'missing' && 'opacity-60',
      )}
      variants={cardVariants}
      initial="hidden"
      animate={isReady && !reducedMotion ? ['visible', 'pulse'] : 'visible'}
      aria-label={`${component.name}: ${cfg.label}`}
    >
      {/* Row 1: title + status dot */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-base font-semibold text-foreground leading-tight">
          {component.name}
        </span>
        <StatusDot status={component.status} />
      </div>

      {/* Row 2: namespace */}
      <div className="min-h-[16px]">
        {component.namespace ? (
          <span className="font-mono text-[11px] text-muted-foreground">
            {component.namespace}
          </span>
        ) : null}
      </div>

      {/* Row 3: status label (shimmer when installing) */}
      <StatusLabel status={component.status} />

      {/* Row 4: secondary fact */}
      <SecondaryFact component={component} />
    </motion.div>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function ComponentFlowRail({ components, className }: ComponentFlowRailProps) {
  const reducedMotion = useReducedMotion() ?? false;

  // Ordered pipeline keys — render in this order regardless of API order
  const PIPELINE_ORDER: TracingComponent['key'][] = [
    'cert-manager',
    'otel-operator',
    'kubilitics-collector',
    'trace-ingestion',
  ];

  // Build an ordered list, filling gaps with a placeholder if API omits a key
  const ordered = PIPELINE_ORDER.map(
    (key) =>
      components.find((c) => c.key === key) ??
      ({
        key,
        name: key,
        status: 'missing' as ComponentStatus,
        version_installed: null,
        skip_if_present: false,
      } satisfies TracingComponent),
  );

  return (
    <div
      className={cn('flex flex-col md:flex-row items-stretch gap-0', className)}
      role="list"
      aria-label="Component pipeline"
    >
      {ordered.map((component, i) => {
        const isLast = i === ordered.length - 1;
        const connectorActive =
          !isLast &&
          component.status === 'ready' &&
          ordered[i + 1].status === 'ready';

        return (
          <div
            key={component.key}
            className="contents"
            role="listitem"
          >
            <ComponentCard
              component={component}
              index={i}
              reducedMotion={reducedMotion}
            />
            {!isLast && (
              <>
                <HorizontalConnector active={connectorActive} />
                <VerticalConnector active={connectorActive} />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
