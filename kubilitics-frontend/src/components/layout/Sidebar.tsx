import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Box,
  Layers,
  Server,
  Globe,
  Database,
  Settings,
  Shield,
  Activity,
  History,
  Network,
  FileText,
  ChevronRight,
  ChevronLeft,
  Key,
  Scale,
  Route,
  HardDrive,
  Users,
  Gauge,
  FileCode,
  Webhook,
  AlertTriangle,
  Container,
  Clock,
  Cpu,
  Lock,
  Zap,
  Camera,
  ClipboardList,
  HardDrive as StorageIcon,
  FolderKanban,
  LogOut,
  ChevronDown,
  Package,
  ShieldCheck,
  LayoutTemplate,
  Scan,
  GitCompareArrows,
  ShieldAlert,
} from 'lucide-react';
import {
  K8sPodIcon, K8sDeploymentIcon, K8sReplicaSetIcon, K8sStatefulSetIcon,
  K8sDaemonSetIcon, K8sJobIcon, K8sCronJobIcon, K8sServiceIcon, K8sIngressIcon,
  K8sEndpointsIcon, K8sNetworkPolicyIcon, K8sConfigMapIcon, K8sSecretIcon,
  K8sPVIcon, K8sPVCIcon, K8sStorageClassIcon, K8sNodeIcon, K8sNamespaceIcon,
  K8sServiceAccountIcon, K8sRoleIcon, K8sClusterRoleIcon, K8sRoleBindingIcon,
  K8sClusterRoleBindingIcon, K8sHPAIcon, K8sLimitRangeIcon,
} from '@/components/icons/k8sSidebarIcons';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useResourceCounts } from '@/hooks/useResourceCounts';
import { useMetalLBInstalled } from '@/hooks/useMetalLBInstalled';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { RecentResources } from '@/components/layout/RecentResources';
import { useHoverPrefetch } from '@/hooks/useHoverPrefetch';
import { BrandLogo } from '@/components/BrandLogo';

// ─── Types ───────────────────────────────────────────────────────────────────

interface NavItemProps {
  to: string;
  icon: React.ElementType;
  label: string;
  count?: number;
  onNavigate?: () => void;
}

interface ResourceCategory {
  id: string;
  label: string;
  icon: React.ElementType;
  items: Array<{
    to: string;
    icon: React.ElementType;
    label: string;
    countKey?: string;
    condition?: boolean;
  }>;
}

// ─── Path Constants ──────────────────────────────────────────────────────────

const WORKLOAD_PATHS = ['/workloads', '/pods', '/deployments', '/replicasets', '/statefulsets', '/daemonsets', '/jobs', '/cronjobs', '/podtemplates', '/controllerrevisions'];
const NETWORKING_PATHS = ['/networking', '/services', '/ingresses', '/ingressclasses', '/endpoints', '/endpointslices', '/networkpolicies', '/ipaddresspools', '/bgppeers'];
const STORAGE_PATHS = ['/storage', '/configmaps', '/secrets', '/persistentvolumes', '/persistentvolumeclaims', '/storageclasses', '/volumeattachments', '/volumesnapshots', '/volumesnapshotclasses', '/volumesnapshotcontents'];
const CLUSTER_PATHS = ['/cluster', '/cluster-overview', '/nodes', '/namespaces', '/events', '/apiservices', '/leases'];
const SECURITY_PATHS = ['/serviceaccounts', '/roles', '/clusterroles', '/rolebindings', '/clusterrolebindings', '/priorityclasses', '/rbac-analyzer'];
const RESOURCES_PATHS = ['/resources', '/resourcequotas', '/limitranges', '/resourceslices', '/deviceclasses'];
const SCALING_PATHS = ['/scaling', '/horizontalpodautoscalers', '/verticalpodautoscalers', '/poddisruptionbudgets'];
const CRD_PATHS = ['/crds', '/customresourcedefinitions', '/customresources'];
const ADMISSION_PATHS = ['/admission', '/mutatingwebhooks', '/validatingwebhooks'];

const ALL_RESOURCE_PATHS = [
  '/workloads',
  ...WORKLOAD_PATHS,
  ...NETWORKING_PATHS,
  ...STORAGE_PATHS,
  ...CLUSTER_PATHS,
  ...SECURITY_PATHS,
  ...RESOURCES_PATHS,
  ...SCALING_PATHS,
  ...CRD_PATHS,
  ...ADMISSION_PATHS,
];

// Category IDs
const CATEGORY_IDS = {
  WORKLOADS: 'workloads',
  NETWORKING: 'networking',
  STORAGE: 'storage',
  CLUSTER: 'cluster',
  SECURITY: 'security',
  RESOURCES: 'resources',
  SCALING: 'scaling',
  CRDS: 'crds',
  ADMISSION: 'admission',
} as const;

