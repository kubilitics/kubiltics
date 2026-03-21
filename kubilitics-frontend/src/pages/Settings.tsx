import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, RotateCcw, CheckCircle2, XCircle, Loader2, AlertTriangle, RefreshCw, Download, Palette, Keyboard, Info, Sun, Moon, Monitor, Server, Trash2, Plus, FolderKanban, Focus, Settings } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { getHealth, deleteCluster, getProjects, deleteProject, type BackendCluster, type BackendProject } from '@/services/backendApiClient';
import { useClustersFromBackend } from '@/hooks/useClustersFromBackend';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { useBackendCircuitOpen } from '@/hooks/useBackendCircuitOpen';
import { backendClusterToCluster } from '@/lib/backendClusterAdapter';
import { CreateProjectDialog } from '@/components/projects/CreateProjectDialog';
import { ProjectCard } from '@/components/projects/ProjectCard';
import { ProjectSettingsDialog } from '@/components/projects/ProjectSettingsDialog';
import { DEFAULT_BACKEND_BASE_URL } from '@/lib/backendConstants';
import { isTauri } from '@/lib/tauri';
import { useThemeStore, type Theme } from '@/stores/themeStore';
import { cn } from '@/lib/utils';

const settingsSchema = z.object({
  backendBaseUrl: z.string().url({ message: 'Please enter a valid URL' }),
});

interface DesktopInfo {
  app_version: string;
  backend_port: number;
  backend_version: string | null;
  backend_uptime_seconds: number | null;
  kubeconfig_path: string;
  app_data_dir: string;
}

interface AISidecarStatus {
  available: boolean;
  running: boolean;
  port: number;
}

