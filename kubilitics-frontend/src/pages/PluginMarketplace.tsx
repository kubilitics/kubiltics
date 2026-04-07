/**
 * Plugin Marketplace page.
 *
 * Browse, search, install, and uninstall kcli plugins. Shows plugin cards
 * with name, description, author, install count, and official badge.
 * Supports category filtering, search, and sort.
 *
 * Official plugins: istio, argocd, cert-manager, flux, kyverno.
 *
 * TASK-KCLI-001
 */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, RefreshCw, Loader2, WifiOff, Download, Trash2,
  Star, Shield, CheckCircle2, ExternalLink, Filter, ArrowUpDown,
  Puzzle, Globe, GitBranch, Lock, Eye, BarChart3, Package,
  ChevronDown, Tag,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { PageLayout } from '@/components/layout/PageLayout';
import { ApiError } from '@/components/ui/error-state';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { usePluginRegistry, type PluginCategory, type PluginInfo } from '@/hooks/usePluginRegistry';
import { toast } from '@/components/ui/sonner';
import { openExternal } from '@/lib/tauri';

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const CATEGORY_ICONS: Record<PluginCategory, React.ElementType> = {
  'service-mesh': Globe,
  gitops: GitBranch,
  security: Lock,
  certificates: Shield,
  policy: Shield,
  monitoring: BarChart3,
  networking: Globe,
  storage: Package,
  other: Puzzle,
};

const CATEGORY_LABELS: Record<PluginCategory, string> = {
  'service-mesh': 'Service Mesh',
  gitops: 'GitOps',
  security: 'Security',
  certificates: 'Certificates',
  policy: 'Policy',
  monitoring: 'Monitoring',
  networking: 'Networking',
  storage: 'Storage',
  other: 'Other',
};

type SortOption = 'downloads' | 'stars' | 'name';

// ── Plugin Card ────────────────────────────────────────────────────────────────

interface PluginCardProps {
  plugin: PluginInfo;
  onInstall: (id: string) => void;
  onUninstall: (id: string) => void;
  isOperating: boolean;
}

