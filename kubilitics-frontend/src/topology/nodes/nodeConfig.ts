/**
 * Design system tokens for topology nodes.
 * All 8 category configs with light + dark mode colors.
 */

export interface CategoryColors {
  headerBg: { light: string; dark: string };
  nodeBg: { light: string; dark: string };
  borderColor: { light: string; dark: string };
}

export const categoryConfig: Record<string, CategoryColors> = {
  workload: {
    headerBg: { light: "#2563EB", dark: "#3B82F6" },
    nodeBg: { light: "#EFF6FF", dark: "#1E3A5F" },
    borderColor: { light: "#BFDBFE", dark: "#1E40AF" },
  },
  networking: {
    headerBg: { light: "#7C3AED", dark: "#8B5CF6" },
    nodeBg: { light: "#F5F3FF", dark: "#2D1B69" },
    borderColor: { light: "#DDD6FE", dark: "#5B21B6" },
  },
  config: {
    headerBg: { light: "#0D9488", dark: "#14B8A6" },
    nodeBg: { light: "#F0FDFA", dark: "#1A3C3A" },
    borderColor: { light: "#99F6E4", dark: "#0F766E" },
  },
  storage: {
    headerBg: { light: "#EA580C", dark: "#F97316" },
    nodeBg: { light: "#FFF7ED", dark: "#3D2010" },
    borderColor: { light: "#FED7AA", dark: "#9A3412" },
  },
  rbac: {
    headerBg: { light: "#D97706", dark: "#F59E0B" },
    nodeBg: { light: "#FFFBEB", dark: "#3D2E0A" },
    borderColor: { light: "#FDE68A", dark: "#92400E" },
  },
  scaling: {
    headerBg: { light: "#16A34A", dark: "#22C55E" },
    nodeBg: { light: "#F0FDF4", dark: "#1A3C2A" },
    borderColor: { light: "#BBF7D0", dark: "#15803D" },
  },
  cluster: {
    headerBg: { light: "#475569", dark: "#94A3B8" },
    nodeBg: { light: "#F8FAFC", dark: "#1E293B" },
    borderColor: { light: "#CBD5E1", dark: "#334155" },
  },
  extensions: {
    headerBg: { light: "#DB2777", dark: "#EC4899" },
    nodeBg: { light: "#FDF2F8", dark: "#3D1A30" },
    borderColor: { light: "#FBCFE8", dark: "#9D174D" },
  },
};

export const healthColors = {
  healthy: "#16A34A",
  warning: "#EAB308",
  error: "#DC2626",
  unknown: "#9CA3AF",
} as const;

export const healthStatusMap: Record<string, keyof typeof healthColors> = {
  Running: "healthy",
  Ready: "healthy",
  Bound: "healthy",
  Available: "healthy",
  Completed: "healthy",
  Active: "healthy",
  healthy: "healthy",
  Pending: "warning",
  warning: "warning",
  PartiallyAvailable: "warning",
  Failed: "error",
  error: "error",
  NotReady: "error",
  Lost: "error",
  CrashLoopBackOff: "error",
  OOMKilled: "error",
};

/**
 * Lucide icon names mapped to resource kinds.
 * Import these from lucide-react at the component level.
 */
export const resourceIconNames: Record<string, string> = {
  Pod: "Box",
  Deployment: "Layers",
  StatefulSet: "Database",
  DaemonSet: "Copy",
  ReplicaSet: "CopyPlus",
  Job: "Play",
  CronJob: "Clock",
  Service: "Globe",
  Ingress: "ArrowRightCircle",
  IngressClass: "Settings",
  Endpoints: "Target",
  EndpointSlice: "Split",
  ConfigMap: "FileText",
  Secret: "Key",
  Namespace: "Folder",
  PersistentVolumeClaim: "HardDrive",
  PersistentVolume: "Server",
  StorageClass: "Archive",
  Node: "Cpu",
  ServiceAccount: "User",
  Role: "Shield",
  ClusterRole: "Shield",
  RoleBinding: "Link",
  ClusterRoleBinding: "Link",
  HorizontalPodAutoscaler: "TrendingUp",
  PodDisruptionBudget: "ShieldCheck",
  NetworkPolicy: "Lock",
  MutatingWebhookConfiguration: "Zap",
  ValidatingWebhookConfiguration: "CheckCircle",
  PriorityClass: "ArrowUp",
  RuntimeClass: "Terminal",
};

/**
 * Semantic layer assignments per resource kind.
 * Used by ELK layout for hierarchical positioning.
 */
export const layerAssignment: Record<string, number> = {
  Ingress: 0,
  IngressClass: 0,
  Service: 1,
  Endpoints: 1,
  EndpointSlice: 1,
  Deployment: 2,
  StatefulSet: 2,
  DaemonSet: 2,
  CronJob: 2,
  ReplicaSet: 3,
  Job: 3,
  Pod: 4,
  Node: 5,
  PriorityClass: 5,
  RuntimeClass: 5,
  ConfigMap: 10,   // sidebar
  Secret: 10,
  PersistentVolumeClaim: 11, // sidebar right
  PersistentVolume: 11,
  StorageClass: 11,
  ServiceAccount: 20, // below
  RoleBinding: 20,
  Role: 20,
  ClusterRoleBinding: 20,
  ClusterRole: 20,
  HorizontalPodAutoscaler: 21,
  PodDisruptionBudget: 21,
  NetworkPolicy: 21,
};

/**
 * Dark mode color mapping for canvas elements.
 */
export const canvasColors = {
  light: {
    background: "#FFFFFF",
    gridDots: "#E2E8F0",
    nodeBackground: "#FFFFFF",
    nodeBorder: "#E2E8F0",
    primaryText: "#1E293B",
    secondaryText: "#64748B",
    edgeLabelBg: "#FFFFFF",
    edgeLabelBorder: "#E2E8F0",
    minimapBg: "rgba(248, 250, 252, 0.9)",
  },
  dark: {
    background: "#0F172A",
    gridDots: "#334155",
    nodeBackground: "#1E293B",
    nodeBorder: "#334155",
    primaryText: "#F1F5F9",
    secondaryText: "#94A3B8",
    edgeLabelBg: "#1E293B",
    edgeLabelBorder: "#475569",
    minimapBg: "rgba(30, 41, 59, 0.9)",
  },
} as const;
