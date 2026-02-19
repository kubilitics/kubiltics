import { useState, useMemo } from 'react';
import { ResourceWizard, WizardStep } from './ResourceWizard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus, X } from 'lucide-react';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { useQueryClient } from '@tanstack/react-query';
import { applyManifest } from '@/services/backendApiClient';
import { toast } from 'sonner';

interface IngressWizardProps {
  onClose: () => void;
  onSubmit?: (yaml: string) => void;
}

interface RuleConfig {
  host: string;
  path: string;
  pathType: string;
  serviceName: string;
  servicePort: string;
}

interface TlsConfig {
  hosts: string;
  secretName: string;
}

interface KeyValue {
  key: string;
  value: string;
}

export function IngressWizard({ onClose, onSubmit }: IngressWizardProps) {
  const queryClient = useQueryClient();
  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const clusterId = currentClusterId ?? null;
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [namespace, setNamespace] = useState('default');
  const [labels, setLabels] = useState<KeyValue[]>([{ key: 'app', value: '' }]);
  const [ingressClassName, setIngressClassName] = useState('nginx');
  const [rules, setRules] = useState<RuleConfig[]>([
    { host: '', path: '/', pathType: 'Prefix', serviceName: '', servicePort: '80' },
  ]);
  const [tlsList, setTlsList] = useState<TlsConfig[]>([{ hosts: '', secretName: '' }]);
  const [defaultBackendService, setDefaultBackendService] = useState('');
  const [defaultBackendPort, setDefaultBackendPort] = useState('80');
  const [annotations, setAnnotations] = useState<KeyValue[]>([{ key: '', value: '' }]);
  const [canaryWeight, setCanaryWeight] = useState('');
  const [canaryHeader, setCanaryHeader] = useState('');

  const addRule = () => setRules([...rules, { host: '', path: '/', pathType: 'Prefix', serviceName: '', servicePort: '80' }]);
  const removeRule = (i: number) => setRules(rules.filter((_, idx) => idx !== i));
  const updateRule = (i: number, field: keyof RuleConfig, value: string) => {
    const next = [...rules];
    next[i] = { ...next[i], [field]: value };
    setRules(next);
  };

  const addTls = () => setTlsList([...tlsList, { hosts: '', secretName: '' }]);
  const removeTls = (i: number) => setTlsList(tlsList.filter((_, idx) => idx !== i));
  const updateTls = (i: number, field: keyof TlsConfig, value: string) => {
    const next = [...tlsList];
    next[i] = { ...next[i], [field]: value };
    setTlsList(next);
  };

  const addLabel = () => setLabels([...labels, { key: '', value: '' }]);
  const removeLabel = (i: number) => setLabels(labels.filter((_, idx) => idx !== i));
  const updateLabel = (i: number, field: 'key' | 'value', value: string) => {
    const next = [...labels];
    next[i] = { ...next[i], [field]: value };
    setLabels(next);
  };
  const addAnnotation = () => setAnnotations([...annotations, { key: '', value: '' }]);
  const removeAnnotation = (i: number) => setAnnotations(annotations.filter((_, idx) => idx !== i));
  const updateAnnotation = (i: number, field: 'key' | 'value', value: string) => {
    const next = [...annotations];
    next[i] = { ...next[i], [field]: value };
    setAnnotations(next);
  };

  const yaml = useMemo(() => {
    const rulesByHost = rules.reduce((acc, r) => {
      const h = r.host || '*';
      if (!acc[h]) acc[h] = [];
      if (r.serviceName) acc[h].push(r);
      return acc;
    }, {} as Record<string, RuleConfig[]>);
    const rulesYaml = Object.entries(rulesByHost)
      .filter(([, paths]) => paths.length > 0)
      .map(
        ([host, paths]) => `    - host: ${host === '*' ? '""' : host}
      http:
        paths:
${paths.map((r) => `        - path: ${r.path}
          pathType: ${r.pathType}
          backend:
            service:
              name: ${r.serviceName}
              port:
                number: ${parseInt(r.servicePort, 10) || 80}`).join('\n')}`
      )
      .join('\n');

    const tlsYaml =
      tlsList.filter((t) => t.hosts.trim() || t.secretName.trim()).length > 0
        ? `
  tls:
${tlsList
  .filter((t) => t.hosts.trim() || t.secretName.trim())
  .map(
    (t) => `    - hosts:
${t.hosts
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean)
  .map((h) => `      - ${h}`)
  .join('\n')}
      secretName: ${t.secretName || 'tls-secret'}`
  )
  .join('\n')}`
        : '';

    const defaultBackendYaml =
      defaultBackendService
        ? `
  defaultBackend:
    service:
      name: ${defaultBackendService}
      port:
        number: ${parseInt(defaultBackendPort, 10) || 80}`
        : '';

    const labelsEntries = labels.filter((l) => l.key.trim()).map((l) => `    ${l.key}: ${l.value || name || 'app'}`).join('\n');
    const labelsYaml = labelsEntries ? `\n  labels:\n${labelsEntries}` : '';

    const annotationsList = [
      `kubernetes.io/ingress.class: ${ingressClassName}`,
      ...annotations.filter((a) => a.key.trim()).map((a) => `${a.key}: ${a.value}`),
    ];
    const annotationsYaml = annotationsList.length > 0 ? `\n  annotations:\n    ${annotationsList.join('\n    ')}` : '';

    return `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${name || 'my-ingress'}
  namespace: ${namespace}${labelsYaml}${annotationsYaml}
spec:
  ingressClassName: ${ingressClassName}${defaultBackendYaml}
  rules:
${rulesYaml || '    - http:\n        paths: []'}${tlsYaml}
`;
  }, [name, namespace, labels, annotations, ingressClassName, rules, tlsList, defaultBackendService, defaultBackendPort]);

  const steps: WizardStep[] = [
    {
      id: 'basic',
      title: 'Basic Info',
      description: 'Name, namespace, labels, ingress class',
      isValid: name.length > 0,
      content: (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-ingress" />
            </div>
            <div className="space-y-2">
              <Label>Namespace</Label>
              <Input value={namespace} onChange={(e) => setNamespace(e.target.value)} placeholder="default" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Ingress Class</Label>
            <Input value={ingressClassName} onChange={(e) => setIngressClassName(e.target.value)} placeholder="nginx" />
          </div>
          <div className="space-y-2">
            <Label>Labels</Label>
            <p className="text-xs text-muted-foreground">Optional key-value labels for the Ingress.</p>
            {labels.map((lab, i) => (
              <div key={i} className="flex gap-2 items-center">
                <Input value={lab.key} onChange={(e) => updateLabel(i, 'key', e.target.value)} placeholder="key" className="flex-1" />
                <Input value={lab.value} onChange={(e) => updateLabel(i, 'value', e.target.value)} placeholder="value" className="flex-1" />
                {labels.length > 1 && <Button type="button" variant="ghost" size="icon" onClick={() => removeLabel(i)}><X className="h-4 w-4" /></Button>}
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addLabel} className="gap-1.5"><Plus className="h-4 w-4" />Add Label</Button>
          </div>
        </div>
      ),
    },
    {
      id: 'rules',
      title: 'Hosts & Routing Rules',
      description: 'Host, path, and backend service',
      content: (
        <div className="space-y-4">
          {rules.map((rule, i) => (
            <Card key={i}>
              <CardContent className="pt-4 space-y-4">
                <div className="flex justify-between items-center">
                  <Badge variant="secondary">Rule {i + 1}</Badge>
                  {rules.length > 1 && <Button variant="ghost" size="sm" onClick={() => removeRule(i)}><X className="h-4 w-4" /></Button>}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Host</Label>
                    <Input value={rule.host} onChange={(e) => updateRule(i, 'host', e.target.value)} placeholder="example.com" />
                  </div>
                  <div className="space-y-2">
                    <Label>Path</Label>
                    <Input value={rule.path} onChange={(e) => updateRule(i, 'path', e.target.value)} placeholder="/" />
                  </div>
                  <div className="space-y-2">
                    <Label>Path Type</Label>
                    <Select value={rule.pathType} onValueChange={(v) => updateRule(i, 'pathType', v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Prefix">Prefix</SelectItem>
                        <SelectItem value="Exact">Exact</SelectItem>
                        <SelectItem value="ImplementationSpecific">ImplementationSpecific</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Service Name</Label>
                    <Input value={rule.serviceName} onChange={(e) => updateRule(i, 'serviceName', e.target.value)} placeholder="my-svc" />
                  </div>
                  <div className="space-y-2">
                    <Label>Service Port</Label>
                    <Input value={rule.servicePort} onChange={(e) => updateRule(i, 'servicePort', e.target.value)} placeholder="80" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          <Button variant="outline" size="sm" onClick={addRule} className="gap-1.5"><Plus className="h-4 w-4" />Add Rule</Button>
        </div>
      ),
    },
    {
      id: 'tls',
      title: 'TLS Configuration',
      description: 'Enable TLS per host, select or create TLS secret',
      content: (
        <div className="space-y-4">
          {tlsList.map((t, i) => (
            <div key={i} className="flex gap-2 items-end">
              <div className="flex-1 space-y-2">
                <Label>Hosts (comma-separated)</Label>
                <Input value={t.hosts} onChange={(e) => updateTls(i, 'hosts', e.target.value)} placeholder="example.com" />
              </div>
              <div className="flex-1 space-y-2">
                <Label>Secret Name</Label>
                <Input value={t.secretName} onChange={(e) => updateTls(i, 'secretName', e.target.value)} placeholder="tls-secret" />
              </div>
              {tlsList.length > 1 && <Button variant="ghost" size="icon" onClick={() => removeTls(i)}><X className="h-4 w-4" /></Button>}
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addTls} className="gap-1.5"><Plus className="h-4 w-4" />Add TLS</Button>
        </div>
      ),
    },
    {
      id: 'default',
      title: 'Default Backend',
      description: 'Service:port for unmatched requests',
      content: (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Default Backend Service</Label>
            <Input value={defaultBackendService} onChange={(e) => setDefaultBackendService(e.target.value)} placeholder="default-svc" />
          </div>
          <div className="space-y-2">
            <Label>Default Backend Port</Label>
            <Input value={defaultBackendPort} onChange={(e) => setDefaultBackendPort(e.target.value)} placeholder="80" />
          </div>
        </div>
      ),
    },
    {
      id: 'annotations',
      title: 'Annotations',
      description: 'Controller-specific: nginx rewrite, rate limiting, CORS, auth',
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Add annotations for your ingress controller (e.g. nginx.ingress.kubernetes.io/rewrite-target, rate limiting, CORS).</p>
          {annotations.map((ann, i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input value={ann.key} onChange={(e) => updateAnnotation(i, 'key', e.target.value)} placeholder="e.g. nginx.ingress.kubernetes.io/rewrite-target" className="flex-1" />
              <Input value={ann.value} onChange={(e) => updateAnnotation(i, 'value', e.target.value)} placeholder="value" className="flex-1" />
              {annotations.length > 1 && <Button type="button" variant="ghost" size="icon" onClick={() => removeAnnotation(i)}><X className="h-4 w-4" /></Button>}
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addAnnotation} className="gap-1.5"><Plus className="h-4 w-4" />Add Annotation</Button>
        </div>
      ),
    },
    {
      id: 'advanced',
      title: 'Advanced',
      description: 'Traffic routing weights, canary annotations',
      content: (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Canary weight (optional)</Label>
            <Input value={canaryWeight} onChange={(e) => setCanaryWeight(e.target.value)} placeholder="0-100" type="number" min={0} max={100} />
            <p className="text-xs text-muted-foreground">For canary ingress: percentage of traffic to this ingress (nginx canary annotations).</p>
          </div>
          <div className="space-y-2">
            <Label>Canary by header (optional)</Label>
            <Input value={canaryHeader} onChange={(e) => setCanaryHeader(e.target.value)} placeholder="Canary: true" />
            <p className="text-xs text-muted-foreground">Route canary traffic by request header.</p>
          </div>
        </div>
      ),
    },
    {
      id: 'review',
      title: 'Review + YAML Preview',
      description: 'Review and create',
      content: (
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><p className="text-muted-foreground">Name</p><p className="font-medium">{name || 'my-ingress'}</p></div>
              <div><p className="text-muted-foreground">Namespace</p><p className="font-medium">{namespace}</p></div>
              <div><p className="text-muted-foreground">Ingress Class</p><p className="font-medium">{ingressClassName}</p></div>
              <div><p className="text-muted-foreground">Rules</p><p>{rules.filter((r) => r.serviceName).length}</p></div>
              <div><p className="text-muted-foreground">TLS</p><Badge variant={tlsList.some((t) => t.secretName) ? 'default' : 'secondary'}>{tlsList.some((t) => t.secretName) ? 'Yes' : 'No'}</Badge></div>
              <div><p className="text-muted-foreground">Default Backend</p><p className="font-mono text-xs">{defaultBackendService || '—'}</p></div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">Switch to YAML view below to edit the manifest before creating.</p>
          </CardContent>
        </Card>
      ),
    },
  ];

  const handleSubmit = async () => {
    if (!isBackendConfigured() || !clusterId) {
      toast.error('Connect to a cluster to create Ingress');
      onSubmit?.(yaml);
      onClose();
      return;
    }
    try {
      setIsSubmitting(true);
      await applyManifest(backendBaseUrl, clusterId, yaml);
      queryClient.invalidateQueries({ queryKey: ['k8s', 'ingresses'] });
      queryClient.invalidateQueries({ queryKey: ['backend', 'resources', clusterId, 'ingresses'] });
      toast.success('Ingress created successfully');
      onClose();
      onSubmit?.(yaml);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to create Ingress: ${message}`);
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ResourceWizard
      title="Create Ingress"
      resourceType="Ingress"
      steps={steps}
      yaml={yaml}
      onClose={onClose}
      onSubmit={handleSubmit}
      isSubmitting={isSubmitting}
    />
  );
}
