import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, 
  ExternalLink, 
  Copy, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  Clock,
  Box,
  Server,
  Layers,
  Globe,
  Container,
  Database,
  Key,
  FileCode,
  HardDrive,
  Shield,
  Activity,
  Cpu,
  Settings,
  Workflow,
  Network,
  MemoryStick,
  ArrowUpRight,
  Info,
  ChevronRight,
  type LucideIcon
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useNavigate, useLocation } from 'react-router-dom';

export type ResourceType = 
  | 'pod' 
  | 'deployment' 
  | 'replicaset' 
  | 'service' 
  | 'node' 
  | 'namespace' 
  | 'configmap' 
  | 'secret'
  | 'ingress'
  | 'statefulset'
  | 'daemonset'
  | 'job'
  | 'cronjob'
  | 'pv'
  | 'pvc'
  | 'hpa'
  | 'endpoint'
  | 'endpointslice';

export interface ResourceDetail {
  id: string;
  type: ResourceType;
  name: string;
  namespace?: string;
  status?: 'healthy' | 'warning' | 'error' | 'pending';
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  createdAt?: string;
  uid?: string;
  spec?: Record<string, any>;
  statusDetails?: Record<string, any>;
}

interface NodeDetailPopupProps {
  resource: ResourceDetail | null;
  position?: { x: number; y: number };
  onClose: () => void;
  onViewDetails?: (resource: ResourceDetail) => void;
  sourceResourceType?: string; // The resource type we're viewing from
  sourceResourceName?: string; // The name of the resource we started from
}

const resourceIcons: Record<ResourceType, LucideIcon> = {
  pod: Box,
  deployment: Container,
  replicaset: Layers,
  service: Globe,
  node: Server,
  namespace: Network,
  configmap: FileCode,
  secret: Key,
  ingress: Globe,
  statefulset: Database,
  daemonset: Cpu,
  job: Workflow,
  cronjob: Clock,
  pv: HardDrive,
  pvc: HardDrive,
  hpa: Activity,
  endpoint: Globe,
  endpointslice: Network,
};
const resourceColors: Record<ResourceType, string> = {
  pod: 'hsl(199, 89%, 48%)',
  deployment: 'hsl(25, 95%, 53%)',
  replicaset: 'hsl(262, 83%, 58%)',
  service: 'hsl(142, 76%, 36%)',
  node: 'hsl(0, 72%, 51%)',
  namespace: 'hsl(280, 87%, 67%)',
  configmap: 'hsl(47, 96%, 53%)',
  secret: 'hsl(340, 82%, 52%)',
  ingress: 'hsl(174, 72%, 40%)',
  statefulset: 'hsl(220, 70%, 50%)',
  daemonset: 'hsl(280, 70%, 50%)',
  job: 'hsl(45, 93%, 47%)',
  cronjob: 'hsl(36, 100%, 50%)',
  pv: 'hsl(210, 40%, 50%)',
  pvc: 'hsl(210, 60%, 45%)',
  hpa: 'hsl(160, 60%, 45%)',
  endpoint: 'hsl(180, 60%, 45%)',
  endpointslice: 'hsl(190, 60%, 45%)',
};

const resourceLabels: Record<ResourceType, string> = {
  pod: 'Pod',
  deployment: 'Deployment',
  replicaset: 'ReplicaSet',
  service: 'Service',
  node: 'Node',
  namespace: 'Namespace',
  configmap: 'ConfigMap',
  secret: 'Secret',
  ingress: 'Ingress',
  statefulset: 'StatefulSet',
  daemonset: 'DaemonSet',
  job: 'Job',
  cronjob: 'CronJob',
  pv: 'PersistentVolume',
  pvc: 'PersistentVolumeClaim',
  hpa: 'HPA',
  endpoint: 'Endpoint',
  endpointslice: 'EndpointSlice',
};

