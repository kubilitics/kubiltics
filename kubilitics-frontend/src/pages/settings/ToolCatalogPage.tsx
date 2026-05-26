/**
 * Tool Catalog — browses all AI tools the brain knows about.
 *
 * Renders from the baked-in static catalog so the page works even when
 * the brain is offline (first launch, crash).  When the brain IS reachable
 * it overlays live certification grades fetched from
 * GET /api/v1/ai/mcp/certification so operators can see which tools are
 * Certified / Provisional / Uncertified without leaving Settings.
 */
import { useEffect, useMemo, useState } from 'react';
import { Library, Search, ShieldCheck, ShieldAlert, ShieldX, Lock } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { cn } from '@/lib/utils';
import { apiUrl } from '@/lib/backendUrl';

import catalogData from '@/data/tool-catalog.json';

type ToolEntry = {
  name: string;
  category: string;
  group: string;
  description: string;
};

type Catalog = {
  generated_at: string;
  version: string;
  tools: ToolEntry[];
};

type CertSummary = {
  enabled: boolean;
  certified: number;
  provisional: number;
  uncertified: number;
  blocked: number;
  blocked_tools: string[];
};

type Grade = 'certified' | 'provisional' | 'uncertified';

const catalog = catalogData as Catalog;
const ALL_GROUPS = Array.from(new Set(catalog.tools.map((t) => t.group))).sort();

const GRADE_META: Record<Grade, { label: string; icon: React.ElementType; className: string }> = {
  certified:   { label: 'Certified',   icon: ShieldCheck, className: 'text-green-600 dark:text-green-400' },
  provisional: { label: 'Provisional', icon: ShieldAlert, className: 'text-amber-500 dark:text-amber-400' },
  uncertified: { label: 'Uncertified', icon: ShieldX,     className: 'text-red-500 dark:text-red-400' },
};

function GradeBadge({ toolName, grades, blocked }: {
  toolName: string;
  grades: Map<string, Grade>;
  blocked: Set<string>;
}) {
  if (blocked.has(toolName)) {
    return (
      <span className="flex items-center gap-1 text-xs text-red-500 dark:text-red-400" title="Blocked: destructive + uncertified">
        <Lock className="h-3 w-3" />
        Blocked
      </span>
    );
  }
  const grade = grades.get(toolName);
  if (!grade) return null;
  const { label, icon: Icon, className } = GRADE_META[grade];
  return (
    <span className={cn('flex items-center gap-1 text-xs', className)} title={`Certification grade: ${label}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

export default function ToolCatalogPage() {
  const [query, setQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<string | 'all'>('all');
  const [cert, setCert] = useState<CertSummary | null>(null);
  const [grades, setGrades] = useState<Map<string, Grade>>(new Map());
  const [blocked, setBlocked] = useState<Set<string>>(new Set());

  // Fetch live certification data — soft failure is fine, static catalog still shows.
  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl('/api/v1/ai/mcp/certification'))
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: CertSummary & { grades?: Record<string, Grade> }) => {
        if (cancelled) return;
        setCert(data);
        // Build a per-tool grade map from the blocked list.
        // blocked_tools → uncertified; all others → provisional.
        // (Full per-tool grades require the certification report file.)
        const blockedSet = new Set(data.blocked_tools ?? []);
        setBlocked(blockedSet);
        const m = new Map<string, Grade>();
        for (const tool of catalog.tools) {
          m.set(tool.name, blockedSet.has(tool.name) ? 'uncertified' : 'provisional');
        }
        setGrades(m);
      })
      .catch(() => { /* brain offline — static catalog still renders */ });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.tools.filter((t) => {
      if (activeGroup !== 'all' && t.group !== activeGroup) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
      );
    });
  }, [query, activeGroup]);

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of catalog.tools) {
      counts.set(t.group, (counts.get(t.group) ?? 0) + 1);
    }
    return counts;
  }, []);

  const certAvailable = cert?.enabled === true;

  return (
    <div className="page-container" role="main" aria-label="AI Tool Catalog">
      <div className="page-inner p-6 gap-6 flex flex-col">
        <SectionOverviewHeader
          title="AI Tool Catalog"
          description={`${catalog.tools.length} tools the AI can call when answering your questions. Version ${catalog.version}.`}
          icon={Library}
          showAiButton={false}
        />

        {/* Live certification summary banner */}
        {certAvailable && cert && (
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
              <ShieldCheck className="h-4 w-4" />
              {cert.certified} certified
            </span>
            <span className="flex items-center gap-1.5 text-amber-500 dark:text-amber-400">
              <ShieldAlert className="h-4 w-4" />
              {cert.provisional} provisional
            </span>
            <span className="flex items-center gap-1.5 text-red-500 dark:text-red-400">
              <ShieldX className="h-4 w-4" />
              {cert.uncertified} uncertified
            </span>
            <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400 font-medium">
              <Lock className="h-4 w-4" />
              {cert.blocked} blocked
            </span>
          </div>
        )}

        <Card className="border-none soft-shadow glass-panel">
          <CardContent className="p-5 flex flex-col gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name or description…"
                className="pl-9"
                aria-label="Search tools"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant={activeGroup === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActiveGroup('all')}
              >
                All <span className="ml-1 opacity-70">{catalog.tools.length}</span>
              </Button>
              {ALL_GROUPS.map((g) => (
                <Button
                  key={g}
                  variant={activeGroup === g ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setActiveGroup(g)}
                >
                  {g} <span className="ml-1 opacity-70">{groupCounts.get(g) ?? 0}</span>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="text-sm text-muted-foreground">
          Showing {filtered.length} of {catalog.tools.length} tools.
          {!certAvailable && (
            <span className="ml-2 opacity-60">(Start the brain to see live certification grades.)</span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((t) => (
            <Card
              key={t.name}
              className={cn(
                'border-none soft-shadow glass-panel transition-shadow hover:shadow-md',
                blocked.has(t.name) && 'ring-1 ring-red-400/40',
              )}
            >
              <CardContent className="p-5 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <code className="font-mono text-sm font-semibold">{t.name}</code>
                  <div className="flex items-center gap-2 shrink-0">
                    {certAvailable && (
                      <GradeBadge toolName={t.name} grades={grades} blocked={blocked} />
                    )}
                    <Badge variant="outline" className="text-xs">
                      {t.group}
                    </Badge>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {t.description || (
                    <span className="italic opacity-60">(no description)</span>
                  )}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        {filtered.length === 0 && (
          <Card className="border-none soft-shadow glass-panel">
            <CardContent className="p-8 text-center text-muted-foreground">
              No tools match your filter.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