function isPathIn(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function getCategoryForPath(pathname: string): string | null {
  if (pathname === '/workloads' || isPathIn(pathname, WORKLOAD_PATHS)) return CATEGORY_IDS.WORKLOADS;
  if (isPathIn(pathname, NETWORKING_PATHS)) return CATEGORY_IDS.NETWORKING;
  if (isPathIn(pathname, STORAGE_PATHS)) return CATEGORY_IDS.STORAGE;
  if (isPathIn(pathname, CLUSTER_PATHS)) return CATEGORY_IDS.CLUSTER;
  if (isPathIn(pathname, SECURITY_PATHS)) return CATEGORY_IDS.SECURITY;
  if (isPathIn(pathname, RESOURCES_PATHS)) return CATEGORY_IDS.RESOURCES;
  if (isPathIn(pathname, SCALING_PATHS)) return CATEGORY_IDS.SCALING;
  if (isPathIn(pathname, CRD_PATHS)) return CATEGORY_IDS.CRDS;
  if (isPathIn(pathname, ADMISSION_PATHS)) return CATEGORY_IDS.ADMISSION;
  return null;
}

// ─── NavItem Component ───────────────────────────────────────────────────────

function NavItem({ to, icon: Icon, label, count, onNavigate }: NavItemProps) {
  const location = useLocation();
  const isActive = location.pathname === to || location.pathname.startsWith(`${to}/`);
  const itemRef = useRef<HTMLAnchorElement>(null);
  // PERF Area 2: Prefetch resource data on hover (200-400ms head start)
  const { onMouseEnter: hoverPrefetch, onMouseLeave: hoverCancel } = useHoverPrefetch();

  useEffect(() => {
    if (isActive && itemRef.current) {
      const timer = setTimeout(() => {
        if (itemRef.current) {
          itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isActive]);

  return (
    <NavLink
      ref={itemRef}
      to={to}
      onClick={onNavigate}
      onMouseEnter={() => hoverPrefetch(to)}
      onMouseLeave={hoverCancel}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-medium transition-all duration-300 group relative overflow-hidden h-10',
        isActive
          ? 'text-primary bg-primary/8 dark:bg-primary/15 border border-primary/15 dark:border-primary/25 shadow-sm'
          : 'text-slate-800 dark:text-slate-300 hover:bg-slate-100/60 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100 border border-transparent hover:translate-x-0.5'
      )}
    >
      {isActive && (
        <motion.div
          layoutId="activeNavLine"
          className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-primary"
        />
      )}
      <Icon className={cn("h-5 w-5 transition-colors relative z-10 shrink-0", isActive ? "text-primary" : "text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-slate-100")} />
      <span className={cn("flex-1 truncate relative z-10", isActive && "font-semibold")}>{label}</span>
      {count !== undefined && (
        <span
          className={cn(
            'text-[10px] font-bold px-2 py-0.5 rounded-lg min-w-[1.25rem] text-center leading-none transition-colors relative z-10',
            isActive ? 'bg-primary text-primary-foreground' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 group-hover:bg-slate-300 dark:group-hover:bg-slate-600 group-hover:text-slate-900 dark:group-hover:text-slate-100'
          )}
        >
          {count}
        </span>
      )}
    </NavLink>
  );
}

// ─── NavItemIconOnly (collapsed mode) ────────────────────────────────────────

function NavItemIconOnly({
  to,
  icon: Icon,
  label,
  iconColor,
}: {
  to: string;
  icon: React.ElementType;
  label: string;
  iconColor?: string;
}) {
  const location = useLocation();
  const isActive = location.pathname === to || location.pathname.startsWith(`${to}/`);
  return (
    <NavLink
      to={to}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex items-center justify-center w-11 h-11 rounded-xl transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:scale-105 active:scale-95 group relative border',
        isActive
          ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/30 border-transparent'
          : 'hover:bg-muted/80 border-transparent hover:border-border/50'
      )}
      title={label}
      aria-label={label}
    >
      <Icon
        className={cn(
          'h-6 w-6 transition-colors',
          isActive
            ? 'text-primary-foreground fill-primary-foreground/20'
            : iconColor || 'text-foreground group-hover:text-foreground'
        )}
        aria-hidden
      />
      <span className="absolute left-full ml-3 px-3 py-1.5 bg-popover text-popover-foreground text-sm font-medium rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 border border-border">
        {label}
      </span>
    </NavLink>
  );
}

// Search bar removed — global search in header (Cmd+K) handles resource search

// ─── Resource Sub-Category (nested accordion) ────────────────────────────────

function ResourceSubCategory({
  category,
  counts,
  isExpanded,
  onToggle,
  searchFilter,
}: {
  category: ResourceCategory;
  counts: Record<string, number>;
  isExpanded: boolean;
  onToggle: () => void;
  searchFilter: string;
}) {
  const location = useLocation();
  const pathname = location.pathname;
  const Icon = category.icon;
  const colors = CATEGORY_COLORS[category.id] ?? DEFAULT_CATEGORY_COLOR;

  // Filter items by search
  const visibleItems = useMemo(() => {
    if (!searchFilter) return category.items.filter((item) => item.condition !== false);
    const lowerFilter = searchFilter.toLowerCase();
    return category.items.filter(
      (item) => item.condition !== false && item.label.toLowerCase().includes(lowerFilter)
    );
  }, [category.items, searchFilter]);

  if (visibleItems.length === 0) return null;

  const isCategoryActive = category.items.some(
    (item) => pathname === item.to || pathname.startsWith(`${item.to}/`)
  );

  // Calculate total resource count for this category
  const totalCount = visibleItems.reduce((sum, item) => {
    if (item.countKey && counts[item.countKey] !== undefined) {
      return sum + counts[item.countKey];
    }
    return sum;
  }, 0);

  return (
    <div>
      <button
        onClick={onToggle}
        aria-expanded={isExpanded}
        className={cn(
          "flex items-center justify-between w-full px-2.5 py-2 rounded-lg transition-all duration-200 group text-left",
          isCategoryActive
            ? cn("text-foreground", colors.activeBg)
            : isExpanded
              ? "text-slate-800 dark:text-slate-200 bg-slate-50/80 dark:bg-slate-800/40"
              : "text-slate-700 dark:text-slate-300 hover:bg-slate-100/60 dark:hover:bg-slate-800/60"
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn(
            "h-6 w-6 rounded-md flex items-center justify-center shrink-0 transition-colors",
            isCategoryActive ? colors.iconBg : "bg-slate-100/80 dark:bg-slate-800/80 group-hover:bg-slate-200/80 dark:group-hover:bg-slate-700/80"
          )}>
            <Icon className={cn("h-3.5 w-3.5 shrink-0 transition-colors", isCategoryActive ? colors.icon : "text-slate-500 dark:text-slate-300 group-hover:text-slate-700 dark:group-hover:text-slate-100")} />
          </div>
          <span className={cn("text-[12px] font-semibold tracking-wide uppercase truncate", isCategoryActive ? "text-foreground" : "text-slate-600 dark:text-slate-300 group-hover:text-slate-800 dark:group-hover:text-slate-100")}>
            {category.label}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {totalCount > 0 && !isExpanded && (
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-400 tabular-nums">
              {totalCount}
            </span>
          )}
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 transition-transform duration-200',
              isCategoryActive ? colors.icon : 'text-slate-400 dark:text-slate-400',
              isExpanded && 'rotate-90'
            )}
          />
        </div>
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden"
          >
            <div className={cn("pl-3 ml-3 border-l-2 my-1 space-y-0.5", colors.border)}>
              {visibleItems.map((item) => (
                <NavItem
                  key={item.to}
                  to={item.to}
                  icon={item.icon}
                  label={item.label}
                  count={item.countKey ? counts[item.countKey] : undefined}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Syncing Indicator ───────────────────────────────────────────────────────

function SyncingIndicator({ isLoading, isInitialLoad }: { isLoading: boolean; isInitialLoad: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (isLoading && isInitialLoad) {
      setShow(true);
      const id = setTimeout(() => setShow(false), 3000);
      return () => clearTimeout(id);
    } else {
      setShow(false);
    }
  }, [isLoading, isInitialLoad]);

  if (!isInitialLoad || !isLoading || !show) return null;

  return (
    <div className="flex items-center justify-center px-2 py-1">
      <div className="h-1.5 w-1.5 rounded-full bg-blue-500/60 animate-pulse" title="Loading resources..." />
    </div>
  );
}

// ─── Top-Level Nav Link ──────────────────────────────────────────────────────

// Color map for top-level nav icons
const TOP_NAV_COLORS: Record<string, { active: string; activeBg: string; idle: string; idleBg: string }> = {
  '/dashboard': {
    active: 'text-blue-600 dark:text-blue-400',
    activeBg: 'bg-blue-100 dark:bg-blue-500/20',
    idle: 'text-blue-500 dark:text-blue-400',
    idleBg: 'bg-blue-50 dark:bg-blue-500/10',
  },
  '/fleet': {
    active: 'text-indigo-600 dark:text-indigo-400',
    activeBg: 'bg-indigo-100 dark:bg-indigo-500/20',
    idle: 'text-indigo-500 dark:text-indigo-400',
    idleBg: 'bg-indigo-50 dark:bg-indigo-500/10',
  },
  '/topology': {
    active: 'text-violet-600 dark:text-violet-400',
    activeBg: 'bg-violet-100 dark:bg-violet-500/20',
    idle: 'text-violet-500 dark:text-violet-400',
    idleBg: 'bg-violet-50 dark:bg-violet-500/10',
  },
  '/templates': {
    active: 'text-emerald-600 dark:text-emerald-400',
    activeBg: 'bg-emerald-100 dark:bg-emerald-500/20',
    idle: 'text-emerald-500 dark:text-emerald-400',
    idleBg: 'bg-emerald-50 dark:bg-emerald-500/10',
  },
};

function TopLevelNavLink({
  to,
  icon: Icon,
  label,
  isActive,
}: {
  to: string;
  icon: React.ElementType;
  label: string;
  isActive: boolean;
}) {
  const navColors = TOP_NAV_COLORS[to];
  return (
    <NavLink
      to={to}
      className={cn(
        "flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300 group border h-12",
        isActive
          ? "bg-white dark:bg-slate-800 text-foreground border-slate-200/60 dark:border-slate-700/40 shadow-apple"
          : "bg-transparent text-slate-800 dark:text-slate-300 hover:bg-slate-100/60 dark:hover:bg-slate-800/60 border-transparent hover:border-slate-100 dark:hover:border-slate-700/50"
      )}
    >
      <div className={cn(
        "h-9 w-9 rounded-xl flex items-center justify-center shrink-0 transition-colors",
        isActive
          ? navColors?.activeBg ?? 'bg-primary/15'
          : cn(navColors?.idleBg ?? 'bg-slate-200/80 dark:bg-slate-700/60', "group-hover:bg-slate-300/80 dark:group-hover:bg-slate-600/80")
      )}>
        <Icon className={cn(
          "h-5 w-5 transition-colors",
          isActive
            ? navColors?.active ?? 'text-primary'
            : cn(navColors?.idle ?? 'text-slate-700 dark:text-slate-300', "group-hover:text-slate-900 dark:group-hover:text-slate-100")
        )} strokeWidth={2} />
      </div>
      <span className={cn("font-bold text-sm tracking-[-0.01em]", isActive ? "text-slate-900 dark:text-slate-100" : "text-slate-800 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-slate-100")}>{label}</span>
    </NavLink>
  );
}

// ─── Category Color Map ──────────────────────────────────────────────────────
// Each resource category gets a distinct accent color for its icon, border, and active state.

const CATEGORY_COLORS: Record<string, { icon: string; iconBg: string; border: string; activeBg: string }> = {
  [CATEGORY_IDS.WORKLOADS]: {
    icon: 'text-amber-600 dark:text-amber-400',
    iconBg: 'bg-amber-100 dark:bg-amber-500/15',
    border: 'border-l-amber-400 dark:border-l-amber-500/60',
    activeBg: 'bg-amber-50/60 dark:bg-amber-500/5',
  },
  [CATEGORY_IDS.NETWORKING]: {
    icon: 'text-cyan-600 dark:text-cyan-400',
    iconBg: 'bg-cyan-100 dark:bg-cyan-500/15',
    border: 'border-l-cyan-400 dark:border-l-cyan-500/60',
    activeBg: 'bg-cyan-50/60 dark:bg-cyan-500/5',
  },
  [CATEGORY_IDS.STORAGE]: {
    icon: 'text-violet-600 dark:text-violet-400',
    iconBg: 'bg-violet-100 dark:bg-violet-500/15',
    border: 'border-l-violet-400 dark:border-l-violet-500/60',
    activeBg: 'bg-violet-50/60 dark:bg-violet-500/5',
  },
  [CATEGORY_IDS.CLUSTER]: {
    icon: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-100 dark:bg-blue-500/15',
    border: 'border-l-blue-400 dark:border-l-blue-500/60',
    activeBg: 'bg-blue-50/60 dark:bg-blue-500/5',
  },
  [CATEGORY_IDS.SECURITY]: {
    icon: 'text-rose-600 dark:text-rose-400',
    iconBg: 'bg-rose-100 dark:bg-rose-500/15',
    border: 'border-l-rose-400 dark:border-l-rose-500/60',
    activeBg: 'bg-rose-50/60 dark:bg-rose-500/5',
  },
  [CATEGORY_IDS.RESOURCES]: {
    icon: 'text-emerald-600 dark:text-emerald-400',
    iconBg: 'bg-emerald-100 dark:bg-emerald-500/15',
    border: 'border-l-emerald-400 dark:border-l-emerald-500/60',
    activeBg: 'bg-emerald-50/60 dark:bg-emerald-500/5',
  },
  [CATEGORY_IDS.SCALING]: {
    icon: 'text-orange-600 dark:text-orange-400',
    iconBg: 'bg-orange-100 dark:bg-orange-500/15',
    border: 'border-l-orange-400 dark:border-l-orange-500/60',
    activeBg: 'bg-orange-50/60 dark:bg-orange-500/5',
  },
  [CATEGORY_IDS.CRDS]: {
    icon: 'text-indigo-600 dark:text-indigo-400',
    iconBg: 'bg-indigo-100 dark:bg-indigo-500/15',
    border: 'border-l-indigo-400 dark:border-l-indigo-500/60',
    activeBg: 'bg-indigo-50/60 dark:bg-indigo-500/5',
  },
  [CATEGORY_IDS.ADMISSION]: {
    icon: 'text-teal-600 dark:text-teal-400',
    iconBg: 'bg-teal-100 dark:bg-teal-500/15',
    border: 'border-l-teal-400 dark:border-l-teal-500/60',
    activeBg: 'bg-teal-50/60 dark:bg-teal-500/5',
  },
};

const DEFAULT_CATEGORY_COLOR = {
  icon: 'text-slate-600 dark:text-slate-300',
  iconBg: 'bg-slate-100 dark:bg-slate-500/15',
  border: 'border-l-slate-400 dark:border-l-slate-500/60',
  activeBg: 'bg-slate-50/60 dark:bg-slate-500/5',
};

// ─── Resource Categories Definition ──────────────────────────────────────────

function useResourceCategories(metallbInstalled: boolean): ResourceCategory[] {
  return useMemo(
    () => [
      {
        id: CATEGORY_IDS.WORKLOADS,
        label: 'Workloads',
        icon: Cpu,
        items: [
          { to: '/workloads', icon: LayoutDashboard, label: 'Overview' },
          { to: '/pods', icon: K8sPodIcon, label: 'Pods', countKey: 'pods' },
          { to: '/deployments', icon: K8sDeploymentIcon, label: 'Deployments', countKey: 'deployments' },
          { to: '/replicasets', icon: K8sReplicaSetIcon, label: 'ReplicaSets', countKey: 'replicasets' },
          { to: '/statefulsets', icon: K8sStatefulSetIcon, label: 'StatefulSets', countKey: 'statefulsets' },
          { to: '/daemonsets', icon: K8sDaemonSetIcon, label: 'DaemonSets', countKey: 'daemonsets' },
          { to: '/jobs', icon: K8sJobIcon, label: 'Jobs', countKey: 'jobs' },
          { to: '/cronjobs', icon: K8sCronJobIcon, label: 'CronJobs', countKey: 'cronjobs' },
          { to: '/podtemplates', icon: K8sPodIcon, label: 'Pod Templates', countKey: 'podtemplates' },
          { to: '/controllerrevisions', icon: K8sStatefulSetIcon, label: 'Controller Revisions', countKey: 'controllerrevisions' },
        ],
      },
      {
        id: CATEGORY_IDS.NETWORKING,
        label: 'Networking',
        icon: Globe,
        items: [
          { to: '/networking', icon: LayoutDashboard, label: 'Overview' },
          { to: '/services', icon: K8sServiceIcon, label: 'Services', countKey: 'services' },
          { to: '/ingresses', icon: K8sIngressIcon, label: 'Ingresses', countKey: 'ingresses' },
          { to: '/ingressclasses', icon: K8sIngressIcon, label: 'Ingress Classes', countKey: 'ingressclasses' },
          { to: '/endpoints', icon: K8sEndpointsIcon, label: 'Endpoints', countKey: 'endpoints' },
          { to: '/endpointslices', icon: K8sEndpointsIcon, label: 'Endpoint Slices', countKey: 'endpointslices' },
          { to: '/networkpolicies', icon: K8sNetworkPolicyIcon, label: 'Network Policies', countKey: 'networkpolicies' },
          { to: '/ipaddresspools', icon: K8sServiceIcon, label: 'IP Address Pools', countKey: 'ipaddresspools', condition: metallbInstalled },
          { to: '/bgppeers', icon: K8sEndpointsIcon, label: 'BGP Peers', countKey: 'bgppeers', condition: metallbInstalled },
        ],
      },
      {
        id: CATEGORY_IDS.STORAGE,
        label: 'Storage & Config',
        icon: StorageIcon,
        items: [
          { to: '/storage', icon: LayoutDashboard, label: 'Overview' },
          { to: '/configmaps', icon: K8sConfigMapIcon, label: 'ConfigMaps', countKey: 'configmaps' },
          { to: '/secrets', icon: K8sSecretIcon, label: 'Secrets', countKey: 'secrets' },
          { to: '/persistentvolumes', icon: K8sPVIcon, label: 'Persistent Volumes', countKey: 'persistentvolumes' },
          { to: '/persistentvolumeclaims', icon: K8sPVCIcon, label: 'PVCs', countKey: 'persistentvolumeclaims' },
          { to: '/storageclasses', icon: K8sStorageClassIcon, label: 'Storage Classes', countKey: 'storageclasses' },
          { to: '/volumeattachments', icon: K8sPVIcon, label: 'Volume Attachments', countKey: 'volumeattachments' },
          { to: '/volumesnapshots', icon: K8sPVCIcon, label: 'Volume Snapshots', countKey: 'volumesnapshots' },
          { to: '/volumesnapshotclasses', icon: K8sStorageClassIcon, label: 'Snapshot Classes', countKey: 'volumesnapshotclasses' },
          { to: '/volumesnapshotcontents', icon: K8sPVIcon, label: 'Snapshot Contents', countKey: 'volumesnapshotcontents' },
        ],
      },
      {
        id: CATEGORY_IDS.CLUSTER,
        label: 'Cluster',
        icon: Server,
        items: [
          { to: '/cluster', icon: LayoutDashboard, label: 'Overview' },
          { to: '/nodes', icon: K8sNodeIcon, label: 'Nodes', countKey: 'nodes' },
          { to: '/namespaces', icon: K8sNamespaceIcon, label: 'Namespaces', countKey: 'namespaces' },
          { to: '/events', icon: K8sPodIcon, label: 'Events' },
          { to: '/apiservices', icon: K8sServiceIcon, label: 'API Services', countKey: 'apiservices' },
          { to: '/leases', icon: K8sNodeIcon, label: 'Leases', countKey: 'leases' },
        ],
      },
      {
        id: CATEGORY_IDS.SECURITY,
        label: 'Security & Access',
        icon: Lock,
        items: [
          { to: '/serviceaccounts', icon: K8sServiceAccountIcon, label: 'Service Accounts', countKey: 'serviceaccounts' },
          { to: '/roles', icon: K8sRoleIcon, label: 'Roles', countKey: 'roles' },
          { to: '/clusterroles', icon: K8sClusterRoleIcon, label: 'Cluster Roles', countKey: 'clusterroles' },
          { to: '/rolebindings', icon: K8sRoleBindingIcon, label: 'Role Bindings', countKey: 'rolebindings' },
          { to: '/clusterrolebindings', icon: K8sClusterRoleBindingIcon, label: 'Cluster Role Bindings', countKey: 'clusterrolebindings' },
          { to: '/priorityclasses', icon: K8sLimitRangeIcon, label: 'Priority Classes', countKey: 'priorityclasses' },
          { to: '/rbac-analyzer', icon: ShieldCheck, label: 'RBAC Analyzer' },
        ],
      },
      {
        id: CATEGORY_IDS.RESOURCES,
        label: 'Resources & DRA',
        icon: Gauge,
        items: [
          { to: '/resources', icon: LayoutDashboard, label: 'Overview' },
          { to: '/resourcequotas', icon: K8sLimitRangeIcon, label: 'Resource Quotas', countKey: 'resourcequotas' },
          { to: '/limitranges', icon: K8sLimitRangeIcon, label: 'Limit Ranges', countKey: 'limitranges' },
          { to: '/resourceslices', icon: K8sNodeIcon, label: 'Resource Slices (DRA)', countKey: 'resourceslices' },
          { to: '/deviceclasses', icon: K8sStorageClassIcon, label: 'Device Classes (DRA)', countKey: 'deviceclasses' },
        ],
      },
      {
        id: CATEGORY_IDS.SCALING,
        label: 'Scaling & Policies',
        icon: Zap,
        items: [
          { to: '/scaling', icon: LayoutDashboard, label: 'Overview' },
          { to: '/horizontalpodautoscalers', icon: K8sHPAIcon, label: 'HPAs', countKey: 'horizontalpodautoscalers' },
          { to: '/verticalpodautoscalers', icon: K8sHPAIcon, label: 'VPAs', countKey: 'verticalpodautoscalers' },
          { to: '/poddisruptionbudgets', icon: K8sPodIcon, label: 'PDBs', countKey: 'poddisruptionbudgets' },
        ],
      },
      {
        id: CATEGORY_IDS.CRDS,
        label: 'Custom Resources',
        icon: FileCode,
        items: [
          { to: '/crds', icon: LayoutDashboard, label: 'Overview' },
          { to: '/customresourcedefinitions', icon: K8sConfigMapIcon, label: 'Definitions', countKey: 'customresourcedefinitions' },
          { to: '/customresources', icon: K8sPodIcon, label: 'Instances' },
        ],
      },
      {
        id: CATEGORY_IDS.ADMISSION,
        label: 'Admission Control',
        icon: Webhook,
        items: [
          { to: '/admission', icon: LayoutDashboard, label: 'Overview' },
          { to: '/mutatingwebhooks', icon: K8sServiceAccountIcon, label: 'Mutating Webhooks', countKey: 'mutatingwebhookconfigurations' },
          { to: '/validatingwebhooks', icon: K8sServiceAccountIcon, label: 'Validating Webhooks', countKey: 'validatingwebhookconfigurations' },
        ],
      },
    ],
    [metallbInstalled]
  );
}

// ─── Sidebar Content ─────────────────────────────────────────────────────────

function SidebarContent({
  counts,
  isLoading,
  isInitialLoad,
  metallbInstalled,
}: {
  counts: ReturnType<typeof useResourceCounts>['counts'];
  isLoading: boolean;
  isInitialLoad: boolean;
  metallbInstalled: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = location.pathname;
  const isDashboardActive = pathname === '/dashboard';
  const isFleetActive = pathname === '/fleet' || pathname.startsWith('/fleet/');
  const isFleetXrayActive = pathname.startsWith('/fleet/xray');
  const isTopologyActive = pathname === '/topology';
  const isTemplatesActive = pathname === '/templates';
  const activeProject = useProjectStore((s) => s.activeProject);
  const clearActiveProject = useProjectStore((s) => s.clearActiveProject);

  // Persisted state from UI store
  const expandedCategories = useUIStore((s) => s.expandedResourceCategories);
  const isResourcesSectionOpen = useUIStore((s) => s.isResourcesSectionOpen);
  const toggleResourceCategory = useUIStore((s) => s.toggleResourceCategory);
  const setResourcesSectionOpen = useUIStore((s) => s.setResourcesSectionOpen);

  // Search state removed — global search in header handles this

  // Resource categories data
  const categories = useResourceCategories(metallbInstalled);

  // Is any resource path active?
  const isAnyResourceActive = isPathIn(pathname, ALL_RESOURCE_PATHS);

  // Auto-expand Resources section and correct sub-category when navigating to a resource route
  useEffect(() => {
    const categoryForPath = getCategoryForPath(pathname);
    if (categoryForPath) {
      if (!isResourcesSectionOpen) {
        setResourcesSectionOpen(true);
      }
      if (!expandedCategories.includes(categoryForPath)) {
        toggleResourceCategory(categoryForPath);
      }
    }
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps


  const handleResourcesToggle = useCallback(() => {
    setResourcesSectionOpen(!isResourcesSectionOpen);
  }, [isResourcesSectionOpen, setResourcesSectionOpen]);

  const handleExitProject = () => {
    clearActiveProject();
    navigate('/dashboard');
  };

  const filteredCategories = categories;

  return (
    <div className="flex flex-col gap-5 pb-6 w-full">
      {/* Project scope indicator */}
      {activeProject && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 dark:bg-primary/10 p-3 space-y-2">
          <div className="flex items-center gap-2 min-w-0">
            <FolderKanban className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-medium truncate dark:text-slate-100" title={activeProject.name}>{activeProject.name}</span>
          </div>
          <p className="text-xs text-slate-700 dark:text-slate-300 font-medium">Project scope</p>
          <button
            type="button"
            onClick={handleExitProject}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium text-slate-800 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" /> Exit project
          </button>
        </div>
      )}

      {/* Search removed — use the global search in the header (Cmd+K) */}

      <SyncingIndicator isLoading={isLoading} isInitialLoad={isInitialLoad} />

      {/* Top-level navigation */}
      <div className="space-y-1.5">
        <TopLevelNavLink to="/dashboard" icon={LayoutDashboard} label="Dashboard" isActive={isDashboardActive} />
        <TopLevelNavLink to="/fleet" icon={Layers} label="Fleet" isActive={isFleetActive} />
        <TopLevelNavLink to="/topology" icon={Network} label="Topology" isActive={isTopologyActive} />
        <TopLevelNavLink to="/templates" icon={LayoutTemplate} label="Templates" isActive={isTemplatesActive} />
      </div>

      {/* Fleet X-Ray sub-navigation */}
      {isFleetXrayActive && (
        <div className="space-y-0.5 pl-3 ml-3 border-l-2 border-l-indigo-400 dark:border-l-indigo-500/60">
          <NavItem to="/fleet/xray" icon={Scan} label="X-Ray Dashboard" />
          <NavItem to="/fleet/xray/compare" icon={GitCompareArrows} label="Compare" />
          <NavItem to="/fleet/xray/templates" icon={ShieldCheck} label="Golden Templates" />
          <NavItem to="/fleet/xray/dr" icon={ShieldAlert} label="DR Readiness" />
        </div>
      )}

      {/* Resources — single expandable section containing all K8s resource categories */}
      <div className="space-y-1">
        {/* Section divider label */}
        <div className="flex items-center gap-2.5 px-2 pt-3 pb-1.5">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-200/80 to-slate-200/80 dark:via-slate-700/80 dark:to-slate-700/80" />
          <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.18em] select-none">Kubernetes</span>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-slate-200/80 to-slate-200/80 dark:via-slate-700/80 dark:to-slate-700/80" />
        </div>
        <button
          onClick={handleResourcesToggle}
          aria-expanded={isResourcesSectionOpen}
          aria-controls="nav-resources-section"
          className={cn(
            "flex items-center justify-between w-full px-4 py-2.5 rounded-xl transition-all duration-300 group border h-11",
            isAnyResourceActive
              ? "bg-white dark:bg-slate-800 shadow-apple border-slate-200/40 dark:border-slate-700/40 text-primary"
              : isResourcesSectionOpen
                ? "bg-slate-100/40 dark:bg-slate-800/40 text-slate-900 dark:text-slate-100 border-slate-100 dark:border-slate-700/50"
                : "bg-transparent hover:bg-slate-100/60 dark:hover:bg-slate-800/40 text-slate-800 dark:text-slate-300 border-transparent hover:border-slate-100 dark:hover:border-slate-700/50"
          )}
        >
          <div className="flex items-center gap-3">
            <div className={cn(
              "h-7 w-7 rounded-lg flex items-center justify-center transition-colors",
              isAnyResourceActive
                ? "bg-primary/10 dark:bg-primary/20"
                : "bg-slate-200/60 dark:bg-slate-700/60 group-hover:bg-slate-300/60 dark:group-hover:bg-slate-600/60"
            )}>
              <Package className={cn("h-4 w-4 transition-colors", isAnyResourceActive ? "text-primary" : "text-slate-600 dark:text-slate-300 group-hover:text-slate-800 dark:group-hover:text-slate-100")} />
            </div>
            <span className={cn(
              "text-[11px] font-bold tracking-[0.05em] uppercase",
              isAnyResourceActive ? "text-primary" : "text-slate-800 dark:text-slate-200 group-hover:text-slate-950 dark:group-hover:text-slate-50"
            )}>
              Resources
            </span>
          </div>
          <ChevronDown
            className={cn(
              'h-4 w-4 transition-transform duration-300',
              isAnyResourceActive ? 'text-primary' : 'text-slate-600 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-slate-100',
              !isResourcesSectionOpen && '-rotate-90'
            )}
          />
        </button>

        <AnimatePresence initial={false}>
          {isResourcesSectionOpen && (
            <motion.div
              id="nav-resources-section"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
              className="overflow-hidden"
            >
              <div className="pl-2 space-y-1 py-1.5">
                {filteredCategories.map((category) => (
                  <ResourceSubCategory
                    key={category.id}
                    category={category}
                    counts={counts as Record<string, number>}
                    isExpanded={expandedCategories.includes(category.id)}
                    onToggle={() => toggleResourceCategory(category.id)}
                    searchFilter=""
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Recent Resources — bottom of scrollable area, non-intrusive */}
      <RecentResources />

      {/* AI section removed — will be redesigned in a future version */}
    </div>
  );
}

// ─── Section Routes for auto-expand ──────────────────────────────────────────

const SECTION_ROUTES = ['/workloads', '/topology', ...WORKLOAD_PATHS, ...NETWORKING_PATHS, ...STORAGE_PATHS, ...CLUSTER_PATHS, ...SECURITY_PATHS, ...RESOURCES_PATHS, ...SCALING_PATHS, ...CRD_PATHS, ...ADMISSION_PATHS];

// ─── Main Sidebar ────────────────────────────────────────────────────────────

export function Sidebar() {
  const { counts, isLoading, isInitialLoad } = useResourceCounts();
  const { installed: metallbInstalled } = useMetalLBInstalled();
  const collapsed = useUIStore((s) => s.isSidebarCollapsed);
  const setCollapsed = useUIStore((s) => s.setSidebarCollapsed);
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const mountedTime = useRef(Date.now());

  // Prevent flyout from opening during initial render
  const handleFlyoutEnter = useCallback(() => {
    if (Date.now() - mountedTime.current > 500) {
      setFlyoutOpen(true);
    }
  }, []);

  const location = useLocation();
  const pathname = location.pathname;
  const isSettingsActive = pathname.startsWith('/settings');

  // Auto-collapse sidebar on small viewports
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 1023px)');
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches && !collapsed) {
        setCollapsed(true);
      }
    };
    handleChange(mql);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Expand sidebar when navigating to section routes
  useEffect(() => {
    const isMobile = window.matchMedia('(max-width: 1023px)').matches;
    const isSectionRoute = SECTION_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
    if (isSectionRoute && collapsed && !isMobile) {
      setCollapsed(false);
    }
  }, [pathname, collapsed, setCollapsed]);

  const fullContent = (
    <div className="flex flex-col flex-1 min-h-0 bg-slate-50/10 dark:bg-transparent">
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-6 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-700 hover:scrollbar-thumb-slate-300 dark:hover:scrollbar-thumb-slate-600">
        <SidebarContent counts={counts} isLoading={isLoading} isInitialLoad={isInitialLoad} metallbInstalled={metallbInstalled} />
      </div>

      {/* Fixed footer */}
      <div className="shrink-0 px-5 pb-6 pt-4 border-t border-slate-100/60 dark:border-slate-800/60 bg-white/40 dark:bg-slate-900/40 backdrop-blur-md space-y-2">
        <NavLink
          to="/settings"
          className={cn(
            "flex items-center gap-3 px-4 py-2 rounded-xl transition-all duration-300 group border h-11",
            isSettingsActive
              ? "bg-white dark:bg-slate-800 text-foreground border-slate-200/60 dark:border-slate-700/40 shadow-apple"
              : "bg-transparent text-slate-800 dark:text-slate-300 hover:bg-slate-100/60 dark:hover:bg-slate-800/60 border-transparent hover:border-slate-100 dark:hover:border-slate-700/50"
          )}
        >
          <div className={cn(
            "h-7 w-7 rounded-lg flex items-center justify-center shrink-0 transition-colors",
            isSettingsActive ? "bg-slate-200 dark:bg-slate-700" : "bg-slate-100/80 dark:bg-slate-800/80 group-hover:bg-slate-200/80 dark:group-hover:bg-slate-700/80"
          )}>
            <Settings className={cn("h-4 w-4 transition-colors", isSettingsActive ? "text-slate-700 dark:text-slate-300" : "text-slate-600 dark:text-slate-300 group-hover:text-slate-800 dark:group-hover:text-slate-100")} />
          </div>
          <span className={cn("font-semibold text-[13px]", isSettingsActive ? "text-slate-900 dark:text-slate-100" : "text-slate-800 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-slate-100")}>Settings</span>
        </NavLink>
        {!collapsed && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('openKeyboardShortcuts'))}
            className={cn(
              "flex items-center justify-start gap-3 w-full px-4 py-2 rounded-xl border h-9 transition-all duration-300 group",
              "bg-transparent text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/60 border-transparent hover:border-slate-100 dark:hover:border-slate-700/50"
            )}
            aria-label="Keyboard shortcuts"
          >
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <span className="text-[12px] flex-1 text-left">Keyboard Shortcuts</span>
            <kbd className="inline-flex items-center rounded border bg-muted/80 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground" aria-hidden>?</kbd>
          </button>
        )}
        {!collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className={cn(
              "flex items-center justify-start gap-3 w-full px-4 py-2 rounded-xl border h-11 transition-all duration-500 group press-effect",
              "bg-transparent text-slate-800 dark:text-slate-300 hover:bg-slate-100/60 dark:hover:bg-slate-800/60 border-transparent hover:border-slate-100 dark:hover:border-slate-700/50"
            )}
            aria-label="Collapse sidebar"
          >
            <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5 shrink-0" aria-hidden />
            <span className="font-semibold text-[13px] flex-1 text-left">Collapse Sidebar</span>
            <kbd className="hidden group-hover:inline-flex items-center rounded border bg-muted/80 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground" aria-hidden>
              {/Mac|iPod|iPhone|iPad/.test(navigator.userAgent) ? '⌘B' : 'Ctrl+B'}
            </kbd>
          </button>
        )}
      </div>
    </div>
  );

  if (collapsed) {
    return (
      <>
        <aside
          className="w-[5.5rem] h-full border-r border-slate-100 dark:border-slate-800 bg-white/95 dark:bg-[hsl(228,14%,9%)] backdrop-blur-3xl flex flex-col items-center py-6 gap-4 shrink-0 z-40 shadow-apple"
          onMouseEnter={handleFlyoutEnter}
          onMouseLeave={() => setFlyoutOpen(false)}
          role="navigation"
          aria-label="Main navigation"
        >
          {/* Logo icon — always visible in collapsed state */}
          <NavLink to="/dashboard" className="mb-2 flex items-center justify-center group/logo" title="Kubilitics — Go to Dashboard">
            <BrandLogo mark height={36} className="rounded-lg transition-transform duration-200 group-hover/logo:scale-105 group-active/logo:scale-95" draggable={false} />
          </NavLink>
          <div className="w-12 h-px bg-border/50 mb-1" />

          <NavItemIconOnly to="/dashboard" icon={LayoutDashboard} label="Dashboard" iconColor="text-blue-600 group-hover:text-blue-700" />
          <NavItemIconOnly to="/fleet" icon={Layers} label="Fleet" iconColor="text-indigo-600 group-hover:text-indigo-700" />
          <NavItemIconOnly to="/fleet/xray" icon={Scan} label="Fleet X-Ray" iconColor="text-indigo-500 group-hover:text-indigo-600" />
          <NavItemIconOnly to="/topology" icon={Network} label="Topology" iconColor="text-violet-600 group-hover:text-violet-700" />
          <NavItemIconOnly to="/workloads" icon={Cpu} label="Workloads" iconColor="text-amber-600 group-hover:text-amber-700" />
          <div className="w-12 h-px bg-border/50 my-2" />
          <NavItemIconOnly to="/pods" icon={Box} label="Pods" iconColor="text-emerald-600 group-hover:text-emerald-700" />
          <NavItemIconOnly to="/nodes" icon={Server} label="Nodes" iconColor="text-sky-600 group-hover:text-sky-700" />
          <NavItemIconOnly to="/services" icon={Globe} label="Services" iconColor="text-cyan-600 group-hover:text-cyan-700" />
          <NavItemIconOnly to="/events" icon={Activity} label="Events" iconColor="text-amber-600 group-hover:text-amber-700" />
          <NavItemIconOnly to="/resources" icon={Gauge} label="Resources & DRA" iconColor="text-blue-600 group-hover:text-blue-700" />

          <div className="flex-1" />

          <NavItemIconOnly to="/settings" icon={Settings} label="Settings" iconColor="text-slate-800 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-slate-100" />
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="flex items-center justify-center w-11 h-11 rounded-xl text-blue-600 hover:text-blue-700 hover:bg-blue-50/80 dark:hover:bg-blue-900/20 transition-colors mb-2 press-effect"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        </aside>
        <AnimatePresence>
          {flyoutOpen && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="fixed left-[5.5rem] top-20 bottom-0 z-40 w-72 border-r border-slate-200/40 dark:border-slate-700/40 bg-white/70 dark:bg-[hsl(228,14%,9%)]/90 backdrop-blur-3xl shadow-apple-xl elevation-3 ring-1 ring-black/5 dark:ring-white/5"
              onMouseEnter={handleFlyoutEnter}
              onMouseLeave={() => setFlyoutOpen(false)}
              style={{ height: 'calc(100vh - 5rem)' }}
              role="navigation"
              aria-label="Main navigation"
            >
              {fullContent}
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  }

  return (
    <aside className="w-72 h-full flex flex-col border-r border-slate-100 dark:border-slate-800 bg-white/95 dark:bg-[hsl(228,14%,9%)] backdrop-blur-3xl shrink-0 z-40 transition-[width] duration-300 ease-out" role="navigation" aria-label="Main navigation">
      {fullContent}
    </aside>
  );
}
