/**
 * ResourceTemplates — a gallery of starter K8s resource templates.
 *
 * Users pick a template card, edit the pre-filled YAML in a Monaco editor,
 * choose a target namespace, and apply it to the cluster.
 */

import { useState, useMemo, useCallback } from 'react';
import yaml from 'js-yaml';
import {
  LayoutTemplate,
  Rocket,
  Globe,
  Route as RouteIcon,
  FileText,
  Lock,
  Clock,
  Timer,
  FolderOpen,
  Activity,
  Shield,
  Search,
  Loader2,
  Plus,
  X,
  Check,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { toast } from '@/components/ui/sonner';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { useNamespacesFromCluster } from '@/hooks/useNamespacesFromCluster';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { applyManifest } from '@/services/api/resources';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

// ---------------------------------------------------------------------------
// Template definitions
// ---------------------------------------------------------------------------

interface TemplateDefinition {
  id: string;
  title: string;
  description: string;
  category: string;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  yaml: string;
}

const TEMPLATES: TemplateDefinition[] = [
  {
    id: 'deployment',
    title: 'Deployment',
    description: 'Run stateless application pods with rolling updates and self-healing.',
    category: 'Workloads',
    icon: Rocket,
    iconColor: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-100 dark:bg-blue-500/20',
    yaml: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  labels:
    app: my-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: my-app
          image: nginx:1.27-alpine
          ports:
            - containerPort: 80
              protocol: TCP
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 256Mi
          livenessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 10
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 5
`,
  },
  {
    id: 'service-clusterip',
    title: 'Service (ClusterIP)',
    description: 'Expose pods internally within the cluster on a stable virtual IP.',
    category: 'Networking',
    icon: Globe,
    iconColor: 'text-cyan-600 dark:text-cyan-400',
    iconBg: 'bg-cyan-100 dark:bg-cyan-500/20',
    yaml: `apiVersion: v1
kind: Service
metadata:
  name: my-app-svc
  labels:
    app: my-app
spec:
  type: ClusterIP
  selector:
    app: my-app
  ports:
    - name: http
      port: 80
      targetPort: 80
      protocol: TCP
`,
  },
  {
    id: 'service-nodeport',
    title: 'Service (NodePort)',
    description: 'Expose pods externally via a static port on each node.',
    category: 'Networking',
    icon: Globe,
    iconColor: 'text-cyan-600 dark:text-cyan-400',
    iconBg: 'bg-cyan-100 dark:bg-cyan-500/20',
    yaml: `apiVersion: v1
kind: Service
metadata:
  name: my-app-nodeport
  labels:
    app: my-app
spec:
  type: NodePort
  selector:
    app: my-app
  ports:
    - name: http
      port: 80
      targetPort: 80
      nodePort: 30080
      protocol: TCP
`,
  },
  {
    id: 'service-loadbalancer',
    title: 'Service (LoadBalancer)',
    description: 'Expose pods via an external cloud load balancer.',
    category: 'Networking',
    icon: Globe,
    iconColor: 'text-cyan-600 dark:text-cyan-400',
    iconBg: 'bg-cyan-100 dark:bg-cyan-500/20',
    yaml: `apiVersion: v1
kind: Service
metadata:
  name: my-app-lb
  labels:
    app: my-app
spec:
  type: LoadBalancer
  selector:
    app: my-app
  ports:
    - name: http
      port: 80
      targetPort: 80
      protocol: TCP
`,
  },
  {
    id: 'ingress',
    title: 'Ingress',
    description: 'Route external HTTP/S traffic to services via host or path rules.',
    category: 'Networking',
    icon: RouteIcon,
    iconColor: 'text-violet-600 dark:text-violet-400',
    iconBg: 'bg-violet-100 dark:bg-violet-500/20',
    yaml: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  ingressClassName: nginx
  rules:
    - host: my-app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-app-svc
                port:
                  number: 80
`,
  },
  {
    id: 'configmap',
    title: 'ConfigMap',
    description: 'Store non-confidential configuration data as key-value pairs.',
    category: 'Config',
    icon: FileText,
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    iconBg: 'bg-emerald-100 dark:bg-emerald-500/20',
    yaml: `apiVersion: v1
kind: ConfigMap
metadata:
  name: my-app-config
data:
  APP_ENV: production
  APP_LOG_LEVEL: info
  APP_PORT: "8080"
  config.yaml: |
    server:
      host: 0.0.0.0
      port: 8080
    logging:
      level: info
      format: json
`,
  },
  {
    id: 'secret',
    title: 'Secret',
    description: 'Store sensitive data like passwords, tokens, or TLS certificates.',
    category: 'Config',
    icon: Lock,
    iconColor: 'text-rose-600 dark:text-rose-400',
    iconBg: 'bg-rose-100 dark:bg-rose-500/20',
    yaml: `apiVersion: v1
kind: Secret
metadata:
  name: my-app-secret
type: Opaque
data:
  # base64 encoded values — decode with: echo '<value>' | base64 -d
  DB_USERNAME: YWRtaW4=
  DB_PASSWORD: c3VwZXJzZWNyZXQ=
  API_KEY: bXktYXBpLWtleS0xMjM0NTY=
`,
  },
  {
    id: 'job',
    title: 'Job',
    description: 'Run a one-off task to completion with automatic retries.',
    category: 'Workloads',
    icon: Clock,
    iconColor: 'text-amber-600 dark:text-amber-400',
    iconBg: 'bg-amber-100 dark:bg-amber-500/20',
    yaml: `apiVersion: batch/v1
kind: Job
metadata:
  name: my-batch-job
spec:
  backoffLimit: 3
  activeDeadlineSeconds: 600
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: worker
          image: busybox:1.36
          command:
            - /bin/sh
            - -c
            - |
              echo "Starting batch job at $(date)"
              echo "Processing data..."
              sleep 5
              echo "Job completed successfully at $(date)"
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 128Mi
`,
  },
  {
    id: 'cronjob',
    title: 'CronJob',
    description: 'Schedule recurring jobs on a cron-based time interval.',
    category: 'Workloads',
    icon: Timer,
    iconColor: 'text-orange-600 dark:text-orange-400',
    iconBg: 'bg-orange-100 dark:bg-orange-500/20',
    yaml: `apiVersion: batch/v1
kind: CronJob
metadata:
  name: my-scheduled-task
spec:
  schedule: "0 * * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 1
  jobTemplate:
    spec:
      backoffLimit: 2
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: task
              image: busybox:1.36
              command:
                - /bin/sh
                - -c
                - |
                  echo "Hourly task running at $(date)"
                  echo "Cleaning up temporary files..."
                  echo "Task finished"
              resources:
                requests:
                  cpu: 50m
                  memory: 64Mi
                limits:
                  cpu: 100m
                  memory: 128Mi
`,
  },
  {
    id: 'namespace',
    title: 'Namespace',
    description: 'Create an isolated scope for resources with optional quotas.',
    category: 'Cluster',
    icon: FolderOpen,
    iconColor: 'text-indigo-600 dark:text-indigo-400',
    iconBg: 'bg-indigo-100 dark:bg-indigo-500/20',
    yaml: `apiVersion: v1
kind: Namespace
metadata:
  name: my-namespace
  labels:
    team: platform
    environment: staging
`,
  },
  {
    id: 'hpa',
    title: 'HorizontalPodAutoscaler',
    description: 'Automatically scale pods based on CPU or memory utilization.',
    category: 'Scaling',
    icon: Activity,
    iconColor: 'text-teal-600 dark:text-teal-400',
    iconBg: 'bg-teal-100 dark:bg-teal-500/20',
    yaml: `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-app-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  minReplicas: 1
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Pods
          value: 2
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 10
          periodSeconds: 60
`,
  },
  {
    id: 'networkpolicy',
    title: 'NetworkPolicy',
    description: 'Define ingress and egress traffic rules for pod-to-pod communication.',
    category: 'Networking',
    icon: Shield,
    iconColor: 'text-pink-600 dark:text-pink-400',
    iconBg: 'bg-pink-100 dark:bg-pink-500/20',
    yaml: `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: my-app-netpol
spec:
  podSelector:
    matchLabels:
      app: my-app
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              role: frontend
      ports:
        - protocol: TCP
          port: 80
  egress:
    - to:
        - podSelector:
            matchLabels:
              role: database
      ports:
        - protocol: TCP
          port: 5432
    - to:
        - namespaceSelector: {}
      ports:
        - protocol: UDP
          port: 53
`,
  },
];

// Group templates by category
const CATEGORIES = ['Workloads', 'Networking', 'Config', 'Cluster', 'Scaling'] as const;

// ---------------------------------------------------------------------------
// TemplateCard
// ---------------------------------------------------------------------------

function TemplateCard({
  template,
  onClick,
}: {
  template: TemplateDefinition;
  onClick: () => void;
}) {
  return (
    <Card className="group hover:shadow-lg hover:border-primary/30 transition-all duration-300 cursor-pointer border-border/50 hover:-translate-y-0.5">
      <CardContent className="p-5 flex flex-col h-full" onClick={onClick}>
        <div className="flex items-start gap-4 mb-3">
          <div
            className={cn(
              'h-11 w-11 rounded-xl flex items-center justify-center shrink-0 transition-colors',
              template.iconBg,
            )}
          >
            <template.icon className={cn('h-5.5 w-5.5', template.iconColor)} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-sm text-foreground truncate">{template.title}</h3>
            <Badge variant="outline" className="mt-1 text-[10px] font-medium">
              {template.category}
            </Badge>
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed flex-1">
          {template.description}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-4 w-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors press-effect"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Create
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// TemplateEditorDialog
// ---------------------------------------------------------------------------

function TemplateEditorDialog({
  template,
  open,
  onOpenChange,
}: {
  template: TemplateDefinition | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const clusterId = useActiveClusterId();
  const { data: namespaces = [] } = useNamespacesFromCluster(clusterId);
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);

  const [yamlContent, setYamlContent] = useState('');
  const [selectedNamespace, setSelectedNamespace] = useState('default');
  const [isApplying, setIsApplying] = useState(false);

  // Reset editor content whenever the dialog opens (not just when template changes).
  // This fixes stale YAML when re-opening the same template after editing.
  const [lastOpen, setLastOpen] = useState(false);
  if (open && !lastOpen && template) {
    setYamlContent(template.yaml);
    setSelectedNamespace('default');
  }
  if (open !== lastOpen) setLastOpen(open);

  const handleApply = useCallback(async () => {
    if (!clusterId || !isBackendConfigured) {
      toast.error('No cluster connected', {
        description: 'Connect to a cluster in Settings before applying resources.',
      });
      return;
    }

    if (!yamlContent.trim()) {
      toast.error('YAML cannot be empty');
      return;
    }

    // Inject namespace into metadata using YAML parsing to avoid regex
    // false-matches (e.g. "namespace:" inside a ConfigMap data section).
    let finalYaml = yamlContent;
    const isClusterScoped = template?.id === 'namespace';
    if (!isClusterScoped && selectedNamespace) {
      try {
        const doc = yaml.load(finalYaml) as Record<string, unknown> | null;
        if (doc && typeof doc === 'object') {
          const meta = (doc.metadata ?? {}) as Record<string, unknown>;
          meta.namespace = selectedNamespace;
          doc.metadata = meta;
          finalYaml = yaml.dump(doc, { lineWidth: -1, noRefs: true, quotingType: '"' });
        }
      } catch {
        // YAML parse failed — fall back to inserting after metadata.name
        finalYaml = finalYaml.replace(
          /^( {2}name:\s*.+)$/m,
          `$1\n  namespace: ${selectedNamespace}`,
        );
      }
    }

    setIsApplying(true);
    try {
      const result = await applyManifest(backendBaseUrl, clusterId, finalYaml);
      const resources = result.resources ?? [];
      const summary = resources.map((r) => `${r.kind}/${r.name} (${r.action})`).join(', ');
      toast.success('Resource applied', {
        description: summary || result.message || 'Applied successfully.',
      });
      onOpenChange(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error('Failed to apply resource', { description: message });
    } finally {
      setIsApplying(false);
    }
  }, [clusterId, isBackendConfigured, yamlContent, selectedNamespace, template, backendBaseUrl, onOpenChange]);

  if (!template) return null;

  const isClusterScoped = template.id === 'namespace';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b space-y-1.5">
          <div className="flex items-center gap-3">
            <div className={cn('h-9 w-9 rounded-lg flex items-center justify-center', template.iconBg)}>
              <template.icon className={cn('h-4.5 w-4.5', template.iconColor)} />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">
                Create {template.title}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Edit the YAML below and apply to your cluster.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Namespace selector */}
        {!isClusterScoped && (
          <div className="px-6 py-3 border-b bg-muted/30 flex items-center gap-3">
            <label className="text-sm font-medium text-muted-foreground shrink-0">
              Target Namespace
            </label>
            <Select value={selectedNamespace} onValueChange={setSelectedNamespace}>
              <SelectTrigger className="w-60 h-9">
                <SelectValue placeholder="Select namespace" />
              </SelectTrigger>
              <SelectContent>
                {namespaces.length > 0 ? (
                  namespaces.map((ns) => (
                    <SelectItem key={ns} value={ns}>
                      {ns}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="default">default</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* YAML Editor */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <CodeEditor
            value={yamlContent}
            onChange={(v) => setYamlContent(v)}
            minHeight="400px"
            fontSize="small"
          />
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex items-center justify-between bg-background">
          <p className="text-xs text-muted-foreground">
            Review the YAML carefully before applying.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="press-effect">
              <X className="h-3.5 w-3.5 mr-1.5" />
              Cancel
            </Button>
            <Button size="sm" onClick={handleApply} disabled={isApplying} className="press-effect">
              {isApplying ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5 mr-1.5" />
              )}
              Apply
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// ResourceTemplates page
// ---------------------------------------------------------------------------

export default function ResourceTemplates() {
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDefinition | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTemplates = useMemo(() => {
    if (!searchQuery.trim()) return TEMPLATES;
    const q = searchQuery.toLowerCase();
    return TEMPLATES.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q),
    );
  }, [searchQuery]);

  const handleCreate = useCallback((template: TemplateDefinition) => {
    setSelectedTemplate(template);
    setDialogOpen(true);
  }, []);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <LayoutTemplate className="h-5 w-5 text-primary" />
            </div>
            Resource Templates
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create common Kubernetes resources from starter templates with smart defaults.
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      </div>

      {/* Template grid grouped by category */}
      {CATEGORIES.map((category) => {
        const categoryTemplates = filteredTemplates.filter((t) => t.category === category);
        if (categoryTemplates.length === 0) return null;
        return (
          <div key={category}>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              {category}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {categoryTemplates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onClick={() => handleCreate(template)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {filteredTemplates.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Search className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No templates match your search.</p>
        </div>
      )}

      {/* Editor dialog */}
      <TemplateEditorDialog
        template={selectedTemplate}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
