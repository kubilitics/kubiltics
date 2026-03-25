/* eslint-disable react-refresh/only-export-components */
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Upload,
  Undo2,
  X,
  Check,
  Copy,
  Download,
  FileCode,
  BookOpen,
  AlertCircle,
  Sparkles,
  Loader2,
  ChevronLeft,
  CheckCircle2,
  Rocket,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/sonner';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { ResourceDocumentation } from '@/components/editor/ResourceDocumentation';
import { cn } from '@/lib/utils';

interface ResourceCreatorProps {
  resourceKind: string;
  defaultYaml: string;
  onClose: () => void;
  onApply: (yaml: string) => void;
  isApplying?: boolean;
  clusterName?: string;
}

interface YamlValidationResult {
  isValid: boolean;
  errors: string[];
}

function validateYaml(yaml: string): YamlValidationResult {
  const errors: string[] = [];

  if (!yaml.trim()) {
    errors.push('YAML cannot be empty');
    return { isValid: false, errors };
  }

  if (!yaml.includes('apiVersion:')) {
    errors.push('Missing required field: apiVersion');
  }
  if (!yaml.includes('kind:')) {
    errors.push('Missing required field: kind');
  }
  if (!yaml.includes('metadata:')) {
    errors.push('Missing required field: metadata');
  }
  if (!yaml.includes('name:')) {
    errors.push('Missing required field: metadata.name');
  }

  if (yaml.includes('\t')) {
    errors.push('Tabs are not allowed in YAML, use spaces');
  }

  return { isValid: errors.length === 0, errors: errors.slice(0, 5) };
}

