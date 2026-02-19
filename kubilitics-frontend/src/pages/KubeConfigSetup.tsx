import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Upload, CheckCircle2, XCircle, Server, ArrowRight, ChevronRight, Loader2 } from 'lucide-react';
import { KubernetesLogo } from '@/components/icons/KubernetesIcons';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useKubeConfigStore, parseKubeConfig, validateKubeConfig, ParsedCluster } from '@/stores/kubeConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { addClusterWithUpload } from '@/services/backendApiClient';
import { backendClusterToCluster } from '@/lib/backendClusterAdapter';
import { toast } from 'sonner';

type Step = 'upload' | 'validating' | 'select' | 'connecting';

export default function KubeConfigSetup() {
  const navigate = useNavigate();
  const { setKubeConfig, parsedClusters, selectCluster, setAuthenticated } = useKubeConfigStore();
  const { setDemo, setClusters, setActiveCluster } = useClusterStore();
  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const setCurrentClusterId = useBackendConfigStore((s) => s.setCurrentClusterId);

  const [step, setStep] = useState<Step>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  /** P2-12: Raw kubeconfig content for addClusterWithUpload when backend is configured. */
  const [rawKubeconfigContent, setRawKubeconfigContent] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleFile = async (file: File) => {
    setStep('validating');
    setErrors([]);
    setProgress(0);

    try {
      const content = await file.text();
      
      // Simulate progress
      for (let i = 0; i <= 50; i += 10) {
        await new Promise((r) => setTimeout(r, 100));
        setProgress(i);
      }

      const config = parseKubeConfig(content);
      const validation = validateKubeConfig(config);

      for (let i = 50; i <= 100; i += 10) {
        await new Promise((r) => setTimeout(r, 100));
        setProgress(i);
      }

      if (!validation.valid) {
        setErrors(validation.errors);
        setStep('upload');
        return;
      }

      setKubeConfig(config);
      setRawKubeconfigContent(content);
      setStep('select');
    } catch (error) {
      setErrors(['Failed to parse kubeconfig file. Please check the file format.']);
      setStep('upload');
    }
  };

  const handleSelectCluster = (cluster: ParsedCluster) => {
    setSelectedClusterId(cluster.id);
  };

  const handleConnect = async () => {
    if (!selectedClusterId) return;
    setStep('connecting');
    setIsConnecting(true);
    setDemo(false);

    if (isBackendConfigured && backendBaseUrl?.trim() && rawKubeconfigContent) {
      try {
        const base64 = btoa(unescape(encodeURIComponent(rawKubeconfigContent)));
        const result = await addClusterWithUpload(backendBaseUrl, base64, selectedClusterId);
        const cluster = backendClusterToCluster(result);
        setCurrentClusterId(result.id);
        setClusters([cluster]);
        setActiveCluster(cluster);
        setAuthenticated(true);
        toast.success('Connected to cluster', { description: result.name });
        navigate('/home', { replace: true });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to add cluster');
        setStep('select');
      } finally {
        setIsConnecting(false);
      }
      return;
    }

    selectCluster(selectedClusterId);
    setAuthenticated(true);
    setIsConnecting(false);
    navigate('/connect');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 py-12">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mb-12"
        >
          <div className="flex items-center gap-3">
            <KubernetesLogo size={32} className="text-primary" />
            <span className="text-xl font-semibold">Kubilitics Setup</span>
          </div>
          <Button variant="ghost" onClick={() => navigate('/')}>
            Cancel
          </Button>
        </motion.div>

        {/* Progress Steps */}
        <div className="max-w-2xl mx-auto mb-12">
          <div className="flex items-center justify-center gap-4">
            {['Upload', 'Select Cluster', 'Connect'].map((label, i) => {
              const stepIndex = ['upload', 'validating'].includes(step) ? 0 : step === 'select' ? 1 : 2;
              const isActive = i === stepIndex;
              const isComplete = i < stepIndex;

              return (
                <div key={label} className="flex items-center gap-2">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                      isComplete
                        ? 'bg-primary text-primary-foreground'
                        : isActive
                        ? 'bg-primary/20 text-primary border-2 border-primary'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {isComplete ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                  </div>
                  <span className={`text-sm font-medium ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {label}
                  </span>
                  {i < 2 && <ChevronRight className="h-4 w-4 text-muted-foreground mx-2" />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="max-w-2xl mx-auto">
          {/* Upload Step */}
          {(step === 'upload' || step === 'validating') && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <div className="text-center mb-8">
                <h1 className="text-2xl font-bold mb-2">Upload Kubeconfig</h1>
                <p className="text-muted-foreground">
                  Drag and drop your kubeconfig file to get started
                </p>
              </div>

              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`
                  relative rounded-2xl border-2 border-dashed p-16 transition-all duration-300 text-center
                  ${step === 'validating' ? 'pointer-events-none' : ''}
                  ${isDragging
                    ? 'border-primary bg-primary/5 scale-[1.02]'
                    : 'border-border bg-card hover:border-primary/50'
                  }
                `}
              >
                {step === 'validating' ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center gap-3">
                      <Server className="h-6 w-6 text-primary animate-pulse" />
                      <span className="text-lg font-medium">Validating kubeconfig...</span>
                    </div>
                    <Progress value={progress} className="max-w-xs mx-auto" />
                  </div>
                ) : (
                  <>
                    <div className="p-4 rounded-2xl bg-primary/10 w-fit mx-auto mb-4">
                      <Upload className="h-8 w-8 text-primary" />
                    </div>
                    <p className="text-lg font-medium mb-2">Drop kubeconfig here</p>
                    <p className="text-sm text-muted-foreground mb-4">
                      or{' '}
                      <label className="text-primary hover:underline cursor-pointer">
                        browse files
                        <input
                          type="file"
                          className="hidden"
                          accept=".yaml,.yml,.config,*"
                          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                        />
                      </label>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Usually found at ~/.kube/config
                    </p>
                  </>
                )}
              </div>

              {errors.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 p-4 rounded-lg bg-destructive/10 border border-destructive/20"
                >
                  <div className="flex items-center gap-2 text-destructive mb-2">
                    <XCircle className="h-4 w-4" />
                    <span className="font-medium">Validation Failed</span>
                  </div>
                  <ul className="text-sm text-destructive/80 list-disc list-inside">
                    {errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </motion.div>
              )}
            </motion.div>
          )}

          {/* Select Cluster Step */}
          {step === 'select' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <div className="text-center mb-8">
                <h1 className="text-2xl font-bold mb-2">Select Cluster</h1>
                <p className="text-muted-foreground">
                  Choose which cluster to connect to
                </p>
              </div>

              <div className="space-y-3 mb-8">
                {parsedClusters.map((cluster) => (
                  <Card
                    key={cluster.id}
                    className={`cursor-pointer transition-all ${
                      selectedClusterId === cluster.id
                        ? 'ring-2 ring-primary border-primary'
                        : 'hover:border-primary/50'
                    }`}
                    onClick={() => handleSelectCluster(cluster)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4">
                        <div className="p-2 rounded-lg bg-primary/10">
                          <Server className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{cluster.name}</span>
                            <Badge variant="outline" className="text-xs">
                              {cluster.context}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground font-mono truncate">
                            {cluster.server}
                          </p>
                        </div>
                        {selectedClusterId === cluster.id && (
                          <CheckCircle2 className="h-5 w-5 text-primary" />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Button
                className="w-full"
                size="lg"
                disabled={!selectedClusterId || isConnecting}
                onClick={handleConnect}
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Connecting...
                  </>
                ) : (
                  <>
                    Connect to Cluster
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
              <p className="text-center mt-3">
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:text-foreground"
                  onClick={() => navigate('/setup/clusters')}
                >
                  Or choose from all contexts →
                </button>
              </p>
            </motion.div>
          )}

          {/* Connecting Step */}
          {step === 'connecting' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-16"
            >
              <div className="p-6 rounded-full bg-primary/10 w-fit mx-auto mb-6">
                <Server className="h-12 w-12 text-primary animate-pulse" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Connecting...</h2>
              <p className="text-muted-foreground">
                Establishing connection to your cluster
              </p>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
