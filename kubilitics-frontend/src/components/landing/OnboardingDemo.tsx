import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  Search,
  CheckCircle2,
  Loader2,
  Server,
  Database,
  ArrowRight,
  FileText,
  FolderOpen,
  Shield,
  Globe,
  Play,
  Pause,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

type DemoStep =
  | 'idle'
  | 'uploading'
  | 'parsing'
  | 'detecting'
  | 'health-check'
  | 'cluster-selection'
  | 'namespace-fetch'
  | 'namespace-selection'
  | 'connecting'
  | 'complete';

interface Cluster {
  id: string;
  name: string;
  provider: string;
  icon: string;
  status: 'checking' | 'healthy' | 'warning';
  version: string;
  nodes: number;
}

interface Namespace {
  name: string;
  pods: number;
  status: 'Active';
}

const demoClusters: Cluster[] = [
  { id: 'prod', name: 'production-eks', provider: 'EKS', icon: '🔶', status: 'checking', version: 'v1.28.4', nodes: 12 },
  { id: 'staging', name: 'staging-gke', provider: 'GKE', icon: '🔵', status: 'checking', version: 'v1.27.8', nodes: 5 },
  { id: 'dev', name: 'dev-minikube', provider: 'Minikube', icon: '🏠', status: 'checking', version: 'v1.29.0', nodes: 1 },
];

const demoNamespaces: Namespace[] = [
  { name: 'default', pods: 12, status: 'Active' },
  { name: 'production', pods: 45, status: 'Active' },
  { name: 'staging', pods: 23, status: 'Active' },
  { name: 'kube-system', pods: 28, status: 'Active' },
  { name: 'monitoring', pods: 15, status: 'Active' },
];

const stepLabels: Record<DemoStep, string> = {
  'idle': 'Ready to start',
  'uploading': 'Uploading kubeconfig...',
  'parsing': 'Parsing configuration...',
  'detecting': 'Detecting clusters...',
  'health-check': 'Checking cluster health...',
  'cluster-selection': 'Select your cluster',
  'namespace-fetch': 'Fetching namespaces...',
  'namespace-selection': 'Select default namespace',
  'connecting': 'Connecting to dashboard...',
  'complete': 'Welcome to Kubilitics!',
};