export function ResourceCreator({
  resourceKind,
  defaultYaml,
  onClose,
  onApply,
  isApplying = false,
  clusterName,
}: ResourceCreatorProps) {
  const navigate = useNavigate();
  const [yaml, setYaml] = useState(defaultYaml);
  const [originalYaml] = useState(defaultYaml);
  const [activeTab, setActiveTab] = useState<'editor' | 'docs'>('editor');
  const [fontSize, setFontSize] = useState<'small' | 'medium' | 'large'>('small');
  const [validation, setValidation] = useState<YamlValidationResult>({ isValid: true, errors: [] });

  const hasChanges = yaml !== originalYaml;

  const handleYamlChange = useCallback((value: string) => {
    setYaml(value);
    setValidation(validateYaml(value));
  }, []);

  const handleUndo = () => {
    setYaml(originalYaml);
    setValidation(validateYaml(originalYaml));
    toast.info('Changes reverted');
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(yaml);
    toast.success('YAML copied to clipboard');
  };

  const handleDownload = () => {
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${resourceKind.toLowerCase()}.yaml`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    toast.success('YAML downloaded');
  };

  const handleUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.yaml,.yml';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const content = event.target?.result as string;
          setYaml(content);
          setValidation(validateYaml(content));
          toast.success(`Loaded ${file.name}`);
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const handleApply = () => {
    if (!validation.isValid) {
      toast.error('Please fix validation errors before applying');
      return;
    }
    onApply(yaml);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="fixed z-[60] flex flex-col bg-white dark:bg-slate-900 overflow-hidden"
      style={{ top: 0, right: 0, bottom: 0, left: 0 }}
      ref={(el) => {
        // Position to cover exactly the main content area (right of sidebar, below header)
        if (el) {
          const main = document.getElementById('main-content');
          if (main) {
            const rect = main.getBoundingClientRect();
            el.style.top = `${rect.top}px`;
            el.style.left = `${rect.left}px`;
            el.style.right = '0px';
            el.style.bottom = '0px';
          }
        }
      }}
    >
        {/* ─── Header — title + tabs + close ──────────────────────────────── */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-200/60 dark:border-slate-700/60 bg-slate-50/80 dark:bg-slate-800/50 shrink-0">
          <Plus className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">Create {resourceKind}</span>
          {clusterName && <span className="text-xs text-muted-foreground font-mono shrink-0">{clusterName}</span>}

          <div className="flex items-center gap-1 ml-3 shrink-0">
            <button
              onClick={() => setActiveTab('editor')}
              className={cn(
                "flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all border",
                activeTab === 'editor'
                  ? "bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/25"
                  : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-primary/50 hover:text-primary"
              )}
            >
              <FileCode className="h-4 w-4" />
              Editor
            </button>
            <button
              onClick={() => setActiveTab('docs')}
              className={cn(
                "flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all border",
                activeTab === 'docs'
                  ? "bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/25"
                  : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-primary/50 hover:text-primary"
              )}
            >
              <BookOpen className="h-4 w-4" />
              Documentation
            </button>
          </div>

          <div className="flex-1" />

          {/* Editor-only toolbar */}
          {activeTab === 'editor' && (
            <div className="flex items-center gap-1 shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={handleCopy} className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Copy</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={handleDownload} className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                    <Download className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Download</TooltipContent>
              </Tooltip>
              <button
                onClick={handleUpload}
                className="h-7 rounded-lg border border-slate-200/80 dark:border-slate-700/60 px-2 flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                <Upload className="h-3 w-3" />
                Import
              </button>
              <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
            </div>
          )}

          <button
            onClick={onClose}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ─── Editor: validation errors ──────────────────────────────────── */}
        <AnimatePresence>
          {activeTab === 'editor' && !validation.isValid && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="px-6 py-2.5 bg-red-50/80 dark:bg-red-900/10 border-b border-red-100 dark:border-red-900/20">
                <div className="space-y-1">
                  {validation.errors.map((error, i) => (
                    <p key={i} className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5">
                      <span className="h-1 w-1 rounded-full bg-red-400 shrink-0" />
                      {error}
                    </p>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ─── Main Content ───────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {activeTab === 'editor' ? (
            <CodeEditor
              value={yaml}
              onChange={handleYamlChange}
              className="h-full rounded-none border-0"
              minHeight="100%"
              fontSize={fontSize}
            />
          ) : (
            <ResourceDocumentation
              resourceKind={resourceKind}
              className="h-full"
            />
          )}
        </div>

        {/* ─── Footer — Editor only ──────────────────────────────────────── */}
        {activeTab === 'editor' && <div className="grid grid-cols-3 items-center px-6 py-4 border-t border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-900 shadow-[0_-4px_16px_rgba(0,0,0,0.04)] dark:shadow-[0_-4px_16px_rgba(0,0,0,0.2)] shrink-0">
          {/* Left — Cancel + Reset */}
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="flex items-center gap-2 h-10 px-5 rounded-lg text-sm font-semibold border border-red-200 dark:border-red-800/60 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/15 hover:bg-red-100 dark:hover:bg-red-900/30 hover:border-red-300 dark:hover:border-red-700 transition-colors"
            >
              <X className="h-4 w-4" />
              Cancel
            </button>
            {hasChanges && (
              <button
                onClick={handleUndo}
                className="flex items-center gap-1.5 h-10 px-4 rounded-lg text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <Undo2 className="h-4 w-4" />
                Reset
              </button>
            )}
          </div>

          {/* Center — Validation status */}
          <div className="flex justify-center">
            {validation.isValid && yaml.trim() ? (
              <span className="flex items-center gap-2 h-10 px-5 rounded-lg text-sm font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                <CheckCircle2 className="h-5 w-5" />
                Valid YAML
              </span>
            ) : !yaml.trim() ? null : (
              <span className="flex items-center gap-2 h-10 px-5 rounded-lg text-sm font-semibold text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <AlertCircle className="h-5 w-5" />
                {validation.errors.length} error{validation.errors.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Right — Create */}
          <div className="flex justify-end">
            <button
              onClick={handleApply}
              disabled={!validation.isValid || isApplying}
              className={cn(
                "flex items-center gap-2 h-10 px-6 rounded-lg text-sm font-semibold transition-all",
                validation.isValid && !isApplying
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md shadow-primary/30"
                  : "bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed"
              )}
            >
              {isApplying ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Applying...
                </>
              ) : (
                <>
                  <Rocket className="h-4 w-4" />
                  Create {resourceKind}
                </>
              )}
            </button>
          </div>
        </div>}
    </motion.div>
  );
}

// Default YAML templates for different resource types
export const DEFAULT_YAMLS: Record<string, string> = {
  Pod: `apiVersion: v1
kind: Pod
metadata:
  name: ''
  namespace: ''
  labels:
    app: kubilitics
spec:
  containers:
    - name: ''
      image: ''
      ports:
        - containerPort: 80
      imagePullPolicy: Always
  nodeName: ''`,

  Deployment: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ''
  namespace: ''
  labels:
    app: kubilitics
spec:
  replicas: 1
  selector:
    matchLabels:
      app: kubilitics
  template:
    metadata:
      labels:
        app: kubilitics
    spec:
      containers:
        - name: ''
          image: ''
          ports:
            - containerPort: 80
          resources:
            requests:
              memory: "64Mi"
              cpu: "250m"
            limits:
              memory: "128Mi"
              cpu: "500m"`,

  Service: `apiVersion: v1
kind: Service
metadata:
  name: ''
  namespace: ''
spec:
  type: ClusterIP
  selector:
    app: kubilitics
  ports:
    - protocol: TCP
      port: 80
      targetPort: 80`,

  ConfigMap: `apiVersion: v1
kind: ConfigMap
metadata:
  name: ''
  namespace: ''
data:
  key: value`,

  Secret: `apiVersion: v1
kind: Secret
metadata:
  name: ''
  namespace: ''
type: Opaque
stringData:
  key: value`,

  StatefulSet: `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: ''
  namespace: ''
  labels:
    app: kubilitics
spec:
  serviceName: statefulset-service
  replicas: 1
  selector:
    matchLabels:
      app: kubilitics
  template:
    metadata:
      labels:
        app: kubilitics
    spec:
      containers:
        - name: ''
          image: ''
          ports:
            - containerPort: 80
  # Optional: add volumeClaimTemplates for persistent storage per pod
  # volumeClaimTemplates:
  #   - metadata:
  #       name: data
  #     spec:
  #       accessModes: ["ReadWriteOnce"]
  #       storageClassName: standard
  #       resources:
  #         requests:
  #           storage: 1Gi`,

  DaemonSet: `apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: ''
  namespace: ''
spec:
  selector:
    matchLabels:
      app: kubilitics
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
  template:
    metadata:
      labels:
        app: kubilitics
    spec:
      # nodeSelector: {}
      # tolerations: []
      containers:
        - name: ''
          image: ''`,

  Job: `apiVersion: batch/v1
kind: Job
metadata:
  name: ''
  namespace: ''
spec:
  completions: 1
  parallelism: 1
  backoffLimit: 6
  template:
    spec:
      containers:
        - name: ''
          image: ''
          command: []
      restartPolicy: Never
`,

  CronJob: `apiVersion: batch/v1
kind: CronJob
metadata:
  name: ''
  namespace: ''
spec:
  schedule: "*/5 * * * *"
  concurrencyPolicy: Allow
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 1
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: ''
              image: ''
              command: []
          restartPolicy: OnFailure
`,

  Ingress: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ''
  namespace: ''
spec:
  rules:
    - host: ''
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: ''
                port:
                  number: 80`,

  PersistentVolumeClaim: `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ''
  namespace: ''
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi`,

  Namespace: `apiVersion: v1
kind: Namespace
metadata:
  name: ''
  labels:
    name: ''`,

  ServiceAccount: `apiVersion: v1
kind: ServiceAccount
metadata:
  name: ''
  namespace: ''`,

  Role: `apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: ''
  namespace: ''
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]`,

  ClusterRole: `apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: ''
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]`,

  RoleBinding: `apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ''
  namespace: ''
