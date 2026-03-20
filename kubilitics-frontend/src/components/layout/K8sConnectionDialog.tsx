import { useState } from 'react';
import { motion } from 'framer-motion';
import { Server, Link2, Unlink, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useKubernetesConfigStore } from '@/stores/kubernetesConfigStore';
import { useTestK8sConnection } from '@/hooks/useKubernetes';
import { cn } from '@/lib/utils';

interface K8sConnectionDialogProps {
  /** Optional class for the trigger to match header action buttons (e.g. uniform height/size) */
  triggerClassName?: string;
}

export function K8sConnectionDialog({ triggerClassName }: K8sConnectionDialogProps) {
  const { config, setApiUrl, setToken, disconnect } = useKubernetesConfigStore();
  const testConnection = useTestK8sConnection();
  const [open, setOpen] = useState(false);
  const [apiUrl, setApiUrlLocal] = useState(config.apiUrl);
  const [token, setTokenLocal] = useState(config.token || '');

  const handleConnect = () => {
    setApiUrl(apiUrl);
    setToken(token);
    testConnection.mutate();
  };

  const handleDisconnect = () => {
    disconnect();
    setApiUrlLocal('');
    setTokenLocal('');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className={cn(
            triggerClassName,
            config.isConnected
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
              : 'bg-primary text-primary-foreground border-primary hover:bg-primary/90'
          )}
        >
          {config.isConnected ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span>Connected</span>
            </>
          ) : (
            <>
              <Server className="h-4 w-4" />
              <span>Connect</span>
            </>
          )}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Kubernetes Connection
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          {config.isConnected ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <Card className="border-green-500/20 bg-green-500/5">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-green-500/20 flex items-center justify-center">
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    </div>
                    <div>
                      <p className="font-medium">Connected</p>
                      <p className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
                        {config.apiUrl}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => testConnection.mutate()}
                  disabled={testConnection.isPending}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${testConnection.isPending ? 'animate-spin' : ''}`} />
                  Test Connection
                </Button>
                <Button variant="destructive" className="flex-1" onClick={handleDisconnect}>
                  <Unlink className="h-4 w-4 mr-2" />
                  Disconnect
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="apiUrl">Kubernetes API URL</Label>
                <Input
                  id="apiUrl"
                  value={apiUrl}
                  onChange={(e) => setApiUrlLocal(e.target.value)}
                  placeholder="https://your-cluster-api:6443"
                />
                <p className="text-xs text-muted-foreground">
                  The URL of your Kubernetes API server or proxy
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="token">Bearer Token (optional)</Label>
                <Input
                  id="token"
                  type="password"
                  value={token}
                  onChange={(e) => setTokenLocal(e.target.value)}
                  placeholder="Your service account token"
                />
                <p className="text-xs text-muted-foreground">
                  Required for authenticated access
                </p>
              </div>
              <Button
                className="w-full"
                onClick={handleConnect}
                disabled={!apiUrl || testConnection.isPending}
              >
                {testConnection.isPending ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4 mr-2" />
                )}
                Connect to Cluster
              </Button>
              {testConnection.isError && (
                <p className="text-sm text-destructive text-center">
                  {testConnection.error?.message}
                </p>
              )}
            </motion.div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
