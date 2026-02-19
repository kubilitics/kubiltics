import { useState, useMemo } from 'react';
import { ResourceWizard, WizardStep } from './ResourceWizard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus, X, Loader2 } from 'lucide-react';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { useQueryClient } from '@tanstack/react-query';
import { applyManifest } from '@/services/backendApiClient';
import { useK8sResourceList, type KubernetesResource } from '@/hooks/useKubernetes';
import { toast } from 'sonner';

function podMatchesMatchLabels(podLabels: Record<string, string> | undefined, matchLabels: Record<string, string>): boolean {
  if (Object.keys(matchLabels).length === 0) return true;
  if (!podLabels) return false;
  return Object.entries(matchLabels).every(([k, v]) => podLabels[k] === v);
}

interface NetworkPolicyWizardProps {
  onClose: () => void;
  onSubmit?: (yaml: string) => void;
}

interface LabelEntry {
  key: string;
  value: string;
}

interface IngressEgressRule {
  podLabels: LabelEntry[];
  namespaceLabels: LabelEntry[];
  ports: string[];
  ipBlockCidr: string;
  ipBlockExcept: string;
}

export function NetworkPolicyWizard({ onClose, onSubmit }: NetworkPolicyWizardProps) {
  const queryClient = useQueryClient();
  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const clusterId = currentClusterId ?? null;
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [namespace, setNamespace] = useState('default');
  const [podSelectorLabels, setPodSelectorLabels] = useState<LabelEntry[]>([{ key: 'app', value: '' }]);
  const [policyTypes, setPolicyTypes] = useState<string[]>(['Ingress']);
  const [ingressRules, setIngressRules] = useState<IngressEgressRule[]>([
    { podLabels: [], namespaceLabels: [], ports: ['80'], ipBlockCidr: '', ipBlockExcept: '' },
  ]);
  const [egressRules, setEgressRules] = useState<IngressEgressRule[]>([]);

  const addPodSelector = () => setPodSelectorLabels([...podSelectorLabels, { key: '', value: '' }]);
  const removePodSelector = (i: number) => setPodSelectorLabels(podSelectorLabels.filter((_, idx) => idx !== i));
  const updatePodSelector = (i: number, field: 'key' | 'value', value: string) => {
    const next = [...podSelectorLabels];
    next[i] = { ...next[i], [field]: value };
    setPodSelectorLabels(next);
  };

  const togglePolicyType = (t: string) => {
    setPolicyTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const addIngressRule = () => setIngressRules([...ingressRules, { podLabels: [], namespaceLabels: [], ports: ['80'], ipBlockCidr: '', ipBlockExcept: '' }]);
  const removeIngressRule = (i: number) => setIngressRules(ingressRules.filter((_, idx) => idx !== i));
  const addEgressRule = () => setEgressRules([...egressRules, { podLabels: [], namespaceLabels: [], ports: ['80'], ipBlockCidr: '', ipBlockExcept: '' }]);
  const removeEgressRule = (i: number) => setEgressRules(egressRules.filter((_, idx) => idx !== i));

  const { data: podsData, isLoading: podsLoading } = useK8sResourceList<KubernetesResource>('pods', namespace, { limit: 500 });
  const matchLabelsFromSelector = useMemo(() => {
    const out: Record<string, string> = {};
    podSelectorLabels.filter((l) => l.key.trim()).forEach((l) => { out[l.key.trim()] = l.value.trim(); });
    return out;
  }, [podSelectorLabels]);
  const matchingPods = useMemo(() => {
    if (!podsData?.items?.length) return [];
    const matchLabels = matchLabelsFromSelector;
    return (podsData.items as KubernetesResource[]).filter((p) => podMatchesMatchLabels(p.metadata?.labels as Record<string, string> | undefined, matchLabels));
  }, [podsData?.items, matchLabelsFromSelector]);

  const labelsToYaml = (labels: LabelEntry[], indent: string) => {
    const entries = labels.filter((l) => l.key.trim());
    if (entries.length === 0) return '';
    return `${indent}matchLabels:\n${entries.map((l) => `${indent}  ${l.key}: ${l.value || '""'}`).join('\n')}`;
  };

  const ruleToYaml = (rule: IngressEgressRule, fromTo: 'from' | 'to') => {
    const parts: string[] = [];
    rule.podLabels.filter((l) => l.key).forEach((l) => {
      parts.push(`        - podSelector:\n            matchLabels:\n              ${l.key}: ${l.value || '""'}`);
    });
    rule.namespaceLabels.filter((l) => l.key).forEach((l) => {
      parts.push(`        - namespaceSelector:\n            matchLabels:\n              ${l.key}: ${l.value || '""'}`);
    });
    if (rule.ipBlockCidr.trim()) {
      const except = rule.ipBlockExcept.trim().split(/[\s,]+/).filter(Boolean);
      const exceptYaml = except.length > 0 ? `\n          except:\n${except.map((e) => `            - ${e}`).join('\n')}` : '';
      parts.push(`        - ipBlock:\n            cidr: ${rule.ipBlockCidr.trim()}${exceptYaml}`);
    }
    const fromToBlock = parts.length > 0 ? `\n      ${fromTo}:\n${parts.join('\n')}` : '';
    const portsBlock =
      rule.ports.filter((p) => p.trim()).length > 0
        ? `\n      ports:\n${rule.ports.filter((p) => p.trim()).map((p) => `        - protocol: TCP\n          port: ${p}`).join('\n')}`
        : '';
    return fromToBlock || portsBlock ? `      -${fromToBlock}${portsBlock}` : '';
  };

  const yaml = useMemo(() => {
    const podSelectorYaml = labelsToYaml(podSelectorLabels, '    ');
    const ingressYaml =
      policyTypes.includes('Ingress') && ingressRules.length > 0
        ? `
  ingress:
${ingressRules.map((r) => ruleToYaml(r, 'from')).filter(Boolean).join('\n')}`
        : '';
    const egressYaml =
      policyTypes.includes('Egress') && egressRules.length > 0
        ? `
  egress:
${egressRules.map((r) => ruleToYaml(r, 'to')).filter(Boolean).join('\n')}`
        : '';

    return `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: ${name || 'my-networkpolicy'}
  namespace: ${namespace}
spec:
  podSelector:
${podSelectorYaml || '    {}'}
  policyTypes:
${policyTypes.map((t) => `  - ${t}`).join('\n')}${ingressYaml}${egressYaml}
`;
  }, [name, namespace, podSelectorLabels, policyTypes, ingressRules, egressRules]);

  const steps: WizardStep[] = [
    {
      id: 'basic',
      title: 'Basic Info',
      description: 'Name and namespace',
      isValid: name.length > 0,
      content: (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-networkpolicy" />
          </div>
          <div className="space-y-2">
            <Label>Namespace</Label>
            <Input value={namespace} onChange={(e) => setNamespace(e.target.value)} placeholder="default" />
          </div>
        </div>
      ),
    },
    {
      id: 'podSelector',
      title: 'Pod Selector',
      description: 'Pods this policy applies to',
      content: (
        <div className="space-y-4">
          {podSelectorLabels.map((l, i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input placeholder="Key" value={l.key} onChange={(e) => updatePodSelector(i, 'key', e.target.value)} />
              <span>=</span>
              <Input placeholder="Value" value={l.value} onChange={(e) => updatePodSelector(i, 'value', e.target.value)} />
              {podSelectorLabels.length > 1 && <Button variant="ghost" size="icon" onClick={() => removePodSelector(i)}><X className="h-4 w-4" /></Button>}
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addPodSelector} className="gap-1.5"><Plus className="h-4 w-4" />Add label</Button>
          <div className="pt-2 border-t border-border">
            <p className="text-sm font-medium text-muted-foreground mb-1">Matching pods (live preview)</p>
            {podsLoading ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading pods…</p>
            ) : matchingPods.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {podsData?.items?.length === undefined ? 'Connect to a cluster to see matching pods.' : Object.keys(matchLabelsFromSelector).length === 0 ? 'All pods in namespace (no selector).' : 'No pods match the selector.'}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{matchingPods.length}</span> pod{matchingPods.length !== 1 ? 's' : ''} match
                {matchingPods.length <= 10 ? `: ${matchingPods.map((p) => p.metadata?.name).filter(Boolean).join(', ')}` : ` (showing first 10: ${matchingPods.slice(0, 10).map((p) => p.metadata?.name).filter(Boolean).join(', ')}…)`}
              </p>
            )}
          </div>
        </div>
      ),
    },
    {
      id: 'policyTypes',
      title: 'Policy Types',
      description: 'Ingress and/or Egress',
      content: (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button type="button" variant={policyTypes.includes('Ingress') ? 'default' : 'outline'} onClick={() => togglePolicyType('Ingress')}>Ingress</Button>
            <Button type="button" variant={policyTypes.includes('Egress') ? 'default' : 'outline'} onClick={() => togglePolicyType('Egress')}>Egress</Button>
          </div>
        </div>
      ),
    },
    {
      id: 'ingress',
      title: 'Ingress Rules',
      description: 'Allowed ingress (if Ingress type selected)',
      content: (
        <div className="space-y-4">
          {policyTypes.includes('Ingress') ? (
            <>
              {ingressRules.map((rule, i) => (
                <Card key={i}>
                  <CardContent className="pt-4">
                    <div className="flex justify-between mb-2"><Badge variant="secondary">Rule {i + 1}</Badge>{ingressRules.length > 1 && <Button variant="ghost" size="sm" onClick={() => removeIngressRule(i)}><X className="h-4 w-4" /></Button>}</div>
                    <div className="space-y-2">
                      <Label>Ports (comma-separated)</Label>
                      <Input value={rule.ports.join(', ')} onChange={(e) => setIngressRules((prev) => { const n = [...prev]; n[i] = { ...n[i], ports: e.target.value.split(',').map((p) => p.trim()) }; return n; })} placeholder="80, 443" />
                      <Label className="pt-2 block">IP Block (optional) CIDR</Label>
                      <Input value={rule.ipBlockCidr} onChange={(e) => setIngressRules((prev) => { const n = [...prev]; n[i] = { ...n[i], ipBlockCidr: e.target.value }; return n; })} placeholder="e.g. 10.0.0.0/8" />
                      <Label className="text-muted-foreground text-xs">Except (optional, comma-separated)</Label>
                      <Input value={rule.ipBlockExcept} onChange={(e) => setIngressRules((prev) => { const n = [...prev]; n[i] = { ...n[i], ipBlockExcept: e.target.value }; return n; })} placeholder="e.g. 10.0.0.0/24" />
                    </div>
                  </CardContent>
                </Card>
              ))}
              <Button variant="outline" size="sm" onClick={addIngressRule} className="gap-1.5"><Plus className="h-4 w-4" />Add ingress rule</Button>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">Enable Ingress in Policy Types to add rules.</p>
          )}
        </div>
      ),
    },
    {
      id: 'egress',
      title: 'Egress Rules',
      description: 'Allowed egress (if Egress type selected)',
      content: (
        <div className="space-y-4">
          {policyTypes.includes('Egress') ? (
            <>
              {egressRules.map((rule, i) => (
                <Card key={i}>
                  <CardContent className="pt-4">
                    <div className="flex justify-between mb-2"><Badge variant="secondary">Rule {i + 1}</Badge>{egressRules.length > 1 && <Button variant="ghost" size="sm" onClick={() => removeEgressRule(i)}><X className="h-4 w-4" /></Button>}</div>
                    <div className="space-y-2">
                      <Label>Ports (comma-separated)</Label>
                      <Input value={rule.ports.join(', ')} onChange={(e) => setEgressRules((prev) => { const n = [...prev]; n[i] = { ...n[i], ports: e.target.value.split(',').map((p) => p.trim()) }; return n; })} placeholder="80, 443" />
                      <Label className="pt-2 block">IP Block (optional) CIDR</Label>
                      <Input value={rule.ipBlockCidr} onChange={(e) => setEgressRules((prev) => { const n = [...prev]; n[i] = { ...n[i], ipBlockCidr: e.target.value }; return n; })} placeholder="e.g. 10.0.0.0/8" />
                      <Label className="text-muted-foreground text-xs">Except (optional, comma-separated)</Label>
                      <Input value={rule.ipBlockExcept} onChange={(e) => setEgressRules((prev) => { const n = [...prev]; n[i] = { ...n[i], ipBlockExcept: e.target.value }; return n; })} placeholder="e.g. 10.0.0.0/24" />
                    </div>
                  </CardContent>
                </Card>
              ))}
              <Button variant="outline" size="sm" onClick={addEgressRule} className="gap-1.5"><Plus className="h-4 w-4" />Add egress rule</Button>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">Enable Egress in Policy Types to add rules.</p>
          )}
        </div>
      ),
    },
    {
      id: 'review',
      title: 'Review',
      description: 'Review and create',
      content: (
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><p className="text-muted-foreground">Name</p><p className="font-medium">{name || 'my-networkpolicy'}</p></div>
              <div><p className="text-muted-foreground">Namespace</p><p className="font-medium">{namespace}</p></div>
              <div><p className="text-muted-foreground">Policy Types</p><div className="flex gap-1">{policyTypes.map((t) => <Badge key={t} variant="outline">{t}</Badge>)}</div></div>
              <div><p className="text-muted-foreground">Ingress rules</p><p>{ingressRules.length}</p></div>
              <div><p className="text-muted-foreground">Egress rules</p><p>{egressRules.length}</p></div>
            </div>
          </CardContent>
        </Card>
      ),
    },
  ];

  const handleSubmit = async () => {
    if (!isBackendConfigured() || !clusterId) {
      toast.error('Connect to a cluster to create NetworkPolicy');
      onSubmit?.(yaml);
      onClose();
      return;
    }
    try {
      setIsSubmitting(true);
      await applyManifest(backendBaseUrl, clusterId, yaml);
      queryClient.invalidateQueries({ queryKey: ['k8s', 'networkpolicies'] });
      queryClient.invalidateQueries({ queryKey: ['backend', 'resources', clusterId, 'networkpolicies'] });
      toast.success('NetworkPolicy created successfully');
      onClose();
      onSubmit?.(yaml);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to create NetworkPolicy: ${message}`);
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ResourceWizard
      title="Create NetworkPolicy"
      resourceType="NetworkPolicy"
      steps={steps}
      yaml={yaml}
      onClose={onClose}
      onSubmit={handleSubmit}
      isSubmitting={isSubmitting}
    />
  );
}