export default function Settings() {
  // Backend config store (consolidated URL state)
  const {
    backendBaseUrl,
    setBackendBaseUrl,
  } = useBackendConfigStore();
  const effectiveBackendBaseUrl = useMemo(() => getEffectiveBackendBaseUrl(backendBaseUrl), [backendBaseUrl]);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const setCurrentClusterId = useBackendConfigStore((s) => s.setCurrentClusterId);
  const setActiveCluster = useClusterStore((s) => s.setActiveCluster);
  const setClusters = useClusterStore((s) => s.setClusters);
  const storeClusters = useClusterStore((s) => s.clusters);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: clustersFromBackend } = useClustersFromBackend();
  const clusters = useMemo(() => clustersFromBackend || [], [clustersFromBackend]);
  const currentClusterId = useActiveClusterId();
  const circuitOpen = useBackendCircuitOpen();

  const [clusterToRemove, setClusterToRemove] = useState<BackendCluster | null>(null);
  const [projectToRemove, setProjectToRemove] = useState<BackendProject | null>(null);
  const [settingsProject, setSettingsProject] = useState<any>(null);

  // Cluster delete mutation
  const deleteClusterMutation = useMutation({
    mutationFn: async (cluster: BackendCluster) => {
      await deleteCluster(effectiveBackendBaseUrl, cluster.id);
    },
    onSuccess: (_, cluster) => {
      queryClient.invalidateQueries({ queryKey: ['backend', 'clusters', effectiveBackendBaseUrl] });

      // Remove from Zustand store so header dropdown updates immediately
      const remainingStore = storeClusters.filter((c) => c.id !== cluster.id);
      setClusters(remainingStore);

      if (cluster.id === currentClusterId) {
        const remaining = clusters.filter((c) => c.id !== cluster.id);
        setCurrentClusterId(remaining[0]?.id ?? null);
        if (remaining[0]) setActiveCluster(backendClusterToCluster(remaining[0]));
      }
      setClusterToRemove(null);
      toast.success('Cluster removed');
    },
    onError: (err: Error) => toast.error(`Failed to remove cluster: ${err.message}`),
  });

  // Projects query — when disabled (circuit open / not configured), force isLoading to false
  // so the UI never gets stuck in an infinite loading spinner
  const shouldQueryProjects = isBackendConfigured && !circuitOpen;
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => getProjects(effectiveBackendBaseUrl),
    enabled: shouldQueryProjects,
  });
  const isProjectsLoading = shouldQueryProjects ? projectsQuery.isLoading : false;
  const projects = useMemo(() => projectsQuery.data || [], [projectsQuery.data]);

  // Project delete mutation
  const deleteProjectMutation = useMutation({
    mutationFn: async (project: BackendProject) => {
      await deleteProject(effectiveBackendBaseUrl, project.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setProjectToRemove(null);
      toast.success('Project removed');
    },
    onError: (err: Error) => toast.error(`Failed to remove project: ${err.message}`),
  });

  const [isTesting, setIsTesting] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<Record<string, 'success' | 'error' | null>>({});
  const [desktopInfo, setDesktopInfo] = useState<DesktopInfo | null>(null);
  const [aiStatus, setAiStatus] = useState<AISidecarStatus | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [analyticsConsent, setAnalyticsConsent] = useState<boolean | null>(null);
  const [isUpdatingAnalytics, setIsUpdatingAnalytics] = useState(false);
  // Use build-time constant first (timing-independent), fall back to runtime check
  const isDesktop = (typeof __VITE_IS_TAURI_BUILD__ !== 'undefined' && __VITE_IS_TAURI_BUILD__) || isTauri();

  const form = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      backendBaseUrl,
    },
  });

  useEffect(() => {
    if (isDesktop) {
      loadDesktopInfo();
      loadAIStatus();
      loadAnalyticsConsent();
    }
  }, [isDesktop]);

  async function loadAnalyticsConsent() {
    if (!isDesktop) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const consent = await invoke<boolean>('get_analytics_consent');
      setAnalyticsConsent(consent);
    } catch (error) {
      console.error('Failed to load analytics consent:', error);
    }
  }

  async function handleToggleAnalytics(enabled: boolean) {
    if (!isDesktop) return;
    setIsUpdatingAnalytics(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_analytics_consent', { consent: enabled });
      setAnalyticsConsent(enabled);
      toast.success(enabled ? 'Analytics enabled' : 'Analytics disabled');
    } catch (error) {
      toast.error(`Failed to update analytics setting: ${error}`);
    } finally {
      setIsUpdatingAnalytics(false);
    }
  }

  async function loadDesktopInfo() {
    if (!isDesktop) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const info = await invoke<DesktopInfo>('get_desktop_info');
      setDesktopInfo(info);
    } catch (error) {
      console.error('Failed to load desktop info:', error);
    }
  }

  async function loadAIStatus() {
    if (!isDesktop) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const status = await invoke<AISidecarStatus>('get_ai_status');
      setAiStatus(status);
    } catch (error) {
      console.error('Failed to load AI status:', error);
    }
  }

  async function handleRestartBackend() {
    if (!isDesktop) return;
    setIsRestarting(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('restart_sidecar');
      toast.success('Backend restarted successfully');
      setTimeout(() => {
        loadDesktopInfo();
        loadAIStatus();
      }, 2000);
    } catch (error) {
      toast.error(`Failed to restart backend: ${error}`);
    } finally {
      setIsRestarting(false);
    }
  }

  async function handleCheckForUpdates() {
    if (!isDesktop) return;
    setIsCheckingUpdate(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const update = await invoke<{ version: string } | null>('check_for_updates');
      if (update) {
        toast.success(`Update available: ${update.version}`, {
          action: {
            label: 'Install',
            onClick: async () => {
              try {
                const { invoke: invokeUpdate } = await import('@tauri-apps/api/core');
                await invokeUpdate('install_update');
                toast.success('Update installed. Please restart the application.');
              } catch (error) {
                toast.error(`Failed to install update: ${error}`);
              }
            },
          },
        });
      } else {
        toast.info('You are running the latest version');
      }
    } catch (error) {
      toast.error(`Failed to check for updates: ${error}`);
    } finally {
      setIsCheckingUpdate(false);
    }
  }

  function formatUptime(seconds: number | null): string {
    if (!seconds) return 'Unknown';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  async function testConnection(type: 'backend') {
    setIsTesting(type);
    setConnectionStatus((prev) => ({ ...prev, [type]: null }));

    try {
      const values = form.getValues();
      await getHealth(values.backendBaseUrl);
      setConnectionStatus((prev) => ({ ...prev, [type]: 'success' }));
      toast.success('Backend connection successful');
    } catch (error) {
      console.error(error);
      setConnectionStatus((prev) => ({ ...prev, [type]: 'error' }));
      toast.error('Could not connect to Backend');
    } finally {
      setIsTesting(null);
    }
  }

  function onSubmit(values: z.infer<typeof settingsSchema>) {
    const isChangingBackend = values.backendBaseUrl !== effectiveBackendBaseUrl;
    if (isChangingBackend) {
      const confirmed = window.confirm(
        'Changing the backend URL will reload the application and disconnect from all clusters.\n\nAre you sure you want to continue?'
      );
      if (!confirmed) return;
    }
    setBackendBaseUrl(values.backendBaseUrl);
    toast.success('Settings saved', {
      description: 'Reloading application to apply changes...',
    });
    setTimeout(() => {
      window.location.reload();
    }, 1500);
  }

  const handleReset = () => {
    setBackendBaseUrl(DEFAULT_BACKEND_BASE_URL);

    form.reset({
      backendBaseUrl: DEFAULT_BACKEND_BASE_URL,
    });

    toast.info('Restored default settings');
  };

  return (
    <div className="container max-w-4xl py-10 space-y-8">
      <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-card via-card to-primary/5 dark:from-slate-900 dark:via-slate-900/80 dark:to-primary/10 p-8 shadow-sm">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 dark:bg-primary/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
        <div className="relative flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 dark:bg-primary/20 shadow-sm">
            <Settings className="h-7 w-7 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Manage connections, appearance, and application configuration</p>
          </div>
        </div>
      </div>

      <Alert className="border-amber-200/60 bg-amber-50/50 dark:border-amber-500/20 dark:bg-amber-950/30">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <AlertTitle className="text-amber-800 dark:text-amber-300">Caution — Advanced Configuration</AlertTitle>
        <AlertDescription className="text-amber-700 dark:text-amber-400/80">
          Changing backend connection endpoints will reload the application. Only modify these if you know what you're doing.
        </AlertDescription>
      </Alert>

      {/* ─── Clusters ─── */}
      <Card className="dark:bg-slate-900/50 dark:border-slate-700/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                Clusters
              </CardTitle>
              <CardDescription>Manage your connected Kubernetes clusters.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate('/connect?addCluster=true')}>
              <Plus className="h-4 w-4 mr-1.5" />
              Add Cluster
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {clusters.length === 0 ? (
            <div className="text-center py-8">
              <Server className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No clusters connected</p>
              <Button className="mt-4" onClick={() => navigate('/connect?addCluster=true')}>
                <Plus className="h-4 w-4 mr-2" />
                Connect Cluster
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {clusters.map((cluster) => {
                const isActive = cluster.id === currentClusterId;
                return (
                  <div key={cluster.id} className={cn(
                    "flex items-center justify-between p-4 rounded-xl border transition-colors",
                    isActive ? "border-primary/30 bg-primary/5" : "border-border hover:border-border/80"
                  )}>
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={cn("h-2 w-2 rounded-full shrink-0", isActive ? "bg-primary" : "bg-emerald-500")} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{cluster.name}</span>
                          {isActive && <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded uppercase">Current</span>}
                        </div>
                        <span className="text-xs text-muted-foreground">{cluster.provider || 'Kubernetes'} · {cluster.node_count ?? 0} node{(cluster.node_count ?? 0) !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!isActive && (
                        <Button variant="outline" size="sm" onClick={() => {
                          setCurrentClusterId(cluster.id);
                          setActiveCluster(backendClusterToCluster(cluster));
                          toast.success(`Switched to ${cluster.name}`);
                        }}>
                          Switch
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setClusterToRemove(cluster)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Projects ─── */}
      <Card className="dark:bg-slate-900/50 dark:border-slate-700/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FolderKanban className="h-5 w-5" />
                Projects
              </CardTitle>
              <CardDescription>Organize workloads into logical groups with governance.</CardDescription>
            </div>
            <CreateProjectDialog>
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4 mr-1.5" />
                New Project
              </Button>
            </CreateProjectDialog>
          </div>
        </CardHeader>
        <CardContent>
          {isProjectsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading projects...</span>
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-8">
              <Focus className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No projects yet</p>
              <CreateProjectDialog>
                <Button className="mt-4">
                  <Plus className="h-4 w-4 mr-2" />
                  New Project
                </Button>
              </CreateProjectDialog>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onClick={() => navigate(`/projects/${project.id}/dashboard`)}
                  onSettingsClick={() => setSettingsProject(project)}
                  onDeleteClick={() => setProjectToRemove(project)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-amber-200/40 dark:border-amber-500/20 dark:bg-slate-900/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-5 w-5" />
            Connection Endpoints
          </CardTitle>
          <CardDescription>
            Manage the URL for the Core Backend. <span className="font-medium text-amber-600 dark:text-amber-500">Changing these will reload the app.</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* Backend URL */}
              <FormField
                control={form.control}
                name="backendBaseUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Core Backend URL</FormLabel>
                    <div className="flex gap-2">
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => testConnection('backend')}
                        disabled={!!isTesting}
                      >
                        {isTesting === 'backend' ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : connectionStatus.backend === 'success' ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : connectionStatus.backend === 'error' ? (
                          <XCircle className="h-4 w-4 text-red-500" />
                        ) : (
                          <RotateCcw className="h-4 w-4" /> // Using RotateCcw as "Test" icon proxy or verify icon
                        )}
                      </Button>
                    </div>
                    <FormDescription>
                      The URL where the Kubilitics Core Go backend is running (default port 819).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-between pt-4">
                <Button type="button" variant="ghost" onClick={handleReset}>
                  Reset to Defaults
                </Button>
                <Button type="submit">
                  <Save className="mr-2 h-4 w-4" />
                  Save Changes
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* ─── Appearance ─── */}
      <AppearanceSection />

      {/* ─── Keyboard Shortcuts ─── */}
      <KeyboardShortcutsSection />

      {isDesktop && (
        <Card className="dark:bg-slate-900/50 dark:border-slate-700/50">
          <CardHeader>
            <CardTitle>Desktop Settings</CardTitle>
            <CardDescription>
              Desktop-specific configuration and status information.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* App Version */}
            {desktopInfo && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">App Version</p>
                    <p className="text-sm">{desktopInfo.app_version}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Backend Port</p>
                    <p className="text-sm">{desktopInfo.backend_port}</p>
                  </div>
                  {desktopInfo.backend_version && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Backend Version</p>
                      <p className="text-sm">{desktopInfo.backend_version}</p>
                    </div>
                  )}
                  {desktopInfo.backend_uptime_seconds !== null && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Backend Uptime</p>
                      <p className="text-sm">{formatUptime(desktopInfo.backend_uptime_seconds)}</p>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Kubeconfig Path</p>
                  <p className="text-sm font-mono break-all">{desktopInfo.kubeconfig_path}</p>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">App Data Directory</p>
                  <p className="text-sm font-mono break-all">{desktopInfo.app_data_dir}</p>
                </div>
              </div>
            )}

            {/* AI Backend Status */}
            {aiStatus && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">AI Backend Status</p>
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${aiStatus.running ? 'bg-green-500' : aiStatus.available ? 'bg-yellow-500' : 'bg-gray-400'}`} />
                  <p className="text-sm">
                    {aiStatus.running
                      ? `Running on port ${aiStatus.port}`
                      : aiStatus.available
                        ? 'Stopped (available)'
                        : 'Not bundled'}
                  </p>
                </div>
              </div>
            )}

            {/* Analytics Consent */}
            <div className="space-y-2 pt-4 border-t">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Analytics & Usage Data</p>
                  <p className="text-xs text-muted-foreground">
                    Help improve Kubilitics by sharing anonymous usage data
                  </p>
                </div>
                {analyticsConsent !== null && (
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-muted-foreground">
                      {analyticsConsent ? 'Enabled' : 'Disabled'}
                    </span>
                    <Button
                      type="button"
                      variant={analyticsConsent ? "destructive" : "default"}
                      size="sm"
                      onClick={() => handleToggleAnalytics(!analyticsConsent)}
                      disabled={isUpdatingAnalytics}
                    >
                      {isUpdatingAnalytics ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : analyticsConsent ? (
                        'Disable'
                      ) : (
                        'Enable'
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={handleRestartBackend}
                disabled={isRestarting}
              >
                {isRestarting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Restarting...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Restart Backend
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleCheckForUpdates}
                disabled={isCheckingUpdate}
              >
                {isCheckingUpdate ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Checking...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    Check for Updates
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── About ─── */}
      <AboutSection />

      {/* Cluster Remove Dialog */}
      <AlertDialog open={!!clusterToRemove} onOpenChange={(open) => !open && setClusterToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove cluster?</AlertDialogTitle>
            <AlertDialogDescription>
              This will unregister <strong>{clusterToRemove?.name}</strong> from Kubilitics. This does not modify your kubeconfig file.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteClusterMutation.isPending}>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={() => clusterToRemove && deleteClusterMutation.mutate(clusterToRemove)} disabled={deleteClusterMutation.isPending}>
              {deleteClusterMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Removing...</> : 'Remove'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Project Delete Dialog */}
      <AlertDialog open={!!projectToRemove} onOpenChange={(open) => !open && setProjectToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              All cluster associations and resource links for <strong>{projectToRemove?.name}</strong> will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteProjectMutation.isPending}>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={() => projectToRemove && deleteProjectMutation.mutate(projectToRemove)} disabled={deleteProjectMutation.isPending}>
              {deleteProjectMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Deleting...</> : 'Confirm Delete'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {settingsProject && (
        <ProjectSettingsDialog
          project={settingsProject}
          open={!!settingsProject}
          onOpenChange={(open) => !open && setSettingsProject(null)}
        />
      )}
    </div>
  );
}

/* ─── Appearance Section ──────────────────────────────────── */

const themeOptions: { value: Theme; icon: typeof Sun; label: string }[] = [
  { value: 'light', icon: Sun, label: 'Light' },
  { value: 'dark', icon: Moon, label: 'Dark' },
  { value: 'system', icon: Monitor, label: 'System' },
];

function AppearanceSection() {
  const { theme, setTheme } = useThemeStore();
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    // Check system preference for reduced motion
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mq.matches);
  }, []);

  const handleReduceMotion = (enabled: boolean) => {
    setReduceMotion(enabled);
    document.documentElement.classList.toggle('reduce-motion', enabled);
    toast.success(enabled ? 'Animations reduced' : 'Animations restored');
  };

  return (
    <Card className="dark:bg-slate-900/50 dark:border-slate-700/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="h-5 w-5" />
          Appearance
        </CardTitle>
        <CardDescription>
          Customize the look and feel of Kubilitics.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Theme Selection */}
        <div className="space-y-3">
          <label className="text-sm font-medium">Theme</label>
          <div className="grid grid-cols-3 gap-3">
            {themeOptions.map(({ value, icon: Icon, label }) => (
              <button
                key={value}
                onClick={() => {
                  setTheme(value);
                  toast.success(`Theme set to ${label}`);
                }}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all press-effect',
                  theme === value
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border hover:border-primary/40 hover:bg-muted/50 text-muted-foreground'
                )}
                aria-pressed={theme === value}
                aria-label={`Set theme to ${label}`}
              >
                <Icon className="h-6 w-6" />
                <span className="text-sm font-medium">{label}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            System theme follows your operating system's light/dark preference.
          </p>
        </div>

        {/* Reduce Motion */}
        <div className="flex items-center justify-between space-x-2 rounded-lg border p-4">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">Reduce Motion</div>
            <div className="text-xs text-muted-foreground">
              Minimize animations for accessibility or preference
            </div>
          </div>
          <Switch checked={reduceMotion} onCheckedChange={handleReduceMotion} />
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Keyboard Shortcuts Section ──────────────────────────── */

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
const mod = isMac ? '⌘' : 'Ctrl';

const shortcuts: { category: string; items: { keys: string; description: string }[] }[] = [
  {
    category: 'Navigation',
    items: [
      { keys: `${mod}+K`, description: 'Open command palette / search' },
      { keys: `${mod}+B`, description: 'Toggle sidebar' },
      { keys: 'G then P', description: 'Go to Pods' },
      { keys: 'G then N', description: 'Go to Nodes' },
      { keys: '/', description: 'Focus search' },
    ],
  },
  {
    category: 'Actions',
    items: [
      { keys: 'Escape', description: 'Close dialog / deselect' },
      { keys: `${mod}+Enter`, description: 'Submit form / confirm action' },
      { keys: `${mod}+.`, description: 'Toggle AI assistant' },
    ],
  },
];

function KeyboardShortcutsSection() {
  return (
    <Card className="dark:bg-slate-900/50 dark:border-slate-700/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Keyboard className="h-5 w-5" />
          Keyboard Shortcuts
        </CardTitle>
        <CardDescription>
          Navigate faster with keyboard shortcuts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {shortcuts.map(({ category, items }) => (
          <div key={category} className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground">{category}</h4>
            <div className="space-y-2">
              {items.map(({ keys, description }) => (
                <div key={keys} className="flex items-center justify-between rounded-lg border px-4 py-2.5">
                  <span className="text-sm">{description}</span>
                  <kbd className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs font-mono text-muted-foreground">
                    {keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ─── About Section ───────────────────────────────────────── */

function AboutSection() {
  return (
    <Card className="dark:bg-slate-900/50 dark:border-slate-700/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Info className="h-5 w-5" />
          About Kubilitics
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="font-medium text-muted-foreground">Product</p>
            <p>Kubilitics — Kubernetes, Made Human</p>
          </div>
          <div>
            <p className="font-medium text-muted-foreground">Version</p>
            <p>1.0.0</p>
          </div>
          <div>
            <p className="font-medium text-muted-foreground">Platform</p>
            <p>{typeof __VITE_IS_TAURI_BUILD__ !== 'undefined' && __VITE_IS_TAURI_BUILD__ ? 'Desktop (Tauri)' : 'Browser'}</p>
          </div>
          <div>
            <p className="font-medium text-muted-foreground">License</p>
            <p>Proprietary</p>
          </div>
        </div>
        <div className="pt-4 border-t">
          <p className="text-xs text-muted-foreground leading-relaxed">
            AI-powered Kubernetes operating system with topology visualization, intelligent
            investigation, and offline-first desktop experience. Built for platform engineers,
            SREs, and DevOps teams who want deep visibility into their clusters.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
