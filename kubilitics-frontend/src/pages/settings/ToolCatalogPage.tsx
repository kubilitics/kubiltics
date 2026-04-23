/**
 * Tool Catalog — browses all AI tools the brain knows about.
 *
 * Source: src/data/tool-catalog.json, generated from the brain's
 * taxonomy.go + plain-english.json at build time. 193 entries keyed
 * by tool name with {group, category, description}.
 *
 * Why static? The brain isn't guaranteed to be running when a user
 * opens Settings (first launch, brain crash). Baking the data means
 * the catalog always renders.
 */
import { useMemo, useState } from 'react';
import { Library, Search } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { cn } from '@/lib/utils';

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

const catalog = catalogData as Catalog;
const ALL_GROUPS = Array.from(new Set(catalog.tools.map((t) => t.group))).sort();

export default function ToolCatalogPage() {
  const [query, setQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<string | 'all'>('all');

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

  return (
    <div className="page-container" role="main" aria-label="AI Tool Catalog">
      <div className="page-inner p-6 gap-6 flex flex-col">
        <SectionOverviewHeader
          title="AI Tool Catalog"
          description={`${catalog.tools.length} tools the AI can call when answering your questions. Version ${catalog.version}.`}
          icon={Library}
          showAiButton={false}
        />

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
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((t) => (
            <Card
              key={t.name}
              className="border-none soft-shadow glass-panel transition-shadow hover:shadow-md"
            >
              <CardContent className="p-5 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <code className="font-mono text-sm font-semibold">{t.name}</code>
                  <Badge variant="outline" className={cn('text-xs shrink-0')}>
                    {t.group}
                  </Badge>
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
