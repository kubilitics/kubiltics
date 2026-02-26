import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  Home,
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
  Puzzle,
  ClipboardList,
  HardDrive as StorageIcon,
  Bot,
  BarChart3,
  ShieldAlert,
  Brain,
  FolderKanban,
  LogOut,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useResourceCounts } from '@/hooks/useResourceCounts';
import { useMetalLBInstalled } from '@/hooks/useMetalLBInstalled';
import { useAIStatus } from '@/hooks/useAIStatus';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';

interface NavItemProps {
  to: string;
  icon: React.ElementType;
  label: string;
  count?: number;
  /** Optional callback when item is clicked to ensure parent section is expanded */
  onNavigate?: () => void;
}

function NavItem({ to, icon: Icon, label, count, onNavigate }: NavItemProps) {
  const location = useLocation();
  const isActive = location.pathname === to || location.pathname.startsWith(`${to}/`);
  const itemRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (isActive && itemRef.current) {
      // Small delay to ensure any accordion animation has started/completed
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
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-medium transition-all duration-300 group relative overflow-hidden h-10',
        isActive
          ? 'text-primary bg-primary/5 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)]'
          : 'text-slate-800 hover:bg-slate-100/60 hover:text-slate-900 border-transparent hover:translate-x-0.5'
      )}
    >
      {/* Active Indicator Line */}
      {isActive && (
        <motion.div
          layoutId="activeNavLine"
          className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-primary"
        />
      )}

      <Icon className={cn("h-4 w-4 transition-colors relative z-10", isActive ? "text-primary" : "text-slate-700 group-hover:text-slate-900")} />
      <span className={cn("flex-1 truncate relative z-10", isActive && "font-semibold")}>{label}</span>
      {count !== undefined && (
        <span
          className={cn(
            'text-[10px] font-bold px-2 py-0.5 rounded-lg min-w-[1.25rem] text-center leading-none transition-colors relative z-10',
            isActive ? 'bg-primary text-primary-foreground' : 'bg-slate-200 text-slate-700 group-hover:bg-slate-300 group-hover:text-slate-900'
          )}
        >
          {count}
        </span>
      )}
    </NavLink>
  );
}

interface NavGroupProps {
  label: string;
  sectionId: string;
  children: React.ReactNode;
  icon: React.ElementType;
  /** When true, show the same blue gradient highlight as Dashboard/Settings */
  isSectionActive?: boolean;
  /** Controlled: whether this section is currently open */
  isOpen: boolean;
  /** Optional route to navigate to when header is clicked */
  to?: string;
  /** Callback when section header is clicked */
  onToggle: (sectionId: string) => void;
}

