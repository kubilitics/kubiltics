import { useMemo } from 'react';
import { Filter, ChevronDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

const SYSTEM_PREFIXES = ['kube-', 'cattle-'];
const SYSTEM_NAMESPACES = new Set(['kube-system', 'kube-public', 'kube-node-lease']);

function isSystemNamespace(ns: string): boolean {
  if (SYSTEM_NAMESPACES.has(ns)) return true;
  return SYSTEM_PREFIXES.some((p) => ns.startsWith(p));
}

export interface NamespaceFilterProps {
  /** All available namespace names (e.g. from resource list). */
  namespaces: string[];
  /** Currently selected namespaces. Empty = "All" (no filter). */
  selected: Set<string>;
  /** Called when selection changes. */
  onSelectionChange: (selected: Set<string>) => void;
  /** 'chip' = compact trigger; 'bar' = full-width for ResourceCommandBar (no chips, full label); 'default' = full button + chips. */
  triggerVariant?: 'default' | 'chip' | 'bar';
  /** Optional class for the trigger button (e.g. min-h for alignment). */
  triggerClassName?: string;
  className?: string;
}

/** Group namespaces into Project: Default (user) and Project: System. */
function groupByProject(namespaces: string[]): { project: string; namespaces: string[] }[] {
  const user: string[] = [];
  const system: string[] = [];
  for (const ns of namespaces.sort((a, b) => a.localeCompare(b))) {
    if (isSystemNamespace(ns)) system.push(ns);
    else user.push(ns);
  }
  const result: { project: string; namespaces: string[] }[] = [];
  if (user.length > 0) result.push({ project: 'Project: Default', namespaces: user });
  if (system.length > 0) result.push({ project: 'Project: System', namespaces: system });
  return result;
}

export function NamespaceFilter({
  namespaces,
  selected,
  onSelectionChange,
  triggerVariant = 'default',
  triggerClassName,
  className,
}: NamespaceFilterProps) {
  const groups = useMemo(() => groupByProject(namespaces), [namespaces]);
  const userNs = useMemo(() => namespaces.filter((n) => !isSystemNamespace(n)), [namespaces]);
  const systemNs = useMemo(() => namespaces.filter(isSystemNamespace), [namespaces]);

  const toggle = (ns: string) => {
    const next = new Set(selected);
    if (next.has(ns)) next.delete(ns);
    else next.add(ns);
    onSelectionChange(next);
  };

  const selectOnlyUser = () => onSelectionChange(new Set(userNs));
  const selectOnlySystem = () => onSelectionChange(new Set(systemNs));
  const clearSelection = () => onSelectionChange(new Set());

  const isChip = triggerVariant === 'chip';
  const isBar = triggerVariant === 'bar';
  const label =
    selected.size === 0
      ? (isChip ? 'All' : 'All Namespaces')
      : selected.size === 1
        ? Array.from(selected)[0]
        : (isChip ? `${selected.size} ns` : `${selected.size} namespaces`);

  return (
    <div className={cn('flex flex-wrap items-center gap-2', isBar && 'w-full min-w-0', className)}>
      {isBar ? (
        <div className="w-full min-w-0">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size={isChip ? 'sm' : 'default'}
                className={cn(
                  'transition-all duration-200',
                  isChip && 'gap-1.5 h-8 rounded-full border-border/80 bg-muted/30 hover:bg-muted/50 font-normal text-muted-foreground hover:text-foreground',
                  isBar && 'w-full min-w-0 justify-between h-10 shrink-0 rounded-lg border border-border bg-background font-medium text-foreground shadow-sm hover:bg-muted/50 hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-primary/20',
                  triggerClassName
                )}
              >
                {!isChip && <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />}
                <span className={cn(isChip && 'text-xs', isBar && 'truncate')}>{label}</span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground', isChip && 'h-3.5 w-3.5')} />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-0" sideOffset={4}>
              <div className="p-2 border-b border-border space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Quick select</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={selectOnlyUser} disabled={userNs.length === 0}>
                    Only User Namespaces
                  </Button>
                  <Button variant="outline" size="sm" onClick={selectOnlySystem} disabled={systemNs.length === 0}>
                    Only System Namespaces
                  </Button>
                  <Button variant="ghost" size="sm" onClick={clearSelection}>
                    Clear
                  </Button>
                </div>
              </div>
              <ScrollArea className="h-[280px]">
                <div className="p-2 space-y-3">
                  {groups.map(({ project, namespaces: list }) => (
                    <div key={project}>
                      <p className="text-xs font-semibold text-muted-foreground mb-1.5">{project}</p>
                      <div className="space-y-1">
                        {list.map((ns) => (
                          <label
                            key={ns}
                            className="flex items-center gap-2 cursor-pointer rounded px-2 py-1.5 hover:bg-muted/50"
                          >
                            <Checkbox
                              checked={selected.has(ns)}
                              onCheckedChange={() => toggle(ns)}
                            />
                            <span className="text-sm">{ns}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>
        </div>
      ) : (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size={isChip ? 'sm' : 'default'}
            className={cn(
              isChip && 'gap-1.5 h-8 rounded-full border-border/80 bg-muted/30 hover:bg-muted/50 font-normal text-muted-foreground hover:text-foreground',
              isBar && 'w-full min-w-0 justify-between h-10 shrink-0',
              triggerClassName
            )}
          >
            {!isChip && <Filter className="h-4 w-4 shrink-0" />}
            <span className={cn(isChip && 'text-xs', isBar && 'truncate')}>{label}</span>
            <ChevronDown className={cn('h-4 w-4 opacity-50 shrink-0', isChip && 'h-3.5 w-3.5')} />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0" sideOffset={4}>
          <div className="p-2 border-b border-border space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Quick select</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={selectOnlyUser} disabled={userNs.length === 0}>
                Only User Namespaces
              </Button>
              <Button variant="outline" size="sm" onClick={selectOnlySystem} disabled={systemNs.length === 0}>
                Only System Namespaces
              </Button>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                Clear
              </Button>
            </div>
          </div>
          <ScrollArea className="h-[280px]">
            <div className="p-2 space-y-3">
              {groups.map(({ project, namespaces: list }) => (
                <div key={project}>
                  <p className="text-xs font-semibold text-muted-foreground mb-1.5">{project}</p>
                  <div className="space-y-1">
                    {list.map((ns) => (
                      <label
                        key={ns}
                        className="flex items-center gap-2 cursor-pointer rounded px-2 py-1.5 hover:bg-muted/50"
                      >
                        <Checkbox
                          checked={selected.has(ns)}
                          onCheckedChange={() => toggle(ns)}
                        />
                        <span className="text-sm">{ns}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
      )}
      {selected.size > 0 && !isChip && !isBar && (
        <div className="flex flex-wrap gap-1">
          {Array.from(selected).map((ns) => (
            <span
              key={ns}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-medium"
            >
              {ns}
              <button
                type="button"
                className="hover:bg-primary/20 rounded p-0.5"
                onClick={() => toggle(ns)}
                aria-label={`Remove ${ns}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
