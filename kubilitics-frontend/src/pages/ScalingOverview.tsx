import { useState, useCallback, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Zap,
  Search,
  ArrowUpRight,
  Shield,
  Activity,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useScalingOverview } from '@/hooks/useScalingOverview';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { ScalingPulse } from '@/components/scaling/ScalingPulse';
import { ListPagination } from '@/components/list/ListPagination';
import { ConnectionRequiredBanner } from '@/components/layout/ConnectionRequiredBanner';
import { PageLoadingState } from '@/components/PageLoadingState';

type ScalingResource = {
  kind: string;
  name: string;
  namespace: string;
  status: string;
};

function getResourceKey(r: ScalingResource): string {
  return `${r.kind}/${r.namespace}/${r.name}`;
}

export default function ScalingOverview() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [pageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);
  const queryClient = useQueryClient();
  const { data, isLoading } = useScalingOverview();

  const handleSync = useCallback(() => {
    setIsSyncing(true);
    queryClient.invalidateQueries({ queryKey: ['k8s'] });
    setTimeout(() => setIsSyncing(false), 1500);
  }, [queryClient]);

 // eslint-disable-next-line react-hooks/exhaustive-deps
  const resources: ScalingResource[] = data?.resources ?? [];

  const filteredResources = useMemo(() => {
    if (!searchQuery.trim()) return resources;
    const q = searchQuery.toLowerCase();
    return resources.filter(
      (r) => r.name.toLowerCase().includes(q) || r.kind.toLowerCase().includes(q)
    );
  }, [resources, searchQuery]);

  const totalFiltered = filteredResources.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const start = safePageIndex * pageSize;
  const itemsOnPage = filteredResources.slice(start, start + pageSize);

  useEffect(() => {
    if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
  }, [safePageIndex, pageIndex]);

  useEffect(() => { setPageIndex(0); }, [searchQuery]);

  const toggleSelection = (r: ScalingResource) => {
    const key = getResourceKey(r);
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set());
    else setSelectedItems(new Set(itemsOnPage.map(getResourceKey)));
  };

  const isAllSelected = itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;

  if (isLoading) {
    return <PageLoadingState message="Loading scaling resources..." />;
  }

  const hpaCount = resources.filter((r) => r.kind === 'HPA').length;
  const vpaCount = resources.filter((r) => r.kind === 'VPA').length;
  const pdbCount = resources.filter((r) => r.kind === 'PDB').length;

  return (
    <div className="flex flex-col gap-6 p-6" role="main" aria-label="Scaling & Policies Overview">
      <ConnectionRequiredBanner />

      <SectionOverviewHeader
        title="Scaling & Policies"
        description="Autoscalers and pod disruption budgets keeping your cluster balanced."
        icon={Zap}
        onSync={handleSync}
        isSyncing={isSyncing}
      />

      {/* Hero: Scaling Pulse & Policy Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Card className="lg:col-span-8 overflow-hidden border-slate-200/80 shadow-sm bg-white" aria-live="polite">
          <CardHeader className="pb-0 pt-8 px-8">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl font-bold tracking-tight text-slate-900">Scaling Activity</CardTitle>
                <p className="text-sm text-slate-500 mt-1">Autoscaler alignment and replica convergence</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-semibold text-slate-500">Active</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0 pb-8 px-8">
            <ScalingPulse />
            <div className="grid grid-cols-3 gap-6 mt-6 border-t border-slate-100 pt-6">
              <div>
                <span className="block text-xs font-medium text-slate-500 mb-1">HPAs</span>
                <span className="text-xl font-bold text-slate-900 tabular-nums">{hpaCount}</span>
              </div>
              <div>
                <span className="block text-xs font-medium text-slate-500 mb-1">VPAs</span>
                <span className="text-xl font-bold text-slate-900 tabular-nums">{vpaCount}</span>
              </div>
              <div>
                <span className="block text-xs font-medium text-slate-500 mb-1">PDBs</span>
                <span className="text-xl font-bold text-slate-900 tabular-nums">{pdbCount}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-4 border-slate-200/80 shadow-sm bg-white flex flex-col p-8 overflow-hidden">
          <div className="flex items-center gap-3 mb-5">
            <div className="h-9 w-9 rounded-lg bg-slate-100 flex items-center justify-center">
              <Shield className="h-4.5 w-4.5 text-slate-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Disruption Budget</h3>
              <p className="text-xs text-slate-500">Pod availability guarantees</p>
            </div>
          </div>

          <div className="flex-1 space-y-3">
            <div className="flex items-center justify-between py-2.5 px-4 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-sm font-medium text-slate-700">HPAs Configured</span>
              <span className="text-sm font-bold text-slate-900 tabular-nums">{hpaCount}</span>
            </div>
            <div className="flex items-center justify-between py-2.5 px-4 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-sm font-medium text-slate-700">VPAs Active</span>
              <span className="text-sm font-bold text-slate-900 tabular-nums">{vpaCount}</span>
            </div>
            <div className="flex items-center justify-between py-2.5 px-4 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-sm font-medium text-slate-700">PDBs Enforced</span>
              <span className="text-sm font-bold text-slate-900 tabular-nums">{pdbCount}</span>
            </div>
          </div>

          <div className="mt-6">
            <Button variant="outline" asChild className="w-full h-9 border-slate-200 text-slate-600 font-medium hover:bg-slate-50 rounded-lg">
              <Link to="/horizontal-pod-autoscalers">Manage Autoscalers</Link>
            </Button>
          </div>
        </Card>
      </div>

      {/* Resources Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-6 border-b border-slate-100">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold tracking-tight text-slate-900">Scaling Resources</h3>
              <p className="text-sm text-slate-500 mt-0.5">HPAs, VPAs, and disruption budgets</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative min-w-[280px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden />
                <Input
                  placeholder="Search scaling resources..."
                  className="pl-10 bg-slate-50 border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500/10 focus:border-blue-300 h-10 text-sm"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search scaling resources"
                />
              </div>
              {selectedItems.size > 0 && (
                <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">
                  {selectedItems.size} selected
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80">
                <th className="px-6 py-3.5 border-b border-slate-100 w-10">
                  <Checkbox checked={isAllSelected} onCheckedChange={toggleAll} />
                </th>
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-100">Name</th>
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-100">Kind</th>
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-100">Namespace</th>
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-100">Status</th>
                <th className="px-6 py-3.5 border-b border-slate-100"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 text-sm">
              {itemsOnPage.map((resource, idx) => {
                const isSelected = selectedItems.has(getResourceKey(resource));
                return (
                  <motion.tr
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.02 }}
                    key={getResourceKey(resource)}
                    className={cn('group hover:bg-slate-50/80 transition-colors', isSelected && 'bg-blue-50/40')}
                  >
                    <td className="px-6 py-3.5">
                      <Checkbox checked={isSelected} onCheckedChange={() => toggleSelection(resource)} />
                    </td>
                    <td className="px-6 py-3.5">
                      <span className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">{resource.name}</span>
                    </td>
                    <td className="px-6 py-3.5">
                      <Badge variant="outline" className="text-xs uppercase tracking-wider font-semibold border-slate-200 text-slate-500">{resource.kind}</Badge>
                    </td>
                    <td className="px-6 py-3.5">
                      <span className="font-mono text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">{resource.namespace}</span>
                    </td>
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className={cn('h-1.5 w-1.5 rounded-full', resource.status === 'Active' ? 'bg-emerald-500' : 'bg-amber-500')} />
                        <span className="text-xs font-medium text-slate-700">{resource.status}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-white hover:text-blue-600 hover:shadow-sm rounded-lg transition-all border border-transparent hover:border-slate-200">
                        <ArrowUpRight className="h-4 w-4" aria-hidden />
                      </Button>
                    </td>
                  </motion.tr>
                );
              })}
              {itemsOnPage.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-sm text-slate-400">
                    {searchQuery ? 'No resources match your search.' : 'No scaling resources found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalFiltered > 0 && (
          <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between gap-4">
            <ListPagination
              rangeLabel={`${totalFiltered} ${totalFiltered === 1 ? 'resource' : 'resources'}`}
              hasPrev={safePageIndex > 0}
              hasNext={start + pageSize < totalFiltered}
              onPrev={() => setPageIndex((i) => Math.max(0, i - 1))}
              onNext={() => setPageIndex((i) => Math.min(totalPages - 1, i + 1))}
              currentPage={safePageIndex + 1}
              totalPages={totalPages}
              onPageChange={(p) => setPageIndex(p - 1)}
            />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild className="h-9 px-4 font-medium border-slate-200 text-slate-600 hover:bg-white hover:text-blue-600 rounded-lg transition-all">
                <Link to="/horizontal-pod-autoscalers">HPAs</Link>
              </Button>
              <Button variant="outline" size="sm" asChild className="h-9 px-4 font-medium border-slate-200 text-slate-600 hover:bg-white hover:text-blue-600 rounded-lg transition-all">
                <Link to="/pod-disruption-budgets">PDBs</Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
