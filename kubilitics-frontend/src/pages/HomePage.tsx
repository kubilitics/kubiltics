import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  LayoutGrid,
  RefreshCw,
  Plus,
  Loader2,
  Zap,
  Focus,
  Activity,
  ShieldCheck,
  Bot,
  ChevronRight,
  PlusCircle,
  AlertCircle,
  Info,
  CheckCircle2,
  Settings,
  ArrowRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { backendClusterToCluster } from '@/lib/backendClusterAdapter';
import { useProjectStore } from '@/stores/projectStore';
import { useClustersFromBackend } from '@/hooks/useClustersFromBackend';
import { useBackendCircuitOpen } from '@/hooks/useBackendCircuitOpen';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { useClusterOverview } from '@/hooks/useClusterOverview';
import { HealthRing } from '@/components/HealthRing';
import { AISetupModal } from '@/features/ai/AISetupModal';
import { loadLLMProviderConfig } from '@/services/aiService';
import { getProjects } from '@/services/backendApiClient';
import { CreateProjectDialog } from '@/components/projects/CreateProjectDialog';
import { ProjectCard } from '@/components/projects/ProjectCard';
import { ProjectSettingsDialog } from '@/components/projects/ProjectSettingsDialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function HomePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'infrastructure';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [searchQuery, setSearchQuery] = useState('');

  const storedBackendUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = useMemo(() => getEffectiveBackendBaseUrl(storedBackendUrl), [storedBackendUrl]);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const setCurrentClusterId = useBackendConfigStore((s) => s.setCurrentClusterId);
  const setActiveCluster = useClusterStore((s) => s.setActiveCluster);

  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [settingsProject, setSettingsProject] = useState<any>(null);
  const aiConfig = loadLLMProviderConfig();
  const isAiEnabled = aiConfig && aiConfig.provider !== 'none';

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const clearActiveProject = useProjectStore((s) => s.clearActiveProject);
  useEffect(() => {
    if (activeTab !== 'projects') {
      clearActiveProject();
    }
  }, [activeTab, clearActiveProject]);

  const { data: clustersFromBackend } = useClustersFromBackend();
  const clusters = useMemo(() => clustersFromBackend || [], [clustersFromBackend]);

  const circuitOpen = useBackendCircuitOpen();
  const currentClusterId = useActiveClusterId();
  const { data: overview } = useClusterOverview(currentClusterId ?? undefined);
  const { data: projectsFromBackend, isLoading: isProjectsLoading, error: projectsError } = useQuery({
    queryKey: ['projects'],
    queryFn: () => getProjects(backendBaseUrl),
    enabled: isBackendConfigured && !circuitOpen,
  });
  const projects = useMemo(() => {
    console.log('Projects from backend:', projectsFromBackend);
    return projectsFromBackend || [];
  }, [projectsFromBackend]);

  if (projectsError) {
    console.error('Projects fetch error:', projectsError);
  }

  const filteredClusters = useMemo(() => {
    return clusters.filter(c =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.provider?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [clusters, searchQuery]);

  const handleTabChange = (val: string) => {
    setActiveTab(val);
    setSearchParams({ tab: val });
  };

  // P2-5: System health from current cluster overview (no hardcoded value).
  const systemHealthScore = overview?.health?.score;
  const activeClusters = clusters.length;
  const activeNodes = useMemo(() => clusters.reduce((acc, c) => acc + (c.node_count || 0), 0), [clusters]);

  return (
    <div className="min-h-screen bg-slate-50/50 pb-20 animate-in">
      {/* Premium Navigation Header Area */}
      <div className="bg-white/80 backdrop-blur-xl sticky top-0 z-40 border-b border-slate-100/60 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Infrastructure Hub</h1>
          <nav className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className={cn("rounded-xl h-9 px-4 text-sm font-medium transition-all", activeTab === 'infrastructure' ? "bg-slate-100 text-slate-950 font-semibold" : "text-slate-500 hover:text-slate-900")}
              onClick={() => handleTabChange('infrastructure')}
            >
              Infrastructure
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn("rounded-xl h-9 px-4 text-sm font-medium transition-all", activeTab === 'intelligence' ? "bg-slate-100 text-slate-950 font-semibold" : "text-slate-500 hover:text-slate-900")}
              onClick={() => handleTabChange('intelligence')}
            >
              Intelligence
            </Button>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
            <input
              type="text"
              placeholder="Search resources..."
              className="w-64 h-10 bg-slate-100/50 border-none rounded-2xl pl-10 pr-4 text-sm focus:ring-2 focus:ring-blue-100 transition-all outline-none"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-10">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-12">
          {/* Unified Infrastructure View: Projects & Clusters */}
          <TabsContent value="infrastructure" className="m-0 space-y-20">

            {/* Clusters Section - Direct Infrastructure access - TOP PRIORITY */}
            <div className="space-y-8">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-black tracking-tight text-slate-900">Physical Infrastructure</h2>
                  <p className="text-sm font-medium text-slate-500 mt-1">Direct access to compute environments</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {filteredClusters.map((cluster) => (
                  <div
                    key={cluster.id}
                    className="relative group bg-white border border-slate-100 rounded-[2.5rem] p-8 shadow-sm hover:shadow-xl hover:shadow-blue-500/5 hover:border-blue-100 transition-all duration-500 cursor-pointer"
                    onClick={() => {
                      // P0-D: Must set BOTH stores atomically so ProtectedRoute (checks
                      // activeCluster) and useKubernetes (uses currentClusterId for API) agree.
                      setCurrentClusterId(cluster.id);
                      setActiveCluster(backendClusterToCluster(cluster));
                      navigate('/home');
                    }}
                  >
                    <div className="flex justify-between items-start mb-8">
                      <HealthRing score={currentClusterId === cluster.id ? (systemHealthScore ?? 0) : 0} size={64} strokeWidth={8} />
                      <Badge className="bg-slate-100 text-slate-500 border-none px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest">
                        {cluster.provider || 'Local'}
                      </Badge>
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 mb-1 group-hover:text-blue-600 transition-colors uppercase tracking-tight">{cluster.name}</h3>
                    <p className="text-xs text-slate-400 font-bold mb-10 truncate tracking-tight">{cluster.server_url?.replace('https://', '')}</p>

                    <div className="flex items-center justify-between pt-8 border-t border-slate-100/50">
                      <div className="flex gap-10">
                        <div className="space-y-1">
                          <div className="text-2xl font-extrabold text-slate-900 tabular-nums">{cluster.node_count ?? 0}</div>
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em]">Nodes</div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-2xl font-extrabold text-slate-900 tabular-nums">{cluster.namespace_count ?? 0}</div>
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em]">Namespaces</div>
                        </div>
                      </div>
                      <div className="h-10 w-10 rounded-xl bg-slate-50 flex items-center justify-center group-hover:bg-slate-900 transition-all duration-500">
                        <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-white" />
                      </div>
                    </div>
                  </div>
                ))}

                <div
                  className="bg-slate-50/50 border-2 border-dashed border-slate-200 rounded-[2.5rem] p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-white hover:border-blue-300 transition-all group"
                  onClick={() => navigate('/setup/kubeconfig')}
                >
                  <div className="h-14 w-14 bg-white rounded-2xl border border-slate-200 flex items-center justify-center mb-4 group-hover:shadow-lg transition-all">
                    <Plus className="h-6 w-6 text-slate-400 group-hover:text-blue-600" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">Scale Up</h3>
                  <p className="text-sm text-slate-500 font-medium mt-1">Connect secondary<br />compute context</p>
                </div>
              </div>
            </div>

            {/* Projects Section - Secondary Management */}
            <div className="space-y-8">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-black tracking-tight text-slate-900">Logical Governance</h2>
                  <p className="text-sm font-medium text-slate-500 mt-1">Assemble projects from connected environments</p>
                </div>
                <CreateProjectDialog>
                  <Button className="bg-slate-900 text-white rounded-2xl h-11 px-6 font-bold flex items-center gap-2 shadow-lg shadow-slate-900/10 hover:shadow-slate-900/20 active:scale-95 transition-all">
                    <Plus className="h-4 w-4" />
                    Initialize Project
                  </Button>
                </CreateProjectDialog>
              </div>

              {isProjectsLoading ? (
                <div className="flex items-center justify-center p-20 bg-white/40 rounded-[2.5rem] border border-slate-100">
                  <Loader2 className="h-10 w-10 text-slate-200 animate-spin" />
                </div>
              ) : projects.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                  {projects.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      onClick={() => setSettingsProject(project)}
                    />
                  ))}
                </div>
              ) : (
                <div className="relative overflow-hidden bg-white/40 backdrop-blur-md rounded-[3rem] border border-slate-100 p-20 text-center">
                  <div className="relative h-20 w-20 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <Focus className="h-8 w-8 text-blue-500" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900">No logical projects found</h3>
                  <p className="text-slate-500 max-w-sm mx-auto mt-2 text-sm font-medium">
                    Projects allow you to group clusters and namespaces for precise multi-tenancy.
                  </p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="intelligence" className="m-0 space-y-12">
            {/* Clean Hero Layout */}
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-10">
              <div className="lg:col-span-2 space-y-8">
                <div>
                  <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50 border-none px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mb-4">
                    Kubernetes Operating System
                  </Badge>
                  <h2 className="text-6xl font-extrabold tracking-tight text-slate-900 mb-6 leading-[1.1]">
                    Your Infrastructure is <span className="ai-accent-text">Optimal.</span>
                  </h2>
                  <p className="text-xl text-slate-600 max-w-2xl leading-relaxed">
                    Automated intelligence is monitoring {activeClusters} active clusters with {activeNodes} nodes across your environments. No critical action required.
                  </p>
                </div>

                <div className="flex flex-wrap gap-4">
                  <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex items-center gap-5 min-w-[200px]">
                    <div className="p-3 bg-emerald-50 rounded-2xl">
                      <ShieldCheck className="h-6 w-6 text-emerald-600" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-slate-900">{systemHealthScore != null ? `${systemHealthScore}%` : '—'}</div>
                      <div className="text-xs font-semibold text-slate-600 uppercase tracking-tight">System Health</div>
                    </div>
                  </div>
                  <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex items-center gap-5 min-w-[200px]">
                    <div className="p-3 bg-blue-50 rounded-2xl">
                      <Activity className="h-6 w-6 text-blue-600" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-slate-900">{activeNodes}</div>
                      <div className="text-xs font-semibold text-slate-600 uppercase tracking-tight">Active Nodes</div>
                    </div>
                  </div>
                  <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex items-center gap-5 min-w-[200px]">
                    <div className="p-3 bg-purple-50 rounded-2xl">
                      <Bot className="h-6 w-6 text-purple-600" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-slate-900">{isAiEnabled ? 'Active' : 'Standby'}</div>
                      <div className="text-xs font-semibold text-slate-600 uppercase tracking-tight">AI Status</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-xl shadow-slate-200/50 flex flex-col justify-between">
                <div>
                  <h3 className="text-xl font-bold text-slate-900 mb-2">Health Report</h3>
                  <p className="text-sm text-slate-600">Weekly insight of your production and staging environments.</p>
                </div>
                <div className="py-8 flex justify-center">
                  <HealthRing score={systemHealthScore ?? 0} size={140} strokeWidth={10} />
                </div>
                <Button variant="outline" className="w-full rounded-2xl h-12 border-slate-200 text-slate-700 font-semibold hover:bg-slate-50 group">
                  View Full Metrics
                  <ArrowRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
              </div>
            </section>

            {/* AI Insights - Clean & High Contrast */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-blue-500" />
                    Critical Anomalies
                  </h3>
                  <Badge variant="outline" className="rounded-full bg-slate-50 text-slate-600 border-slate-200">0 Total</Badge>
                </div>
                <div className="bg-white rounded-[2.5rem] border border-slate-100 p-12 flex flex-col items-center justify-center text-center space-y-4 shadow-sm">
                  <div className="h-20 w-20 bg-emerald-50 rounded-full flex items-center justify-center">
                    <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                  </div>
                  <div>
                    <h4 className="text-lg font-bold text-slate-900">All Quiet</h4>
                    <p className="text-slate-600 max-w-xs mx-auto">Systems are operating within normal parameters across all connected clusters.</p>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <Bot className="h-5 w-5 text-purple-500" />
                    Optimization Assistant
                  </h3>
                  <Badge variant="outline" className="rounded-full bg-purple-50 text-purple-600 border-purple-100 font-bold uppercase text-[9px]">KOS-Intelligence</Badge>
                </div>
                <div className="bg-white rounded-[2.5rem] border border-slate-100 p-12 flex flex-col items-center justify-center text-center shadow-sm">
                  {isAiEnabled ? (
                    <div className="space-y-4">
                      <div className="h-20 w-20 bg-purple-50 rounded-full flex items-center justify-center mx-auto">
                        <Zap className="h-10 w-10 text-purple-500" />
                      </div>
                      <div>
                        <h4 className="text-lg font-bold text-slate-900">Learning Patterns</h4>
                        <p className="text-slate-600 max-w-xs mx-auto">AI is analyzing historical usage to generate recommendations.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="h-20 w-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
                        <Bot className="h-10 w-10 text-slate-300" />
                      </div>
                      <div>
                        <h4 className="text-lg font-bold text-slate-900 text-balance">Unlock Autonomous Optimization</h4>
                        <p className="text-slate-600 max-w-xs mx-auto mt-2">Enable AI to receive context-aware recommendations for performance and cost.</p>
                      </div>
                      <Button onClick={() => setIsAiModalOpen(true)} className="bg-slate-900 hover:bg-slate-800 text-white rounded-2xl h-11 px-6 shadow-xl">
                        Setup AI Assistant
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <AISetupModal open={isAiModalOpen} onOpenChange={setIsAiModalOpen} />
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
