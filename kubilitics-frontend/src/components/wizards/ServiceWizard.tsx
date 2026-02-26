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
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { useQueryClient } from '@tanstack/react-query';
import { applyManifest } from '@/services/backendApiClient';
import { toast } from 'sonner';

interface ServiceWizardProps {
  onClose: () => void;
  onSubmit?: (yaml: string) => void;
}

interface PortConfig {
  name: string;
  port: string;
  targetPort: string;
  protocol: string;
}

interface SelectorEntry {
  key: string;
  value: string;
}

export function ServiceWizard({ onClose, onSubmit }: ServiceWizardProps) {
  const { config } = useKubernetesConfigStore();
  const createResource = useCreateK8sResource('services');
  const queryClient = useQueryClient();
  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const clusterId = currentClusterId ?? null;
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [namespace, setNamespace] = useState('default');
  const [type, setType] = useState('ClusterIP');
  const [selectors, setSelectors] = useState<SelectorEntry[]>([{ key: 'app', value: '' }]);
  const [ports, setPorts] = useState<PortConfig[]>([
    { name: 'http', port: '80', targetPort: '80', protocol: 'TCP' },
  ]);

  const addSelector = () => setSelectors([...selectors, { key: '', value: '' }]);
  const removeSelector = (index: number) => setSelectors(selectors.filter((_, i) => i !== index));
  const updateSelector = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...selectors];
    updated[index][field] = value;
    setSelectors(updated);
  };

  const addPort = () => setPorts([...ports, { name: '', port: '', targetPort: '', protocol: 'TCP' }]);
  const removePort = (index: number) => setPorts(ports.filter((_, i) => i !== index));
  const updatePort = (index: number, field: keyof PortConfig, value: string) => {
    const updated = [...ports];
    updated[index][field] = value;
    setPorts(updated);
  };

  const yaml = useMemo(() => {
    const selectorsYaml = selectors
      .filter((s) => s.key)
      .map((s) => `    ${s.key}: ${s.value || name || 'app'}`)
      .join('\n');

    const portsYaml = ports
      .map(
        (p) => `    - name: ${p.name || 'http'}
      port: ${p.port || 80}
      targetPort: ${p.targetPort || p.port || 80}
      protocol: ${p.protocol}`
      )
      .join('\n');

    return `apiVersion: v1
kind: Service
metadata:
  name: ${name || 'my-service'}
  namespace: ${namespace}
spec:
  type: ${type}
  selector:
${selectorsYaml}
  ports:
${portsYaml}`;
  }, [name, namespace, type, selectors, ports]);

  const steps: WizardStep[] = [
    {
      id: 'basic',
      title: 'Basic Info',
      description: 'Set the service name, namespace, and type',
      isValid: name.length > 0,
      content: (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Service Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-service"
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
                  <SelectItem value="development">development</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="type">Service Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ClusterIP">ClusterIP</SelectItem>
                <SelectItem value="NodePort">NodePort</SelectItem>
                <SelectItem value="LoadBalancer">LoadBalancer</SelectItem>
                <SelectItem value="ExternalName">ExternalName</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              {type === 'ClusterIP' && 'Exposes the service on an internal IP in the cluster'}
              {type === 'NodePort' && 'Exposes the service on each Node\'s IP at a static port'}
              {type === 'LoadBalancer' && 'Exposes the service externally using a cloud load balancer'}
              {type === 'ExternalName' && 'Maps the service to a DNS name'}
            </p>
          </div>
        </div>
      ),
    },
    {
      id: 'selectors',
      title: 'Selectors',
      description: 'Define selectors to match target pods',
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Selectors determine which pods receive traffic from this service
          </p>
          {selectors.map((selector, index) => (
            <div key={index} className="flex items-center gap-3">
              <Input
                placeholder="Key (e.g., app)"
                value={selector.key}
                onChange={(e) => updateSelector(index, 'key', e.target.value)}
                className="flex-1"
              />
              <span className="text-muted-foreground">=</span>
              <Input
                placeholder="Value (e.g., nginx)"
                value={selector.value}
                onChange={(e) => updateSelector(index, 'value', e.target.value)}
                className="flex-1"
              />
              {selectors.length > 1 && (
                <Button variant="ghost" size="icon" onClick={() => removeSelector(index)}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addSelector} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Add Selector
          </Button>
        </div>
      ),
    },
    {
      id: 'ports',
      title: 'Ports',
      description: 'Configure service ports',
      isValid: ports.every((p) => p.port),
      content: (
        <div className="space-y-4">
          {ports.map((port, index) => (
            <Card key={index}>
              <CardContent className="pt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <Badge variant="secondary">Port {index + 1}</Badge>
                  {ports.length > 1 && (
                    <Button variant="ghost" size="sm" onClick={() => removePort(index)}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Port Name</Label>
                    <Input
                      value={port.name}
                      onChange={(e) => updatePort(index, 'name', e.target.value)}
                      placeholder="http"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Protocol</Label>
                    <Select
                      value={port.protocol}
                      onValueChange={(v) => updatePort(index, 'protocol', v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="TCP">TCP</SelectItem>
                        <SelectItem value="UDP">UDP</SelectItem>
                        <SelectItem value="SCTP">SCTP</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Service Port *</Label>
                    <Input
                      value={port.port}
                      onChange={(e) => updatePort(index, 'port', e.target.value)}
                      placeholder="80"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Target Port</Label>
                    <Input
                      value={port.targetPort}
                      onChange={(e) => updatePort(index, 'targetPort', e.target.value)}
                      placeholder="8080"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          <Button variant="outline" size="sm" onClick={addPort} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Add Port
          </Button>
        </div>
      ),
    },
    {
      id: 'review',
      title: 'Review',
      description: 'Review your service configuration',
      content: (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Name</p>
                  <p className="font-medium">{name || 'my-service'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Namespace</p>
                  <p className="font-medium">{namespace}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Type</p>
                  <Badge variant="outline">{type}</Badge>
                </div>
                <div>
                  <p className="text-muted-foreground">Selectors</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {selectors.filter((s) => s.key).map((s, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {s.key}={s.value || name}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground mb-2">Ports</p>
              <div className="space-y-2">
                {ports.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <Badge variant="outline">{p.name || 'http'}</Badge>
                    <span className="font-mono">{p.port}:{p.targetPort || p.port}</span>
                    <span className="text-muted-foreground">({p.protocol})</span>
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
    await createResource.mutateAsync({ yaml, namespace });
    onClose();
    onSubmit?.(yaml);
  };

  return (
    <ResourceWizard
      title="Create Service"
      resourceType="Service"
      steps={steps}
      yaml={yaml}
      onClose={onClose}
      onSubmit={handleSubmit}
      isSubmitting={createResource.isPending || isSubmitting}
    />
  );
}
