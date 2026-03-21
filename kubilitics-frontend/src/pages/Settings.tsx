import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, RotateCcw, CheckCircle2, XCircle, Loader2, AlertTriangle, RefreshCw, Download, Palette, Keyboard, Info, Sun, Moon, Monitor, Server, Trash2, Plus, FolderKanban, Focus, Settings as SettingsIcon } from 'lucide-react';
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
  // Backend config store — use individual selectors to avoid subscribing to entire store
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const setBackendBaseUrl = useBackendConfigStore((s) => s.setBackendBaseUrl);
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
    <div className="container max-w-4xl py-8 space-y-6">
      {/* ─── Hero Header ─── */}
      <div className="relative overflow-hidden rounded-2xl border border-border/40 bg-gradient-to-br from-slate-50 via-white to-blue-50/80 dark:from-slate-900 dark:via-slate-900/95 dark:to-blue-950/30 shadow-sm">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-100/40 via-transparent to-transparent dark:from-blue-900/20" />
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-blue-400" />
        <div className="relative px-8 py-7 flex items-center gap-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/20">
            <SettingsIcon className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Settings</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Manage connections, clusters, and application preferences</p>
          </div>
        </div>
      </div>

      {/* ─── Clusters ─── */}
      <div className="rounded-2xl border border-emerald-200/60 bg-card overflow-hidden shadow-sm dark:bg-slate-900/60 dark:border-emerald-800/30">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-emerald-400/60 rounded-t-2xl" />
        <div className="px-6 py-5 border-b border-emerald-100/60 bg-gradient-to-r from-emerald-50/40 to-transparent dark:border-emerald-900/20 dark:from-emerald-950/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/40 shadow-sm shadow-emerald-200/50 dark:shadow-none">
                <Server className="h-4.5 w-4.5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Clusters</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{clusters.length} connected cluster{clusters.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="rounded-lg h-8 text-xs" onClick={() => navigate('/connect?addCluster=true')}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Cluster
            </Button>
          </div>
        </div>
        <div className="p-4">
          {clusters.length === 0 ? (
            <div className="text-center py-10">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/60 mx-auto mb-3">
                <Server className="h-6 w-6 text-muted-foreground/60" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">No clusters connected</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Connect a Kubernetes cluster to get started</p>
              <Button size="sm" className="mt-4 rounded-lg" onClick={() => navigate('/connect?addCluster=true')}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Connect Cluster
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {clusters.map((cluster) => {
                const isActive = cluster.id === currentClusterId;
                return (
                  <div key={cluster.id} className={cn(
                    "group flex items-center justify-between px-4 py-3.5 rounded-xl border transition-all duration-150",
                    isActive
                      ? "border-blue-200 bg-gradient-to-r from-blue-50/80 to-indigo-50/40 dark:border-blue-800/40 dark:from-blue-950/30 dark:to-indigo-950/20 shadow-sm"
                      : "border-border/40 bg-muted/10 hover:bg-muted/30 dark:border-slate-700/40"
                  )}>
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      <div className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-lg shrink-0",
                        isActive ? "bg-blue-100 dark:bg-blue-900/40" : "bg-muted/60 dark:bg-slate-800/60"
                      )}>
                        <Server className={cn("h-4 w-4", isActive ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground")} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{cluster.name}</span>
                          {isActive && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/50 px-1.5 py-0.5 rounded-md uppercase tracking-wider">
                              <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                              Active
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-xs text-muted-foreground">{cluster.provider || 'Kubernetes'}</span>
                          <span className="text-muted-foreground/40">·</span>
                          <span className="text-xs text-muted-foreground">{cluster.node_count ?? 0} node{(cluster.node_count ?? 0) !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!isActive && (
                        <Button variant="outline" size="sm" className="h-7 text-xs rounded-lg border-blue-200 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/40" onClick={() => {
                          setCurrentClusterId(cluster.id);
                          setActiveCluster(backendClusterToCluster(cluster));
                          toast.success(`Switched to ${cluster.name}`);
                        }}>
                          Switch
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground/50 hover:text-destructive" onClick={() => setClusterToRemove(cluster)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ─── Projects ─── */}
      <div className="rounded-2xl border border-violet-200/60 bg-card overflow-hidden shadow-sm dark:bg-slate-900/60 dark:border-violet-800/30">
        <div className="px-6 py-5 border-b border-violet-100/60 bg-gradient-to-r from-violet-50/40 to-transparent dark:border-violet-900/20 dark:from-violet-950/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/40 shadow-sm shadow-violet-200/50 dark:shadow-none">
                <FolderKanban className="h-4.5 w-4.5 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Projects</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Organize workloads into logical groups</p>
              </div>
            </div>
            <CreateProjectDialog>
              <Button variant="outline" size="sm" className="rounded-lg h-8 text-xs">
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                New Project
              </Button>
            </CreateProjectDialog>
          </div>
        </div>
        <div className="p-4">
          {isProjectsLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/60" />
              <span className="ml-2.5 text-sm text-muted-foreground">Loading projects...</span>
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-10">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/60 mx-auto mb-3">
                <FolderKanban className="h-6 w-6 text-muted-foreground/60" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">No projects yet</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Create a project to organize cluster workloads</p>
              <CreateProjectDialog>
                <Button size="sm" className="mt-4 rounded-lg">
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Create Project
                </Button>
              </CreateProjectDialog>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        </div>
      </div>

      {/* ─── Connection Endpoints ─── */}
      <div className="rounded-2xl border border-amber-200/50 bg-card overflow-hidden shadow-sm dark:border-amber-800/30 dark:bg-slate-900/60">
        <div className="px-6 py-5 border-b border-amber-200/40 dark:border-amber-800/20 bg-amber-50/30 dark:bg-amber-950/10">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/40">
              <AlertTriangle className="h-4.5 w-4.5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-300">Connection Endpoints</h2>
              <p className="text-xs text-amber-600/80 dark:text-amber-400/70 mt-0.5">Changing these will reload the application</p>
            </div>
          </div>
        </div>
        <div className="p-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="backendBaseUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Core Backend URL</FormLabel>
                    <div className="flex gap-2 mt-1.5">
                      <FormControl>
                        <Input {...field} className="rounded-lg h-10 font-mono text-sm" />
                      </FormControl>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-10 w-10 rounded-lg shrink-0"
                        onClick={() => testConnection('backend')}
                        disabled={!!isTesting}
                      >
                        {isTesting === 'backend' ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : connectionStatus.backend === 'success' ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        ) : connectionStatus.backend === 'error' ? (
                          <XCircle className="h-4 w-4 text-red-500" />
                        ) : (
                          <RotateCcw className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <FormDescription className="text-xs">
                      The URL where the Kubilitics Core Go backend is running (default port 819).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-between pt-3 border-t border-border/30">
                <Button type="button" variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={handleReset}>
                  Reset to Defaults
                </Button>
                <Button type="submit" size="sm" className="rounded-lg">
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                  Save Changes
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </div>

      {/* ─── Appearance ─── */}
      <AppearanceSection />

      {/* ─── Keyboard Shortcuts ─── */}
      <KeyboardShortcutsSection />

      {isDesktop && (
        <div className="rounded-2xl border border-border/40 bg-card overflow-hidden shadow-sm dark:bg-slate-900/60 dark:border-slate-700/50">
          <div className="px-6 py-5 border-b border-border/40 dark:border-slate-700/40">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800/60">
                <Monitor className="h-4.5 w-4.5 text-slate-600 dark:text-slate-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Desktop</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Desktop-specific configuration and status</p>
              </div>
            </div>
          </div>
          <div className="p-6 space-y-5">
            {desktopInfo && (
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'App Version', value: desktopInfo.app_version },
                  { label: 'Backend Port', value: String(desktopInfo.backend_port) },
                  ...(desktopInfo.backend_version ? [{ label: 'Backend Version', value: desktopInfo.backend_version }] : []),
                  ...(desktopInfo.backend_uptime_seconds !== null ? [{ label: 'Backend Uptime', value: formatUptime(desktopInfo.backend_uptime_seconds) }] : []),
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg border border-border/40 bg-muted/20 px-4 py-3">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
                    <p className="text-sm font-medium mt-1">{value}</p>
                  </div>
                ))}
              </div>
            )}

            {desktopInfo && (
              <div className="space-y-3">
                {[
                  { label: 'Kubeconfig Path', value: desktopInfo.kubeconfig_path },
                  { label: 'App Data Directory', value: desktopInfo.app_data_dir },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg border border-border/40 bg-muted/20 px-4 py-3">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
                    <p className="text-xs font-mono text-foreground/80 mt-1.5 break-all">{value}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Analytics Consent */}
            <div className="flex items-center justify-between rounded-lg border border-border/40 px-4 py-3.5">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Analytics & Usage Data</p>
                <p className="text-xs text-muted-foreground">Help improve Kubilitics by sharing anonymous usage data</p>
              </div>
              {analyticsConsent !== null && (
                <Switch
                  checked={analyticsConsent}
                  onCheckedChange={(checked) => handleToggleAnalytics(checked)}
                  disabled={isUpdatingAnalytics}
                />
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-3 border-t border-border/30">
              <Button type="button" variant="outline" size="sm" className="rounded-lg text-xs" onClick={handleRestartBackend} disabled={isRestarting}>
                {isRestarting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                {isRestarting ? 'Restarting...' : 'Restart Backend'}
              </Button>
              <Button type="button" variant="outline" size="sm" className="rounded-lg text-xs" onClick={handleCheckForUpdates} disabled={isCheckingUpdate}>
                {isCheckingUpdate ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
                {isCheckingUpdate ? 'Checking...' : 'Check for Updates'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ─── About ─── */}
      <AboutSection />

      {/* Cluster Remove Dialog */}
      <AlertDialog open={!!clusterToRemove} onOpenChange={(open) => !open && setClusterToRemove(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove cluster?</AlertDialogTitle>
            <AlertDialogDescription>
              This will unregister <strong>{clusterToRemove?.name}</strong> from Kubilitics. This does not modify your kubeconfig file.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteClusterMutation.isPending} className="rounded-lg">Cancel</AlertDialogCancel>
            <Button variant="destructive" className="rounded-lg" onClick={() => clusterToRemove && deleteClusterMutation.mutate(clusterToRemove)} disabled={deleteClusterMutation.isPending}>
              {deleteClusterMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Removing...</> : 'Remove'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Project Delete Dialog */}
      <AlertDialog open={!!projectToRemove} onOpenChange={(open) => !open && setProjectToRemove(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              All cluster associations and resource links for <strong>{projectToRemove?.name}</strong> will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteProjectMutation.isPending} className="rounded-lg">Cancel</AlertDialogCancel>
            <Button variant="destructive" className="rounded-lg" onClick={() => projectToRemove && deleteProjectMutation.mutate(projectToRemove)} disabled={deleteProjectMutation.isPending}>
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
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mq.matches);
  }, []);

  const handleReduceMotion = (enabled: boolean) => {
    setReduceMotion(enabled);
    document.documentElement.classList.toggle('reduce-motion', enabled);
    toast.success(enabled ? 'Animations reduced' : 'Animations restored');
  };

  return (
    <div className="rounded-2xl border border-pink-200/60 bg-card overflow-hidden shadow-sm dark:bg-slate-900/60 dark:border-pink-800/30">
      <div className="px-6 py-5 border-b border-pink-100/60 bg-gradient-to-r from-pink-50/40 to-transparent dark:border-pink-900/20 dark:from-pink-950/20">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-pink-100 dark:bg-pink-900/40 shadow-sm shadow-pink-200/50 dark:shadow-none">
            <Palette className="h-4.5 w-4.5 text-pink-600 dark:text-pink-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Appearance</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Customize the look and feel</p>
          </div>
        </div>
      </div>
      <div className="p-6 space-y-5">
        <div className="space-y-3">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Theme</label>
          <div className="grid grid-cols-3 gap-3">
            {themeOptions.map(({ value, icon: Icon, label }) => (
              <button
                key={value}
                onClick={() => {
                  setTheme(value);
                  toast.success(`Theme set to ${label}`);
                }}
                className={cn(
                  'flex flex-col items-center gap-2.5 rounded-xl border-2 p-5 transition-all duration-150',
                  theme === value
                    ? 'border-blue-400 bg-blue-50/60 text-blue-700 shadow-sm dark:border-blue-500/50 dark:bg-blue-950/30 dark:text-blue-300'
                    : 'border-border/60 hover:border-border hover:bg-muted/40 text-muted-foreground'
                )}
                aria-pressed={theme === value}
                aria-label={`Set theme to ${label}`}
              >
                <Icon className="h-5 w-5" />
                <span className="text-xs font-semibold">{label}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground/70">
            System theme follows your operating system's light/dark preference.
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border/40 px-4 py-3.5">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">Reduce Motion</div>
            <div className="text-xs text-muted-foreground">Minimize animations for accessibility</div>
          </div>
          <Switch checked={reduceMotion} onCheckedChange={handleReduceMotion} />
        </div>
      </div>
    </div>
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
    <div className="rounded-2xl border border-sky-200/60 bg-card overflow-hidden shadow-sm dark:bg-slate-900/60 dark:border-sky-800/30">
      <div className="px-6 py-5 border-b border-sky-100/60 bg-gradient-to-r from-sky-50/40 to-transparent dark:border-sky-900/20 dark:from-sky-950/20">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/40 shadow-sm shadow-sky-200/50 dark:shadow-none">
            <Keyboard className="h-4.5 w-4.5 text-sky-600 dark:text-sky-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Keyboard Shortcuts</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Navigate faster with keyboard shortcuts</p>
          </div>
        </div>
      </div>
      <div className="p-6 space-y-5">
        {shortcuts.map(({ category, items }) => (
          <div key={category} className="space-y-2">
            <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{category}</h4>
            <div className="rounded-xl border border-border/40 overflow-hidden divide-y divide-border/30">
              {items.map(({ keys, description }) => (
                <div key={keys} className="flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors">
                  <span className="text-sm text-foreground/90">{description}</span>
                  <kbd className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/50 px-2 py-1 text-[11px] font-mono text-muted-foreground shadow-sm">
                    {keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── About Section ───────────────────────────────────────── */

function AboutSection() {
  return (
    <div className="rounded-2xl border border-indigo-200/50 bg-card overflow-hidden shadow-sm dark:bg-slate-900/60 dark:border-indigo-800/30">
      <div className="px-6 py-5 border-b border-indigo-100/50 bg-gradient-to-r from-indigo-50/30 to-transparent dark:border-indigo-900/20 dark:from-indigo-950/15">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/40 shadow-sm shadow-indigo-200/50 dark:shadow-none">
            <Info className="h-4.5 w-4.5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">About Kubilitics</h2>
            <p className="text-xs text-muted-foreground mt-0.5">System information</p>
          </div>
        </div>
      </div>
      <div className="p-6">
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Product', value: 'Kubilitics' },
            { label: 'Version', value: '1.0.0' },
            { label: 'Platform', value: typeof __VITE_IS_TAURI_BUILD__ !== 'undefined' && __VITE_IS_TAURI_BUILD__ ? 'Desktop (Tauri)' : 'Browser' },
            { label: 'License', value: 'Proprietary' },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-lg border border-border/40 bg-muted/20 px-4 py-3">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
              <p className="text-sm font-medium mt-1">{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t border-border/30">
          <p className="text-xs text-muted-foreground/80 leading-relaxed">
            Kubernetes operating system with topology visualization, intelligent investigation,
            and offline-first desktop experience. Built for platform engineers, SREs, and DevOps teams.
          </p>
        </div>
      </div>
    </div>
  );
}
