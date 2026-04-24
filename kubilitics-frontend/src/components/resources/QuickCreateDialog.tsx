import { useState, useMemo, useCallback } from 'react';
import { Plus, X, Code, Eye, AlertCircle, Copy, Download, Loader2, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/components/ui/sonner';
import { useCreateK8sResource } from '@/hooks/useKubernetes';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveCluster } from '@/stores/clusterPresenceStore';
import { applyManifest } from '@/services/backendApiClient';

// ─── Types ──────────────────────────────────────────────────────────────────

export type QuickCreateResourceKind = 'Pod' | 'Deployment' | 'Service' | 'ConfigMap' | 'Namespace';

interface QuickCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: QuickCreateResourceKind;
  onSuccess?: () => void;
}

interface KeyValuePair {
  key: string;
  value: string;
}

// ─── YAML Validation ────────────────────────────────────────────────────────

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
  if (!yaml.includes('apiVersion:')) errors.push('Missing required field: apiVersion');
  if (!yaml.includes('kind:')) errors.push('Missing required field: kind');
  if (!yaml.includes('metadata:')) errors.push('Missing required field: metadata');
  if (!yaml.includes('name:')) errors.push('Missing required field: metadata.name');
  if (yaml.includes('\t')) errors.push('Tabs are not allowed in YAML, use spaces');

  return { isValid: errors.length === 0, errors: errors.slice(0, 5) };
}

// ─── YAML Generators ────────────────────────────────────────────────────────

function generatePodYaml(fields: PodFields): string {
  const commandLines = fields.command.trim()
    ? `  containers:
    - name: ${fields.name || 'main'}
      image: ${fields.image || 'nginx:latest'}
      command: ["/bin/sh", "-c"]
      args:
        - ${JSON.stringify(fields.command)}`
    : `  containers:
    - name: ${fields.name || 'main'}
      image: ${fields.image || 'nginx:latest'}`;

  return `apiVersion: v1
kind: Pod
metadata:
  name: ${fields.name || 'my-pod'}
  namespace: ${fields.namespace || 'default'}
  labels:
    app: ${fields.name || 'my-pod'}
spec:
${commandLines}`;
}

