import { useState, useMemo } from 'react';
import { ResourceWizard, WizardStep } from './ResourceWizard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus, X, FileText } from 'lucide-react';
import { useCreateK8sResource } from '@/hooks/useKubernetes';
import { useKubernetesConfigStore } from '@/stores/kubernetesConfigStore';

interface ConfigMapWizardProps {
  onClose: () => void;
  onSubmit: (yaml: string) => void;
}

interface DataEntry {
  key: string;
  value: string;
}

interface LabelEntry {
  key: string;
  value: string;
}

export function ConfigMapWizard({ onClose, onSubmit }: ConfigMapWizardProps) {
  const { config } = useKubernetesConfigStore();
  const createResource = useCreateK8sResource('configmaps');
  
  const [name, setName] = useState('');
  const [namespace, setNamespace] = useState('default');
  const [labels, setLabels] = useState<LabelEntry[]>([{ key: 'app', value: '' }]);
  const [data, setData] = useState<DataEntry[]>([{ key: '', value: '' }]);

  const addLabel = () => setLabels([...labels, { key: '', value: '' }]);
  const removeLabel = (index: number) => setLabels(labels.filter((_, i) => i !== index));
  const updateLabel = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...labels];
    updated[index][field] = value;
    setLabels(updated);
  };

  const addDataEntry = () => setData([...data, { key: '', value: '' }]);
  const removeDataEntry = (index: number) => setData(data.filter((_, i) => i !== index));
  const updateDataEntry = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...data];
    updated[index][field] = value;
    setData(updated);
  };

  const yaml = useMemo(() => {
    const labelsYaml = labels
      .filter((l) => l.key)
      .map((l) => `    ${l.key}: ${l.value || name || 'app'}`)
      .join('\n');

    const dataYaml = data
      .filter((d) => d.key)
      .map((d) => {
        const isMultiline = d.value.includes('\n');
        if (isMultiline) {
          const indentedValue = d.value
            .split('\n')
            .map((line) => `    ${line}`)
            .join('\n');
          return `  ${d.key}: |\n${indentedValue}`;
        }
        return `  ${d.key}: "${d.value.replace(/"/g, '\\"')}"`;
      })
      .join('\n');

    return `apiVersion: v1
kind: ConfigMap
metadata:
  name: ${name || 'my-configmap'}
  namespace: ${namespace}
  labels:
${labelsYaml}
data:
${dataYaml || '  # No data entries'}`;
  }, [name, namespace, labels, data]);

  const steps: WizardStep[] = [
    {
      id: 'basic',
      title: 'Basic Info',
      description: 'Set the ConfigMap name and namespace',
      isValid: name.length > 0,
      content: (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">ConfigMap Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-configmap"
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
      title: 'Data',
      description: 'Add key-value pairs for configuration data',
      isValid: data.some((d) => d.key),
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Add configuration data entries. Use multiline values for config files.
          </p>
          {data.map((entry, index) => (
            <Card key={index}>
              <CardContent className="pt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
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
                    placeholder="config.yaml or APP_ENV"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Value</Label>
                  <Textarea
                    value={entry.value}
                    onChange={(e) => updateDataEntry(index, 'value', e.target.value)}
                    placeholder="Enter configuration value..."
                    rows={4}
                    className="font-mono text-sm"
                  />
                </div>
              </CardContent>
            </Card>
          ))}
          <Button variant="outline" size="sm" onClick={addDataEntry} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Add Data Entry
          </Button>
        </div>
      ),
    },
    {
      id: 'review',
      title: 'Review',
      description: 'Review your ConfigMap configuration',
      content: (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Name</p>
                  <p className="font-medium">{name || 'my-configmap'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Namespace</p>
                  <p className="font-medium">{namespace}</p>
                </div>
                <div className="col-span-2">
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
              <p className="text-sm text-muted-foreground mb-2">Data Keys</p>
              <div className="flex flex-wrap gap-2">
                {data.filter((d) => d.key).map((d, i) => (
                  <Badge key={i} variant="outline" className="font-mono">
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
      title="Create ConfigMap"
      resourceType="ConfigMap"
      steps={steps}
      yaml={yaml}
      onClose={onClose}
      onSubmit={handleSubmit}
      isSubmitting={createResource.isPending}
    />
  );
}
