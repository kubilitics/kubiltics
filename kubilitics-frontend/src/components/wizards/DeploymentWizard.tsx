import { useState, useMemo } from 'react';
import { ResourceWizard, WizardStep } from './ResourceWizard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus, X } from 'lucide-react';
import { useCreateK8sResource } from '@/hooks/useKubernetes';
import { useKubernetesConfigStore } from '@/stores/kubernetesConfigStore';

interface DeploymentWizardProps {
  onClose: () => void;
  onSubmit?: (yaml: string) => void;
}

interface ContainerConfig {
  name: string;
  image: string;
  port: string;
  cpu: string;
  memory: string;
}

interface LabelEntry {
  key: string;
  value: string;
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

export function DeploymentWizard({ onClose, onSubmit }: DeploymentWizardProps) {
  const { config } = useKubernetesConfigStore();
  const createResource = useCreateK8sResource('deployments');

  const [name, setName] = useState('');
  const [namespace, setNamespace] = useState('default');
  const [replicas, setReplicas] = useState('1');
  const [labels, setLabels] = useState<LabelEntry[]>([{ key: 'app', value: '' }]);
  const [containers, setContainers] = useState<ContainerConfig[]>([
    { name: '', image: '', port: '80', cpu: '100m', memory: '128Mi' },
  ]);
  const [strategy, setStrategy] = useState('RollingUpdate');

  const addLabel = () => setLabels([...labels, { key: '', value: '' }]);
  const removeLabel = (index: number) => setLabels(labels.filter((_, i) => i !== index));
  const updateLabel = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...labels];
    updated[index][field] = value;
    setLabels(updated);
  };

  const addContainer = () =>
    setContainers([...containers, { name: '', image: '', port: '80', cpu: '100m', memory: '128Mi' }]);
  const removeContainer = (index: number) => setContainers(containers.filter((_, i) => i !== index));
  const updateContainer = (index: number, field: keyof ContainerConfig, value: string) => {
    const updated = [...containers];
    updated[index][field] = value;
    setContainers(updated);
  };

  const yaml = useMemo(() => {
    const labelsObj = labels.reduce((acc, l) => {
      if (l.key) acc[l.key] = l.value || name || 'app';
      return acc;
    }, {} as Record<string, string>);

    const containersYaml = containers
      .map(
        (c) => `      - name: ${c.name || 'container'}
        image: ${c.image || 'nginx:latest'}
        ports:
          - containerPort: ${c.port || 80}
        resources:
          requests:
            cpu: ${c.cpu || '100m'}
            memory: ${c.memory || '128Mi'}
          limits:
            cpu: ${c.cpu || '100m'}
            memory: ${c.memory || '128Mi'}`
      )
      .join('\n');

    const labelsYaml = Object.entries(labelsObj)
      .map(([k, v]) => `    ${k}: ${v}`)
      .join('\n');

    return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name || 'my-deployment'}
  namespace: ${namespace}
  labels:
${labelsYaml}
spec:
  replicas: ${replicas}
  strategy:
    type: ${strategy}
  selector:
    matchLabels:
${labelsYaml}
  template:
    metadata:
      labels:
${labelsYaml}
    spec:
      containers:
${containersYaml}`;
  }, [name, namespace, replicas, labels, containers, strategy]);

  const steps: WizardStep[] = [
    {
      id: 'basic',
      title: 'Basic Info',
      description: 'Set the deployment name, namespace, and replicas',
      isValid: name.length > 0,
      content: (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Deployment Name *</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-deployment" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="namespace">Namespace</Label>
              <Select value={namespace} onValueChange={setNamespace}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">default</SelectItem>
                  <SelectItem value="production">production</SelectItem>
                  <SelectItem value="staging">staging</SelectItem>
                  <SelectItem value="development">development</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="replicas">Replicas</Label>
              <Input id="replicas" type="number" min="1" value={replicas} onChange={(e) => setReplicas(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="strategy">Update Strategy</Label>
              <Select value={strategy} onValueChange={setStrategy}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="RollingUpdate">Rolling Update</SelectItem>
                  <SelectItem value="Recreate">Recreate</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'labels',
      title: 'Labels',
      description: 'Define labels for resource identification',
      content: (
        <div className="space-y-4">
          {labels.map((label, index) => (
            <div key={index} className="flex items-center gap-3">
              <Input placeholder="Key" value={label.key} onChange={(e) => updateLabel(index, 'key', e.target.value)} className="flex-1" />
              <span className="text-muted-foreground">=</span>
              <Input placeholder="Value" value={label.value} onChange={(e) => updateLabel(index, 'value', e.target.value)} className="flex-1" />
              {labels.length > 1 && (
                <Button variant="ghost" size="icon" onClick={() => removeLabel(index)}><X className="h-4 w-4" /></Button>
              )}
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addLabel} className="gap-1.5">
            <Plus className="h-4 w-4" />Add Label
          </Button>
        </div>
      ),
    },
    {
      id: 'containers',
      title: 'Containers',
      description: 'Configure container images and resources',
      isValid: containers.every((c) => c.name && c.image),
      content: (
        <div className="space-y-4">
          {containers.map((container, index) => (
            <Card key={index}>
              <CardContent className="pt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <Badge variant="secondary">Container {index + 1}</Badge>
                  {containers.length > 1 && (
                    <Button variant="ghost" size="sm" onClick={() => removeContainer(index)}><X className="h-4 w-4" /></Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Name *</Label>
                    <Input value={container.name} onChange={(e) => updateContainer(index, 'name', e.target.value)} placeholder="container-name" />
                  </div>
                  <div className="space-y-2">
                    <Label>Image *</Label>
                    <Input value={container.image} onChange={(e) => updateContainer(index, 'image', e.target.value)} placeholder="nginx:latest" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Port</Label>
                    <Input value={container.port} onChange={(e) => updateContainer(index, 'port', e.target.value)} placeholder="80" />
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1">CPU <span className="text-[10px] text-muted-foreground font-normal">(req=limit)</span></Label>
                    <Input
                      value={container.cpu}
                      onChange={(e) => updateContainer(index, 'cpu', e.target.value)}
                      placeholder="100m"
                      className={container.cpu !== '100m' ? 'border-indigo-300 bg-indigo-50/30' : ''}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1">Memory <span className="text-[10px] text-muted-foreground font-normal">(req=limit)</span></Label>
                    <Input
                      value={container.memory}
                      onChange={(e) => updateContainer(index, 'memory', e.target.value)}
                      placeholder="128Mi"
                      className={container.memory !== '128Mi' ? 'border-indigo-300 bg-indigo-50/30' : ''}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          <Button variant="outline" size="sm" onClick={addContainer} className="gap-1.5">
            <Plus className="h-4 w-4" />Add Container
          </Button>
        </div>
      ),
    },
    {
      id: 'review',
      title: 'Review',
      description: 'Review your deployment configuration',
      content: (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-muted-foreground">Name</p><p className="font-medium">{name || 'my-deployment'}</p></div>
                <div><p className="text-muted-foreground">Namespace</p><p className="font-medium">{namespace}</p></div>
                <div><p className="text-muted-foreground">Replicas</p><p className="font-medium">{replicas}</p></div>
                <div><p className="text-muted-foreground">Strategy</p><p className="font-medium">{strategy}</p></div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground mb-2">Containers</p>
              <div className="space-y-2">
                {containers.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">{c.name || 'container'}</Badge>
                    <span className="text-sm font-mono">{c.image || 'nginx:latest'}</span>
                    <span className="text-xs text-muted-foreground ml-auto">CPU: {c.cpu} · Mem: {c.memory}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ),
    },
  ];

  const handleSubmit = async () => {
    if (config.isConnected) {
      await createResource.mutateAsync({ yaml, namespace });
    }
    onSubmit?.(yaml);
    onClose();
  };

  return (
    <ResourceWizard
      title="Create Deployment"
      resourceType="Deployment"
      steps={steps}
      yaml={yaml}
      onClose={onClose}
      onSubmit={handleSubmit}
      isSubmitting={createResource.isPending}
    />
  );
}
