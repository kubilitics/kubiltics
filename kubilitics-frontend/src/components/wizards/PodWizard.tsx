import { useState, useCallback } from 'react';
import { Plus, Trash2, Info } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ResourceWizard, type WizardStep } from './ResourceWizard';
import { useCreateK8sResource } from '@/hooks/useKubernetes';
import { useKubernetesConfigStore } from '@/stores/kubernetesConfigStore';
import { notifySuccess } from '@/lib/notificationFormatter';

interface ContainerSpec {
  name: string;
  image: string;
  imagePullPolicy: 'Always' | 'IfNotPresent' | 'Never';
  command: string;
  args: string;
  workingDir: string;
  ports: Array<{ containerPort: number; protocol: string; name: string }>;
  env: Array<{ name: string; value: string }>;
  resources: {
    requests: { cpu: string; memory: string };
    limits: { cpu: string; memory: string };
  };
  volumeMounts: Array<{ name: string; mountPath: string; readOnly: boolean }>;
  livenessProbe: {
    enabled: boolean;
    httpGet: { path: string; port: number };
    initialDelaySeconds: number;
    periodSeconds: number;
  };
  readinessProbe: {
    enabled: boolean;
    httpGet: { path: string; port: number };
    initialDelaySeconds: number;
    periodSeconds: number;
  };
}

interface VolumeSpec {
  name: string;
  type: 'emptyDir' | 'configMap' | 'secret' | 'persistentVolumeClaim' | 'hostPath';
  configMapName?: string;
  secretName?: string;
  pvcName?: string;
  hostPath?: string;
}

interface PodSpec {
  name: string;
  namespace: string;
  labels: Array<{ key: string; value: string }>;
  annotations: Array<{ key: string; value: string }>;
  restartPolicy: 'Always' | 'OnFailure' | 'Never';
  serviceAccountName: string;
  nodeName: string;
  nodeSelector: Array<{ key: string; value: string }>;
  tolerations: Array<{ key: string; operator: string; value: string; effect: string }>;
  containers: ContainerSpec[];
  initContainers: ContainerSpec[];
  volumes: VolumeSpec[];
  dnsPolicy: 'ClusterFirst' | 'Default' | 'ClusterFirstWithHostNet' | 'None';
  hostNetwork: boolean;
  terminationGracePeriodSeconds: number;
}

const defaultContainer: ContainerSpec = {
  name: '',
  image: '',
  imagePullPolicy: 'IfNotPresent',
  command: '',
  args: '',
  workingDir: '',
  ports: [],
  env: [],
  resources: {
    requests: { cpu: '100m', memory: '128Mi' },
    limits: { cpu: '500m', memory: '512Mi' },
  },
  volumeMounts: [],
  livenessProbe: {
    enabled: false,
    httpGet: { path: '/health', port: 8080 },
    initialDelaySeconds: 30,
    periodSeconds: 10,
  },
  readinessProbe: {
    enabled: false,
    httpGet: { path: '/ready', port: 8080 },
    initialDelaySeconds: 5,
    periodSeconds: 5,
  },
};

const defaultPodSpec: PodSpec = {
  name: '',
  namespace: 'default',
  labels: [{ key: 'app', value: '' }],
  annotations: [],
  restartPolicy: 'Always',
  serviceAccountName: 'default',
  nodeName: '',
  nodeSelector: [],
  tolerations: [],
  containers: [{ ...defaultContainer, name: 'main' }],
  initContainers: [],
  volumes: [],
  dnsPolicy: 'ClusterFirst',
  hostNetwork: false,
  terminationGracePeriodSeconds: 30,
};

interface PodWizardProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function PodWizard({ open, onClose, onSuccess }: PodWizardProps) {
  const [spec, setSpec] = useState<PodSpec>({ ...defaultPodSpec });
  const [activeContainerIndex, setActiveContainerIndex] = useState(0);
  const { config } = useKubernetesConfigStore();
  const createPod = useCreateK8sResource('pods');

  const updateSpec = useCallback(<K extends keyof PodSpec>(key: K, value: PodSpec[K]) => {
    setSpec(prev => ({ ...prev, [key]: value }));
  }, []);

