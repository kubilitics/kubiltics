import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Box,
  Container,
  Layers,
  Globe,
  Server,
  Database,
  Settings,
  Key,
  Shield,
  Activity,
  Clock,
  Network,
  FileText,
  FileCode,
  Scale,
  HardDrive,
  Users,
  Gauge,
  Webhook,
  Cpu,
  Camera,
  Route,
  AlertTriangle,
  ChevronDown,
  X,
  History,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRecentResourcesStore, type RecentResource } from '@/stores/recentResourcesStore';

// ─── Constants ───────────────────────────────────────────────────────────────

const COLLAPSE_STORAGE_KEY = 'kubilitics-recent-resources-collapsed';

// ─── Kind → Icon mapping ─────────────────────────────────────────────────────

const KIND_ICON_MAP: Record<string, LucideIcon> = {
  Pod: Box,
  Deployment: Container,
  ReplicaSet: Layers,
  StatefulSet: Layers,
  DaemonSet: Layers,
  Job: Activity,
  CronJob: Clock,
  Service: Globe,
  Ingress: Globe,
  IngressClass: Route,
  Endpoint: Globe,
  EndpointSlice: Network,
  NetworkPolicy: Shield,
  ConfigMap: Settings,
  Secret: Key,
  PersistentVolume: HardDrive,
  PersistentVolumeClaim: Database,
  StorageClass: Database,
  VolumeAttachment: HardDrive,
  VolumeSnapshot: Camera,
  VolumeSnapshotClass: Camera,
  VolumeSnapshotContent: HardDrive,
  Node: Server,
  Namespace: FileText,
  Event: Activity,
  APIService: FileCode,
  Lease: Activity,
  ServiceAccount: Users,
  Role: Shield,
  ClusterRole: Shield,
  RoleBinding: Shield,
  ClusterRoleBinding: Shield,
  PriorityClass: AlertTriangle,
  ResourceQuota: Gauge,
  LimitRange: Scale,
  ResourceSlice: Cpu,
  DeviceClass: Cpu,
  HorizontalPodAutoscaler: Scale,
  VerticalPodAutoscaler: Scale,
  PodDisruptionBudget: Shield,
  CustomResourceDefinition: FileCode,
  MutatingWebhookConfiguration: Webhook,
  ValidatingWebhookConfiguration: Webhook,
  PodTemplate: Layers,
  ControllerRevision: History,
  ReplicationController: Layers,
  IPAddressPool: Network,
  BGPPeer: Network,
};

function getIconForKind(kind: string): LucideIcon {
  return KIND_ICON_MAP[kind] ?? Box;
}

// ─── Kind badge color ────────────────────────────────────────────────────────

function getKindBadgeClasses(kind: string): string {
  const workloads = ['Pod', 'Deployment', 'ReplicaSet', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob', 'PodTemplate', 'ControllerRevision', 'ReplicationController'];
  const networking = ['Service', 'Ingress', 'IngressClass', 'Endpoint', 'EndpointSlice', 'NetworkPolicy', 'IPAddressPool', 'BGPPeer'];
  const storage = ['ConfigMap', 'Secret', 'PersistentVolume', 'PersistentVolumeClaim', 'StorageClass', 'VolumeAttachment', 'VolumeSnapshot', 'VolumeSnapshotClass', 'VolumeSnapshotContent'];
  const cluster = ['Node', 'Namespace', 'Event', 'APIService', 'Lease'];

  if (workloads.includes(kind)) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
  if (networking.includes(kind)) return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
  if (storage.includes(kind)) return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400';
  if (cluster.includes(kind)) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
  return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400';
}

// ─── Helper: load persisted collapse state ───────────────────────────────────

function loadCollapseState(): boolean {
  try {
    const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
    return raw === 'true';
  } catch {
    return false;
  }
}

function saveCollapseState(collapsed: boolean) {
  try {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, String(collapsed));
  } catch {
    // ignore
  }
}

// ─── Recent Resource Item ────────────────────────────────────────────────────