function generateDeploymentYaml(fields: DeploymentFields): string {
  const portSection = fields.port
    ? `
        ports:
          - containerPort: ${fields.port}`
    : '';

  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${fields.name || 'my-deployment'}
  namespace: ${fields.namespace || 'default'}
  labels:
    app: ${fields.name || 'my-deployment'}
spec:
  replicas: ${fields.replicas || 1}
  selector:
    matchLabels:
      app: ${fields.name || 'my-deployment'}
  template:
    metadata:
      labels:
        app: ${fields.name || 'my-deployment'}
    spec:
      containers:
        - name: ${fields.name || 'main'}
          image: ${fields.image || 'nginx:latest'}${portSection}
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 200m
              memory: 256Mi`;
}

function generateServiceYaml(fields: ServiceFields): string {
  const nodePortLine = fields.type === 'NodePort' && fields.nodePort
    ? `\n      nodePort: ${fields.nodePort}`
    : '';

  return `apiVersion: v1
kind: Service
metadata:
  name: ${fields.name || 'my-service'}
  namespace: ${fields.namespace || 'default'}
spec:
  type: ${fields.type || 'ClusterIP'}
  selector:
    app: ${fields.name || 'my-service'}
  ports:
    - protocol: TCP
      port: ${fields.port || 80}
      targetPort: ${fields.targetPort || 80}${nodePortLine}`;
}

function generateConfigMapYaml(fields: ConfigMapFields): string {
  const dataEntries = fields.data
    .filter((d) => d.key.trim())
    .map((d) => `  ${d.key}: ${JSON.stringify(d.value)}`)
    .join('\n');

  const dataSection = dataEntries ? `data:\n${dataEntries}` : 'data: {}';

  return `apiVersion: v1
kind: ConfigMap
metadata:
  name: ${fields.name || 'my-configmap'}
  namespace: ${fields.namespace || 'default'}
  labels:
    app: ${fields.name || 'my-configmap'}
${dataSection}`;
}

function generateNamespaceYaml(fields: NamespaceFields): string {
  return `apiVersion: v1
kind: Namespace
metadata:
  name: ${fields.name || 'my-namespace'}
  labels:
    name: ${fields.name || 'my-namespace'}`;
}

// ─── Field types ────────────────────────────────────────────────────────────

interface PodFields { name: string; namespace: string; image: string; command: string; }
interface DeploymentFields { name: string; namespace: string; image: string; replicas: string; port: string; }
interface ServiceFields { name: string; namespace: string; type: string; port: string; targetPort: string; nodePort: string; }
interface ConfigMapFields { name: string; namespace: string; data: KeyValuePair[]; }
interface NamespaceFields { name: string; }

// ─── Resource type to K8s API resource mapping ──────────────────────────────

const KIND_TO_RESOURCE_TYPE: Record<QuickCreateResourceKind, string> = {
  Pod: 'pods',
  Deployment: 'deployments',
  Service: 'services',
  ConfigMap: 'configmaps',
  Namespace: 'namespaces',
};

// ─── Form Components ────────────────────────────────────────────────────────

function PodForm({ fields, onChange }: { fields: PodFields; onChange: (f: PodFields) => void }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="qc-name">Pod Name <span className="text-destructive">*</span></Label>
          <Input
            id="qc-name"
            placeholder="my-pod"
            value={fields.name}
            onChange={(e) => onChange({ ...fields, name: e.target.value })}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="qc-namespace">Namespace</Label>
          <Select value={fields.namespace} onValueChange={(v) => onChange({ ...fields, namespace: v })}>
            <SelectTrigger id="qc-namespace"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="default">default</SelectItem>
              <SelectItem value="kube-system">kube-system</SelectItem>
              <SelectItem value="kube-public">kube-public</SelectItem>
              <SelectItem value="production">production</SelectItem>
              <SelectItem value="staging">staging</SelectItem>
              <SelectItem value="development">development</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="qc-image">Container Image <span className="text-destructive">*</span></Label>
        <Input
          id="qc-image"
          placeholder="nginx:latest"
          value={fields.image}
          onChange={(e) => onChange({ ...fields, image: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">e.g. nginx:latest, busybox, redis:7-alpine</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="qc-command">Command <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
        <Input
          id="qc-command"
          placeholder='echo "Hello, Kubernetes!"'
          value={fields.command}
          onChange={(e) => onChange({ ...fields, command: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">Shell command to run in the container</p>
      </div>
    </div>
  );
}

function DeploymentForm({ fields, onChange }: { fields: DeploymentFields; onChange: (f: DeploymentFields) => void }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="qc-name">Deployment Name <span className="text-destructive">*</span></Label>
          <Input
            id="qc-name"
            placeholder="my-deployment"
            value={fields.name}
            onChange={(e) => onChange({ ...fields, name: e.target.value })}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="qc-namespace">Namespace</Label>
          <Select value={fields.namespace} onValueChange={(v) => onChange({ ...fields, namespace: v })}>
            <SelectTrigger id="qc-namespace"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="default">default</SelectItem>
              <SelectItem value="kube-system">kube-system</SelectItem>
              <SelectItem value="kube-public">kube-public</SelectItem>
              <SelectItem value="production">production</SelectItem>
              <SelectItem value="staging">staging</SelectItem>
              <SelectItem value="development">development</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="qc-image">Container Image <span className="text-destructive">*</span></Label>
        <Input
          id="qc-image"
          placeholder="nginx:latest"
          value={fields.image}
          onChange={(e) => onChange({ ...fields, image: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="qc-replicas">Replicas</Label>
          <Input
            id="qc-replicas"
            type="number"
            min="1"
            max="100"
            placeholder="1"
            value={fields.replicas}
            onChange={(e) => onChange({ ...fields, replicas: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="qc-port">Container Port <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
          <Input
            id="qc-port"
            type="number"
            placeholder="80"
            value={fields.port}
            onChange={(e) => onChange({ ...fields, port: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

function ServiceForm({ fields, onChange }: { fields: ServiceFields; onChange: (f: ServiceFields) => void }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="qc-name">Service Name <span className="text-destructive">*</span></Label>
          <Input
            id="qc-name"
            placeholder="my-service"
            value={fields.name}
            onChange={(e) => onChange({ ...fields, name: e.target.value })}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="qc-namespace">Namespace</Label>
          <Select value={fields.namespace} onValueChange={(v) => onChange({ ...fields, namespace: v })}>
            <SelectTrigger id="qc-namespace"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="default">default</SelectItem>
              <SelectItem value="kube-system">kube-system</SelectItem>
              <SelectItem value="kube-public">kube-public</SelectItem>
              <SelectItem value="production">production</SelectItem>
              <SelectItem value="staging">staging</SelectItem>
              <SelectItem value="development">development</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="qc-type">Service Type</Label>
        <Select value={fields.type} onValueChange={(v) => onChange({ ...fields, type: v })}>
          <SelectTrigger id="qc-type"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ClusterIP">ClusterIP</SelectItem>
            <SelectItem value="NodePort">NodePort</SelectItem>
            <SelectItem value="LoadBalancer">LoadBalancer</SelectItem>
            <SelectItem value="ExternalName">ExternalName</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="qc-port">Port <span className="text-destructive">*</span></Label>
          <Input
            id="qc-port"
            type="number"
            placeholder="80"
            value={fields.port}
            onChange={(e) => onChange({ ...fields, port: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="qc-target-port">Target Port <span className="text-destructive">*</span></Label>
          <Input
            id="qc-target-port"
            type="number"
            placeholder="80"
            value={fields.targetPort}
            onChange={(e) => onChange({ ...fields, targetPort: e.target.value })}
          />
        </div>
      </div>
      {fields.type === 'NodePort' && (
        <div className="space-y-2">
          <Label htmlFor="qc-node-port">Node Port <span className="text-muted-foreground text-xs font-normal">(optional, 30000-32767)</span></Label>
          <Input
            id="qc-node-port"
            type="number"
            min="30000"
            max="32767"
            placeholder="Auto-assign"
            value={fields.nodePort}
            onChange={(e) => onChange({ ...fields, nodePort: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}

function ConfigMapForm({ fields, onChange }: { fields: ConfigMapFields; onChange: (f: ConfigMapFields) => void }) {
  const addEntry = () => onChange({ ...fields, data: [...fields.data, { key: '', value: '' }] });
  const removeEntry = (index: number) => onChange({ ...fields, data: fields.data.filter((_, i) => i !== index) });
  const updateEntry = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...fields.data];
    updated[index] = { ...updated[index], [field]: value };
    onChange({ ...fields, data: updated });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="qc-name">ConfigMap Name <span className="text-destructive">*</span></Label>
          <Input
            id="qc-name"
            placeholder="my-configmap"
            value={fields.name}
            onChange={(e) => onChange({ ...fields, name: e.target.value })}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="qc-namespace">Namespace</Label>
          <Select value={fields.namespace} onValueChange={(v) => onChange({ ...fields, namespace: v })}>
            <SelectTrigger id="qc-namespace"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="default">default</SelectItem>
              <SelectItem value="kube-system">kube-system</SelectItem>
              <SelectItem value="kube-public">kube-public</SelectItem>
              <SelectItem value="production">production</SelectItem>
              <SelectItem value="staging">staging</SelectItem>
              <SelectItem value="development">development</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Data Entries</Label>
          <Button variant="outline" size="sm" onClick={addEntry} className="h-7 gap-1 text-xs">
            <Plus className="h-3 w-3" /> Add Entry
          </Button>
        </div>
        {fields.data.map((entry, index) => (
          <div key={index} className="flex items-start gap-2">
            <div className="flex-1 space-y-1">
              <Input
                placeholder="key"
                value={entry.key}
                onChange={(e) => updateEntry(index, 'key', e.target.value)}
                className="h-8 text-sm font-mono"
              />
            </div>
            <span className="text-muted-foreground mt-1.5">=</span>
            <div className="flex-[2] space-y-1">
              <Input
                placeholder="value"
                value={entry.value}
                onChange={(e) => updateEntry(index, 'value', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            {fields.data.length > 1 && (
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeEntry(index)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function NamespaceForm({ fields, onChange }: { fields: NamespaceFields; onChange: (f: NamespaceFields) => void }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="qc-name">Namespace Name <span className="text-destructive">*</span></Label>
        <Input
          id="qc-name"
          placeholder="my-namespace"
          value={fields.name}
          onChange={(e) => onChange({ ...fields, name: e.target.value })}
          autoFocus
        />
        <p className="text-xs text-muted-foreground">
          Must be lowercase, alphanumeric, and may contain hyphens. Must start with a letter.
        </p>
      </div>
    </div>
  );
}

// ─── Initial field factories ────────────────────────────────────────────────

function createInitialFields(kind: QuickCreateResourceKind) {
  switch (kind) {
    case 'Pod':
      return { name: '', namespace: 'default', image: '', command: '' } as PodFields;
    case 'Deployment':
      return { name: '', namespace: 'default', image: '', replicas: '1', port: '80' } as DeploymentFields;
    case 'Service':
      return { name: '', namespace: 'default', type: 'ClusterIP', port: '80', targetPort: '80', nodePort: '' } as ServiceFields;
    case 'ConfigMap':
      return { name: '', namespace: 'default', data: [{ key: '', value: '' }] } as ConfigMapFields;
    case 'Namespace':
      return { name: '' } as NamespaceFields;
  }
}

function isFormValid(kind: QuickCreateResourceKind, fields: Record<string, unknown>): boolean {
  const f = fields as Record<string, string>;
  switch (kind) {
    case 'Pod':
      return !!(f.name && f.image);
    case 'Deployment':
      return !!(f.name && f.image);
    case 'Service':
      return !!(f.name && f.port && f.targetPort);
    case 'ConfigMap':
      return !!f.name;
    case 'Namespace':
      return !!f.name;
  }
}

function generateYaml(kind: QuickCreateResourceKind, fields: Record<string, unknown>): string {
  switch (kind) {
    case 'Pod':
      return generatePodYaml(fields as unknown as PodFields);
    case 'Deployment':
      return generateDeploymentYaml(fields as unknown as DeploymentFields);
    case 'Service':
      return generateServiceYaml(fields as unknown as ServiceFields);
    case 'ConfigMap':
      return generateConfigMapYaml(fields as unknown as ConfigMapFields);
    case 'Namespace':
      return generateNamespaceYaml(fields as unknown as NamespaceFields);
  }
}

// ─── Main Dialog Component ──────────────────────────────────────────────────

export function QuickCreateDialog({ open, onOpenChange, kind, onSuccess }: QuickCreateDialogProps) {
  const [mode, setMode] = useState<'form' | 'yaml'>('form');
  const [fields, setFields] = useState<Record<string, unknown>>(() => createInitialFields(kind));
  const [editedYaml, setEditedYaml] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resourceType = KIND_TO_RESOURCE_TYPE[kind] as Parameters<typeof useCreateK8sResource>[0];
  const createResource = useCreateK8sResource(resourceType);

  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const activeCluster = useActiveCluster();

  // Generate YAML from form fields
  const generatedYaml = useMemo(() => generateYaml(kind, fields), [kind, fields]);

  // The active YAML is either user-edited (in yaml mode) or auto-generated (in form mode)
  const activeYaml = mode === 'yaml' ? editedYaml : generatedYaml;

  const yamlValidation = useMemo((): YamlValidationResult => {
    if (mode === 'form') return { isValid: true, errors: [] };
    return validateYaml(editedYaml);
  }, [mode, editedYaml]);

  const formValid = mode === 'form' ? isFormValid(kind, fields) : yamlValidation.isValid;

  // When switching to YAML mode, seed the editor with current generated YAML
  const handleModeSwitch = useCallback((newMode: 'form' | 'yaml') => {
    if (newMode === 'yaml' && mode === 'form') {
      setEditedYaml(generatedYaml);
    }
    setMode(newMode);
  }, [mode, generatedYaml]);

  const handleCopyYaml = useCallback(() => {
    navigator.clipboard.writeText(activeYaml);
    toast.success('YAML copied to clipboard');
  }, [activeYaml]);

  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob([activeYaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${kind.toLowerCase()}.yaml`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    toast.success('YAML downloaded');
  }, [activeYaml, kind]);

  // Reset state when dialog opens/closes
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      // Reset on close
      setTimeout(() => {
        setMode('form');
        setFields(createInitialFields(kind));
        setEditedYaml('');
        setIsSubmitting(false);
      }, 200);
    }
    onOpenChange(nextOpen);
  }, [onOpenChange, kind]);

  const handleSubmit = useCallback(async () => {
    const yaml = activeYaml;
    setIsSubmitting(true);
    try {
      if (isBackendConfigured && currentClusterId) {
        await applyManifest(backendBaseUrl, currentClusterId, yaml);
      } else {
        await createResource.mutateAsync({ yaml });
      }
      toast.success(`${kind} created successfully`);
      onSuccess?.();
      handleOpenChange(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create resource';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }, [activeYaml, isBackendConfigured, currentClusterId, backendBaseUrl, createResource, kind, onSuccess, handleOpenChange]);

  const renderForm = () => {
    switch (kind) {
      case 'Pod':
        return <PodForm fields={fields as unknown as PodFields} onChange={(f) => setFields(f as unknown as Record<string, unknown>)} />;
      case 'Deployment':
        return <DeploymentForm fields={fields as unknown as DeploymentFields} onChange={(f) => setFields(f as unknown as Record<string, unknown>)} />;
      case 'Service':
        return <ServiceForm fields={fields as unknown as ServiceFields} onChange={(f) => setFields(f as unknown as Record<string, unknown>)} />;
      case 'ConfigMap':
        return <ConfigMapForm fields={fields as unknown as ConfigMapFields} onChange={(f) => setFields(f as unknown as Record<string, unknown>)} />;
      case 'Namespace':
        return <NamespaceForm fields={fields as unknown as NamespaceFields} onChange={(f) => setFields(f as unknown as Record<string, unknown>)} />;
    }
  };

  const dialogTitle = `Create ${kind}`;
  const dialogDescription = kind === 'Namespace'
    ? 'Create a new Kubernetes namespace'
    : `Create a new ${kind} resource in your cluster`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden"
        hideCloseButton
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <DialogHeader className="space-y-1">
            <DialogTitle className="text-lg">{dialogTitle}</DialogTitle>
            <DialogDescription className="text-sm">{dialogDescription}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            {/* Mode toggle */}
            <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700">
              <button
                onClick={() => handleModeSwitch('form')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  mode === 'form'
                    ? 'bg-white dark:bg-slate-700 text-foreground shadow-sm border border-slate-200 dark:border-slate-600'
                    : 'text-slate-600 dark:text-slate-400 hover:text-foreground hover:bg-slate-50 dark:hover:bg-slate-700/50'
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                Form
              </button>
              <button
                onClick={() => handleModeSwitch('yaml')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  mode === 'yaml'
                    ? 'bg-white dark:bg-slate-700 text-foreground shadow-sm border border-slate-200 dark:border-slate-600'
                    : 'text-slate-600 dark:text-slate-400 hover:text-foreground hover:bg-slate-50 dark:hover:bg-slate-700/50'
                }`}
              >
                <Code className="h-3.5 w-3.5" />
                YAML
              </button>
            </div>
            <button
              onClick={() => handleOpenChange(false)}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className="border-b" />

        {/* Content */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-6">
            {mode === 'form' ? (
              renderForm()
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Edit YAML</span>
                    {yamlValidation.isValid && editedYaml.trim() ? (
                      <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-200 dark:border-emerald-800">
                        Valid
                      </Badge>
                    ) : !yamlValidation.isValid ? (
                      <Badge variant="destructive" className="text-xs gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {yamlValidation.errors.length} error{yamlValidation.errors.length !== 1 ? 's' : ''}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleCopyYaml}>
                      <Copy className="h-3 w-3" /> Copy
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleDownloadYaml}>
                      <Download className="h-3 w-3" /> Download
                    </Button>
                  </div>
                </div>
                <Textarea
                  value={editedYaml}
                  onChange={(e) => setEditedYaml(e.target.value)}
                  className="min-h-[300px] font-mono text-sm resize-none bg-muted/30 border-muted leading-relaxed"
                  placeholder="Enter YAML configuration..."
                  spellCheck={false}
                />
                {!yamlValidation.isValid && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                    <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                    <div className="space-y-0.5">
                      {yamlValidation.errors.map((error, i) => (
                        <p key={i} className="text-xs text-destructive">{error}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="border-t px-6 py-4 flex items-center justify-between bg-muted/20">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {activeCluster ? (
              <>
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                {activeCluster.name}
              </>
            ) : (
              <>
                <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                No cluster connected
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!formValid || isSubmitting} className="gap-2">
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Create {kind}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