  const updateContainer = useCallback((index: number, updates: Partial<ContainerSpec>) => {
    setSpec(prev => ({
      ...prev,
      containers: prev.containers.map((c, i) => i === index ? { ...c, ...updates } : c),
    }));
  }, []);

  const addContainer = useCallback(() => {
    setSpec(prev => ({
      ...prev,
      containers: [...prev.containers, { ...defaultContainer, name: `container-${prev.containers.length + 1}` }],
    }));
    setActiveContainerIndex(spec.containers.length);
  }, [spec.containers.length]);

  const removeContainer = useCallback((index: number) => {
    if (spec.containers.length <= 1) return;
    setSpec(prev => ({
      ...prev,
      containers: prev.containers.filter((_, i) => i !== index),
    }));
    if (activeContainerIndex >= index && activeContainerIndex > 0) {
      setActiveContainerIndex(activeContainerIndex - 1);
    }
  }, [spec.containers.length, activeContainerIndex]);

  const addPort = useCallback((containerIndex: number) => {
    updateContainer(containerIndex, {
      ports: [...spec.containers[containerIndex].ports, { containerPort: 8080, protocol: 'TCP', name: '' }],
    });
  }, [spec.containers, updateContainer]);

  const removePort = useCallback((containerIndex: number, portIndex: number) => {
    updateContainer(containerIndex, {
      ports: spec.containers[containerIndex].ports.filter((_, i) => i !== portIndex),
    });
  }, [spec.containers, updateContainer]);

  const addEnvVar = useCallback((containerIndex: number) => {
    updateContainer(containerIndex, {
      env: [...spec.containers[containerIndex].env, { name: '', value: '' }],
    });
  }, [spec.containers, updateContainer]);

  const removeEnvVar = useCallback((containerIndex: number, envIndex: number) => {
    updateContainer(containerIndex, {
      env: spec.containers[containerIndex].env.filter((_, i) => i !== envIndex),
    });
  }, [spec.containers, updateContainer]);

  const addVolume = useCallback(() => {
    setSpec(prev => ({
      ...prev,
      volumes: [...prev.volumes, { name: `volume-${prev.volumes.length + 1}`, type: 'emptyDir' }],
    }));
  }, []);

  const removeVolume = useCallback((index: number) => {
    setSpec(prev => ({
      ...prev,
      volumes: prev.volumes.filter((_, i) => i !== index),
    }));
  }, []);

  const addLabel = useCallback(() => {
    setSpec(prev => ({
      ...prev,
      labels: [...prev.labels, { key: '', value: '' }],
    }));
  }, []);

  const removeLabel = useCallback((index: number) => {
    setSpec(prev => ({
      ...prev,
      labels: prev.labels.filter((_, i) => i !== index),
    }));
  }, []);

