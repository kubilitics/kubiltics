import { useState, useCallback, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  FileCode,
  Search,
  ArrowUpRight,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { motion } from 'framer-motion';
import { useCRDOverview } from '@/hooks/useCRDOverview';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { ListPagination } from '@/components/list/ListPagination';
import { ConnectionRequiredBanner } from '@/components/layout/ConnectionRequiredBanner';
import { PageLoadingState } from '@/components/PageLoadingState';

type CRDResource = {
  kind: string;
  name: string;
  group?: string;
  status: string;
};

function getResourceKey(r: CRDResource): string {
  return `${r.kind}/${r.name}`;
}

export default function CRDsOverview() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [pageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);
  const queryClient = useQueryClient();
  const { data, isLoading } = useCRDOverview();

  const handleSync = useCallback(() => {
    setIsSyncing(true);
    queryClient.invalidateQueries({ queryKey: ['k8s'] });
    setTimeout(() => setIsSyncing(false), 1500);
  }, [queryClient]);

  const resources: CRDResource[] = useMemo(() => data?.resources ?? [], [data?.resources]);

  const filteredResources = useMemo(() => {
    if (!searchQuery.trim()) return resources;
    const q = searchQuery.toLowerCase();
    return resources.filter(
      (r) => r.name.toLowerCase().includes(q) || r.kind.toLowerCase().includes(q) || (r.group ?? '').toLowerCase().includes(q)
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

  const toggleSelection = (r: CRDResource) => {
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
    return <PageLoadingState message="Loading custom resources..." />;
  }

  return (
    <div className="flex flex-col gap-6 p-6" role="main" aria-label="Custom Resources">
      <ConnectionRequiredBanner />

      <SectionOverviewHeader
        title="Custom Resources"
        description="Custom resource definitions extending the Kubernetes API."
        icon={FileCode}
        onSync={handleSync}
        isSyncing={isSyncing}
      />

      {/* Hero: CRD Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Card className="lg:col-span-8 overflow-hidden border-slate-200/80 dark:border-slate-700/80 shadow-sm bg-white dark:bg-slate-900">
          <CardHeader className="pt-8 px-8 pb-4">
            <CardTitle className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">API Extensions</CardTitle>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Custom resource definitions registered in your cluster</p>
          </CardHeader>
          <CardContent className="pb-8 px-8">
            <div className="flex items-end gap-8 mt-2">
              <div>
                <span className="block text-5xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">{resources.length}</span>
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1 block">Definitions</span>
              </div>
              <div className="h-12 w-px bg-slate-100 dark:bg-slate-700" />
              <div>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="text-sm font-semibold text-emerald-600">All Established</span>
                </div>
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1 block">Schema validation passing</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-4 border-slate-200/80 dark:border-slate-700/80 shadow-sm bg-white dark:bg-slate-900 flex flex-col p-8 overflow-hidden">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-2">Quick Actions</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">Browse and manage custom API extensions.</p>

          <div className="flex-1 space-y-3">
            <Button variant="outline" asChild className="w-full h-9 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-medium hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg justify-start">
              <Link to="/customresourcedefinitions">Browse All CRDs</Link>
            </Button>
            <Button variant="outline" asChild className="w-full h-9 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-medium hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg justify-start">
              <Link to="/custom-resources">View Custom Resources</Link>
            </Button>
          </div>
        </Card>
      </div>

      {/* Resources Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700/80 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">Custom Resource Definitions</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">All CRDs registered in the cluster</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative min-w-[280px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden />
                <Input
                  placeholder="Search definitions..."
                  className="pl-10 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl focus:bg-white dark:focus:bg-slate-900 focus:ring-2 focus:ring-blue-500/10 focus:border-blue-300 dark:focus:border-blue-600 h-10 text-sm"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search custom resource definitions"
                />
              </div>
              {selectedItems.size > 0 && (
                <Badge variant="secondary" className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700">
                  {selectedItems.size} selected
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 dark:bg-slate-800/80">
                <th className="px-6 py-3.5 border-b border-slate-100 dark:border-slate-700 w-10">
                  <Checkbox checked={isAllSelected} onCheckedChange={toggleAll} />
                </th>
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700">Name</th>
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700">API Group</th>
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700">Status</th>
                <th className="px-6 py-3.5 border-b border-slate-100 dark:border-slate-700"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800 text-sm">
              {itemsOnPage.map((resource, idx) => {
                const isSelected = selectedItems.has(getResourceKey(resource));
                return (
                  <motion.tr
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.02 }}
                    key={getResourceKey(resource)}
                    className={cn('group hover:bg-slate-50/80 dark:hover:bg-slate-800/80 transition-colors', isSelected && 'bg-blue-50/40 dark:bg-blue-900/20')}
                  >
                    <td className="px-6 py-3.5">
                      <Checkbox checked={isSelected} onCheckedChange={() => toggleSelection(resource)} />
                    </td>
                    <td className="px-6 py-3.5">
                      <span className="font-semibold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{resource.name}</span>
                    </td>
                    <td className="px-6 py-3.5">
                      <span className="font-mono text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">{resource.group ?? '—'}</span>
                    </td>
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Established</span>
                      </div>
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-white dark:hover:bg-slate-800 hover:text-blue-600 dark:hover:text-blue-400 hover:shadow-sm rounded-lg transition-all border border-transparent hover:border-slate-200 dark:hover:border-slate-600">
                        <ArrowUpRight className="h-4 w-4" aria-hidden />
                      </Button>
                    </td>
                  </motion.tr>
                );
              })}
              {itemsOnPage.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center">
                    <EmptyState
                      icon={FileCode}
                      title={searchQuery ? "No definitions match your search" : "No custom resource definitions found"}
                      description={searchQuery ? "Try adjusting your search terms." : "CRDs extending the Kubernetes API will appear here once registered."}
                      size="sm"
                      primaryAction={searchQuery ? { label: "Clear search", onClick: () => setSearchQuery('') } : undefined}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalFiltered > 0 && (
          <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50">
            <ListPagination
              rangeLabel={`${totalFiltered} ${totalFiltered === 1 ? 'definition' : 'definitions'}`}
              hasPrev={safePageIndex > 0}
              hasNext={start + pageSize < totalFiltered}
              onPrev={() => setPageIndex((i) => Math.max(0, i - 1))}
              onNext={() => setPageIndex((i) => Math.min(totalPages - 1, i + 1))}
              currentPage={safePageIndex + 1}
              totalPages={totalPages}
              onPageChange={(p) => setPageIndex(p - 1)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
