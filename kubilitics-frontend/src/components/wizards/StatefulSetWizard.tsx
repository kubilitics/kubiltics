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

interface StatefulSetWizardProps {
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

interface VolumeClaimTemplate {
  name: string;
  storageClass: string;
  size: string;
}

export function StatefulSetWizard({ onClose, onSubmit }: StatefulSetWizardProps) {
  const { config } = useKubernetesConfigStore();
  const createResource = useCreateK8sResource('statefulsets');
  
  const [name, setName] = useState('');
  const [namespace, setNamespace] = useState('default');
  const [replicas, setReplicas] = useState('3');
  const [serviceName, setServiceName] = useState('');
  const [podManagementPolicy, setPodManagementPolicy] = useState('OrderedReady');
  const [updateStrategy, setUpdateStrategy] = useState('RollingUpdate');
  const [containers, setContainers] = useState<ContainerConfig[]>([
    { name: '', image: '', port: '5432', cpu: '500m', memory: '1Gi' },
  ]);
  const [volumeClaims, setVolumeClaims] = useState<VolumeClaimTemplate[]>([
    { name: 'data', storageClass: 'standard', size: '10Gi' },
  ]);

  const addContainer = () =>
    setContainers([...containers, { name: '', image: '', port: '80', cpu: '100m', memory: '128Mi' }]);
  const removeContainer = (index: number) => setContainers(containers.filter((_, i) => i !== index));
  const updateContainer = (index: number, field: keyof ContainerConfig, value: string) => {
    const updated = [...containers];
    updated[index][field] = value;
    setContainers(updated);
  };

  const addVolumeClaim = () =>
    setVolumeClaims([...volumeClaims, { name: '', storageClass: 'standard', size: '10Gi' }]);
  const removeVolumeClaim = (index: number) => setVolumeClaims(volumeClaims.filter((_, i) => i !== index));
  const updateVolumeClaim = (index: number, field: keyof VolumeClaimTemplate, value: string) => {
    const updated = [...volumeClaims];
    updated[index][field] = value;
    setVolumeClaims(updated);
  };

  const yaml = useMemo(() => {
    const appName = name || 'my-statefulset';
    const headlessService = serviceName || `${appName}-headless`;
    
    const containersYaml = containers
      .map(
        (c) => `      - name: ${c.name || 'app'}
        image: ${c.image || 'postgres:15'}
        ports:
          - containerPort: ${c.port || 5432}
        resources:
          requests:
            cpu: ${c.cpu || '500m'}
            memory: ${c.memory || '1Gi'}
          limits:
            cpu: ${c.cpu || '500m'}
            memory: ${c.memory || '1Gi'}
        volumeMounts:
${volumeClaims.map(v => `          - name: ${v.name || 'data'}
            mountPath: /data/${v.name || 'data'}`).join('\n')}`
      )
      .join('\n');

    const volumeClaimsYaml = volumeClaims
      .map(
        (v) => `  - metadata:
      name: ${v.name || 'data'}
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: ${v.storageClass || 'standard'}
      resources:
        requests:
          storage: ${v.size || '10Gi'}`
      )
      .join('\n');

    return `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: ${appName}
  namespace: ${namespace}
  labels:
    app: ${appName}
spec:
  serviceName: ${headlessService}
  replicas: ${replicas}
  podManagementPolicy: ${podManagementPolicy}
  updateStrategy:
    type: ${updateStrategy}
  selector:
    matchLabels:
      app: ${appName}
  template:
    metadata:
      labels:
        app: ${appName}
    spec:
      containers:
${containersYaml}
  volumeClaimTemplates:
${volumeClaimsYaml}`;
  }, [name, namespace, replicas, serviceName, podManagementPolicy, updateStrategy, containers, volumeClaims]);

  const handleCreate = async () => {
    if (config.isConnected) {
      await createResource.mutateAsync({ yaml, namespace });
    }
    onSubmit?.(yaml);
    onClose();
  };

  const steps: WizardStep[] = [
    {
      id: 'basic',
      title: 'Basic Info',
      description: 'Configure StatefulSet name and settings',
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">StatefulSet Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="postgres-primary"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="namespace">Namespace</Label>
              <Select value={namespace} onValueChange={setNamespace}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">default</SelectItem>
                  <SelectItem value="production">production</SelectItem>
                  <SelectItem value="staging">staging</SelectItem>
                  <SelectItem value="kube-system">kube-system</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="replicas">Replicas</Label>
              <Input
                id="replicas"
                type="number"
                min="1"
                value={replicas}
                onChange={(e) => setReplicas(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="serviceName">Headless Service Name</Label>
              <Input
                id="serviceName"
                value={serviceName}
                onChange={(e) => setServiceName(e.target.value)}
                placeholder={`${name || 'my-statefulset'}-headless`}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Pod Management Policy</Label>
              <Select value={podManagementPolicy} onValueChange={setPodManagementPolicy}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OrderedReady">OrderedReady</SelectItem>
                  <SelectItem value="Parallel">Parallel</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Update Strategy</Label>
              <Select value={updateStrategy} onValueChange={setUpdateStrategy}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RollingUpdate">RollingUpdate</SelectItem>
                  <SelectItem value="OnDelete">OnDelete</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'containers',
      title: 'Containers',
      description: 'Configure container images and resources',
      content: (
        <div className="space-y-4">
          {containers.map((container, index) => (
            <Card key={index}>
              <CardContent className="pt-4 space-y-4">
                <div className="flex justify-between items-center">
                  <Badge>Container {index + 1}</Badge>
                  {containers.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeContainer(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Container Name</Label>
                    <Input
                      value={container.name}
                      onChange={(e) => updateContainer(index, 'name', e.target.value)}
                      placeholder="postgres"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Image</Label>
                    <Input
                      value={container.image}
                      onChange={(e) => updateContainer(index, 'image', e.target.value)}
                      placeholder="postgres:15"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Port</Label>
                    <Input
                      value={container.port}
                      onChange={(e) => updateContainer(index, 'port', e.target.value)}
                      placeholder="5432"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>CPU</Label>
                    <Input
                      value={container.cpu}
                      onChange={(e) => updateContainer(index, 'cpu', e.target.value)}
                      placeholder="500m"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Memory</Label>
                    <Input
                      value={container.memory}
                      onChange={(e) => updateContainer(index, 'memory', e.target.value)}
                      placeholder="1Gi"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          <Button variant="outline" className="w-full gap-2" onClick={addContainer}>
            <Plus className="h-4 w-4" />
            Add Container
          </Button>
        </div>
      ),
    },
    {
      id: 'storage',
      title: 'Storage',
      description: 'Define volume claim templates for persistent storage',
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Define volume claim templates for persistent storage. Each pod in the StatefulSet will get its own PVC.
          </p>
          {volumeClaims.map((vc, index) => (
            <Card key={index}>
              <CardContent className="pt-4 space-y-4">
                <div className="flex justify-between items-center">
                  <Badge>Volume Claim {index + 1}</Badge>
                  {volumeClaims.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeVolumeClaim(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Volume Name</Label>
                    <Input
                      value={vc.name}
                      onChange={(e) => updateVolumeClaim(index, 'name', e.target.value)}
                      placeholder="data"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Storage Class</Label>
                    <Select value={vc.storageClass} onValueChange={(v) => updateVolumeClaim(index, 'storageClass', v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standard">standard</SelectItem>
                        <SelectItem value="fast">fast</SelectItem>
                        <SelectItem value="gp2">gp2 (AWS)</SelectItem>
                        <SelectItem value="pd-ssd">pd-ssd (GCP)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Size</Label>
                    <Input
                      value={vc.size}
                      onChange={(e) => updateVolumeClaim(index, 'size', e.target.value)}
                      placeholder="10Gi"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          <Button variant="outline" className="w-full gap-2" onClick={addVolumeClaim}>
            <Plus className="h-4 w-4" />
            Add Volume Claim Template
          </Button>
        </div>
      ),
    },
  ];

  return (
    <ResourceWizard
      title="Create StatefulSet"
      resourceType="StatefulSet"
      steps={steps}
      yaml={yaml}
      onClose={onClose}
      onSubmit={handleCreate}
      isSubmitting={createResource.isPending}
    />
  );
}