export function OnboardingDemo() {
  const [step, setStep] = useState<DemoStep>('idle');
  const [progress, setProgress] = useState(0);
  const [clusters, setClusters] = useState<Cluster[]>(demoClusters);
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
  const [selectedNamespace, setSelectedNamespace] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [autoPlayIndex, setAutoPlayIndex] = useState(0);

  const resetDemo = useCallback(() => {
    setStep('idle');
    setProgress(0);
    setClusters(demoClusters.map(c => ({ ...c, status: 'checking' as const })));
    setSelectedCluster(null);
    setSelectedNamespace(null);
    setAutoPlayIndex(0);
    setIsPlaying(false);
  }, []);

  const runStep = useCallback(async (currentStep: DemoStep) => {
    switch (currentStep) {
      case 'uploading':
        for (let i = 0; i <= 100; i += 5) {
          await new Promise(r => setTimeout(r, 40));
          setProgress(i);
        }
        setStep('parsing');
        break;

      case 'parsing':
        setProgress(0);
        for (let i = 0; i <= 100; i += 10) {
          await new Promise(r => setTimeout(r, 60));
          setProgress(i);
        }
        setStep('detecting');
        break;

      case 'detecting':
        setProgress(0);
        await new Promise(r => setTimeout(r, 800));
        setStep('health-check');
        break;

      case 'health-check':
        // Simulate health checks one by one
        for (let i = 0; i < demoClusters.length; i++) {
          await new Promise(r => setTimeout(r, 600));
          setClusters(prev => prev.map((c, idx) =>
            idx === i ? { ...c, status: idx === 1 ? 'warning' : 'healthy' } : c
          ));
        }
        await new Promise(r => setTimeout(r, 400));
        setStep('cluster-selection');
        break;

      case 'cluster-selection':
        // Auto-select first cluster after a delay
        await new Promise(r => setTimeout(r, 1000));
        setSelectedCluster('prod');
        await new Promise(r => setTimeout(r, 500));
        setStep('namespace-fetch');
        break;

      case 'namespace-fetch':
        setProgress(0);
        for (let i = 0; i <= 100; i += 15) {
          await new Promise(r => setTimeout(r, 50));
          setProgress(i);
        }
        setStep('namespace-selection');
        break;

      case 'namespace-selection':
        await new Promise(r => setTimeout(r, 800));
        setSelectedNamespace('production');
        await new Promise(r => setTimeout(r, 600));
        setStep('connecting');
        break;

      case 'connecting':
        setProgress(0);
        for (let i = 0; i <= 100; i += 8) {
          await new Promise(r => setTimeout(r, 40));
          setProgress(i);
        }
        setStep('complete');
        setIsPlaying(false);
        break;
    }
  }, []);

  const startDemo = useCallback(() => {
    resetDemo();
    setIsPlaying(true);
    setStep('uploading');
  }, [resetDemo]);

  // Auto-advance through steps when playing
  useEffect(() => {
    if (isPlaying && step !== 'idle' && step !== 'complete') {
      runStep(step);
    }
  }, [step, isPlaying, runStep]);

  const getStepNumber = () => {
    const steps: DemoStep[] = ['uploading', 'parsing', 'detecting', 'health-check', 'cluster-selection', 'namespace-fetch', 'namespace-selection', 'connecting', 'complete'];
    const idx = steps.indexOf(step);
    return idx >= 0 ? idx + 1 : 0;
  };

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-error/80" />
            <div className="w-3 h-3 rounded-full bg-warning/80" />
            <div className="w-3 h-3 rounded-full bg-success/80" />
          </div>
          <span className="text-xs text-muted-foreground ml-2">Onboarding Journey Demo</span>
        </div>
        <div className="flex items-center gap-2">
          {step !== 'idle' && step !== 'complete' && (
            <Badge variant="secondary" className="text-xs gap-1">
              Step {getStepNumber()}/9
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={resetDemo}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 min-h-[350px] flex flex-col">
        <AnimatePresence mode="wait">
          {/* Idle State */}
          {step === 'idle' && (
            <motion.div
              key="idle"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex-1 flex flex-col items-center justify-center text-center"
            >
              <div className="p-4 rounded-2xl bg-primary/10 mb-4">
                <Play className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-2">See the Magic</h3>
              <p className="text-sm text-muted-foreground mb-6 max-w-xs">
                Watch how Kubilitics takes you from kubeconfig to dashboard in seconds
              </p>
              <Button onClick={startDemo} className="gap-2">
                <Play className="h-4 w-4" />
                Start Demo
              </Button>
            </motion.div>
          )}

          {/* Uploading State */}
          {step === 'uploading' && (
            <motion.div
              key="uploading"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex-1 flex flex-col items-center justify-center"
            >
              <div className="p-4 rounded-2xl bg-primary/10 mb-4">
                <Upload className="h-8 w-8 text-primary animate-pulse" />
              </div>
              <h3 className="font-semibold mb-2">Uploading Kubeconfig</h3>
              <p className="text-sm text-muted-foreground mb-4">~/.kube/config</p>
              <div className="w-full max-w-xs">
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-muted-foreground text-center mt-2">{progress}%</p>
              </div>
            </motion.div>
          )}

          {/* Parsing State */}
          {step === 'parsing' && (
            <motion.div
              key="parsing"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex-1 flex flex-col items-center justify-center"
            >
              <div className="p-4 rounded-2xl bg-primary/10 mb-4">
                <FileText className="h-8 w-8 text-primary animate-pulse" />
              </div>
              <h3 className="font-semibold mb-2">Parsing Configuration</h3>
              <p className="text-sm text-muted-foreground mb-4">Validating YAML structure...</p>
              <div className="w-full max-w-xs">
                <Progress value={progress} className="h-2" />
              </div>
            </motion.div>
          )}

          {/* Detecting Clusters */}
          {step === 'detecting' && (
            <motion.div
              key="detecting"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex-1 flex flex-col items-center justify-center"
            >
              <div className="p-4 rounded-2xl bg-primary/10 mb-4">
                <Search className="h-8 w-8 text-primary animate-pulse" />
              </div>
              <h3 className="font-semibold mb-2">Detecting Clusters</h3>
              <div className="flex items-center gap-2 mt-4">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Scanning contexts...</span>
              </div>
            </motion.div>
          )}

          {/* Health Check */}
          {(step === 'health-check' || step === 'cluster-selection') && (
            <motion.div
              key="health-check"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex-1"
            >
              <div className="text-center mb-4">
                <h3 className="font-semibold">
                  {step === 'health-check' ? 'Checking Cluster Health' : 'Select Cluster'}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {step === 'health-check' ? 'Verifying connectivity...' : 'Choose your primary cluster'}
                </p>
              </div>
              <div className="space-y-2">
                {clusters.map((cluster) => (
                  <div
                    key={cluster.id}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border transition-all",
                      selectedCluster === cluster.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-muted/30'
                    )}
                  >
                    <span className="text-xl">{cluster.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{cluster.name}</span>
                        <Badge variant="outline" className="text-[10px]">{cluster.provider}</Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{cluster.version}</span>
                        <span>•</span>
                        <span>{cluster.nodes} nodes</span>
                      </div>
                    </div>
                    <div>
                      {cluster.status === 'checking' ? (
                        <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
                      ) : cluster.status === 'healthy' ? (
                        <CheckCircle2 className="h-5 w-5 text-success" />
                      ) : (
                        <div className="h-5 w-5 rounded-full bg-warning flex items-center justify-center">
                          <span className="text-[10px] text-white font-bold">!</span>
                        </div>
                      )}
                    </div>
                    {selectedCluster === cluster.id && (
                      <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Namespace Fetch */}
          {step === 'namespace-fetch' && (
            <motion.div
              key="namespace-fetch"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex-1 flex flex-col items-center justify-center"
            >
              <div className="p-4 rounded-2xl bg-primary/10 mb-4">
                <FolderOpen className="h-8 w-8 text-primary animate-pulse" />
              </div>
              <h3 className="font-semibold mb-2">Fetching Namespaces</h3>
              <p className="text-sm text-muted-foreground mb-4">From production-eks cluster...</p>
              <div className="w-full max-w-xs">
                <Progress value={progress} className="h-2" />
              </div>
            </motion.div>
          )}

          {/* Namespace Selection */}
          {step === 'namespace-selection' && (
            <motion.div
              key="namespace-selection"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex-1"
            >
              <div className="text-center mb-4">
                <h3 className="font-semibold">Select Default Namespace</h3>
                <p className="text-sm text-muted-foreground">
                  Found {demoNamespaces.length} namespaces in cluster
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {demoNamespaces.map((ns) => (
                  <div
                    key={ns.name}
                    className={cn(
                      "flex items-center justify-between p-2.5 rounded-lg border transition-all",
                      selectedNamespace === ns.name
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-muted/30'
                    )}
                  >
                    <div>
                      <span className="text-sm font-medium">{ns.name}</span>
                      <p className="text-xs text-muted-foreground">{ns.pods} pods</p>
                    </div>
                    {selectedNamespace === ns.name && (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Connecting */}
          {step === 'connecting' && (
            <motion.div
              key="connecting"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex-1 flex flex-col items-center justify-center"
            >
              <div className="p-4 rounded-2xl bg-primary/10 mb-4">
                <Globe className="h-8 w-8 text-primary animate-pulse" />
              </div>
              <h3 className="font-semibold mb-2">Launching Dashboard</h3>
              <p className="text-sm text-muted-foreground mb-4">
                production-eks / production
              </p>
              <div className="w-full max-w-xs">
                <Progress value={progress} className="h-2" />
              </div>
            </motion.div>
          )}

          {/* Complete */}
          {step === 'complete' && (
            <motion.div
              key="complete"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex-1 flex flex-col items-center justify-center text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 200, delay: 0.1 }}
                className="p-4 rounded-full bg-success/10 mb-4"
              >
                <CheckCircle2 className="h-10 w-10 text-success" />
              </motion.div>
              <h3 className="text-lg font-semibold mb-2">Welcome to Kubilitics!</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Connected to <span className="font-medium text-foreground">production-eks</span>
                <br />
                Default namespace: <span className="font-medium text-foreground">production</span>
              </p>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Server className="h-3.5 w-3.5" />
                  12 nodes
                </div>
                <div className="flex items-center gap-1.5">
                  <Database className="h-3.5 w-3.5" />
                  45 pods
                </div>
                <div className="flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5" />
                  Healthy
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={resetDemo} className="mt-6 gap-2">
                <RotateCcw className="h-3.5 w-3.5" />
                Replay Demo
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer Progress */}
        {step !== 'idle' && step !== 'complete' && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{stepLabels[step]}</span>
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                Processing...
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