function NavGroup({ label, sectionId, children, icon: Icon, isSectionActive = false, isOpen, to, onToggle }: NavGroupProps) {
  const headerContent = (
    <div className={cn(
      "flex items-center justify-between w-full px-4 py-2.5 rounded-xl transition-all duration-500 group border h-11",
      isSectionActive
        ? "bg-white shadow-apple border-slate-200/40 text-primary"
        : isOpen
          ? "bg-slate-100/40 text-slate-900 border-slate-100"
          : "bg-transparent hover:bg-slate-100/60 text-slate-800 border-transparent hover:border-slate-100"
    )}>
      <div className="flex items-center gap-3">
        <div className={cn(
          "p-1.5 rounded-lg transition-colors",
          isSectionActive ? "bg-primary/5 text-primary" : isOpen ? "bg-slate-200/50 text-slate-900" : "bg-slate-200/50 text-slate-700 group-hover:bg-white group-hover:text-slate-900"
        )}>
          <Icon className="h-4 w-4" />
        </div>
        <span className={cn(
          "text-[11px] font-bold tracking-[0.05em] uppercase",
          isSectionActive ? "text-primary" : "text-slate-800 group-hover:text-slate-950"
        )}>
          {label}
        </span>
      </div>
      <ChevronRight
        className={cn('h-4 w-4 transition-transform duration-500', isSectionActive ? 'text-primary' : 'text-slate-600 group-hover:text-slate-900', isOpen && 'rotate-90')}
      />
    </div>
  );

  return (
    <div className="space-y-1">
      {to ? (
        <NavLink
          to={to}
          onClick={() => onToggle(sectionId)}
          className="block"
        >
          {headerContent}
        </NavLink>
      ) : (
        <button
          onClick={() => onToggle(sectionId)}
          aria-expanded={isOpen}
          aria-controls={`nav-group-${sectionId}`}
          className="w-full"
        >
          {headerContent}
        </button>
      )}

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={`nav-group-${sectionId}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden"
          >
            <div className="relative pl-4 ml-4 border-l-2 border-primary/20 my-2 space-y-1">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavItemIconOnly({
  to,
  icon: Icon,
  label,
  iconColor,
}: {
  to: string;
  icon: React.ElementType;
  label: string;
  /** Tailwind class for icon color when inactive (e.g. text-blue-600) */
  iconColor?: string;
}) {
  const location = useLocation();
  const isActive = location.pathname === to || location.pathname.startsWith(`${to}/`);
  return (
    <NavLink
      to={to}
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

      {/* Tooltip-like label on hover for icon-only mode */}
      <span className="absolute left-full ml-3 px-3 py-1.5 bg-popover text-popover-foreground text-sm font-medium rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 border border-border">
        {label}
      </span>
    </NavLink>
  );
}

function isPathIn(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Subtle background sync indicator - only shows on initial load, not background refresh */
function SyncingIndicator({ isLoading, isInitialLoad }: { isLoading: boolean; isInitialLoad: boolean }) {
  // Only show on initial load, not during background refresh
  if (!isInitialLoad) return null;

  // Only show for a brief moment on initial load (max 3s)
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (isLoading && isInitialLoad) {
      setShow(true);
      const id = setTimeout(() => setShow(false), 3000); // Max 3s for initial load
      return () => clearTimeout(id);
    } else {
      setShow(false);
    }
  }, [isLoading, isInitialLoad]);

  if (!isLoading || !show) return null;

  // Very subtle indicator - small dot in corner, not prominent banner
  return (
    <div className="flex items-center justify-center px-2 py-1">
      <div className="h-1.5 w-1.5 rounded-full bg-blue-500/60 animate-pulse" title="Loading resources..." />
    </div>
  );
}

const WORKLOAD_PATHS = ['/pods', '/deployments', '/replicasets', '/statefulsets', '/daemonsets', '/jobs', '/cronjobs', '/podtemplates', '/controllerrevisions'];
const NETWORKING_PATHS = ['/networking', '/services', '/ingresses', '/ingressclasses', '/endpoints', '/endpointslices', '/networkpolicies', '/ipaddresspools', '/bgppeers'];
const STORAGE_PATHS = ['/storage', '/configmaps', '/secrets', '/persistentvolumes', '/persistentvolumeclaims', '/storageclasses', '/volumeattachments', '/volumesnapshots', '/volume-snapshots', '/volumesnapshotclasses', '/volume-snapshot-classes', '/volumesnapshotcontents', '/volume-snapshot-contents'];
const CLUSTER_PATHS = ['/cluster-overview', '/nodes', '/namespaces', '/events', '/apiservices', '/leases'];
const SECURITY_PATHS = ['/serviceaccounts', '/roles', '/clusterroles', '/rolebindings', '/clusterrolebindings', '/priorityclasses'];
const RESOURCES_PATHS = ['/resources', '/resourcequotas', '/limitranges', '/resourceslices', '/deviceclasses', '/device-classes'];
const SCALING_PATHS = ['/scaling', '/horizontalpodautoscalers', '/verticalpodautoscalers', '/poddisruptionbudgets'];
const CRD_PATHS = ['/crds', '/customresourcedefinitions', '/customresources'];
const ADMISSION_PATHS = ['/admission', '/mutatingwebhooks', '/validatingwebhooks'];
const AI_PATHS = ['/analytics', '/security', '/ml-analytics'];

// Section identifiers for accordion state management
const SECTION_IDS = {
  WORKLOADS: 'workloads',
  NETWORKING: 'networking',
  STORAGE: 'storage',
  CLUSTER: 'cluster',
  SECURITY: 'security',
  RESOURCES: 'resources',
  SCALING: 'scaling',
  CRDS: 'crds',
  ADMISSION: 'admission',
  AI: 'ai',
} as const;

type SectionId = typeof SECTION_IDS[keyof typeof SECTION_IDS] | null;

// Map route paths to their parent section IDs
function getSectionForPath(pathname: string): SectionId {
  if (pathname === '/workloads' || isPathIn(pathname, WORKLOAD_PATHS)) return SECTION_IDS.WORKLOADS;
  if (isPathIn(pathname, NETWORKING_PATHS)) return SECTION_IDS.NETWORKING;
  if (isPathIn(pathname, STORAGE_PATHS)) return SECTION_IDS.STORAGE;
  if (isPathIn(pathname, CLUSTER_PATHS)) return SECTION_IDS.CLUSTER;
  if (isPathIn(pathname, SECURITY_PATHS)) return SECTION_IDS.SECURITY;
  if (isPathIn(pathname, RESOURCES_PATHS)) return SECTION_IDS.RESOURCES;
  if (isPathIn(pathname, SCALING_PATHS)) return SECTION_IDS.SCALING;
  if (isPathIn(pathname, CRD_PATHS)) return SECTION_IDS.CRDS;
  if (isPathIn(pathname, ADMISSION_PATHS)) return SECTION_IDS.ADMISSION;
  if (isPathIn(pathname, AI_PATHS)) return SECTION_IDS.AI;
  return null; // Dashboard, Settings, etc.
}

function SidebarContent({
  counts,
  isLoading,
  isInitialLoad,
  metallbInstalled,
  aiActive,
}: {
  counts: ReturnType<typeof useResourceCounts>['counts'];
  isLoading: boolean;
  isInitialLoad: boolean;
  metallbInstalled: boolean;
  aiActive: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = location.pathname;
  const isHomeActive = pathname === '/home';
  const isDashboardActive = pathname === '/dashboard';
  const isTopologyActive = pathname === '/topology';
  const isAddOnsActive = pathname.startsWith('/addons');
  const activeProject = useProjectStore((s) => s.activeProject);
  const clearActiveProject = useProjectStore((s) => s.clearActiveProject);

  // Centralized state for accordion: track which section is currently open
  const [openSection, setOpenSection] = useState<SectionId>(() => {
    // Initialize based on current route
    const sectionForPath = getSectionForPath(pathname);
    return sectionForPath;
  });

  // Sync expansion state with route changes
  useEffect(() => {
    const sectionForPath = getSectionForPath(pathname);
    // If on dashboard, close all sections; otherwise open the section for current route
    setOpenSection(sectionForPath);
  }, [pathname]);

  // Handle section toggle: if clicking the same section, close it; otherwise open new and close others
  const handleSectionToggle = (sectionId: string, forceOpen: boolean = false) => {
    setOpenSection((current) => {
      // If force open is requested (e.g. from a NavLink click), ensure it's open
      if (forceOpen) {
        return sectionId as SectionId;
      }
      // Otherwise, toggle: if clicking the already-open section, close it
      if (current === sectionId) {
        return null;
      }
      // Otherwise, open the clicked section (this closes any other open section)
      return sectionId as SectionId;
    });
  };

  // Handle NavItem click: ensure parent section is expanded
  const handleNavItemClick = (sectionId: SectionId) => {
    if (sectionId && openSection !== sectionId) {
      setOpenSection(sectionId);
    }
  };

  const handleExitProject = () => {
    clearActiveProject();
    navigate('/home');
  };

  return (
    <div className="flex flex-col gap-6 pb-6 w-full">
      {activeProject && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2">
          <div className="flex items-center gap-2 min-w-0">
            <FolderKanban className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-medium truncate" title={activeProject.name}>{activeProject.name}</span>
          </div>
          <p className="text-xs text-slate-700 font-medium">Project scope</p>
          <button
            type="button"
            onClick={handleExitProject}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium text-slate-800 hover:bg-slate-200 hover:text-slate-900 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" /> Exit project
          </button>
        </div>
      )}
      <div className="space-y-1.5">
        <NavLink
          to="/home"
          className={cn(
            "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-500 group border h-12",
            isHomeActive
              ? "bg-white text-primary border-slate-100 shadow-apple"
              : "bg-transparent text-slate-800 hover:bg-slate-100/60 border-transparent hover:border-slate-100"
          )}
        >
          <Home className={cn("h-5 w-5 transition-colors", isHomeActive ? "text-primary" : "text-slate-700 group-hover:text-slate-900")} />
          <span className={cn("font-semibold text-sm", isHomeActive ? "text-slate-900" : "text-slate-800 group-hover:text-slate-900")}>Home</span>
        </NavLink>
        <NavLink
          to="/dashboard"
          className={cn(
            "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-500 group border h-12",
            isDashboardActive
              ? "bg-white text-primary border-slate-100 shadow-apple"
              : "bg-transparent text-slate-800 hover:bg-slate-100/60 border-transparent hover:border-slate-100"
          )}
        >
          <LayoutDashboard className={cn("h-5 w-5 transition-colors", isDashboardActive ? "text-primary" : "text-slate-700 group-hover:text-slate-900")} />
          <span className={cn("font-semibold text-sm", isDashboardActive ? "text-slate-900" : "text-slate-800 group-hover:text-slate-900")}>Dashboard</span>
        </NavLink>
        <NavLink
          to="/topology"
          className={cn(
            "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-500 group border h-12",
            isTopologyActive
              ? "bg-white text-primary border-slate-100 shadow-apple"
              : "bg-transparent text-slate-800 hover:bg-slate-100/60 border-transparent hover:border-slate-100"
          )}
        >
          <Network className={cn("h-5 w-5 transition-colors", isTopologyActive ? "text-primary" : "text-slate-700 group-hover:text-slate-900")} />
          <span className={cn("font-semibold text-sm", isTopologyActive ? "text-slate-900" : "text-slate-800 group-hover:text-slate-900")}>Topology</span>
        </NavLink>
        <NavLink
          to="/addons"
          className={cn(
            "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-500 group border h-12",
            isAddOnsActive
              ? "bg-white text-primary border-slate-100 shadow-apple"
              : "bg-transparent text-slate-800 hover:bg-slate-100/60 border-transparent hover:border-slate-100"
          )}
        >
          <Puzzle className={cn("h-5 w-5 transition-colors", isAddOnsActive ? "text-primary" : "text-slate-700 group-hover:text-slate-900")} />
          <span className={cn("font-semibold text-sm", isAddOnsActive ? "text-slate-900" : "text-slate-800 group-hover:text-slate-900")}>Add-ons</span>
        </NavLink>
      </div>

      {/* Subtle background sync indicator - only on initial load, not background refresh */}
      <SyncingIndicator isLoading={isLoading} isInitialLoad={isInitialLoad} />

      <div className="space-y-5">
        {/* AI Intelligence — only shown when AI backend is active */}
        {aiActive && (
          <NavGroup
            label="AI Intelligence"
            sectionId={SECTION_IDS.AI}
            to="/analytics"
            icon={Bot}
            isOpen={openSection === SECTION_IDS.AI}
            onToggle={(id) => handleSectionToggle(id, true)}
            isSectionActive={getSectionForPath(pathname) === SECTION_IDS.AI}
          >
            <NavItem to="/analytics" icon={BarChart3} label="Analytics Overview" onNavigate={() => handleNavItemClick(SECTION_IDS.AI)} />
            <NavItem to="/ml-analytics" icon={Brain} label="ML Analytics" onNavigate={() => handleNavItemClick(SECTION_IDS.AI)} />
          </NavGroup>
        )}

        {/* Workloads */}
        <NavGroup
          label="Workloads"
          sectionId={SECTION_IDS.WORKLOADS}
          to="/workloads"
          icon={Cpu}
          isOpen={openSection === SECTION_IDS.WORKLOADS}
          onToggle={(id) => handleSectionToggle(id, true)}
          isSectionActive={getSectionForPath(pathname) === SECTION_IDS.WORKLOADS}
        >
          <NavItem to="/pods" icon={Box} label="Pods" count={counts.pods} onNavigate={() => handleNavItemClick(SECTION_IDS.WORKLOADS)} />
          <NavItem to="/deployments" icon={Container} label="Deployments" count={counts.deployments} onNavigate={() => handleNavItemClick(SECTION_IDS.WORKLOADS)} />
          <NavItem to="/replicasets" icon={Layers} label="ReplicaSets" count={counts.replicasets} onNavigate={() => handleNavItemClick(SECTION_IDS.WORKLOADS)} />
          <NavItem to="/statefulsets" icon={Layers} label="StatefulSets" count={counts.statefulsets} onNavigate={() => handleNavItemClick(SECTION_IDS.WORKLOADS)} />
          <NavItem to="/daemonsets" icon={Layers} label="DaemonSets" count={counts.daemonsets} onNavigate={() => handleNavItemClick(SECTION_IDS.WORKLOADS)} />
          <NavItem to="/jobs" icon={Activity} label="Jobs" count={counts.jobs} onNavigate={() => handleNavItemClick(SECTION_IDS.WORKLOADS)} />
          <NavItem to="/cronjobs" icon={Clock} label="CronJobs" count={counts.cronjobs} onNavigate={() => handleNavItemClick(SECTION_IDS.WORKLOADS)} />
          <NavItem to="/podtemplates" icon={Layers} label="Pod Templates" count={counts.podtemplates} onNavigate={() => handleNavItemClick(SECTION_IDS.WORKLOADS)} />
          <NavItem to="/controllerrevisions" icon={History} label="Controller Revisions" count={counts.controllerrevisions} onNavigate={() => handleNavItemClick(SECTION_IDS.WORKLOADS)} />
        </NavGroup>

        {/* Networking */}
        <NavGroup
          label="Networking"
          sectionId={SECTION_IDS.NETWORKING}
          to="/networking"
          icon={Globe}
          isOpen={openSection === SECTION_IDS.NETWORKING}
          onToggle={(id) => handleSectionToggle(id, true)}
          isSectionActive={getSectionForPath(pathname) === SECTION_IDS.NETWORKING}
        >
          <NavItem to="/services" icon={Globe} label="Services" count={counts.services} onNavigate={() => handleNavItemClick(SECTION_IDS.NETWORKING)} />
          <NavItem to="/ingresses" icon={Globe} label="Ingresses" count={counts.ingresses} onNavigate={() => handleNavItemClick(SECTION_IDS.NETWORKING)} />
          <NavItem to="/ingressclasses" icon={Route} label="Ingress Classes" count={counts.ingressclasses} onNavigate={() => handleNavItemClick(SECTION_IDS.NETWORKING)} />
          <NavItem to="/endpoints" icon={Globe} label="Endpoints" count={counts.endpoints} onNavigate={() => handleNavItemClick(SECTION_IDS.NETWORKING)} />
          <NavItem to="/endpointslices" icon={Network} label="Endpoint Slices" count={counts.endpointslices} onNavigate={() => handleNavItemClick(SECTION_IDS.NETWORKING)} />
          <NavItem to="/networkpolicies" icon={Shield} label="Network Policies" count={counts.networkpolicies} onNavigate={() => handleNavItemClick(SECTION_IDS.NETWORKING)} />
          {metallbInstalled && (
            <>
              <NavItem to="/ipaddresspools" icon={Network} label="IP Address Pools" count={counts.ipaddresspools} onNavigate={() => handleNavItemClick(SECTION_IDS.NETWORKING)} />
              <NavItem to="/bgppeers" icon={Network} label="BGP Peers" count={counts.bgppeers} onNavigate={() => handleNavItemClick(SECTION_IDS.NETWORKING)} />
            </>
          )}
        </NavGroup>

        {/* Storage */}
        <NavGroup
          label="Storage"
          sectionId={SECTION_IDS.STORAGE}
          to="/storage"
          icon={StorageIcon}
          isOpen={openSection === SECTION_IDS.STORAGE}
          onToggle={(id) => handleSectionToggle(id, true)}
          isSectionActive={getSectionForPath(pathname) === SECTION_IDS.STORAGE}
        >
          <NavItem to="/configmaps" icon={Settings} label="ConfigMaps" count={counts.configmaps} onNavigate={() => handleNavItemClick(SECTION_IDS.STORAGE)} />
          <NavItem to="/secrets" icon={Key} label="Secrets" count={counts.secrets} onNavigate={() => handleNavItemClick(SECTION_IDS.STORAGE)} />
          <NavItem to="/persistentvolumes" icon={HardDrive} label="Persistent Volumes" count={counts.persistentvolumes} onNavigate={() => handleNavItemClick(SECTION_IDS.STORAGE)} />
          <NavItem to="/persistentvolumeclaims" icon={Database} label="PVCs" count={counts.persistentvolumeclaims} onNavigate={() => handleNavItemClick(SECTION_IDS.STORAGE)} />
          <NavItem to="/storageclasses" icon={Database} label="Storage Classes" count={counts.storageclasses} onNavigate={() => handleNavItemClick(SECTION_IDS.STORAGE)} />
          <NavItem to="/volumeattachments" icon={HardDrive} label="Volume Attachments" count={counts.volumeattachments} onNavigate={() => handleNavItemClick(SECTION_IDS.STORAGE)} />
          <NavItem to="/volumesnapshots" icon={Camera} label="Volume Snapshots" count={counts.volumesnapshots} onNavigate={() => handleNavItemClick(SECTION_IDS.STORAGE)} />
          <NavItem to="/volumesnapshotclasses" icon={Camera} label="Snapshot Classes" count={counts.volumesnapshotclasses} onNavigate={() => handleNavItemClick(SECTION_IDS.STORAGE)} />
          <NavItem to="/volumesnapshotcontents" icon={HardDrive} label="Snapshot Contents" count={counts.volumesnapshotcontents} onNavigate={() => handleNavItemClick(SECTION_IDS.STORAGE)} />
        </NavGroup>

        {/* Cluster */}
        <NavGroup
          label="Cluster"
          sectionId={SECTION_IDS.CLUSTER}
          to="/cluster-overview"
          icon={Server}
          isOpen={openSection === SECTION_IDS.CLUSTER}
          onToggle={(id) => handleSectionToggle(id, true)}
          isSectionActive={getSectionForPath(pathname) === SECTION_IDS.CLUSTER}
        >
          <NavItem to="/nodes" icon={Server} label="Nodes" count={counts.nodes} onNavigate={() => handleNavItemClick(SECTION_IDS.CLUSTER)} />
          <NavItem to="/namespaces" icon={FileText} label="Namespaces" count={counts.namespaces} onNavigate={() => handleNavItemClick(SECTION_IDS.CLUSTER)} />
          <NavItem to="/events" icon={Activity} label="Events" onNavigate={() => handleNavItemClick(SECTION_IDS.CLUSTER)} />
          <NavItem to="/apiservices" icon={FileCode} label="API Services" count={counts.apiservices} onNavigate={() => handleNavItemClick(SECTION_IDS.CLUSTER)} />
          <NavItem to="/leases" icon={Activity} label="Leases" count={counts.leases} onNavigate={() => handleNavItemClick(SECTION_IDS.CLUSTER)} />
        </NavGroup>

        {/* Security & Access */}
        <NavGroup
          label="Security"
          sectionId={SECTION_IDS.SECURITY}
          icon={Lock}
          isOpen={openSection === SECTION_IDS.SECURITY}
          onToggle={(id) => handleSectionToggle(id)}
          isSectionActive={getSectionForPath(pathname) === SECTION_IDS.SECURITY}
        >
          <NavItem to="/serviceaccounts" icon={Users} label="Service Accounts" count={counts.serviceaccounts} onNavigate={() => handleNavItemClick(SECTION_IDS.SECURITY)} />
          <NavItem to="/roles" icon={Shield} label="Roles" count={counts.roles} onNavigate={() => handleNavItemClick(SECTION_IDS.SECURITY)} />
          <NavItem to="/clusterroles" icon={Shield} label="Cluster Roles" count={counts.clusterroles} onNavigate={() => handleNavItemClick(SECTION_IDS.SECURITY)} />
          <NavItem to="/rolebindings" icon={Shield} label="Role Bindings" count={counts.rolebindings} onNavigate={() => handleNavItemClick(SECTION_IDS.SECURITY)} />
          <NavItem to="/clusterrolebindings" icon={Shield} label="Cluster Role Bindings" count={counts.clusterrolebindings} onNavigate={() => handleNavItemClick(SECTION_IDS.SECURITY)} />
          <NavItem to="/priorityclasses" icon={AlertTriangle} label="Priority Classes" count={counts.priorityclasses} onNavigate={() => handleNavItemClick(SECTION_IDS.SECURITY)} />
        </NavGroup>

        {/* Resource Management & DRA */}
        <NavGroup
          label="Resources & DRA"
          sectionId={SECTION_IDS.RESOURCES}
          to="/resources"
          icon={Gauge}
          isOpen={openSection === SECTION_IDS.RESOURCES}
          onToggle={(id) => handleSectionToggle(id, true)}
          isSectionActive={getSectionForPath(pathname) === SECTION_IDS.RESOURCES}
        >
          <NavItem to="/resourcequotas" icon={Gauge} label="Resource Quotas" count={counts.resourcequotas} onNavigate={() => handleNavItemClick(SECTION_IDS.RESOURCES)} />
          <NavItem to="/limitranges" icon={Scale} label="Limit Ranges" count={counts.limitranges} onNavigate={() => handleNavItemClick(SECTION_IDS.RESOURCES)} />
          <NavItem to="/resourceslices" icon={Cpu} label="Resource Slices (DRA)" count={counts.resourceslices} onNavigate={() => handleNavItemClick(SECTION_IDS.RESOURCES)} />
          <NavItem to="/deviceclasses" icon={Cpu} label="Device Classes (DRA)" count={counts.deviceclasses} onNavigate={() => handleNavItemClick(SECTION_IDS.RESOURCES)} />
        </NavGroup>

        {/* Scaling & Policies */}
        <NavGroup
          label="Scaling"
          sectionId={SECTION_IDS.SCALING}
          to="/scaling"
          icon={Zap}
          isOpen={openSection === SECTION_IDS.SCALING}
          onToggle={(id) => handleSectionToggle(id, true)}
          isSectionActive={getSectionForPath(pathname) === SECTION_IDS.SCALING}
        >
          <NavItem to="/horizontalpodautoscalers" icon={Scale} label="HPAs" count={counts.horizontalpodautoscalers} onNavigate={() => handleNavItemClick(SECTION_IDS.SCALING)} />
          <NavItem to="/verticalpodautoscalers" icon={Scale} label="VPAs" count={counts.verticalpodautoscalers} onNavigate={() => handleNavItemClick(SECTION_IDS.SCALING)} />
          <NavItem to="/poddisruptionbudgets" icon={Shield} label="PDBs" count={counts.poddisruptionbudgets} onNavigate={() => handleNavItemClick(SECTION_IDS.SCALING)} />
        </NavGroup>

        {/* Custom Resources */}
        <NavGroup
          label="CRDs"
          sectionId={SECTION_IDS.CRDS}
          to="/crds"
          icon={FileCode}
          isOpen={openSection === SECTION_IDS.CRDS}
          onToggle={(id) => handleSectionToggle(id, true)}
          isSectionActive={getSectionForPath(pathname) === SECTION_IDS.CRDS}
        >
          <NavItem to="/customresourcedefinitions" icon={FileCode} label="Definitions" count={counts.customresourcedefinitions} onNavigate={() => handleNavItemClick(SECTION_IDS.CRDS)} />
          <NavItem to="/customresources" icon={FileCode} label="Instances" onNavigate={() => handleNavItemClick(SECTION_IDS.CRDS)} />
        </NavGroup>

        {/* Admission Control */}
        <NavGroup
          label="Admission"
          sectionId={SECTION_IDS.ADMISSION}
          to="/admission"
          icon={Webhook}
          isOpen={openSection === SECTION_IDS.ADMISSION}
          onToggle={(id) => handleSectionToggle(id, true)}
          isSectionActive={getSectionForPath(pathname) === SECTION_IDS.ADMISSION}
        >
          <NavItem to="/mutatingwebhooks" icon={Webhook} label="Mutating Webhooks" count={counts.mutatingwebhookconfigurations} onNavigate={() => handleNavItemClick(SECTION_IDS.ADMISSION)} />
          <NavItem to="/validatingwebhooks" icon={Webhook} label="Validating Webhooks" count={counts.validatingwebhookconfigurations} onNavigate={() => handleNavItemClick(SECTION_IDS.ADMISSION)} />
        </NavGroup>
      </div>
    </div>
  );
}

const SECTION_ROUTES = ['/workloads', '/topology', '/addons', ...WORKLOAD_PATHS, ...NETWORKING_PATHS, ...STORAGE_PATHS, ...CLUSTER_PATHS, ...SECURITY_PATHS, ...RESOURCES_PATHS, ...SCALING_PATHS, ...CRD_PATHS, ...ADMISSION_PATHS, ...AI_PATHS];

export function Sidebar() {
  const { counts, isLoading, isInitialLoad } = useResourceCounts();
  const { installed: metallbInstalled } = useMetalLBInstalled();
  const aiStatus = useAIStatus();
  // Show AI section when AI is active (configured + reachable). Also show when unconfigured
  // so users know AI features exist and can set them up.
  const aiActive = aiStatus.status === 'active' || aiStatus.status === 'unconfigured';
  const collapsed = useUIStore((s) => s.isSidebarCollapsed);
  const setCollapsed = useUIStore((s) => s.setSidebarCollapsed);
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const location = useLocation();
  const pathname = location.pathname;
  const isSettingsActive = pathname.startsWith('/settings');

  // Expand sidebar when navigating to a section route (e.g. Workloads) so user sees full nav
  useEffect(() => {
    const isSectionRoute = SECTION_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
    if (isSectionRoute && collapsed) {
      setCollapsed(false);
    }
  }, [pathname, collapsed, setCollapsed]);

  const fullContent = (
    <div className="flex flex-col flex-1 min-h-0 bg-slate-50/10">
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-6 scrollbar-thin scrollbar-thumb-slate-200 hover:scrollbar-thumb-slate-300">
        <SidebarContent counts={counts} isLoading={isLoading} isInitialLoad={isInitialLoad} metallbInstalled={metallbInstalled} aiActive={aiActive} />
      </div>

      {/* Fixed footer: Audit Log + Settings + Collapse — always visible at bottom */}
      <div className="shrink-0 px-5 pb-6 pt-4 border-t border-slate-100/60 bg-white/40 backdrop-blur-md space-y-2">
        <NavLink
          to="/audit-log"
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-500 group border h-11",
              isActive
                ? "bg-white text-indigo-600 border-indigo-100 shadow-apple"
                : "bg-transparent text-slate-800 hover:bg-slate-100/60 border-transparent hover:border-slate-100"
            )
          }
        >
          {({ isActive }) => (
            <>
              <ClipboardList className={cn("h-4 w-4 transition-colors shrink-0", isActive ? "text-indigo-600" : "text-slate-700 group-hover:text-slate-900")} />
              <span className={cn("font-semibold text-[13px]", isActive ? "text-slate-900" : "text-slate-800 group-hover:text-slate-900")}>Audit Log</span>
            </>
          )}
        </NavLink>
        <NavLink
          to="/settings"
          className={cn(
            "flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-500 group border h-11",
            isSettingsActive
              ? "bg-white text-primary border-slate-100 shadow-apple"
              : "bg-transparent text-slate-800 hover:bg-slate-100/60 border-transparent hover:border-slate-100"
          )}
        >
          <Settings className={cn("h-4 w-4 transition-colors shrink-0", isSettingsActive ? "text-primary" : "text-slate-700 group-hover:text-slate-900")} />
          <span className={cn("font-semibold text-[13px]", isSettingsActive ? "text-slate-900" : "text-slate-800 group-hover:text-slate-900")}>Settings</span>
        </NavLink>
        {!collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className={cn(
              "flex items-center justify-start gap-3 w-full px-4 py-2.5 rounded-xl border h-11 transition-all duration-500 group",
              "bg-transparent text-slate-800 hover:bg-slate-100/60 border-transparent hover:border-slate-100"
            )}
            aria-label="Collapse sidebar"
          >
            <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5 shrink-0" aria-hidden />
            <span className="font-semibold text-[13px]">Collapse Sidebar</span>
          </button>
        )}
      </div>
    </div>
  );

  if (collapsed) {
    return (
      <>
        <aside
          className="w-[5.5rem] h-full border-r border-slate-100 bg-white/60 backdrop-blur-3xl flex flex-col items-center py-6 gap-5 shrink-0 z-30 shadow-apple"
          onMouseEnter={() => setFlyoutOpen(true)}
          onMouseLeave={() => setFlyoutOpen(false)}
          aria-label="Navigation rail"
        >
          <NavItemIconOnly to="/dashboard" icon={LayoutDashboard} label="Dashboard" iconColor="text-blue-600 group-hover:text-blue-700" />
          <NavItemIconOnly to="/topology" icon={Network} label="Topology" iconColor="text-violet-600 group-hover:text-violet-700" />
          <NavItemIconOnly to="/addons" icon={Puzzle} label="Add-ons" iconColor="text-indigo-600 group-hover:text-indigo-700" />
          <NavItemIconOnly to="/workloads" icon={Cpu} label="Workloads" iconColor="text-amber-600 group-hover:text-amber-700" />
          <div className="w-12 h-px bg-border/50 my-2" />
          <NavItemIconOnly to="/pods" icon={Box} label="Pods" iconColor="text-emerald-600 group-hover:text-emerald-700" />
          <NavItemIconOnly to="/nodes" icon={Server} label="Nodes" iconColor="text-sky-600 group-hover:text-sky-700" />
          <NavItemIconOnly to="/services" icon={Globe} label="Services" iconColor="text-cyan-600 group-hover:text-cyan-700" />
          <NavItemIconOnly to="/events" icon={Activity} label="Events" iconColor="text-amber-600 group-hover:text-amber-700" />
          <NavItemIconOnly to="/resources" icon={Gauge} label="Resources & DRA" iconColor="text-blue-600 group-hover:text-blue-700" />
          {aiActive && (
            <>
              <div className="w-12 h-px bg-border/50 my-2" />
              <NavItemIconOnly to="/analytics" icon={BarChart3} label="Analytics" iconColor="text-purple-600 group-hover:text-purple-700" />
              <NavItemIconOnly to="/ml-analytics" icon={Brain} label="ML Analytics" iconColor="text-cyan-600 group-hover:text-cyan-700" />
            </>
          )}

          <div className="flex-1" />

          <NavItemIconOnly to="/audit-log" icon={ClipboardList} label="Audit Log" iconColor="text-indigo-600 group-hover:text-indigo-700" />
          <NavItemIconOnly to="/settings" icon={Settings} label="Settings" iconColor="text-slate-800 group-hover:text-slate-900" />
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="flex items-center justify-center w-11 h-11 rounded-xl text-blue-600 hover:text-blue-700 hover:bg-blue-50/80 transition-colors mb-2"
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
              className="fixed left-[5.5rem] top-20 bottom-0 z-40 w-72 border-r border-slate-200/40 bg-white/70 backdrop-blur-3xl shadow-apple-xl ring-1 ring-black/5"
              onMouseEnter={() => setFlyoutOpen(true)}
              onMouseLeave={() => setFlyoutOpen(false)}
              style={{ height: 'calc(100vh - 5rem)' }}
            >
              {fullContent}
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  }

  return (
    <aside className="w-72 h-full flex flex-col border-r border-slate-100 bg-white/40 backdrop-blur-3xl shrink-0 transition-all duration-500">
      {fullContent}
    </aside>
  );
}