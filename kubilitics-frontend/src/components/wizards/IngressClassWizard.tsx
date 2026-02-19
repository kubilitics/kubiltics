import { useState, useMemo } from 'react';
import { ResourceWizard, WizardStep } from './ResourceWizard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { useQueryClient } from '@tanstack/react-query';
import { applyManifest } from '@/services/backendApiClient';
import { toast } from 'sonner';

interface IngressClassWizardProps {
  onClose: () => void;
  onSubmit?: (yaml: string) => void;
}

export function IngressClassWizard({ onClose, onSubmit }: IngressClassWizardProps) {
  const queryClient = useQueryClient();
  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const clusterId = currentClusterId ?? null;
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [controller, setController] = useState('k8s.io/ingress-nginx');
  const [isDefault, setIsDefault] = useState(false);
  const [paramApiGroup, setParamApiGroup] = useState('');
  const [paramKind, setParamKind] = useState('');
  const [paramName, setParamName] = useState('');

  const yaml = useMemo(() => {
    const paramsBlock =
      paramApiGroup || paramKind || paramName
        ? `
  parameters:
    apiGroup: ${paramApiGroup || 'k8s.io'}
    kind: ${paramKind || 'IngressParameters'}
    name: ${paramName || name || 'default'}`
        : '';
    const defaultAnnotation = isDefault
      ? `
  annotations:
    ingressclass.kubernetes.io/is-default-class: "true"`
      : '';
    return `apiVersion: networking.k8s.io/v1
kind: IngressClass
metadata:
  name: ${name || 'my-ingressclass'}${defaultAnnotation}
spec:
  controller: ${controller}${paramsBlock}
`;
  }, [name, controller, isDefault, paramApiGroup, paramKind, paramName]);

  const steps: WizardStep[] = [
    {
      id: 'basic',
      title: 'Basic Info',
      description: 'Set the IngressClass name and default',
      isValid: name.length > 0,
      content: (
        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-ingressclass"
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="font-medium">Default class</p>
              <p className="text-sm text-muted-foreground">Use as default for new Ingresses</p>
            </div>
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
          </div>
        </div>
      ),
    },
    {
      id: 'controller',
      title: 'Controller & Parameters',
      description: 'Controller and optional parameters reference',
      content: (
        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="controller">Controller</Label>
            <Input
              id="controller"
              value={controller}
              onChange={(e) => setController(e.target.value)}
              placeholder="k8s.io/ingress-nginx"
            />
          </div>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Parameters (optional)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>API Group</Label>
                <Input value={paramApiGroup} onChange={(e) => setParamApiGroup(e.target.value)} placeholder="k8s.io" />
              </div>
              <div className="space-y-2">
                <Label>Kind</Label>
                <Input value={paramKind} onChange={(e) => setParamKind(e.target.value)} placeholder="IngressParameters" />
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={paramName} onChange={(e) => setParamName(e.target.value)} placeholder="config-name" />
              </div>
            </CardContent>
          </Card>
        </div>
      ),
    },
    {
      id: 'review',
      title: 'Review',
      description: 'Review and create',
      content: (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Name</p>
                  <p className="font-medium">{name || 'my-ingressclass'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Controller</p>
                  <p className="font-mono text-xs">{controller}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Default</p>
                  <Badge variant={isDefault ? 'default' : 'secondary'}>{isDefault ? 'Yes' : 'No'}</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ),
    },
  ];

  const handleSubmit = async () => {
    if (!isBackendConfigured() || !clusterId) {
      toast.error('Connect to a cluster to create IngressClass');
      onSubmit?.(yaml);
      onClose();
      return;
    }
    try {
      setIsSubmitting(true);
      await applyManifest(backendBaseUrl, clusterId, yaml);
      queryClient.invalidateQueries({ queryKey: ['k8s', 'ingressclasses'] });
      queryClient.invalidateQueries({ queryKey: ['backend', 'resources', clusterId, 'ingressclasses'] });
      toast.success('IngressClass created successfully');
      onClose();
      onSubmit?.(yaml);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to create IngressClass: ${message}`);
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ResourceWizard
      title="Create IngressClass"
      resourceType="IngressClass"
      steps={steps}
      yaml={yaml}
      onClose={onClose}
      onSubmit={handleSubmit}
      isSubmitting={isSubmitting}
    />
  );
}