subjects:
  - kind: ServiceAccount
    name: ''
    namespace: ''
roleRef:
  kind: Role
  name: ''
  apiGroup: rbac.authorization.k8s.io`,

  NetworkPolicy: `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: ''
  namespace: ''
spec:
  podSelector:
    matchLabels:
      app: kubilitics
  policyTypes:
    - Ingress
    - Egress`,

  HorizontalPodAutoscaler: `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ''
  namespace: ''
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ''
  minReplicas: 1
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50`,

  ClusterRoleBinding: `apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: ''
subjects:
  - kind: ServiceAccount
    name: ''
    namespace: ''
roleRef:
  kind: ClusterRole
  name: ''
  apiGroup: rbac.authorization.k8s.io`,

  PersistentVolume: `apiVersion: v1
kind: PersistentVolume
metadata:
  name: ''
spec:
  capacity:
    storage: 10Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  hostPath:
    path: /data`,

  StorageClass: `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ''
provisioner: kubernetes.io/no-provisioner
volumeBindingMode: WaitForFirstConsumer`,

  VolumeSnapshot: `apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: ''
  namespace: default
spec:
  source:
    persistentVolumeClaimName: ''
  volumeSnapshotClassName: ''`,

  VolumeSnapshotClass: `apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshotClass
metadata:
  name: ''
driver: ''
deletionPolicy: Delete`,

  ResourceQuota: `apiVersion: v1
kind: ResourceQuota
metadata:
  name: ''
  namespace: ''
spec:
  hard:
    requests.cpu: "1"
    requests.memory: 1Gi
    limits.cpu: "2"
    limits.memory: 2Gi
    pods: "10"`,

  LimitRange: `apiVersion: v1
