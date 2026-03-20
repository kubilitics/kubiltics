import { useState, useMemo } from 'react';
import { ResourceWizard, WizardStep } from './ResourceWizard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus, X, KeyRound, Eye, EyeOff } from 'lucide-react';
import { useCreateK8sResource } from '@/hooks/useKubernetes';
import { useKubernetesConfigStore } from '@/stores/kubernetesConfigStore';

interface SecretWizardProps {
  onClose: () => void;
  onSubmit: (yaml: string) => void;
}

interface DataEntry {
  key: string;
  value: string;
  showValue: boolean;
}

interface LabelEntry {
  key: string;
  value: string;
}

export function SecretWizard({ onClose, onSubmit }: SecretWizardProps) {
  const { config } = useKubernetesConfigStore();
  const createResource = useCreateK8sResource('secrets');
  
  const [name, setName] = useState('');
  const [namespace, setNamespace] = useState('default');
  const [type, setType] = useState('Opaque');
  const [labels, setLabels] = useState<LabelEntry[]>([{ key: 'app', value: '' }]);
  const [data, setData] = useState<DataEntry[]>([{ key: '', value: '', showValue: false }]);

  const addLabel = () => setLabels([...labels, { key: '', value: '' }]);
  const removeLabel = (index: number) => setLabels(labels.filter((_, i) => i !== index));
  const updateLabel = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...labels];
    updated[index][field] = value;
    setLabels(updated);
  };

  const addDataEntry = () => setData([...data, { key: '', value: '', showValue: false }]);
  const removeDataEntry = (index: number) => setData(data.filter((_, i) => i !== index));
  const updateDataEntry = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...data];
    updated[index][field] = value;
    setData(updated);
  };
  const toggleShowValue = (index: number) => {
    const updated = [...data];
    updated[index].showValue = !updated[index].showValue;
    setData(updated);
  };

  const yaml = useMemo(() => {
    const labelsYaml = labels
      .filter((l) => l.key)
      .map((l) => `    ${l.key}: ${l.value || name || 'app'}`)
      .join('\n');

    const dataYaml = data
      .filter((d) => d.key)
      .map((d) => `  ${d.key}: ${btoa(d.value)}`)
      .join('\n');

    return `apiVersion: v1
kind: Secret
metadata:
  name: ${name || 'my-secret'}
  namespace: ${namespace}
  labels:
${labelsYaml}
type: ${type}
data:
${dataYaml || '  # No secret entries'}`;
  }, [name, namespace, type, labels, data]);

  const steps: WizardStep[] = [
    {
      id: 'basic',
      title: 'Basic Info',
      description: 'Set the Secret name, namespace, and type',
      isValid: name.length > 0,
      content: (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Secret Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-secret"
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
            <Label htmlFor="type">Secret Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Opaque">Opaque (generic)</SelectItem>
                <SelectItem value="kubernetes.io/dockerconfigjson">Docker Registry</SelectItem>
                <SelectItem value="kubernetes.io/tls">TLS Certificate</SelectItem>
                <SelectItem value="kubernetes.io/basic-auth">Basic Auth</SelectItem>
                <SelectItem value="kubernetes.io/ssh-auth">SSH Auth</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              {type === 'Opaque' && 'Generic secret for arbitrary user-defined data'}
              {type === 'kubernetes.io/dockerconfigjson' && 'Docker registry authentication'}
              {type === 'kubernetes.io/tls' && 'TLS certificate and private key'}
              {type === 'kubernetes.io/basic-auth' && 'Username and password authentication'}
              {type === 'kubernetes.io/ssh-auth' && 'SSH private key authentication'}
            </p>
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
              <Input
                placeholder="Key"
                value={label.key}
                onChange={(e) => updateLabel(index, 'key', e.target.value)}
                className="flex-1"
              />
              <span className="text-muted-foreground">=</span>
              <Input
                placeholder="Value"
                value={label.value}
                onChange={(e) => updateLabel(index, 'value', e.target.value)}
                className="flex-1"
              />
              {labels.length > 1 && (
                <Button variant="ghost" size="icon" onClick={() => removeLabel(index)}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addLabel} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Add Label
          </Button>
        </div>
      ),
    },
    {
      id: 'data',
      title: 'Secret Data',
      description: 'Add sensitive key-value pairs (will be base64 encoded)',
      isValid: data.some((d) => d.key),
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Enter secret values in plain text. They will be base64 encoded automatically.
          </p>
          {data.map((entry, index) => (
            <Card key={index}>
              <CardContent className="pt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-muted-foreground" />
                    <Badge variant="secondary">Entry {index + 1}</Badge>
                  </div>
                  {data.length > 1 && (
                    <Button variant="ghost" size="sm" onClick={() => removeDataEntry(index)}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Key *</Label>
                  <Input
                    value={entry.key}
                    onChange={(e) => updateDataEntry(index, 'key', e.target.value)}
                    placeholder="username or password"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Value</Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleShowValue(index)}
                      className="h-6 px-2"
                    >
                      {entry.showValue ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                  <Input
                    type={entry.showValue ? 'text' : 'password'}
                    value={entry.value}
                    onChange={(e) => updateDataEntry(index, 'value', e.target.value)}
                    placeholder="Enter secret value..."
                    className="font-mono"
                  />
                </div>
              </CardContent>
            </Card>
          ))}
          <Button variant="outline" size="sm" onClick={addDataEntry} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Add Secret Entry
          </Button>
        </div>
      ),
    },
    {
      id: 'review',
      title: 'Review',
      description: 'Review your Secret configuration',
      content: (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Name</p>
                  <p className="font-medium">{name || 'my-secret'}</p>
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
                  <p className="text-muted-foreground">Labels</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {labels.filter((l) => l.key).map((l, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {l.key}={l.value || name}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground mb-2">Secret Keys (values hidden)</p>
              <div className="flex flex-wrap gap-2">
                {data.filter((d) => d.key).map((d, i) => (
                  <Badge key={i} variant="outline" className="font-mono">
                    <KeyRound className="h-3 w-3 mr-1" />
                    {d.key}
                  </Badge>
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
      onClose();
    } else {
      onSubmit(yaml);
    }
  };

  return (
    <ResourceWizard
      title="Create Secret"
      resourceType="Secret"
      steps={steps}
      yaml={yaml}
      onClose={onClose}
      onSubmit={handleSubmit}
      isSubmitting={createResource.isPending}
    />
  );
}
