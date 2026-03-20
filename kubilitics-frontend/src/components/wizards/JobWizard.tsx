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

interface JobWizardProps {
  onClose: () => void;
  onSubmit?: (yaml: string) => void;
}

interface ContainerConfig {
  name: string;
  image: string;
  command: string;
  args: string;
  cpu: string;
  memory: string;
}

export function JobWizard({ onClose, onSubmit }: JobWizardProps) {
  const { config } = useKubernetesConfigStore();
  const createResource = useCreateK8sResource('jobs');
  
  const [name, setName] = useState('');
  const [namespace, setNamespace] = useState('default');
  const [completions, setCompletions] = useState('1');
  const [parallelism, setParallelism] = useState('1');
  const [backoffLimit, setBackoffLimit] = useState('6');
  const [activeDeadlineSeconds, setActiveDeadlineSeconds] = useState('');
  const [ttlSecondsAfterFinished, setTtlSecondsAfterFinished] = useState('');
  const [restartPolicy, setRestartPolicy] = useState('Never');
  const [containers, setContainers] = useState<ContainerConfig[]>([
    { name: '', image: '', command: '', args: '', cpu: '100m', memory: '128Mi' },
  ]);

  const addContainer = () =>
    setContainers([...containers, { name: '', image: '', command: '', args: '', cpu: '100m', memory: '128Mi' }]);
  const removeContainer = (index: number) => setContainers(containers.filter((_, i) => i !== index));
  const updateContainer = (index: number, field: keyof ContainerConfig, value: string) => {
    const updated = [...containers];
    updated[index][field] = value;
    setContainers(updated);
  };

  const yaml = useMemo(() => {
    const jobName = name || 'my-job';
    
    const containersYaml = containers
      .map((c) => {
        let containerYaml = `      - name: ${c.name || 'job'}
        image: ${c.image || 'busybox:latest'}`;
        
        if (c.command) {
          containerYaml += `
        command: [${c.command.split(',').map(cmd => `"${cmd.trim()}"`).join(', ')}]`;
        }
        
        if (c.args) {
          containerYaml += `
        args: [${c.args.split(',').map(arg => `"${arg.trim()}"`).join(', ')}]`;
        }
        
        containerYaml += `
        resources:
          requests:
            cpu: ${c.cpu || '100m'}
            memory: ${c.memory || '128Mi'}
          limits:
            cpu: ${c.cpu || '100m'}
            memory: ${c.memory || '128Mi'}`;
        
        return containerYaml;
      })
      .join('\n');

    let spec = `apiVersion: batch/v1
kind: Job
metadata:
  name: ${jobName}
  namespace: ${namespace}
  labels:
    job-name: ${jobName}
spec:
  completions: ${completions}
  parallelism: ${parallelism}
  backoffLimit: ${backoffLimit}`;

    if (activeDeadlineSeconds) {
      spec += `
  activeDeadlineSeconds: ${activeDeadlineSeconds}`;
    }

    if (ttlSecondsAfterFinished) {
      spec += `
  ttlSecondsAfterFinished: ${ttlSecondsAfterFinished}`;
    }

    spec += `
  template:
    metadata:
      labels:
        job-name: ${jobName}
    spec:
      restartPolicy: ${restartPolicy}
      containers:
${containersYaml}`;

    return spec;
  }, [name, namespace, completions, parallelism, backoffLimit, activeDeadlineSeconds, ttlSecondsAfterFinished, restartPolicy, containers]);

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
      description: 'Configure Job name and completion settings',
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Job Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="data-migration"
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
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="completions">Completions</Label>
              <Input
                id="completions"
                type="number"
                min="1"
                value={completions}
                onChange={(e) => setCompletions(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Number of successful completions</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="parallelism">Parallelism</Label>
              <Input
                id="parallelism"
                type="number"
                min="1"
                value={parallelism}
                onChange={(e) => setParallelism(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Max pods running at once</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="backoffLimit">Backoff Limit</Label>
              <Input
                id="backoffLimit"
                type="number"
                min="0"
                value={backoffLimit}
                onChange={(e) => setBackoffLimit(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Max retries before failure</p>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'execution',
      title: 'Execution',
      description: 'Configure job execution limits and policies',
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="activeDeadlineSeconds">Active Deadline (seconds)</Label>
              <Input
                id="activeDeadlineSeconds"
                type="number"
                min="1"
                value={activeDeadlineSeconds}
                onChange={(e) => setActiveDeadlineSeconds(e.target.value)}
                placeholder="Optional"
              />
              <p className="text-xs text-muted-foreground">Max time for job to run</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ttlSecondsAfterFinished">TTL After Finished (seconds)</Label>
              <Input
                id="ttlSecondsAfterFinished"
                type="number"
                min="0"
                value={ttlSecondsAfterFinished}
                onChange={(e) => setTtlSecondsAfterFinished(e.target.value)}
                placeholder="Optional"
              />
              <p className="text-xs text-muted-foreground">Auto-delete after completion</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Restart Policy</Label>
            <Select value={restartPolicy} onValueChange={setRestartPolicy}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Never">Never</SelectItem>
                <SelectItem value="OnFailure">OnFailure</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {restartPolicy === 'Never' 
                ? 'Pods will not restart; Job will create new pods on failure'
                : 'Pods will restart in-place on failure'}
            </p>
          </div>
        </div>
      ),
    },
    {
      id: 'containers',
      title: 'Containers',
      description: 'Configure container images and commands',
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
                      placeholder="job"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Image</Label>
                    <Input
                      value={container.image}
                      onChange={(e) => updateContainer(index, 'image', e.target.value)}
                      placeholder="myapp/migration:v1"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Command (comma-separated)</Label>
                    <Input
                      value={container.command}
                      onChange={(e) => updateContainer(index, 'command', e.target.value)}
                      placeholder="/bin/sh, -c"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Args (comma-separated)</Label>
                    <Input
                      value={container.args}
                      onChange={(e) => updateContainer(index, 'args', e.target.value)}
                      placeholder="./migrate.sh"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>CPU</Label>
                    <Input
                      value={container.cpu}
                      onChange={(e) => updateContainer(index, 'cpu', e.target.value)}
                      placeholder="100m"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Memory</Label>
                    <Input
                      value={container.memory}
                      onChange={(e) => updateContainer(index, 'memory', e.target.value)}
                      placeholder="128Mi"
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
  ];

  return (
    <ResourceWizard
      title="Create Job"
      resourceType="Job"
      steps={steps}
      yaml={yaml}
      onClose={onClose}
      onSubmit={handleCreate}
      isSubmitting={createResource.isPending}
    />
  );
}
