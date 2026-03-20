import { useState, useEffect, useRef } from 'react';
import { ExternalLink, Copy, Check, Terminal, Globe, Server, ArrowRight, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NamespaceBadge } from '@/components/list';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { startPortForward, stopPortForward } from '@/services/backendApiClient';

export interface PortInfo {
  name?: string;
  containerPort: number;
  protocol?: string;
}

/** Service port entry (used when resourceType = 'service'). */
export interface ServicePortInfo {
  name?: string;
  port: number;
  targetPort?: number | string;
  protocol?: string;
  nodePort?: number;
}

export interface PortForwardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  podName: string;
  namespace: string;
  /** Backend base URL (e.g. "http://localhost:819"). Required for real port-forward. */
  baseUrl?: string;
  /** Active cluster ID. Required for real port-forward. */
  clusterId?: string;
  containers?: Array<{ name: string; ports?: PortInfo[] }>;
  /** When set, dialog opens with this container and port pre-selected (e.g. from ContainersSection "Forward" click). */
  initialContainer?: string;
  initialPort?: number;
  /** When 'service', targets svc/{podName} instead of pod/{podName} and uses servicePorts. */
  resourceType?: 'pod' | 'service';
  /** Service ports — used when resourceType = 'service'. */
  servicePorts?: ServicePortInfo[];
}