const statusConfig = {
  healthy: { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-500/10', label: 'Healthy' },
  warning: { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-500/10', label: 'Warning' },
  error: { icon: XCircle, color: 'text-rose-600', bg: 'bg-rose-500/10', label: 'Error' },
  pending: { icon: Clock, color: 'text-muted-foreground', bg: 'bg-muted', label: 'Pending' },
};

// Mock detailed data for different resource types
function getMockResourceDetails(resource: ResourceDetail): ResourceDetail {
  const baseDetails = {
    ...resource,
    uid: resource.uid || 'cd68340d-d81f-4095-a733-df860f6724f1',
    createdAt: resource.createdAt || new Date(Date.now() - 80 * 24 * 60 * 60 * 1000).toISOString(),
    labels: resource.labels || { 'app': 'demo-app', 'version': 'blue' },
    annotations: resource.annotations || {
      'deployment.kubernetes.io/revision': '1',
      'kubectl.kubernetes.io/last-applied-configuration': '{"apiVersion":"apps/v1","kind":"Deployment",...}',
    },
  };

  switch (resource.type) {
    case 'deployment':
      return {
        ...baseDetails,
        spec: {
          replicas: 3,
          selector: {
            matchLabels: { app: 'demo-app', version: 'blue' },
          },
          template: {
            metadata: { creationTimestamp: null },
            spec: { containers: [{ name: 'app', image: 'nginx:1.25' }] },
          },
        },
        statusDetails: {
          observedGeneration: 1,
          replicas: 3,
          updatedReplicas: 3,
          readyReplicas: 3,
          availableReplicas: 3,
        },
      };
    case 'pod':
      return {
        ...baseDetails,
        spec: {
          nodeName: 'worker-node-1',
          containers: [{ name: 'main', image: 'nginx:1.25', ports: [{ containerPort: 80 }] }],
          restartPolicy: 'Always',
        },
        statusDetails: {
          phase: 'Running',
          podIP: '10.244.1.45',
          hostIP: '192.168.1.10',
          conditions: [
            { type: 'Ready', status: 'True' },
            { type: 'ContainersReady', status: 'True' },
          ],
        },
      };
    case 'service':
      return {
        ...baseDetails,
        spec: {
          type: 'ClusterIP',
          clusterIP: '10.96.145.32',
          ports: [{ port: 80, targetPort: 8080, protocol: 'TCP' }],
          selector: { app: 'demo-app' },
        },
        statusDetails: {
          loadBalancer: {},
        },
      };
    case 'replicaset':
      return {
        ...baseDetails,
        spec: {
          replicas: 3,
          selector: { matchLabels: { app: 'demo-app' } },
        },
        statusDetails: {
          replicas: 3,
          fullyLabeledReplicas: 3,
          readyReplicas: 3,
          availableReplicas: 3,
        },
      };
    case 'node':
      return {
        ...baseDetails,
        spec: {
          podCIDR: '10.244.1.0/24',
          providerID: 'aws:///us-east-1a/i-1234567890abcdef0',
        },
        statusDetails: {
          capacity: { cpu: '4', memory: '16Gi', pods: '110' },
          allocatable: { cpu: '3800m', memory: '14Gi', pods: '110' },
          conditions: [
            { type: 'Ready', status: 'True' },
            { type: 'MemoryPressure', status: 'False' },
            { type: 'DiskPressure', status: 'False' },
          ],
        },
      };
    default:
      return baseDetails;
  }
}

export function NodeDetailPopup({ 
  resource, 
  position, 
  onClose, 
  onViewDetails,
  sourceResourceType,
  sourceResourceName 
}: NodeDetailPopupProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState('overview');

  // Handle Escape key to close popup
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!resource) return null;

  const details = getMockResourceDetails(resource);
  const Icon = resourceIcons[resource.type] || Box;
  const color = resourceColors[resource.type] || 'hsl(var(--primary))';
  const statusInfo = resource.status ? statusConfig[resource.status] : null;
  const StatusIcon = statusInfo?.icon || CheckCircle2;

  // Determine current page resource type from URL
  const currentResourceType = location.pathname.split('/')[1];
  
  // Build breadcrumb trail
  const getBreadcrumbTrail = () => {
    const trail: { label: string; type?: ResourceType }[] = [];
    
    // Add source resource if provided
    if (sourceResourceType && sourceResourceName) {
      trail.push({ 
        label: sourceResourceName, 
        type: sourceResourceType.replace(/s$/, '') as ResourceType 
      });
    } else if (currentResourceType) {
      // Fallback to current path
      const pathType = currentResourceType.replace(/s$/, '') as ResourceType;
      if (resourceLabels[pathType]) {
        trail.push({ label: resourceLabels[pathType], type: pathType });
      }
    }
    
    // Add target resource
    trail.push({ 
      label: resource.name, 
      type: resource.type 
    });
    
    return trail;
  };
  
  const breadcrumbTrail = getBreadcrumbTrail();
  const isNavigatingAway = currentResourceType !== `${resource.type}s`;

  const handleCopyUID = () => {
    if (details.uid) {
      navigator.clipboard.writeText(details.uid);
      toast.success('UID copied to clipboard');
    }
  };

  const getResourceRoute = () => {
    const routes: Record<ResourceType, string> = {
      pod: `/pods/${resource.namespace}/${resource.name}`,
      deployment: `/deployments/${resource.namespace}/${resource.name}`,
      service: `/services/${resource.namespace}/${resource.name}`,
      replicaset: `/replicasets/${resource.namespace}/${resource.name}`,
      node: `/nodes/${resource.name}`,
      namespace: `/namespaces/${resource.name}`,
      configmap: `/configmaps/${resource.namespace}/${resource.name}`,
      secret: `/secrets/${resource.namespace}/${resource.name}`,
      ingress: `/ingresses/${resource.namespace}/${resource.name}`,
      statefulset: `/statefulsets/${resource.namespace}/${resource.name}`,
      daemonset: `/daemonsets/${resource.namespace}/${resource.name}`,
      job: `/jobs/${resource.namespace}/${resource.name}`,
      cronjob: `/cronjobs/${resource.namespace}/${resource.name}`,
      pv: `/persistentvolumes/${resource.name}`,
      pvc: `/persistentvolumeclaims/${resource.namespace}/${resource.name}`,
      hpa: `/horizontalpodautoscalers/${resource.namespace}/${resource.name}`,
      endpoint: `/endpoints/${resource.namespace}/${resource.name}`,
      endpointslice: `/endpointslices/${resource.namespace}/${resource.name}`,
    };
    return routes[resource.type];
  };

  const handleViewDetails = () => {
    const route = getResourceRoute();
    if (route) {
      navigate(route);
      onClose();
    }
  };

  const handleOpenInNewTab = () => {
    const route = getResourceRoute();
    if (route) {
      window.open(route, '_blank');
      toast.success(`Opened ${resourceLabels[resource.type]} in new tab`);
    }
  };

  const formatAge = (timestamp: string) => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days > 0) return `${days}d`;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours > 0) return `${hours}h`;
    const minutes = Math.floor(diff / (1000 * 60));
    return `${minutes}m`;
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="w-full max-w-2xl max-h-[80vh] bg-background border border-border rounded-2xl shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
        {/* Breadcrumb Trail */}
          {breadcrumbTrail.length > 1 && (
            <div className="flex items-center gap-1.5 px-6 py-2.5 border-b border-border bg-muted/50 text-xs">
              {breadcrumbTrail.map((item, index) => {
                const ItemIcon = item.type ? resourceIcons[item.type] : null;
                return (
                  <div key={index} className="flex items-center gap-1.5">
                    {index > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                    <div className="flex items-center gap-1.5">
                      {ItemIcon && (
                        <ItemIcon 
                          className="h-3.5 w-3.5" 
                          style={{ color: item.type ? resourceColors[item.type] : undefined }} 
                        />
                      )}
                      <span className={cn(
                        index === breadcrumbTrail.length - 1 
                          ? 'text-foreground font-medium' 
                          : 'text-muted-foreground'
                      )}>
                        {item.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
            <div className="flex items-center gap-4">
              <div 
                className="p-3 rounded-xl" 
                style={{ backgroundColor: `${color}20` }}
              >
                <Icon className="h-6 w-6" style={{ color }} />
              </div>
              <div>
                <h2 className="text-lg font-semibold">{resource.name}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="secondary" className="font-mono text-xs">
                    {resourceLabels[resource.type]}
                  </Badge>
                  {resource.namespace && (
                    <Badge variant="outline" className="font-mono text-xs">
                      {resource.namespace}
                    </Badge>
                  )}
                  {statusInfo && (
                    <Badge 
                      variant="outline" 
                      className={cn('gap-1', statusInfo.color, statusInfo.bg)}
                    >
                      <StatusIcon className="h-3 w-3" />
                      {statusInfo.label}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs text-muted-foreground">
                Esc to close
              </Badge>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>

          {/* Content */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
            <div className="px-6 pt-2 border-b border-border">
              <TabsList className="h-9 bg-transparent p-0 gap-4">
                <TabsTrigger 
                  value="overview" 
                  className="h-9 px-0 pb-2 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
                >
                  Overview
                </TabsTrigger>
                <TabsTrigger 
                  value="spec" 
                  className="h-9 px-0 pb-2 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
                >
                  Spec
                </TabsTrigger>
                <TabsTrigger 
                  value="status" 
                  className="h-9 px-0 pb-2 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
                >
                  Status
                </TabsTrigger>
              </TabsList>
            </div>

            <ScrollArea className="h-[400px]">
              <TabsContent value="overview" className="m-0 p-6 space-y-4">
                {/* Basic Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Name</p>
                    <p className="font-mono text-sm">{resource.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Namespace</p>
                    <p className="font-mono text-sm">{resource.namespace || '-'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">UID</p>
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-xs truncate">{details.uid}</p>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopyUID}>
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Age</p>
                    <p className="text-sm">{details.createdAt ? formatAge(details.createdAt) : '-'}</p>
                  </div>
                </div>

                {/* Labels */}
                {details.labels && Object.keys(details.labels).length > 0 && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Labels</p>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(details.labels).map(([key, value]) => (
                        <Badge key={key} variant="secondary" className="font-mono text-xs">
                          {key}={value}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Annotations */}
                {details.annotations && Object.keys(details.annotations).length > 0 && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Annotations</p>
                    <Card className="bg-muted/30">
                      <CardContent className="p-3 space-y-2">
                        {Object.entries(details.annotations).slice(0, 3).map(([key, value]) => (
                          <div key={key} className="text-xs">
                            <span className="font-medium text-primary">{key}:</span>
                            <span className="text-muted-foreground ml-2 break-all">
                              {typeof value === 'string' && value.length > 100 
                                ? `${value.substring(0, 100)}...` 
                                : value}
                            </span>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="spec" className="m-0 p-6">
                <Card className="bg-muted/30">
                  <CardContent className="p-4">
                    <pre className="text-xs font-mono overflow-auto whitespace-pre-wrap">
                      {JSON.stringify(details.spec, null, 2)}
                    </pre>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="status" className="m-0 p-6">
                <Card className="bg-muted/30">
                  <CardContent className="p-4">
                    <pre className="text-xs font-mono overflow-auto whitespace-pre-wrap">
                      {JSON.stringify(details.statusDetails, null, 2)}
                    </pre>
                  </CardContent>
                </Card>
              </TabsContent>
            </ScrollArea>
          </Tabs>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/20">
            <div className="flex items-center gap-2">
              {isNavigatingAway && (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/20">
                        <Info className="h-3.5 w-3.5 text-amber-600" />
                        <span className="text-xs text-amber-700 font-medium">
                          Navigates to {resourceLabels[resource.type]}
                        </span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <p>This will take you to the {resourceLabels[resource.type]} detail page. Use "Open in New Tab" to keep your current view.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {!isNavigatingAway && (
                <p className="text-xs text-muted-foreground">
                  View full resource details
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              {isNavigatingAway && (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" onClick={handleOpenInNewTab} className="gap-2">
                        <ArrowUpRight className="h-4 w-4" />
                        New Tab
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Open in new tab (keeps current view)</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <Button onClick={handleViewDetails} className="gap-2">
                <ExternalLink className="h-4 w-4" />
                View Details
              </Button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
