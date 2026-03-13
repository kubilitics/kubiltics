import { useState, useCallback, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Gauge,
  Search,
  ArrowUpRight,
  Cpu,
  Zap,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useResourcesOverview } from '@/hooks/useResourcesOverview';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { QuotaPulse } from '@/components/resources/QuotaPulse';
import { ListPagination } from '@/components/list/ListPagination';
import { ConnectionRequiredBanner } from '@/components/layout/ConnectionRequiredBanner';
import { PageLoadingState } from '@/components/PageLoadingState';

type ResourceItem = {
  kind: string;
  name: string;
  namespace: string;
  status: string;
};

function getResourceKey(r: ResourceItem): string {
  return `${r.kind}/${r.namespace}/${r.name}`;
}

export default function ResourcesOverview() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [pageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);
  const queryClient = useQueryClient();
  const { data, isLoading } = useResourcesOverview();

  const handleSync = useCallback(() => {
    setIsSyncing(true);
    queryClient.invalidateQueries({ queryKey: ['k8s'] });
    setTimeout(() => setIsSyncing(false), 1500);
  }, [queryClient]);

  const resources: ResourceItem[] = data?.resources ?? [];

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

  const toggleSelection = (r: ResourceItem) => {
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
    return <PageLoadingState message="Loading resource constraints..." />;
  }

  const quotaCount = resources.filter((r) => r.kind === 'ResourceQuota').length;
  const limitCount = resources.filter((r) => r.kind === 'LimitRange').length;
  const sliceCount = resources.filter((r) => r.kind === 'ResourceSlice').length;
  const classCount = resources.filter((r) => r.kind === 'DeviceClass').length;

  return (
    <div className="flex flex-col gap-6 p-6" role="main" aria-label="Resources Overview">
      <ConnectionRequiredBanner />

      <SectionOverviewHeader
        title="Resources Overview"
        description="Resource quotas, limit ranges, and dynamic resource allocation."
        icon={Gauge}
        onSync={handleSync}
        isSyncing={isSyncing}
      />

      {/* Hero: Quota Pulse & DRA */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Card className="lg:col-span-8 overflow-hidden border-slate-200/80 shadow-sm bg-white">
          <CardHeader className="pb-0 pt-8 px-8">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl font-bold tracking-tight text-slate-900">Resource Usage</CardTitle>
                <p className="text-sm text-slate-500 mt-1">Quota allocation across CPU, memory, and storage</p>
              </div>
              <Badge variant="outline" className="text-xs font-semibold border-slate-200 text-slate-500">
                {quotaCount} quotas · {limitCount} limits
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-4 pb-8 px-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <QuotaPulse title="CPU Quota" percent={24} color="#3b82f6" />
              <QuotaPulse title="Memory Quota" percent={68} color="#8b5cf6" />
              <QuotaPulse title="Storage Quota" percent={42} color="#06b6d4" />
            </div>

            <div className="mt-6 border-t border-slate-100 pt-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="text-xs font-medium border-slate-200 text-slate-500">{quotaCount} Quotas</Badge>
                <Badge variant="outline" className="text-xs font-medium border-slate-200 text-slate-500">{limitCount} Limits</Badge>
              </div>
              <Button variant="outline" asChild className="h-9 border-slate-200 text-slate-600 font-medium hover:bg-slate-50 rounded-lg">
                <Link to="/resource-quotas">View Quotas</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-4 border-slate-200/80 shadow-sm bg-white flex flex-col p-8 overflow-hidden">
          <div className="flex items-center gap-2 mb-4">
            <Cpu className="h-5 w-5 text-amber-500" />
            <h3 className="text-sm font-bold text-slate-900">Dynamic Resource Allocation</h3>
          </div>
          <p className="text-xs text-slate-500 mb-5">Request specialized hardware like GPUs and FPGAs beyond standard resource limits.</p>

          <div className="grid grid-cols-2 gap-3 mb-5">
            <div className="py-3 px-4 rounded-xl bg-slate-50 border border-slate-100">
              <span className="block text-xs font-medium text-slate-500">Resource Slices</span>
              <span className="text-xl font-bold text-slate-900 tabular-nums">{sliceCount}</span>
            </div>
            <div className="py-3 px-4 rounded-xl bg-slate-50 border border-slate-100">
              <span className="block text-xs font-medium text-slate-500">Device Classes</span>
              <span className="text-xl font-bold text-slate-900 tabular-nums">{classCount}</span>
            </div>
          </div>

          <div className="mt-auto">
            <Button variant="outline" asChild className="w-full h-9 border-slate-200 text-slate-600 font-medium hover:bg-slate-50 rounded-lg">
              <Link to="/resource-slices">Manage DRA</Link>
            </Button>
          </div>
        </Card>
      </div>

      {/* Resources Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-6 border-b border-slate-100">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold tracking-tight text-slate-900">Resource Constraints</h3>
              <p className="text-sm text-slate-500 mt-0.5">Quotas, limit ranges, and device classes</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative min-w-[280px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden />
                <Input
                  placeholder="Search constraints..."
                  className="pl-10 bg-slate-50 border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500/10 focus:border-blue-300 h-10 text-sm"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search resource constraints"
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
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        <span className="text-xs font-medium text-slate-700">Enforced</span>
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
                    {searchQuery ? 'No resources match your search.' : 'No resource constraints found.'}
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
                <Link to="/resource-quotas">Quotas</Link>
              </Button>
              <Button variant="outline" size="sm" asChild className="h-9 px-4 font-medium border-slate-200 text-slate-600 hover:bg-white hover:text-blue-600 rounded-lg transition-all">
                <Link to="/limit-ranges">Limits</Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