  const generateYaml = useCallback((): string => {
    const labels = spec.labels.reduce((acc, l) => {
      if (l.key) acc[l.key] = l.value;
      return acc;
    }, {} as Record<string, string>);

    const annotations = spec.annotations.reduce((acc, a) => {
      if (a.key) acc[a.key] = a.value;
      return acc;
    }, {} as Record<string, string>);

    const containers = spec.containers.map(c => {
      const container: any = {
        name: c.name,
        image: c.image,
        imagePullPolicy: c.imagePullPolicy,
      };

      if (c.command) container.command = c.command.split(' ').filter(Boolean);
      if (c.args) container.args = c.args.split(' ').filter(Boolean);
      if (c.workingDir) container.workingDir = c.workingDir;

      if (c.ports.length > 0) {
        container.ports = c.ports.map(p => ({
          containerPort: p.containerPort,
          protocol: p.protocol,
          ...(p.name && { name: p.name }),
        }));
      }

      if (c.env.length > 0) {
        container.env = c.env.filter(e => e.name).map(e => ({ name: e.name, value: e.value }));
      }

      container.resources = {
        requests: { cpu: c.resources.requests.cpu, memory: c.resources.requests.memory },
        limits: { cpu: c.resources.limits.cpu, memory: c.resources.limits.memory },
      };

      if (c.volumeMounts.length > 0) {
        container.volumeMounts = c.volumeMounts.map(v => ({
          name: v.name,
          mountPath: v.mountPath,
          ...(v.readOnly && { readOnly: true }),
        }));
      }

      if (c.livenessProbe.enabled) {
        container.livenessProbe = {
          httpGet: { path: c.livenessProbe.httpGet.path, port: c.livenessProbe.httpGet.port },
          initialDelaySeconds: c.livenessProbe.initialDelaySeconds,
          periodSeconds: c.livenessProbe.periodSeconds,
        };
      }

      if (c.readinessProbe.enabled) {
        container.readinessProbe = {
          httpGet: { path: c.readinessProbe.httpGet.path, port: c.readinessProbe.httpGet.port },
          initialDelaySeconds: c.readinessProbe.initialDelaySeconds,
          periodSeconds: c.readinessProbe.periodSeconds,
        };
      }

      return container;
    });

    const volumes = spec.volumes.map(v => {
      const vol: any = { name: v.name };
      switch (v.type) {
        case 'emptyDir':
          vol.emptyDir = {};
          break;
        case 'configMap':
          vol.configMap = { name: v.configMapName };
          break;
        case 'secret':
          vol.secret = { secretName: v.secretName };
          break;
        case 'persistentVolumeClaim':
          vol.persistentVolumeClaim = { claimName: v.pvcName };
          break;
        case 'hostPath':
          vol.hostPath = { path: v.hostPath };
          break;
      }
      return vol;
    });

    const nodeSelector = spec.nodeSelector.reduce((acc, n) => {
      if (n.key) acc[n.key] = n.value;
      return acc;
    }, {} as Record<string, string>);

    const podManifest: any = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: spec.name,
        namespace: spec.namespace,
        ...(Object.keys(labels).length > 0 && { labels }),
        ...(Object.keys(annotations).length > 0 && { annotations }),
      },
      spec: {
        restartPolicy: spec.restartPolicy,
        terminationGracePeriodSeconds: spec.terminationGracePeriodSeconds,
        dnsPolicy: spec.dnsPolicy,
        ...(spec.serviceAccountName && { serviceAccountName: spec.serviceAccountName }),
        ...(spec.nodeName && { nodeName: spec.nodeName }),
        ...(Object.keys(nodeSelector).length > 0 && { nodeSelector }),
        ...(spec.hostNetwork && { hostNetwork: true }),
        containers,
        ...(volumes.length > 0 && { volumes }),
        ...(spec.tolerations.length > 0 && {
          tolerations: spec.tolerations.filter(t => t.key).map(t => ({
            key: t.key,
            operator: t.operator,
            value: t.value,
            effect: t.effect,
          })),
        }),
      },
    };

