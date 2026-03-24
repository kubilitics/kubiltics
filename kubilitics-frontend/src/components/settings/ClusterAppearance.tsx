/**
 * ClusterAppearance — Per-cluster color, environment badge, and alias settings.
 * Week 7: Cluster Colors & Environment Badges
 */
import { useState, useCallback, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useClusterStore, getClusterAppearance, setClusterAppearance, getEnvBadgeLabel, getEnvBadgeClasses } from '@/stores/clusterStore';
import { cn } from '@/lib/utils';

const PRESET_COLORS = [
  { name: 'Red', hex: '#ef4444' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Yellow', hex: '#eab308' },
  { name: 'Green', hex: '#22c55e' },
  { name: 'Cyan', hex: '#06b6d4' },
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Purple', hex: '#a855f7' },
  { name: 'Pink', hex: '#ec4899' },
];

const ENVIRONMENTS = [
  { value: '', label: 'None' },
  { value: 'production', label: 'Production' },
  { value: 'staging', label: 'Staging' },
  { value: 'development', label: 'Development' },
  { value: 'testing', label: 'Testing' },
];

export function ClusterAppearanceSettings() {
  const clusters = useClusterStore((s) => s.clusters);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const [selectedClusterId, setSelectedClusterId] = useState<string>(activeCluster?.id ?? '');
  const [appearance, setAppearanceState] = useState(() => getClusterAppearance(selectedClusterId));
  const [envDropdownOpen, setEnvDropdownOpen] = useState(false);

  // Sync when selected cluster changes
  useEffect(() => {
    setAppearanceState(getClusterAppearance(selectedClusterId));
  }, [selectedClusterId]);

  // Default to active cluster
  useEffect(() => {
    if (!selectedClusterId && activeCluster?.id) {
      setSelectedClusterId(activeCluster.id);
    }
  }, [activeCluster?.id, selectedClusterId]);

  const updateAppearance = useCallback(
    (partial: Partial<{ color: string; environment: string; alias: string }>) => {
      if (!selectedClusterId) return;
      setClusterAppearance(selectedClusterId, partial);
      setAppearanceState((prev) => ({ ...prev, ...partial }));
      // Trigger re-render in header by dispatching a storage event
      window.dispatchEvent(new Event('cluster-appearance-changed'));
    },
    [selectedClusterId]
  );

  const selectedCluster = clusters.find((c) => c.id === selectedClusterId);
  const displayName = appearance.alias || selectedCluster?.name || 'Cluster';
  const envLabel = getEnvBadgeLabel(appearance.environment);
  const envClasses = getEnvBadgeClasses(appearance.environment);

  if (clusters.length === 0) return null;

  return (
    <Card className="rounded-2xl overflow-hidden shadow-md border-border/50 dark:bg-slate-900/60">
      <div className="h-1 bg-gradient-to-r from-pink-400 via-rose-500 to-orange-400" />
      <CardHeader className="pb-4 bg-gradient-to-r from-pink-50/50 to-transparent dark:from-pink-950/20">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pink-100 dark:bg-pink-900/40 shadow-sm">
            <div className="h-5 w-5 rounded-full" style={{ background: `linear-gradient(135deg, ${PRESET_COLORS[0].hex}, ${PRESET_COLORS[4].hex})` }} />
          </div>
          <div>
            <CardTitle className="text-base">Cluster Appearance</CardTitle>
            <CardDescription className="mt-0.5">Customize colors, environment badges, and aliases per cluster</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-2 pb-6 space-y-6">
        {/* Cluster selector */}
        {clusters.length > 1 && (
          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-2">Select Cluster</label>
            <div className="flex flex-wrap gap-2">
              {clusters.map((cluster) => (
                <button
                  key={cluster.id}
                  onClick={() => setSelectedClusterId(cluster.id)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all',
                    cluster.id === selectedClusterId
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border/50 text-muted-foreground hover:border-border hover:bg-muted/30'
                  )}
                >
                  {cluster.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Color picker */}
        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-2">Cluster Color</label>
          <div className="flex items-center gap-3">
            {PRESET_COLORS.map((preset) => (
              <button
                key={preset.hex}
                onClick={() => updateAppearance({ color: preset.hex })}
                className={cn(
                  'w-8 h-8 rounded-full border-2 transition-all duration-200 hover:scale-110',
                  appearance.color === preset.hex
                    ? 'border-foreground scale-110 shadow-lg'
                    : 'border-transparent hover:border-muted-foreground/30'
                )}
                style={{ backgroundColor: preset.hex }}
                title={preset.name}
                aria-label={`Set cluster color to ${preset.name}`}
              />
            ))}
          </div>
        </div>

        {/* Environment dropdown */}
        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-2">Environment</label>
          <div className="relative">
            <button
              onClick={() => setEnvDropdownOpen(!envDropdownOpen)}
              className="w-full max-w-xs h-10 px-3 rounded-lg border border-border/50 bg-background text-sm font-medium flex items-center justify-between hover:border-border transition-colors"
            >
              <span>{ENVIRONMENTS.find((e) => e.value === appearance.environment)?.label ?? 'None'}</span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </button>
            {envDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 w-full max-w-xs bg-popover border border-border rounded-lg shadow-lg z-50 py-1">
                {ENVIRONMENTS.map((env) => (
                  <button
                    key={env.value}
                    onClick={() => {
                      updateAppearance({ environment: env.value });
                      setEnvDropdownOpen(false);
                    }}
                    className={cn(
                      'w-full px-3 py-2 text-sm text-left hover:bg-muted/50 transition-colors',
                      appearance.environment === env.value && 'bg-muted/30 font-semibold'
                    )}
                  >
                    {env.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Alias input */}
        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-2">Display Alias</label>
          <Input
            value={appearance.alias}
            onChange={(e) => updateAppearance({ alias: e.target.value })}
            placeholder={selectedCluster?.name ?? 'Short display name'}
            className="max-w-xs rounded-lg h-10 text-sm"
            maxLength={32}
          />
          <p className="text-[11px] text-muted-foreground mt-1.5">Shown in the header instead of the full cluster name</p>
        </div>

        {/* Preview */}
        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-2">Preview</label>
          <div className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl border border-border/50 bg-muted/20">
            <span className="block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: appearance.color }} />
            <span className="text-sm font-bold tracking-tight truncate">{displayName}</span>
            {envLabel && (
              <span className={cn('text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border', envClasses)}>
                {envLabel}
              </span>
            )}
          </div>
          {appearance.environment === 'production' && (
            <div className="mt-3">
              <div className="h-[3px] w-48 bg-gradient-to-r from-red-500 via-red-600 to-red-500 rounded-full" />
              <p className="text-[11px] text-muted-foreground mt-1.5">Production clusters show a red warning bar at the top of the page</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