export function PortForwardDialog({
  open,
  onOpenChange,
  podName,
  namespace,
  baseUrl,
  clusterId,
  containers = [],
  initialContainer,
  initialPort,
  resourceType = 'pod',
  servicePorts = [],
}: PortForwardDialogProps) {
  const [selectedContainer, setSelectedContainer] = useState(containers[0]?.name || '');
  const [selectedPort, setSelectedPort] = useState<number | null>(null);
  const [localPort, setLocalPort] = useState('');
  const [localPortTouched, setLocalPortTouched] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isForwarding, setIsForwarding] = useState(false);
  const sessionIdRef = useRef<string | null>(null);

  const isServiceMode = resourceType === 'service';

  // Get available ports for selected container (pod mode) or service ports (service mode)
  const currentContainer = containers.find(c => c.name === selectedContainer);
  const availablePorts = isServiceMode
    ? servicePorts.map(p => ({ containerPort: p.port, name: p.name, protocol: p.protocol }))
    : (currentContainer?.ports || []);

  // Set default port when container/service changes (only if user hasn't manually set a local port)
  useEffect(() => {
    if (availablePorts.length > 0 && !selectedPort) {
      setSelectedPort(availablePorts[0].containerPort);
      if (!localPortTouched) {
        setLocalPort(String(availablePorts[0].containerPort));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPort]);

  // Reset when dialog opens; use initialContainer/initialPort when provided.
  // Only [open] in deps — containers/servicePorts are new array refs every parent render
  // (PodDetail polls every few seconds). Including them would reset localPort on every
  // poll cycle while the dialog is open.
  useEffect(() => {
    if (open) {
      setIsForwarding(false);
      setIsStarting(false);
      setCopied(false);
      setLocalPortTouched(false);
      sessionIdRef.current = null;
      if (isServiceMode) {
        const port = servicePorts[0]?.port ?? null;
        setSelectedPort(port);
        setLocalPort(port ? String(port) : '');
      } else if (containers.length > 0) {
        const containerName = initialContainer && containers.some(c => c.name === initialContainer)
          ? initialContainer
          : containers[0].name;
        setSelectedContainer(containerName);
        const container = containers.find(c => c.name === containerName);
        const ports = container?.ports || [];
        const port = initialPort != null && ports.some(p => p.containerPort === initialPort)
          ? initialPort
          : ports[0]?.containerPort;
        if (port != null) {
          setSelectedPort(port);
          setLocalPort(String(port));
        } else {
          setSelectedPort(null);
          setLocalPort('');
        }
      }
    } else {
      // Dialog closed — stop any active session silently
      if (sessionIdRef.current && baseUrl && clusterId) {
        stopPortForward(baseUrl, clusterId, sessionIdRef.current).catch(() => {});
        sessionIdRef.current = null;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const resourceTarget = isServiceMode ? `svc/${podName}` : `pod/${podName}`;
  const kubectlCommand = `kubectl port-forward ${resourceTarget} ${localPort}:${selectedPort} -n ${namespace}`;

  const handleCopyCommand = () => {
    navigator.clipboard.writeText(kubectlCommand);
    setCopied(true);
    toast.success('Command copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStartForwarding = async () => {
    if (!selectedPort || !localPort) return;
    setIsStarting(true);
    try {
      const resp = await startPortForward(baseUrl ?? '', clusterId ?? '', {
        resourceType: isServiceMode ? 'service' : 'pod',
        name: podName,
        namespace,
        localPort: Number(localPort),
        remotePort: selectedPort,
      });
      sessionIdRef.current = resp.sessionId;
      setIsForwarding(true);
      toast.success('Port forwarding active', {
        description: `Tunnel open at http://localhost:${localPort}`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Port forward failed', { description: msg });
    } finally {
      setIsStarting(false);
    }
  };

  const handleStopForwarding = async () => {
    if (sessionIdRef.current && baseUrl && clusterId) {
      try {
        await stopPortForward(baseUrl, clusterId, sessionIdRef.current);
      } catch {
        // Best-effort; session may have already ended
      }
      sessionIdRef.current = null;
    }
    setIsForwarding(false);
    toast.info('Port forwarding stopped');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <ExternalLink className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle>Port Forward</DialogTitle>
              <DialogDescription>
                Forward a local port to access the container
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Resource Info */}
          <Card className="bg-muted/50">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 text-sm">
                <Server className="h-4 w-4 text-muted-foreground" />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {isServiceMode ? 'Service' : 'Pod'}
                </span>
                <span className="font-mono">{podName}</span>
                <NamespaceBadge namespace={namespace} className="text-xs" />
              </div>
            </CardContent>
          </Card>

          {/* Container Selection — pod mode only */}
          {!isServiceMode && containers.length > 1 && (
            <div className="space-y-2">
              <Label>Container</Label>
              <Select value={selectedContainer} onValueChange={setSelectedContainer}>
                <SelectTrigger>
                  <SelectValue placeholder="Select container" />
                </SelectTrigger>
                <SelectContent>
                  {containers.map(c => (
                    <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Port Selection */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Container Port</Label>
              {availablePorts.length > 0 ? (
                <Select
                  value={String(selectedPort)}
                  onValueChange={(v) => {
                    setSelectedPort(Number(v));
                    // Only sync local port if the user hasn't manually changed it
                    if (!localPortTouched) {
                      setLocalPort(v);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select port" />
                  </SelectTrigger>
                  <SelectContent>
                    {availablePorts.map(p => (
                      <SelectItem key={p.containerPort} value={String(p.containerPort)}>
                        {p.containerPort} {p.name && `(${p.name})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="8080"
                  value={selectedPort ?? ''}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '');
                    setSelectedPort(val ? Number(val) : null);
                  }}
                />
              )}
            </div>
            <div className="space-y-2">
              <Label>Local Port</Label>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="8080"
                value={localPort}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  setLocalPort(val);
                  setLocalPortTouched(true);
                }}
              />
            </div>
          </div>

          {/* Visual Diagram */}
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <div className="flex items-center justify-center gap-4 text-sm">
                <div className="text-center">
                  <div className="p-2 rounded-lg bg-background border border-border mb-1">
                    <Globe className="h-5 w-5 text-primary mx-auto" />
                  </div>
                  <p className="font-mono text-xs">localhost:{localPort}</p>
                  <p className="text-muted-foreground text-xs">Your browser</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <div className="text-center">
                  <div className="p-2 rounded-lg bg-background border border-border mb-1">
                    <Server className="h-5 w-5 text-primary mx-auto" />
                  </div>
                  <p className="font-mono text-xs">:{selectedPort}</p>
                  <p className="text-muted-foreground text-xs">{isServiceMode ? podName : selectedContainer}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Active Status */}
          {isForwarding && (
            <Card className="border-[hsl(var(--success))] bg-[hsl(var(--success)/0.1)]">
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <span className="inline-block w-2 h-2 bg-[hsl(var(--success))] rounded-full animate-pulse" />
                  <span className="text-sm font-medium text-[hsl(var(--success))]">
                    Port forwarding active
                  </span>
                </div>
                <p className="text-sm mt-1 text-muted-foreground">
                  Access your service at{' '}
                  <a
                    href={`http://localhost:${localPort}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline font-mono"
                  >
                    http://localhost:{localPort}
                  </a>
                </p>
              </CardContent>
            </Card>
          )}

          {/* kubectl Command */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2">
                <Terminal className="h-4 w-4" />
                kubectl command
              </Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5"
                onClick={handleCopyCommand}
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </>
                )}
              </Button>
            </div>
            <div className="p-3 rounded-lg bg-[hsl(221_39%_11%)] font-mono text-sm text-[hsl(142_76%_73%)] overflow-x-auto">
              {kubectlCommand}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          {isForwarding ? (
            <Button variant="destructive" onClick={handleStopForwarding}>
              Stop Forwarding
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleStartForwarding}
                disabled={!selectedPort || !localPort || isStarting}
              >
                {isStarting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Starting…
                  </>
                ) : (
                  <>
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Start Forwarding
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