function PluginCard({ plugin, onInstall, onUninstall, isOperating }: PluginCardProps) {
  const isInstalled = plugin.status === 'installed' || plugin.status === 'update-available';
  const isInstalling = plugin.status === 'installing';
  const isUninstalling = plugin.status === 'uninstalling';
  const CategoryIcon = CATEGORY_ICONS[plugin.category] ?? Puzzle;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="h-full flex flex-col border-none soft-shadow glass-panel hover:shadow-lg transition-all">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              {plugin.iconUrl ? (
                <img src={plugin.iconUrl} alt="" className="h-8 w-8 rounded-md" />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted/60 dark:bg-muted/30">
                  <CategoryIcon className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
              <div>
                <CardTitle className="text-sm leading-tight">{plugin.name}</CardTitle>
                <p className="text-[11px] text-muted-foreground">{plugin.author}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {plugin.official && (
                <Badge variant="secondary" className="text-[9px] gap-0.5">
                  <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />
                  Official
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 pb-3">
          <p className="text-xs text-muted-foreground line-clamp-2">{plugin.description}</p>
          <div className="flex items-center gap-3 mt-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Download className="h-3 w-3" /> {formatNumber(plugin.downloads)}
            </span>
            <span className="flex items-center gap-1">
              <Star className="h-3 w-3" /> {formatNumber(plugin.stars)}
            </span>
            <Badge variant="outline" className="text-[9px]">
              v{plugin.version}
            </Badge>
          </div>
          {plugin.keywords.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {plugin.keywords.slice(0, 3).map((tag) => (
                <Badge key={tag} variant="secondary" className="text-[9px] font-normal">
                  {tag}
                </Badge>
              ))}
              {plugin.keywords.length > 3 && (
                <Badge variant="secondary" className="text-[9px] font-normal">
                  +{plugin.keywords.length - 3}
                </Badge>
              )}
            </div>
          )}
        </CardContent>
        <CardFooter className="pt-0 pb-3 px-4">
          <div className="flex items-center gap-2 w-full">
            {isInstalled ? (
              <>
                <Badge variant="default" className="text-[10px] gap-1 flex-shrink-0">
                  <CheckCircle2 className="h-2.5 w-2.5" /> Installed
                </Badge>
                {plugin.status === 'update-available' && (
                  <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={isOperating}>
                    Update
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px] text-red-600 dark:text-red-400 ml-auto"
                  onClick={(e) => { e.stopPropagation(); onUninstall(plugin.id); }}
                  disabled={isOperating || isUninstalling}
                >
                  {isUninstalling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  <span className="ml-1">Uninstall</span>
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  className="h-7 text-[11px] flex-1"
                  onClick={(e) => { e.stopPropagation(); onInstall(plugin.id); }}
                  disabled={isOperating || isInstalling}
                >
                  {isInstalling ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Download className="mr-1 h-3 w-3" />
                  )}
                  {isInstalling ? 'Installing...' : 'Install'}
                </Button>
                {plugin.homepageUrl && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => void openExternal(plugin.homepageUrl!)}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                )}
              </>
            )}
          </div>
        </CardFooter>
      </Card>
    </motion.div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function PluginMarketplace() {
  const { isOnline } = useConnectionStatus();
  const [selectedCategory, setSelectedCategory] = useState<PluginCategory | undefined>();
  const [sortBy, setSortBy] = useState<SortOption>('downloads');
  const [tab, setTab] = useState<'all' | 'installed'>('all');

  const {
    plugins,
    allPlugins,
    isLoading,
    error: registryError,
    searchQuery,
    setSearchQuery,
    install,
    uninstall,
    isInstalling,
    isUninstalling,
    refetch,
  } = usePluginRegistry({
    category: selectedCategory,
    installedOnly: tab === 'installed',
  });

  const isOperating = isInstalling || isUninstalling;

  // Sort
  const sorted = useMemo(() => {
    const items = [...plugins];
    switch (sortBy) {
      case 'downloads': items.sort((a, b) => b.downloads - a.downloads); break;
      case 'stars': items.sort((a, b) => b.stars - a.stars); break;
      case 'name': items.sort((a, b) => a.name.localeCompare(b.name)); break;
    }
    return items;
  }, [plugins, sortBy]);

  const installedCount = allPlugins.filter(
    (p) => p.status === 'installed' || p.status === 'update-available',
  ).length;

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts = new Map<PluginCategory, number>();
    for (const p of allPlugins) {
      counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    }
    return counts;
  }, [allPlugins]);

  if (registryError) {
    return (
      <PageLayout label="Plugin Marketplace">
        <ApiError onRetry={() => refetch()} message={(registryError as Error)?.message} />
      </PageLayout>
    );
  }

  return (
    <PageLayout label="Plugin Marketplace">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Puzzle className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-xl font-semibold text-foreground dark:text-foreground">
            Plugin Marketplace
          </h1>
          <Badge variant="secondary">{allPlugins.length} plugins</Badge>
          {!isOnline && <WifiOff className="h-4 w-4 text-amber-500" />}
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'all' | 'installed')}>
        <div className="flex items-center justify-between gap-4">
          <TabsList>
            <TabsTrigger value="all" className="flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5" /> All Plugins
            </TabsTrigger>
            <TabsTrigger value="installed" className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> Installed
              {installedCount > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px]">{installedCount}</Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 mt-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search plugins..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={selectedCategory ?? '_all'} onValueChange={(v) => setSelectedCategory(v === '_all' ? undefined : v as PluginCategory)}>
            <SelectTrigger className="w-[160px]">
              <Filter className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Categories</SelectItem>
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
                const count = categoryCounts.get(key as PluginCategory) ?? 0;
                if (count === 0) return null;
                return (
                  <SelectItem key={key} value={key}>
                    {label} ({count})
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
            <SelectTrigger className="w-[140px]">
              <ArrowUpDown className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="downloads">Most Downloads</SelectItem>
              <SelectItem value="stars">Most Stars</SelectItem>
              <SelectItem value="name">Name A-Z</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Content */}
        <TabsContent value="all" className="mt-4">
          {isLoading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <Puzzle className="h-12 w-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm font-medium text-foreground">No plugins found</p>
              <p className="text-xs text-muted-foreground mt-1">
                {searchQuery ? 'Try adjusting your search or clearing filters.' : 'No plugins available in this category.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <AnimatePresence mode="popLayout">
                {sorted.map((plugin) => (
                  <PluginCard
                    key={plugin.id}
                    plugin={plugin}
                    onInstall={install}
                    onUninstall={uninstall}
                    isOperating={isOperating}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </TabsContent>

        <TabsContent value="installed" className="mt-4">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <Package className="h-12 w-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm font-medium text-foreground">No plugins installed</p>
              <p className="text-xs text-muted-foreground mt-1">
                Browse the marketplace to install plugins for your cluster.
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setTab('all')}>
                Browse Plugins
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <AnimatePresence mode="popLayout">
                {sorted.map((plugin) => (
                  <PluginCard
                    key={plugin.id}
                    plugin={plugin}
                    onInstall={install}
                    onUninstall={uninstall}
                    isOperating={isOperating}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}
