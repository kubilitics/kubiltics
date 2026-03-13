import { useState, useCallback, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Database,
  Search,
  ArrowUpRight,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useStorageOverview } from '@/hooks/useStorageOverview';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { StorageRadial } from '@/components/storage/StorageRadial';
import { StoragePerformanceSparkline } from '@/components/storage/StoragePerformanceSparkline';
import { ListPagination } from '@/components/list/ListPagination';
import { ConnectionRequiredBanner } from '@/components/layout/ConnectionRequiredBanner';
import { PageLoadingState } from '@/components/PageLoadingState';

type StorageResource = {
  kind: string;
  name: string;
  namespace: string;
  status: string;
  capacity?: string;
};

function getResourceKey(r: StorageResource): string {
  return `${r.kind}/${r.namespace}/${r.name}`;
}

export default function StorageOverview() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [pageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);
  const queryClient = useQueryClient();
  const { data, isLoading } = useStorageOverview();

  const handleSync = useCallback(() => {
    setIsSyncing(true);
    queryClient.invalidateQueries({ queryKey: ['k8s'] });
    setTimeout(() => setIsSyncing(false), 1500);
  }, [queryClient]);

  const resources: StorageResource[] = data?.resources ?? [];

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

  const toggleSelection = (r: StorageResource) => {
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
    return <PageLoadingState message="Loading storage resources..." />;
  }

  const pvcCount = resources.filter((r) => r.kind === 'PersistentVolumeClaim').length;
  const pvCount = resources.filter((r) => r.kind === 'PersistentVolume').length;

  return (
    <div className="flex flex-col gap-6 p-6" role="main" aria-label="Storage Overview">
      <ConnectionRequiredBanner />

      <SectionOverviewHeader
        title="Storage Overview"
        description="Persistent volumes, claims, and storage class usage across your cluster."
        icon={Database}
        onSync={handleSync}
        isSyncing={isSyncing}
      />

      {/* Hero: Capacity & Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Card className="lg:col-span-8 overflow-hidden border-slate-200/80 shadow-sm bg-white" aria-live="polite">
          <CardHeader className="pb-0 pt-8 px-8">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl font-bold tracking-tight text-slate-900">Storage Capacity</CardTitle>
                <p className="text-sm text-slate-500 mt-1">Volume allocation and provisioning health</p>
              </div>
              <Badge variant="outline" className="text-xs font-semibold border-slate-200 text-slate-500">
                {pvcCount + pvCount} volumes
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0 pb-8 px-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center mt-6">
              <StorageRadial title="PVC Utilization" value={data?.pulse.optimal_percent ?? 0} subtext="Claims" />
              <div className="space-y-5 px-4">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                  <div>
                    <span className="block text-2xl font-bold text-slate-900 tabular-nums">{pvcCount}</span>
                    <span className="text-xs font-medium text-slate-500">Total PVCs</span>
                  </div>
                  <div>
                    <span className="block text-2xl font-bold text-slate-900 tabular-nums">{pvCount}</span>
                    <span className="text-xs font-medium text-slate-500">Persistent Volumes</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-medium text-slate-500">
                    <span>Provisioning Health</span>
                    <span className="text-emerald-600 font-semibold">{data?.pulse.optimal_percent.toFixed(0)}%</span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${data?.pulse.optimal_percent}%` }}
                      transition={{ duration: 1, ease: 'circOut' }}
                      className="h-full bg-blue-500 rounded-full"
                    />
                  </div>
                </div>
                <Button variant="outline" asChild className="w-full h-9 border-slate-200 text-slate-600 font-medium hover:bg-slate-50 rounded-lg">
                  <Link to="/persistent-volume-claims">Manage PVCs</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-4 border-slate-200/80 shadow-sm bg-white flex flex-col p-6 overflow-hidden">
          <CardHeader className="p-0 mb-4">
            <CardTitle className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Performance</CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 flex flex-col gap-4">
            <StoragePerformanceSparkline />
            <div className="mt-auto">
              <Button variant="outline" asChild className="w-full h-9 border-slate-200 text-slate-600 font-medium hover:bg-slate-50 rounded-lg">
                <Link to="/storage-classes">Storage Classes</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Resources Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-6 border-b border-slate-100">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold tracking-tight text-slate-900">Storage Resources</h3>
              <p className="text-sm text-slate-500 mt-0.5">Volumes, claims, and storage classes</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative min-w-[280px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden />
                <Input
                  placeholder="Search storage resources..."
                  className="pl-10 bg-slate-50 border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500/10 focus:border-blue-300 h-10 text-sm"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search storage resources"
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
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-100">Capacity</th>
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
                        <div className={cn('h-1.5 w-1.5 rounded-full', ['Bound', 'Available', 'Active'].includes(resource.status) ? 'bg-emerald-500' : 'bg-amber-500')} />
                        <span className="text-xs font-medium text-slate-700">{resource.status}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3.5">
                      <span className="text-xs font-semibold text-slate-600 tabular-nums">{resource.capacity || '—'}</span>
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
                  <td colSpan={7} className="px-6 py-12 text-center text-sm text-slate-400">
                    {searchQuery ? 'No resources match your search.' : 'No storage resources found.'}
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
                <Link to="/persistent-volumes">PVs</Link>
              </Button>
              <Button variant="outline" size="sm" asChild className="h-9 px-4 font-medium border-slate-200 text-slate-600 hover:bg-white hover:text-blue-600 rounded-lg transition-all">
                <Link to="/persistent-volume-claims">PVCs</Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