kind: LimitRange
metadata:
  name: ''
  namespace: ''
spec:
  limits:
    - default:
        cpu: "500m"
        memory: 512Mi
      defaultRequest:
        cpu: "100m"
        memory: 128Mi
      type: Container`,

  PodDisruptionBudget: `apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: ''
  namespace: ''
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: kubilitics`,

  PriorityClass: `apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: ''
value: 1000000
globalDefault: false
description: ''`,

  ReplicaSet: `apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: ''
  namespace: ''
  labels:
    app: kubilitics
spec:
  replicas: 3
  selector:
    matchLabels:
      app: kubilitics
  template:
    metadata:
      labels:
        app: kubilitics
    spec:
      containers:
        - name: ''
          image: ''`,

  Endpoints: `apiVersion: v1
kind: Endpoints
metadata:
  name: ''
  namespace: ''
subsets:
  - addresses:
      - ip: 10.0.0.1
    ports:
      - port: 80`,

  EndpointSlice: `apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: ''
  namespace: ''
  labels:
    kubernetes.io/service-name: ''
addressType: IPv4
ports:
  - port: 80
endpoints:
  - addresses:
      - 10.0.0.1`,

  IngressClass: `apiVersion: networking.k8s.io/v1
kind: IngressClass
metadata:
  name: ''
spec:
  controller: nginx.org/ingress-controller`,

  VolumeAttachment: `apiVersion: storage.k8s.io/v1
kind: VolumeAttachment
metadata:
  name: ''
spec:
  attacher: kubernetes.io/csi
  nodeName: ''
  source:
    persistentVolumeName: ''`,

  Lease: `apiVersion: coordination.k8s.io/v1
kind: Lease
metadata:
  name: ''
  namespace: ''
spec:
  holderIdentity: ''
  leaseDurationSeconds: 40`,

  VerticalPodAutoscaler: `apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: ''
  namespace: ''
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ''
  updatePolicy:
    updateMode: "Auto"`,

  ReplicationController: `apiVersion: v1
kind: ReplicationController
metadata:
  name: ''
  namespace: ''
spec:
  replicas: 3
  selector:
    app: kubilitics
  template:
    metadata:
      labels:
        app: kubilitics
    spec:
      containers:
        - name: ''
          image: ''`,

  CustomResourceDefinition: `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: ''
spec:
  group: ''
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
  scope: Namespaced
  names:
    plural: ''
    singular: ''
    kind: ''`,

  RuntimeClass: `apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: ''
handler: ''`,

  ValidatingWebhookConfiguration: `apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
metadata:
  name: ''
webhooks:
  - name: ''
    clientConfig:
      service:
        name: ''
        namespace: ''
        port: 443
    rules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE"]
        resources: ["pods"]
    admissionReviewVersions: ["v1"]
    sideEffects: None
    failurePolicy: Fail`,

  MutatingWebhookConfiguration: `apiVersion: admissionregistration.k8s.io/v1
kind: MutatingWebhookConfiguration
metadata:
  name: ''
webhooks:
  - name: ''
    clientConfig:
      service:
        name: ''
        namespace: ''
        port: 443
    rules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE"]
        resources: ["pods"]
    admissionReviewVersions: ["v1"]
    sideEffects: None
    failurePolicy: Fail`,

  APIService: `apiVersion: apiregistration.k8s.io/v1
kind: APIService
metadata:
  name: ''
spec:
  service:
    namespace: ''
    name: ''
  group: ''
  version: ''
  insecureSkipTLSVerify: false`,

  PodTemplate: `apiVersion: v1
kind: PodTemplate
metadata:
  name: ''
  namespace: ''
template:
  metadata:
    labels:
      app: kubilitics
  spec:
    containers:
      - name: container-1
        image: nginx`,

  ControllerRevision: `apiVersion: apps/v1
kind: ControllerRevision
metadata:
  name: ''
  namespace: ''
revision: 1
data:
  # Managed by StatefulSet or DaemonSet
  # Provide the underlying object state here
  {}`,

  ResourceSlice: `apiVersion: resource.k8s.io/v1alpha3
kind: ResourceSlice
metadata:
  name: ''
spec:
  driverName: ''
  pool:
    name: ''
    generation: 0
    resourceSliceCount: 1`,

  DeviceClass: `apiVersion: resource.k8s.io/v1
kind: DeviceClass
metadata:
  name: ''
spec:
  selectors:
    - cel:
        expression: "device.driver == 'example.com/driver'"`
};