    return formatYaml(podManifest);
  }, [spec]);

  const formatYaml = (obj: any, indent = 0): string => {
    const spaces = '  '.repeat(indent);
    let result = '';

    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined || value === null) continue;

      if (Array.isArray(value)) {
        if (value.length === 0) continue;
        result += `${spaces}${key}:\n`;
        value.forEach((item) => {
          if (typeof item === 'object') {
            const itemYaml = formatYaml(item, indent + 2);
            const lines = itemYaml.split('\n').filter(Boolean);
            result += `${spaces}- ${lines[0].trim()}\n`;
            lines.slice(1).forEach(line => {
              result += `${spaces}  ${line}\n`;
            });
          } else {
            result += `${spaces}- ${item}\n`;
          }
        });
      } else if (typeof value === 'object') {
        result += `${spaces}${key}:\n`;
        result += formatYaml(value, indent + 1);
      } else {
        result += `${spaces}${key}: ${value}\n`;
      }
    }

    return result;
  };

  const handleSubmit = async () => {
    if (config.isConnected) {
      try {
        await createPod.mutateAsync({
          namespace: spec.namespace,
          yaml: generateYaml(),
        });
        onSuccess?.();
        onClose();
      } catch (error: any) {
        // Error toast is handled by useCreateK8sResource / notifyError
      }
    } else {
      notifySuccess(
        {
          action: 'create',
          resourceType: 'pods',
          resourceName: spec.name,
          namespace: spec.namespace,
        },
        {
          description: 'Demo mode – connect to a cluster to actually create this pod.',
        }
      );
      onSuccess?.();
      onClose();
    }
  };

  const activeContainer = spec.containers[activeContainerIndex];

  const steps: WizardStep[] = [
    {
      id: 'basic',
      title: 'Basic Info',
      description: 'Configure pod name, namespace, and metadata',
      isValid: !!spec.name && !!spec.namespace,
      content: (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Pod Name *</Label>
              <Input
                id="name"
                placeholder="my-pod"
                value={spec.name}
                onChange={(e) => updateSpec('name', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="namespace">Namespace *</Label>
              <Select value={spec.namespace} onValueChange={(v) => updateSpec('namespace', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">default</SelectItem>
                  <SelectItem value="production">production</SelectItem>
                  <SelectItem value="staging">staging</SelectItem>
                  <SelectItem value="development">development</SelectItem>
                  <SelectItem value="kube-system">kube-system</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Labels</Label>
              <Button variant="outline" size="sm" onClick={addLabel} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Add Label
              </Button>
            </div>
            {spec.labels.map((label, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  placeholder="key"
                  value={label.key}
                  onChange={(e) => {
                    const newLabels = [...spec.labels];
                    newLabels[i] = { ...newLabels[i], key: e.target.value };
                    updateSpec('labels', newLabels);
                  }}
                  className="flex-1"
                />
                <span className="text-muted-foreground">=</span>
                <Input
                  placeholder="value"
                  value={label.value}
                  onChange={(e) => {
                    const newLabels = [...spec.labels];
                    newLabels[i] = { ...newLabels[i], value: e.target.value };
                    updateSpec('labels', newLabels);
                  }}
                  className="flex-1"
                />
                <Button variant="ghost" size="icon" onClick={() => removeLabel(i)} className="shrink-0">
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Restart Policy</Label>
              <Select value={spec.restartPolicy} onValueChange={(v: any) => updateSpec('restartPolicy', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Always">Always</SelectItem>
                  <SelectItem value="OnFailure">OnFailure</SelectItem>
                  <SelectItem value="Never">Never</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Service Account</Label>
              <Input
                placeholder="default"
                value={spec.serviceAccountName}
                onChange={(e) => updateSpec('serviceAccountName', e.target.value)}
              />
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'containers',
      title: 'Containers',
      description: 'Define container images and configurations',
      isValid: spec.containers.every(c => c.name && c.image),
      content: (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            {spec.containers.map((container, i) => (
              <Badge
                key={i}
                variant={i === activeContainerIndex ? 'default' : 'outline'}
                className="cursor-pointer px-3 py-1.5"
                onClick={() => setActiveContainerIndex(i)}
              >
                {container.name || `Container ${i + 1}`}
                {spec.containers.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeContainer(i); }}
                    className="ml-2 hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            ))}
            <Button variant="outline" size="sm" onClick={addContainer} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Add Container
            </Button>
          </div>

          {activeContainer && (
            <Card>
              <CardContent className="pt-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Container Name *</Label>
                    <Input
                      placeholder="main"
                      value={activeContainer.name}
                      onChange={(e) => updateContainer(activeContainerIndex, { name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Image *</Label>
                    <Input
                      placeholder="nginx:latest"
                      value={activeContainer.image}
                      onChange={(e) => updateContainer(activeContainerIndex, { image: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Image Pull Policy</Label>
                    <Select
                      value={activeContainer.imagePullPolicy}
                      onValueChange={(v: any) => updateContainer(activeContainerIndex, { imagePullPolicy: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Always">Always</SelectItem>
                        <SelectItem value="IfNotPresent">IfNotPresent</SelectItem>
                        <SelectItem value="Never">Never</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Command</Label>
                    <Input
                      placeholder="/bin/sh -c"
                      value={activeContainer.command}
                      onChange={(e) => updateContainer(activeContainerIndex, { command: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Arguments</Label>
                    <Input
                      placeholder="arg1 arg2"
                      value={activeContainer.args}
                      onChange={(e) => updateContainer(activeContainerIndex, { args: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Ports</Label>
                    <Button variant="outline" size="sm" onClick={() => addPort(activeContainerIndex)} className="gap-1.5">
                      <Plus className="h-3.5 w-3.5" />
                      Add Port
                    </Button>
                  </div>
                  {activeContainer.ports.map((port, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        type="number"
                        placeholder="8080"
                        value={port.containerPort}
                        onChange={(e) => {
                          const newPorts = [...activeContainer.ports];
                          newPorts[i] = { ...newPorts[i], containerPort: parseInt(e.target.value) || 0 };
                          updateContainer(activeContainerIndex, { ports: newPorts });
                        }}
                        className="w-24"
                      />
                      <Select
                        value={port.protocol}
                        onValueChange={(v) => {
                          const newPorts = [...activeContainer.ports];
                          newPorts[i] = { ...newPorts[i], protocol: v };
                          updateContainer(activeContainerIndex, { ports: newPorts });
                        }}
                      >
                        <SelectTrigger className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="TCP">TCP</SelectItem>
                          <SelectItem value="UDP">UDP</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder="port name"
                        value={port.name}
                        onChange={(e) => {
                          const newPorts = [...activeContainer.ports];
                          newPorts[i] = { ...newPorts[i], name: e.target.value };
                          updateContainer(activeContainerIndex, { ports: newPorts });
                        }}
                        className="flex-1"
                      />
                      <Button variant="ghost" size="icon" onClick={() => removePort(activeContainerIndex, i)}>
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      ),
    },
    {
      id: 'resources',
      title: 'Resources',
      description: 'Set CPU and memory requests/limits',
      isValid: true,
      content: activeContainer ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-6">
            <Card>
              <CardContent className="pt-4">
                <h4 className="font-medium mb-4">Resource Requests</h4>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>CPU Request</Label>
                    <Input
                      placeholder="100m"
                      value={activeContainer.resources.requests.cpu}
                      onChange={(e) => updateContainer(activeContainerIndex, {
                        resources: {
                          ...activeContainer.resources,
                          requests: { ...activeContainer.resources.requests, cpu: e.target.value },
                        },
                      })}
                    />
                    <p className="text-xs text-muted-foreground">Example: 100m, 0.5, 1</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Memory Request</Label>
                    <Input
                      placeholder="128Mi"
                      value={activeContainer.resources.requests.memory}
                      onChange={(e) => updateContainer(activeContainerIndex, {
                        resources: {
                          ...activeContainer.resources,
                          requests: { ...activeContainer.resources.requests, memory: e.target.value },
                        },
                      })}
                    />
                    <p className="text-xs text-muted-foreground">Example: 128Mi, 1Gi</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <h4 className="font-medium mb-4">Resource Limits</h4>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>CPU Limit</Label>
                    <Input
                      placeholder="500m"
                      value={activeContainer.resources.limits.cpu}
                      onChange={(e) => updateContainer(activeContainerIndex, {
                        resources: {
                          ...activeContainer.resources,
                          limits: { ...activeContainer.resources.limits, cpu: e.target.value },
                        },
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Memory Limit</Label>
                    <Input
                      placeholder="512Mi"
                      value={activeContainer.resources.limits.memory}
                      onChange={(e) => updateContainer(activeContainerIndex, {
                        resources: {
                          ...activeContainer.resources,
                          limits: { ...activeContainer.resources.limits, memory: e.target.value },
                        },
                      })}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Environment Variables</Label>
              <Button variant="outline" size="sm" onClick={() => addEnvVar(activeContainerIndex)} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Add Variable
              </Button>
            </div>
            {activeContainer.env.map((env, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  placeholder="KEY"
                  value={env.name}
                  onChange={(e) => {
                    const newEnv = [...activeContainer.env];
                    newEnv[i] = { ...newEnv[i], name: e.target.value };
                    updateContainer(activeContainerIndex, { env: newEnv });
                  }}
                  className="flex-1 font-mono"
                />
                <span className="text-muted-foreground">=</span>
                <Input
                  placeholder="value"
                  value={env.value}
                  onChange={(e) => {
                    const newEnv = [...activeContainer.env];
                    newEnv[i] = { ...newEnv[i], value: e.target.value };
                    updateContainer(activeContainerIndex, { env: newEnv });
                  }}
                  className="flex-1 font-mono"
                />
                <Button variant="ghost" size="icon" onClick={() => removeEnvVar(activeContainerIndex, i)}>
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null,
    },
    {
      id: 'health',
      title: 'Health Checks',
      description: 'Configure liveness and readiness probes',
      isValid: true,
      content: activeContainer ? (
        <div className="space-y-6">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <h4 className="font-medium">Liveness Probe</h4>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="h-4 w-4 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs">Determines if the container is running. If the probe fails, the container will be restarted.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Switch
                  checked={activeContainer.livenessProbe.enabled}
                  onCheckedChange={(checked) => updateContainer(activeContainerIndex, {
                    livenessProbe: { ...activeContainer.livenessProbe, enabled: checked },
                  })}
                />
              </div>
              {activeContainer.livenessProbe.enabled && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>HTTP Path</Label>
                    <Input
                      placeholder="/health"
                      value={activeContainer.livenessProbe.httpGet.path}
                      onChange={(e) => updateContainer(activeContainerIndex, {
                        livenessProbe: {
                          ...activeContainer.livenessProbe,
                          httpGet: { ...activeContainer.livenessProbe.httpGet, path: e.target.value },
                        },
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Port</Label>
                    <Input
                      type="number"
                      placeholder="8080"
                      value={activeContainer.livenessProbe.httpGet.port}
                      onChange={(e) => updateContainer(activeContainerIndex, {
                        livenessProbe: {
                          ...activeContainer.livenessProbe,
                          httpGet: { ...activeContainer.livenessProbe.httpGet, port: parseInt(e.target.value) || 0 },
                        },
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Initial Delay (s)</Label>
                    <Input
                      type="number"
                      value={activeContainer.livenessProbe.initialDelaySeconds}
                      onChange={(e) => updateContainer(activeContainerIndex, {
                        livenessProbe: { ...activeContainer.livenessProbe, initialDelaySeconds: parseInt(e.target.value) || 0 },
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Period (s)</Label>
                    <Input
                      type="number"
                      value={activeContainer.livenessProbe.periodSeconds}
                      onChange={(e) => updateContainer(activeContainerIndex, {
                        livenessProbe: { ...activeContainer.livenessProbe, periodSeconds: parseInt(e.target.value) || 0 },
                      })}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <h4 className="font-medium">Readiness Probe</h4>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="h-4 w-4 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs">Determines if the container is ready to receive traffic. Traffic will only be routed to this pod when ready.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Switch
                  checked={activeContainer.readinessProbe.enabled}
                  onCheckedChange={(checked) => updateContainer(activeContainerIndex, {
                    readinessProbe: { ...activeContainer.readinessProbe, enabled: checked },
                  })}
                />
              </div>
              {activeContainer.readinessProbe.enabled && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>HTTP Path</Label>
                    <Input
                      placeholder="/ready"
                      value={activeContainer.readinessProbe.httpGet.path}
                      onChange={(e) => updateContainer(activeContainerIndex, {
                        readinessProbe: {
                          ...activeContainer.readinessProbe,
                          httpGet: { ...activeContainer.readinessProbe.httpGet, path: e.target.value },
                        },
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Port</Label>
                    <Input
                      type="number"
                      placeholder="8080"
                      value={activeContainer.readinessProbe.httpGet.port}
                      onChange={(e) => updateContainer(activeContainerIndex, {
                        readinessProbe: {
                          ...activeContainer.readinessProbe,
                          httpGet: { ...activeContainer.readinessProbe.httpGet, port: parseInt(e.target.value) || 0 },
                        },
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Initial Delay (s)</Label>
                    <Input
                      type="number"
                      value={activeContainer.readinessProbe.initialDelaySeconds}
                      onChange={(e) => updateContainer(activeContainerIndex, {
                        readinessProbe: { ...activeContainer.readinessProbe, initialDelaySeconds: parseInt(e.target.value) || 0 },
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Period (s)</Label>
                    <Input
                      type="number"
                      value={activeContainer.readinessProbe.periodSeconds}
                      onChange={(e) => updateContainer(activeContainerIndex, {
                        readinessProbe: { ...activeContainer.readinessProbe, periodSeconds: parseInt(e.target.value) || 0 },
                      })}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null,
    },
    {
      id: 'volumes',
      title: 'Storage',
      description: 'Configure volumes and mounts',
      isValid: true,
      content: (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <Label className="text-base">Volumes</Label>
            <Button variant="outline" size="sm" onClick={addVolume} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Add Volume
            </Button>
          </div>

          {spec.volumes.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <p>No volumes configured</p>
                <p className="text-sm">Add volumes to mount storage in your containers</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {spec.volumes.map((volume, i) => (
                <Card key={i}>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between mb-4">
                      <div className="grid grid-cols-2 gap-4 flex-1">
                        <div className="space-y-2">
                          <Label>Volume Name</Label>
                          <Input
                            value={volume.name}
                            onChange={(e) => {
                              const newVolumes = [...spec.volumes];
                              newVolumes[i] = { ...newVolumes[i], name: e.target.value };
                              updateSpec('volumes', newVolumes);
                            }}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Type</Label>
                          <Select
                            value={volume.type}
                            onValueChange={(v: any) => {
                              const newVolumes = [...spec.volumes];
                              newVolumes[i] = { ...newVolumes[i], type: v };
                              updateSpec('volumes', newVolumes);
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="emptyDir">Empty Dir</SelectItem>
                              <SelectItem value="configMap">ConfigMap</SelectItem>
                              <SelectItem value="secret">Secret</SelectItem>
                              <SelectItem value="persistentVolumeClaim">PVC</SelectItem>
                              <SelectItem value="hostPath">Host Path</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => removeVolume(i)} className="ml-2">
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>

                    {volume.type === 'configMap' && (
                      <div className="space-y-2">
                        <Label>ConfigMap Name</Label>
                        <Input
                          placeholder="my-configmap"
                          value={volume.configMapName || ''}
                          onChange={(e) => {
                            const newVolumes = [...spec.volumes];
                            newVolumes[i] = { ...newVolumes[i], configMapName: e.target.value };
                            updateSpec('volumes', newVolumes);
                          }}
                        />
                      </div>
                    )}

                    {volume.type === 'secret' && (
                      <div className="space-y-2">
                        <Label>Secret Name</Label>
                        <Input
                          placeholder="my-secret"
                          value={volume.secretName || ''}
                          onChange={(e) => {
                            const newVolumes = [...spec.volumes];
                            newVolumes[i] = { ...newVolumes[i], secretName: e.target.value };
                            updateSpec('volumes', newVolumes);
                          }}
                        />
                      </div>
                    )}

                    {volume.type === 'persistentVolumeClaim' && (
                      <div className="space-y-2">
                        <Label>PVC Name</Label>
                        <Input
                          placeholder="my-pvc"
                          value={volume.pvcName || ''}
                          onChange={(e) => {
                            const newVolumes = [...spec.volumes];
                            newVolumes[i] = { ...newVolumes[i], pvcName: e.target.value };
                            updateSpec('volumes', newVolumes);
                          }}
                        />
                      </div>
                    )}

                    {volume.type === 'hostPath' && (
                      <div className="space-y-2">
                        <Label>Host Path</Label>
                        <Input
                          placeholder="/var/data"
                          value={volume.hostPath || ''}
                          onChange={(e) => {
                            const newVolumes = [...spec.volumes];
                            newVolumes[i] = { ...newVolumes[i], hostPath: e.target.value };
                            updateSpec('volumes', newVolumes);
                          }}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'review',
      title: 'Review',
      description: 'Review configuration and create pod',
      isValid: true,
      content: (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-4">
              <h4 className="font-medium mb-3">Pod Summary</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Name</p>
                  <p className="font-mono">{spec.name || '-'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Namespace</p>
                  <p className="font-mono">{spec.namespace}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Containers</p>
                  <p>{spec.containers.length}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Volumes</p>
                  <p>{spec.volumes.length}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Restart Policy</p>
                  <p>{spec.restartPolicy}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Labels</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {spec.labels.filter(l => l.key).map((l, i) => (
                      <Badge key={i} variant="secondary" className="text-xs font-mono">
                        {l.key}={l.value}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <h4 className="font-medium mb-3">Containers</h4>
              <div className="space-y-2">
                {spec.containers.map((c, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div>
                      <p className="font-medium">{c.name}</p>
                      <p className="text-sm text-muted-foreground font-mono">{c.image}</p>
                    </div>
                    <div className="text-right text-sm">
                      <p>CPU: {c.resources.requests.cpu} / {c.resources.limits.cpu}</p>
                      <p className="text-muted-foreground">Mem: {c.resources.requests.memory} / {c.resources.limits.memory}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ),
    },
  ];

  if (!open) return null;

  return (
    <ResourceWizard
      title="Create New Pod"
      resourceType="Pod"
      steps={steps}
      yaml={generateYaml()}
      onClose={onClose}
      onSubmit={handleSubmit}
      isSubmitting={createPod.isPending}
    />
  );
}
