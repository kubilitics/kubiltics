import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
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
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { ResourceDocumentation, K8S_DOCS } from '@/components/editor/ResourceDocumentation';
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

  // Check for required fields
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

  // Check for tabs
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
  clusterName = 'docker-desktop',
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
    URL.revokeObjectURL(url);
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
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background flex flex-col"
    >
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" />
            <span className="font-semibold">Create {resourceKind}</span>
          </div>
          <Badge variant="outline" className="text-xs font-mono">
            {clusterName}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          {/* Font Size Selector */}
          <div className="flex items-center gap-1 border border-border rounded-md p-0.5">
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={fontSize === 'small' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setFontSize('small')}
                    className="h-7 w-7 p-0 text-xs"
                  >
                    A
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Small font</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={fontSize === 'medium' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setFontSize('medium')}
                    className="h-7 w-7 p-0 text-sm"
                  >
                    A
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Medium font</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={fontSize === 'large' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setFontSize('large')}
                    className="h-7 w-7 p-0 text-base font-medium"
                  >
                    A
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Large font</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {/* Upload Button */}
          <Button variant="outline" size="sm" onClick={handleUpload} className="h-8 gap-2">
            <Upload className="h-3.5 w-3.5" />
            Upload File/URL
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Editor/Docs Tabs */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'editor' | 'docs')} className="flex-1 flex flex-col overflow-hidden">
            <div className="border-b border-border px-4">
              <TabsList className="h-10 bg-transparent p-0 gap-0">
                <TabsTrigger
                  value="editor"
                  className="h-10 px-4 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none gap-2"
                >
                  <FileCode className="h-4 w-4" />
                  Editor
                </TabsTrigger>
                <TabsTrigger
                  value="docs"
                  className="h-10 px-4 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none gap-2"
                >
                  <BookOpen className="h-4 w-4" />
                  Documentation
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="editor" className="flex-1 m-0 overflow-hidden">
              <div className="h-full flex flex-col">
                {/* Validation Errors */}
                {!validation.isValid && (
                  <div className="px-4 py-2 bg-destructive/10 border-b border-destructive/20">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                      <div className="flex-1">
                        {validation.errors.map((error, i) => (
                          <p key={i} className="text-xs text-destructive">{error}</p>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Status Bar */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/20">
                  <div className="flex items-center gap-2">
                    {validation.isValid && yaml.trim() && (
                      <Badge variant="outline" className="text-xs text-primary border-primary/30 bg-primary/10">
                        <Check className="h-3 w-3 mr-1" />
                        Valid YAML
                      </Badge>
                    )}
                    {hasChanges && (
                      <Badge variant="outline" className="text-xs text-accent-foreground border-accent/30 bg-accent/50">
                        <Sparkles className="h-3 w-3 mr-1" />
                        Modified
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" onClick={handleCopy} className="h-7 w-7 p-0">
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Copy YAML</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" onClick={handleDownload} className="h-7 w-7 p-0">
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Download YAML</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>

                {/* Code Editor */}
                <div className="flex-1 overflow-hidden">
                  <CodeEditor
                    value={yaml}
                    onChange={handleYamlChange}
                    className="h-full rounded-none border-0"
                    minHeight="100%"
                    fontSize={fontSize}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="docs" className="flex-1 m-0 overflow-hidden">
              <ResourceDocumentation
                resourceKind={resourceKind}
                className="h-full"
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Footer */}
      <footer className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/30">
        <Button
          variant="outline"
          size="sm"
          onClick={handleUndo}
          disabled={!hasChanges}
          className="gap-2"
        >
          <Undo2 className="h-4 w-4" />
          Undo Changes
        </Button>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            disabled={!validation.isValid || isApplying}
          >
            {isApplying ? 'Applying...' : 'Apply'}
          </Button>
        </div>
      </footer>
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
