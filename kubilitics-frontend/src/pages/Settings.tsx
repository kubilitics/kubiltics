import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, RotateCcw, CheckCircle2, XCircle, Loader2, AlertTriangle, RefreshCw, Download, Palette, Keyboard, Info, Sun, Moon, Monitor, Server, Trash2, Plus, FolderKanban, Focus, Settings as SettingsIcon } from 'lucide-react';
import { toast } from '@/components/ui/sonner';

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
import { Badge } from '@/components/ui/badge';
import { ClusterAppearanceSettings } from '@/components/settings/ClusterAppearance';

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
  const [settingsProject, setSettingsProject] = useState<BackendProject | null>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <div className="container max-w-5xl py-8 space-y-8">
      {/* ━━━ Hero Header ━━━ */}
      <div className="relative overflow-hidden rounded-2xl border border-border/40 bg-gradient-to-br from-slate-50 via-white to-blue-50/80 dark:from-slate-900 dark:via-slate-900/95 dark:to-blue-950/30 shadow-lg shadow-blue-500/5">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-100/40 via-transparent to-transparent dark:from-blue-900/20" />
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500" />
        <div className="relative px-8 py-8 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-xl shadow-blue-500/25 ring-4 ring-blue-500/10">
              <SettingsIcon className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
              <p className="text-sm text-muted-foreground mt-1">Manage connections, clusters, and application preferences</p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <Badge variant="outline" className="rounded-full px-3 py-1 text-xs font-medium border-blue-200 text-blue-700 dark:border-blue-800 dark:text-blue-300">
              v1.0.0
            </Badge>
            <Badge variant="outline" className="rounded-full px-3 py-1 text-xs font-medium">
              {typeof __VITE_IS_TAURI_BUILD__ !== 'undefined' && __VITE_IS_TAURI_BUILD__ ? 'Desktop' : 'Browser'}
            </Badge>
          </div>
        </div>
      </div>

      {/* ━━━ Clusters ━━━ */}
      <Card className="rounded-2xl overflow-hidden shadow-md border-border/50 dark:bg-slate-900/60">
        <div className="h-1 bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-500" />
        <CardHeader className="pb-4 bg-gradient-to-r from-emerald-50/50 to-transparent dark:from-emerald-950/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-900/40 shadow-sm">
                <Server className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <CardTitle className="text-base">Clusters</CardTitle>
                <CardDescription className="mt-0.5">
                  {clusters.length} connected cluster{clusters.length !== 1 ? 's' : ''}
                </CardDescription>
              </div>
            </div>
            <Button variant="default" size="sm" className="rounded-xl h-9 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm" onClick={() => navigate('/connect?addCluster=true')}>
              <Plus className="h-4 w-4 mr-1.5" />
              Add Cluster
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-2 pb-6">
          {clusters.length === 0 ? (
            <div className="text-center py-12 px-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-50 dark:from-emerald-900/30 dark:to-teal-900/20 mx-auto mb-4 shadow-inner">
                <Server className="h-7 w-7 text-emerald-400" />
              </div>
              <p className="text-sm font-semibold text-foreground">No clusters connected</p>
              <p className="text-xs text-muted-foreground mt-1.5 max-w-xs mx-auto">Connect a Kubernetes cluster to start monitoring workloads, nodes, and services</p>
              <Button size="sm" className="mt-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => navigate('/connect?addCluster=true')}>
                <Plus className="h-4 w-4 mr-1.5" />
                Connect First Cluster
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {clusters.map((cluster) => {
                const isActive = cluster.id === currentClusterId;
                return (
                  <div
                    key={cluster.id}
                    className={cn(
                      "relative rounded-xl border-2 overflow-hidden transition-all duration-200 hover:shadow-md",
                      isActive
                        ? "border-blue-300 bg-gradient-to-br from-blue-50/90 via-white to-indigo-50/50 dark:border-blue-700/50 dark:from-blue-950/40 dark:via-slate-900 dark:to-indigo-950/20 shadow-sm"
                        : "border-border/50 bg-card hover:border-border dark:hover:border-slate-600"
                    )}
                  >
                    {/* Colored left accent */}
                    <div className={cn(
                      "absolute left-0 top-0 bottom-0 w-1 rounded-l-xl",
                      isActive ? "bg-gradient-to-b from-blue-500 to-indigo-500" : "bg-slate-300 dark:bg-slate-700"
                    )} />
                    <div className="pl-5 pr-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <div className={cn(
                            "flex h-10 w-10 items-center justify-center rounded-xl shrink-0 shadow-sm",
                            isActive
                              ? "bg-gradient-to-br from-blue-500 to-indigo-500 text-white"
                              : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                          )}>
                            <Server className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold truncate">{cluster.name}</span>
                              {isActive && (
                                <Badge className="bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/50 dark:text-blue-300 dark:border-blue-800 text-[10px] px-1.5 py-0 h-5 rounded-md">
                                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse mr-1" />
                                  ACTIVE
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-1.5">
                              <Badge variant="outline" className="text-[10px] px-2 py-0 h-5 rounded-md font-medium">
                                {cluster.provider || 'Kubernetes'}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {cluster.node_count ?? 0} node{(cluster.node_count ?? 0) !== 1 ? 's' : ''}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                      {/* Always-visible actions */}
                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/40">
                        {!isActive ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs rounded-lg flex-1 border-blue-200 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/40"
                            onClick={() => {
                              setCurrentClusterId(cluster.id);
                              setActiveCluster(backendClusterToCluster(cluster));
                              toast.success(`Switched to ${cluster.name}`);
                            }}
                          >
                            <Focus className="h-3.5 w-3.5 mr-1.5" />
                            Switch to Cluster
                          </Button>
                        ) : (
                          <div className="flex-1 flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 font-medium">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Currently active
                          </div>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-lg text-muted-foreground/60 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                          onClick={() => setClusterToRemove(cluster)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ━━━ Cluster Appearance ━━━ */}
      <ClusterAppearanceSettings />

      {/* ━━━ Projects ━━━ */}
      <Card className="rounded-2xl overflow-hidden shadow-md border-border/50 dark:bg-slate-900/60">
        <div className="h-1 bg-gradient-to-r from-violet-400 via-purple-500 to-fuchsia-500" />
        <CardHeader className="pb-4 bg-gradient-to-r from-violet-50/50 to-transparent dark:from-violet-950/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-900/40 shadow-sm">
                <FolderKanban className="h-5 w-5 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <CardTitle className="text-base">Projects</CardTitle>
                <CardDescription className="mt-0.5">Organize workloads into logical groups</CardDescription>
              </div>
            </div>
            <CreateProjectDialog>
              <Button variant="default" size="sm" className="rounded-xl h-9 bg-violet-600 hover:bg-violet-700 text-white shadow-sm">
                <Plus className="h-4 w-4 mr-1.5" />
                New Project
              </Button>
            </CreateProjectDialog>
          </div>
        </CardHeader>
        <CardContent className="pt-2 pb-6">
          {isProjectsLoading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-100/50 dark:bg-violet-900/20">
                <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
              </div>
              <span className="text-sm text-muted-foreground">Loading projects...</span>
            </div>
          ) : projects.length === 0 ? (
            <div className="relative rounded-xl border-2 border-dashed border-violet-200 dark:border-violet-800/40 bg-gradient-to-br from-violet-50/30 to-fuchsia-50/20 dark:from-violet-950/10 dark:to-fuchsia-950/5 py-12 px-4">
              <div className="text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-100 to-fuchsia-50 dark:from-violet-900/30 dark:to-fuchsia-900/20 mx-auto mb-4 shadow-inner">
                  <FolderKanban className="h-7 w-7 text-violet-400" />
                </div>
                <p className="text-sm font-semibold text-foreground">No projects yet</p>
                <p className="text-xs text-muted-foreground mt-1.5 max-w-xs mx-auto">Projects help you organize namespaces, services, and workloads across clusters</p>
                <CreateProjectDialog>
                  <Button size="sm" className="mt-5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white">
                    <Plus className="h-4 w-4 mr-1.5" />
                    Create First Project
                  </Button>
                </CreateProjectDialog>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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

      {/* ━━━ Connection Endpoints ━━━ */}
      <Card className="rounded-2xl overflow-hidden shadow-md border-border/50 dark:bg-slate-900/60">
        <div className="h-1 bg-gradient-to-r from-amber-400 via-orange-500 to-amber-500" />
        <CardHeader className="pb-4 bg-gradient-to-r from-amber-50/50 to-transparent dark:from-amber-950/15">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/40 shadow-sm">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <CardTitle className="text-base">Connection Endpoints</CardTitle>
              <CardDescription className="mt-0.5">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Changing these will reload the application
                </span>
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pb-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* Backend URL */}
              <div className="rounded-xl border border-border/50 bg-muted/10 p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border-amber-200 text-amber-700 dark:border-amber-800 dark:text-amber-300">
                    Core API
                  </Badge>
                  {connectionStatus.backend === 'success' && (
                    <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-300 dark:border-emerald-800 text-[10px] px-2 py-0.5 h-5 rounded-md">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Connected
                    </Badge>
                  )}
                  {connectionStatus.backend === 'error' && (
                    <Badge className="bg-red-100 text-red-700 border-red-200 dark:bg-red-900/50 dark:text-red-300 dark:border-red-800 text-[10px] px-2 py-0.5 h-5 rounded-md">
                      <XCircle className="h-3 w-3 mr-1" />
                      Failed
                    </Badge>
                  )}
                </div>
                <FormField
                  control={form.control}
                  name="backendBaseUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-semibold text-muted-foreground">Backend URL</FormLabel>
                      <div className="flex gap-2 mt-1">
                        <FormControl>
                          <Input {...field} className="rounded-lg h-10 font-mono text-sm bg-background" placeholder="http://localhost:8190" />
                        </FormControl>
                        <Button
                          type="button"
                          variant="outline"
                          className={cn(
                            "h-10 rounded-lg shrink-0 px-4 text-xs font-medium gap-2",
                            connectionStatus.backend === 'success' && "border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400",
                            connectionStatus.backend === 'error' && "border-red-300 text-red-700 dark:border-red-700 dark:text-red-400"
                          )}
                          onClick={() => testConnection('backend')}
                          disabled={!!isTesting}
                        >
                          {isTesting === 'backend' ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : connectionStatus.backend === 'success' ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : connectionStatus.backend === 'error' ? (
                            <XCircle className="h-4 w-4" />
                          ) : (
                            <RotateCcw className="h-4 w-4" />
                          )}
                          Test
                        </Button>
                      </div>
                      <FormDescription className="text-xs">
                        The URL where the Kubilitics Core Go backend is running (default port 8190).
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-between items-center pt-2">
                <Button type="button" variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground rounded-lg gap-1.5" onClick={handleReset}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset to Defaults
                </Button>
                <Button type="submit" size="sm" className="rounded-xl px-5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-sm">
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                  Save Changes
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* ━━━ Appearance ━━━ */}
      <AppearanceSection />

      {/* ━━━ Keyboard Shortcuts ━━━ */}
      <KeyboardShortcutsSection />

      {/* ━━━ Desktop ━━━ */}
      {isDesktop && (
        <Card className="rounded-2xl overflow-hidden shadow-md border-border/50 dark:bg-slate-900/60">
          <div className="h-1 bg-gradient-to-r from-cyan-400 via-sky-500 to-blue-500" />
          <CardHeader className="pb-4 bg-gradient-to-r from-cyan-50/50 to-transparent dark:from-cyan-950/15">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-100 dark:bg-cyan-900/40 shadow-sm">
                  <Monitor className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                </div>
                <div>
                  <CardTitle className="text-base">Desktop Application</CardTitle>
                  <CardDescription className="mt-0.5">Desktop-specific configuration and status</CardDescription>
                </div>
              </div>
              {desktopInfo && (
                <Badge variant="outline" className="rounded-full px-3 py-1 text-xs font-medium border-cyan-200 text-cyan-700 dark:border-cyan-800 dark:text-cyan-300">
                  v{desktopInfo.app_version}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="pb-6 space-y-5">
            {/* Stat cards in 2x2 grid */}
            {desktopInfo && (
              <div className="grid grid-cols-2 gap-3">
                {/* App Version */}
                <div className="rounded-xl border border-border/50 bg-gradient-to-br from-blue-50/40 to-white dark:from-blue-950/20 dark:to-slate-900 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/40">
                      <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">App Version</p>
                      <p className="text-sm font-semibold mt-0.5">{desktopInfo.app_version}</p>
                    </div>
                  </div>
                </div>
                {/* Backend Port */}
                <div className="rounded-xl border border-border/50 bg-gradient-to-br from-emerald-50/40 to-white dark:from-emerald-950/20 dark:to-slate-900 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/40">
                      <Server className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Backend Port</p>
                      <p className="text-sm font-semibold mt-0.5">{desktopInfo.backend_port}</p>
                    </div>
                  </div>
                </div>
                {/* Backend Version */}
                {desktopInfo.backend_version && (
                  <div className="rounded-xl border border-border/50 bg-gradient-to-br from-orange-50/40 to-white dark:from-orange-950/20 dark:to-slate-900 p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/40">
                        <SettingsIcon className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Backend Version</p>
                        <p className="text-sm font-semibold mt-0.5">{desktopInfo.backend_version}</p>
                      </div>
                    </div>
                  </div>
                )}
                {/* Backend Uptime */}
                {desktopInfo.backend_uptime_seconds !== null && (
                  <div className="rounded-xl border border-border/50 bg-gradient-to-br from-pink-50/40 to-white dark:from-pink-950/20 dark:to-slate-900 p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-pink-100 dark:bg-pink-900/40">
                        <RefreshCw className="h-4 w-4 text-pink-600 dark:text-pink-400" />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Uptime</p>
                        <p className="text-sm font-semibold mt-0.5">{formatUptime(desktopInfo.backend_uptime_seconds)}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Paths in monospace cards */}
            {desktopInfo && (
              <div className="space-y-2">
                {[
                  { label: 'Kubeconfig Path', value: desktopInfo.kubeconfig_path },
                  { label: 'App Data Directory', value: desktopInfo.app_data_dir },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-xl border border-border/50 bg-slate-50/50 dark:bg-slate-800/30 px-4 py-3.5 flex items-start gap-3">
                    <div className="shrink-0 mt-0.5">
                      <FolderKanban className="h-4 w-4 text-muted-foreground/60" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{label}</p>
                      <p className="text-xs font-mono text-foreground/80 mt-1 break-all leading-relaxed">{value}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Analytics Consent */}
            <div className="rounded-xl border border-border/50 bg-gradient-to-r from-muted/20 to-transparent p-4 flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">Analytics & Usage Data</p>
                  {analyticsConsent !== null && (
                    <Badge variant="outline" className={cn(
                      "text-[10px] px-1.5 py-0 h-5 rounded-md",
                      analyticsConsent
                        ? "border-emerald-200 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"
                        : "border-border text-muted-foreground"
                    )}>
                      {analyticsConsent ? 'Enabled' : 'Disabled'}
                    </Badge>
                  )}
                </div>
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
              <Button type="button" variant="outline" size="sm" className="rounded-xl text-xs h-9 gap-2" onClick={handleRestartBackend} disabled={isRestarting}>
                {isRestarting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {isRestarting ? 'Restarting...' : 'Restart Backend'}
              </Button>
              <Button type="button" variant="outline" size="sm" className="rounded-xl text-xs h-9 gap-2" onClick={handleCheckForUpdates} disabled={isCheckingUpdate}>
                {isCheckingUpdate ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                {isCheckingUpdate ? 'Checking...' : 'Check for Updates'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ━━━ About ━━━ */}
      <AboutSection />

      {/* ── Cluster Remove Dialog ── */}
      <AlertDialog open={!!clusterToRemove} onOpenChange={(open) => !open && setClusterToRemove(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-red-500" />
              Remove cluster?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will unregister <strong>{clusterToRemove?.name}</strong> from Kubilitics. Your kubeconfig file will not be modified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteClusterMutation.isPending} className="rounded-xl">Cancel</AlertDialogCancel>
            <Button variant="destructive" className="rounded-xl" onClick={() => clusterToRemove && deleteClusterMutation.mutate(clusterToRemove)} disabled={deleteClusterMutation.isPending}>
              {deleteClusterMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Removing...</> : 'Remove Cluster'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Project Delete Dialog ── */}
      <AlertDialog open={!!projectToRemove} onOpenChange={(open) => !open && setProjectToRemove(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-red-500" />
              Delete project?
            </AlertDialogTitle>
            <AlertDialogDescription>
              All cluster associations and resource links for <strong>{projectToRemove?.name}</strong> will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteProjectMutation.isPending} className="rounded-xl">Cancel</AlertDialogCancel>
            <Button variant="destructive" className="rounded-xl" onClick={() => projectToRemove && deleteProjectMutation.mutate(projectToRemove)} disabled={deleteProjectMutation.isPending}>
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

/* ━━━ Appearance Section ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const themeOptions: { value: Theme; icon: typeof Sun; label: string; preview: { bg: string; bar: string; text: string; desc: string } }[] = [
  {
    value: 'light',
    icon: Sun,
    label: 'Light',
    preview: { bg: 'bg-white border-slate-200', bar: 'bg-slate-100', text: 'text-slate-800', desc: 'Clean and bright' },
  },
  {
    value: 'dark',
    icon: Moon,
    label: 'Dark',
    preview: { bg: 'bg-slate-900 border-slate-700', bar: 'bg-slate-800', text: 'text-slate-100', desc: 'Easy on the eyes' },
  },
  {
    value: 'system',
    icon: Monitor,
    label: 'System',
    preview: { bg: 'bg-gradient-to-r from-white to-slate-900 border-slate-400', bar: 'bg-gradient-to-r from-slate-100 to-slate-800', text: 'text-slate-600', desc: 'Matches your OS' },
  },
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
    <Card className="rounded-2xl overflow-hidden shadow-md border-border/50 dark:bg-slate-900/60">
      <div className="h-1 bg-gradient-to-r from-pink-400 via-rose-500 to-pink-500" />
      <CardHeader className="pb-4 bg-gradient-to-r from-pink-50/50 to-transparent dark:from-pink-950/20">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pink-100 dark:bg-pink-900/40 shadow-sm">
            <Palette className="h-5 w-5 text-pink-600 dark:text-pink-400" />
          </div>
          <div>
            <CardTitle className="text-base">Appearance</CardTitle>
            <CardDescription className="mt-0.5">Customize the look and feel</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-6 space-y-5">
        {/* Theme Picker with visual preview thumbnails */}
        <div className="space-y-3">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Theme</label>
          <div className="grid grid-cols-3 gap-3">
            {themeOptions.map(({ value, icon: Icon, label, preview }) => (
              <button
                key={value}
                onClick={() => {
                  setTheme(value);
                  toast.success(`Theme set to ${label}`);
                }}
                className={cn(
                  'group relative flex flex-col rounded-xl border-2 overflow-hidden transition-all duration-200',
                  theme === value
                    ? 'border-blue-400 shadow-md shadow-blue-500/15 dark:border-blue-500/60 ring-2 ring-blue-400/20'
                    : 'border-border/60 hover:border-border hover:shadow-sm'
                )}
                aria-pressed={theme === value}
                aria-label={`Set theme to ${label}`}
              >
                {/* Mini preview mockup */}
                <div className={cn("h-16 border-b relative", preview.bg)}>
                  <div className={cn("absolute top-0 left-0 right-0 h-1", value === 'light' ? 'bg-blue-500' : value === 'dark' ? 'bg-blue-400' : 'bg-gradient-to-r from-blue-500 to-blue-400')} />
                  <div className="absolute inset-2 top-3 flex flex-col gap-1">
                    <div className={cn("h-1.5 w-8 rounded-full", preview.bar)} />
                    <div className={cn("h-1 w-12 rounded-full opacity-50", preview.bar)} />
                    <div className="flex gap-1 mt-auto">
                      <div className={cn("h-3 w-5 rounded-sm", preview.bar)} />
                      <div className={cn("h-3 w-5 rounded-sm", preview.bar)} />
                    </div>
                  </div>
                </div>
                {/* Label area */}
                <div className={cn(
                  "px-3 py-2.5 flex items-center gap-2 transition-colors",
                  theme === value
                    ? "bg-blue-50/80 dark:bg-blue-950/30"
                    : "bg-card group-hover:bg-muted/30"
                )}>
                  <Icon className={cn("h-4 w-4", theme === value ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground")} />
                  <div className="text-left">
                    <span className={cn("text-xs font-semibold block", theme === value ? "text-blue-700 dark:text-blue-300" : "text-foreground")}>{label}</span>
                    <span className="text-[10px] text-muted-foreground">{preview.desc}</span>
                  </div>
                </div>
                {/* Active check indicator */}
                {theme === value && (
                  <div className="absolute top-2 right-2">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 shadow-sm">
                      <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                    </div>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Reduce Motion toggle */}
        <div className="rounded-xl border border-border/50 bg-gradient-to-r from-muted/20 to-transparent p-4 flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-sm font-semibold">Reduce Motion</div>
            <div className="text-xs text-muted-foreground">Minimize animations and transitions for accessibility</div>
          </div>
          <Switch checked={reduceMotion} onCheckedChange={handleReduceMotion} />
        </div>
      </CardContent>
    </Card>
  );
}

/* ━━━ Keyboard Shortcuts Section ━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
const mod = isMac ? '\u2318' : 'Ctrl';

const shortcuts: { category: string; color: string; items: { keys: string; description: string }[] }[] = [
  {
    category: 'Navigation',
    color: 'sky',
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
    color: 'violet',
    items: [
      { keys: 'Escape', description: 'Close dialog / deselect' },
      { keys: `${mod}+Enter`, description: 'Submit form / confirm action' },
      { keys: `${mod}+.`, description: 'Toggle AI assistant' },
    ],
  },
];

function KeyboardShortcutsSection() {
  return (
    <Card className="rounded-2xl overflow-hidden shadow-md border-border/50 dark:bg-slate-900/60">
      <div className="h-1 bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-500" />
      <CardHeader className="pb-4 bg-gradient-to-r from-sky-50/50 to-transparent dark:from-sky-950/20">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 dark:bg-sky-900/40 shadow-sm">
            <Keyboard className="h-5 w-5 text-sky-600 dark:text-sky-400" />
          </div>
          <div>
            <CardTitle className="text-base">Keyboard Shortcuts</CardTitle>
            <CardDescription className="mt-0.5">Navigate faster with keyboard shortcuts</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {shortcuts.map(({ category, color, items }) => (
            <div key={category} className="space-y-2.5">
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-lg",
                  color === 'sky'
                    ? "border-sky-200 text-sky-700 dark:border-sky-800 dark:text-sky-300"
                    : "border-violet-200 text-violet-700 dark:border-violet-800 dark:text-violet-300"
                )}
              >
                {category}
              </Badge>
              <div className="rounded-xl border border-border/50 overflow-hidden divide-y divide-border/30">
                {items.map(({ keys, description }) => (
                  <div key={keys} className="flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors">
                    <span className="text-sm text-foreground/90">{description}</span>
                    <div className="flex items-center gap-1">
                      {keys.split('+').map((key, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && <span className="text-muted-foreground/40 text-[10px]">+</span>}
                          <kbd className="inline-flex items-center justify-center min-w-[24px] rounded-md border border-border/60 bg-gradient-to-b from-muted/80 to-muted/40 px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground shadow-sm">
                            {key.replace('then ', '').trim()}
                          </kbd>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ━━━ About Section ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function AboutSection() {
  const platformLabel = typeof __VITE_IS_TAURI_BUILD__ !== 'undefined' && __VITE_IS_TAURI_BUILD__ ? 'Desktop (Tauri)' : 'Browser';

  return (
    <Card className="rounded-2xl overflow-hidden shadow-md border-border/50 dark:bg-slate-900/60">
      <div className="h-1 bg-gradient-to-r from-indigo-400 via-purple-500 to-indigo-500" />
      <CardHeader className="pb-4 bg-gradient-to-r from-indigo-50/50 to-transparent dark:from-indigo-950/15">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 dark:bg-indigo-900/40 shadow-sm">
            <Info className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <CardTitle className="text-base">About Kubilitics</CardTitle>
            <CardDescription className="mt-0.5">System information and build details</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-6">
        <div className="flex flex-col sm:flex-row items-start gap-5">
          {/* Product identity */}
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/20">
              <SettingsIcon className="h-7 w-7 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold tracking-tight">Kubilitics</h3>
              <div className="flex items-center gap-2 mt-1">
                <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/50 dark:text-indigo-300 dark:border-indigo-800 text-[10px] px-2 py-0.5 h-5 rounded-md font-bold">
                  v1.0.0
                </Badge>
                <Badge variant="outline" className="text-[10px] px-2 py-0.5 h-5 rounded-md">
                  {platformLabel}
                </Badge>
                <Badge variant="outline" className="text-[10px] px-2 py-0.5 h-5 rounded-md border-emerald-200 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300">
                  Stable
                </Badge>
              </div>
            </div>
          </div>
        </div>

        {/* Build info cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-5">
          {[
            { label: 'Product', value: 'Kubilitics' },
            { label: 'Version', value: '1.0.0' },
            { label: 'Platform', value: platformLabel },
            { label: 'License', value: 'Proprietary' },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-lg border border-border/40 bg-muted/15 px-3 py-2.5 text-center">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{label}</p>
              <p className="text-xs font-semibold mt-1 truncate">{value}</p>
            </div>
          ))}
        </div>

        {/* Description footer */}
        <div className="mt-5 pt-4 border-t border-border/30">
          <p className="text-xs text-muted-foreground/80 leading-relaxed">
            Kubernetes operating system with topology visualization, intelligent investigation,
            and offline-first desktop experience. Built for platform engineers, SREs, and DevOps teams.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
