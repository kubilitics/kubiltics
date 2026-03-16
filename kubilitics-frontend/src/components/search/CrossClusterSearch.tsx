/**
 * CrossClusterSearch — ENT-005
 *
 * Global search component designed for the app header. Searches across all
 * connected clusters with debounced input (300ms) and groups results by cluster.
 */

import { useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  X,
  Loader2,
  Server,
  Box,
  Globe,
  FileText,
  Lock,
  Network,
  Layers,
  AlertCircle,
} from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useCrossClusterSearch, type SearchResultKind } from '@/hooks/useCrossClusterSearch';

// ─── Kind icons ──────────────────────────────────────────────

const KIND_ICONS: Record<string, React.ElementType> = {
  Pod: Box,
  Deployment: Layers,
  Service: Globe,
  ConfigMap: FileText,
  Secret: Lock,
  Namespace: Layers,
  Node: Server,
  Ingress: Network,
  StatefulSet: Layers,
  DaemonSet: Layers,
  Job: Box,
  CronJob: Box,
  PersistentVolumeClaim: Box,
};

const KIND_COLORS: Record<string, string> = {
  Pod: 'text-blue-500',
  Deployment: 'text-purple-500',
  Service: 'text-emerald-500',
  ConfigMap: 'text-amber-500',
  Secret: 'text-red-500',
  Node: 'text-cyan-500',
  Namespace: 'text-indigo-500',
  Ingress: 'text-teal-500',
};

// ─── Component ───────────────────────────────────────────────

interface CrossClusterSearchProps {
  className?: string;
}

export default function CrossClusterSearch({ className }: CrossClusterSearchProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    query,
    setQuery,
    results,
    totalCount,
    isSearching,
    error,
    reset,
  } = useCrossClusterSearch();

  const isOpen = query.trim().length > 0;

  // ── Keyboard shortcut: / to focus search ───────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // "/" to focus, but not when in an input/textarea
      if (
        e.key === '/' &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      // Escape to close
      if (e.key === 'Escape' && isOpen) {
        reset();
        inputRef.current?.blur();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, reset]);

  // ── Click outside to close ─────────────────────────────────

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        reset();
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, reset]);

  // ── Navigate to result ─────────────────────────────────────

  const handleSelect = useCallback(
    (href: string) => {
      reset();
      navigate(href);
    },
    [reset, navigate]
  );

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search all clusters... (press /)"
          className="pl-9 pr-9 h-9 w-[320px] bg-muted/50 border-muted-foreground/20 focus:bg-background transition-colors"
        />
        {query && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
            onClick={reset}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Results dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 mt-2 w-[480px] max-h-[400px] overflow-auto
              rounded-xl border bg-popover shadow-xl z-50"
          >
            {/* Loading state */}
            {isSearching && (
              <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching across clusters...
              </div>
            )}

            {/* Error state */}
            {error && !isSearching && (
              <div className="flex items-center gap-2 px-4 py-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}

            {/* Results */}
            {!isSearching && !error && results.length > 0 && (
              <div className="py-2">
                <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground">
                  {totalCount} result{totalCount !== 1 ? 's' : ''} across {results.filter((g) => g.results.length > 0).length} cluster{results.filter((g) => g.results.length > 0).length !== 1 ? 's' : ''}
                </div>
                {results
                  .filter((group) => group.results.length > 0 || group.error)
                  .map((group) => (
                    <div key={group.cluster.id}>
                      {/* Cluster header */}
                      <div className="flex items-center gap-2 px-4 py-2 bg-muted/30 border-t border-b">
                        <Server className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-semibold text-muted-foreground">
                          {group.cluster.name}
                        </span>
                        <Badge variant="outline" className="text-xs px-1 py-0 ml-auto">
                          {group.results.length}
                        </Badge>
                      </div>

                      {/* Cluster results */}
                      {group.results.map((result, idx) => {
                        const Icon = KIND_ICONS[result.kind] ?? Box;
                        const color = KIND_COLORS[result.kind] ?? 'text-muted-foreground';
                        return (
                          <button
                            key={`${result.kind}-${result.namespace}-${result.name}-${idx}`}
                            className="flex items-center gap-3 w-full px-4 py-2.5 text-left
                              hover:bg-muted/50 transition-colors focus:bg-muted/50 focus:outline-none"
                            onClick={() => handleSelect(result.href)}
                          >
                            <Icon className={cn('h-4 w-4 shrink-0', color)} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium truncate">{result.name}</span>
                                <Badge variant="secondary" className="text-xs px-1.5 py-0 shrink-0">
                                  {result.kind}
                                </Badge>
                              </div>
                              {result.namespace && (
                                <span className="text-xs text-muted-foreground">
                                  {result.namespace}
                                </span>
                              )}
                            </div>
                            {result.age && (
                              <span className="text-xs text-muted-foreground shrink-0">{result.age}</span>
                            )}
                            {result.status && (
                              <Badge
                                variant={result.status === 'Running' ? 'default' : 'outline'}
                                className="text-xs px-1.5 py-0"
                              >
                                {result.status}
                              </Badge>
                            )}
                          </button>
                        );
                      })}

                      {/* Cluster error */}
                      {group.error && (
                        <div className="flex items-center gap-2 px-4 py-2 text-xs text-destructive">
                          <AlertCircle className="h-3.5 w-3.5" />
                          {group.error}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            )}

            {/* Empty state */}
            {!isSearching && !error && totalCount === 0 && query.trim().length > 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <Search className="h-8 w-8 opacity-30" />
                <p className="text-sm">No resources found for "{query}"</p>
                <p className="text-xs">Try a different search term or check cluster connectivity</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