function RecentResourceItem({ resource }: { resource: RecentResource }) {
  const navigate = useNavigate();
  const Icon = getIconForKind(resource.resourceKind);

  const handleClick = useCallback(() => {
    navigate(resource.path);
  }, [navigate, resource.path]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-left',
        'transition-all duration-200 group',
        'text-slate-800 dark:text-slate-300',
        'hover:bg-slate-100/60 dark:hover:bg-slate-800/60',
        'hover:text-slate-900 dark:hover:text-slate-100',
        'hover:translate-x-0.5',
      )}
    >
      <Icon
        className="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200 transition-colors"
        aria-hidden
      />
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <span className="text-[13px] font-medium truncate">
          {resource.name}
        </span>
        {resource.namespace && (
          <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500 leading-none">
            {resource.namespace}
          </span>
        )}
      </div>
      <span
        className={cn(
          'shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md leading-none',
          getKindBadgeClasses(resource.resourceKind),
        )}
      >
        {resource.resourceKind}
      </span>
    </button>
  );
}

// ─── RecentResources Section ─────────────────────────────────────────────────

export function RecentResources() {
  const recentResources = useRecentResourcesStore((s) => s.recentResources);
  const clearRecent = useRecentResourcesStore((s) => s.clearRecent);
  const [isCollapsed, setIsCollapsed] = useState(loadCollapseState);

  // Persist collapse state
  useEffect(() => {
    saveCollapseState(isCollapsed);
  }, [isCollapsed]);

  // Don't render anything when there are no recent resources
  if (recentResources.length === 0) return null;

  const handleToggle = () => setIsCollapsed((prev) => !prev);

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    clearRecent();
  };

  return (
    <div className="space-y-1">
      <button
        onClick={handleToggle}
        aria-expanded={!isCollapsed}
        aria-controls="nav-recent-resources"
        className={cn(
          'flex items-center justify-between w-full px-4 py-2.5 rounded-xl transition-all duration-300 group border h-11',
          isCollapsed
            ? 'bg-transparent hover:bg-slate-100/60 dark:hover:bg-slate-800/40 text-slate-800 dark:text-slate-300 border-transparent hover:border-slate-100 dark:hover:border-slate-700/50'
            : 'bg-slate-100/40 dark:bg-slate-800/40 text-slate-900 dark:text-slate-100 border-slate-100 dark:border-slate-700/50',
        )}
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'p-1.5 rounded-lg transition-colors',
              isCollapsed
                ? 'bg-slate-200/50 dark:bg-slate-700/50 text-slate-700 dark:text-slate-400 group-hover:bg-white dark:group-hover:bg-slate-700 group-hover:text-slate-900 dark:group-hover:text-slate-100'
                : 'bg-slate-200/50 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300',
            )}
          >
            <History className="h-4 w-4" />
          </div>
          <span
            className={cn(
              'text-[11px] font-bold tracking-[0.05em] uppercase',
              isCollapsed
                ? 'text-slate-800 dark:text-slate-300 group-hover:text-slate-950 dark:group-hover:text-slate-100'
                : 'text-slate-800 dark:text-slate-300',
            )}
          >
            Recent
          </span>
          {isCollapsed && (
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 tabular-nums">
              {recentResources.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {!isCollapsed && (
            <button
              type="button"
              onClick={handleClear}
              className={cn(
                'p-1 rounded-md transition-colors',
                'text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400',
                'hover:bg-red-50 dark:hover:bg-red-900/20',
              )}
              title="Clear recent resources"
              aria-label="Clear recent resources"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <ChevronDown
            className={cn(
              'h-4 w-4 transition-transform duration-300',
              'text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-slate-100',
              isCollapsed && '-rotate-90',
            )}
          />
        </div>
      </button>

      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            id="nav-recent-resources"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden"
          >
            <div className="pl-2 space-y-0.5 py-1">
              {recentResources.map((resource) => (
                <RecentResourceItem
                  key={resource.path}
                  resource={resource}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
