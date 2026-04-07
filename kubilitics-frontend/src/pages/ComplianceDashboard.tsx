/**
 * ComplianceDashboard — ENT-012
 *
 * Compliance overview page at /compliance showing:
 * - CIS Kubernetes Benchmark score card
 * - RBAC compliance score
 * - Network policy coverage
 * - Pod security standards compliance
 * - Color-coded pass/fail indicators
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Shield,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Loader2,
  TrendingUp,
  ChevronRight,
} from 'lucide-react';
import { toast } from '@/components/ui/sonner';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { PageLayout } from '@/components/layout/PageLayout';
import { ApiError } from '@/components/ui/error-state';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { PageSkeleton } from '@/components/loading';

// ─── Types ───────────────────────────────────────────────────

interface ComplianceCategory {
  id: string;
  name: string;
  icon: React.ElementType;
  score: number; // 0-100
  passed: number;
  failed: number;
  warnings: number;
  total: number;
  items: ComplianceItem[];
}

interface ComplianceItem {
  id: string;
  title: string;
  status: 'pass' | 'fail' | 'warning' | 'not-applicable';
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  remediation?: string;
}

// ─── Score color helpers ─────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 90) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 70) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function scoreBgColor(score: number): string {
  if (score >= 90) return 'bg-emerald-500';
  if (score >= 70) return 'bg-amber-500';
  return 'bg-red-500';
}

function scoreLabel(score: number): string {
  if (score >= 90) return 'Excellent';
  if (score >= 70) return 'Good';
  if (score >= 50) return 'Needs Improvement';
  return 'Critical';
}

function statusIcon(status: string) {
  switch (status) {
    case 'pass':
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case 'fail':
      return <XCircle className="h-4 w-4 text-red-500" />;
    case 'warning':
      return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    default:
      return <div className="h-4 w-4 rounded-full bg-muted" />;
  }
}

// No mock data — empty state shown when compliance engine is not connected

// ─── Component ───────────────────────────────────────────────

export default function ComplianceDashboard() {
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const [categories, setCategories] = useState<ComplianceCategory[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [lastScanned, setLastScanned] = useState<string>(new Date().toISOString());

  // ── Fetch compliance data ──────────────────────────────────

  const fetchCompliance = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`${backendBaseUrl}/api/v1/compliance/overview`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.categories) setCategories(data.categories);
      if (data.lastScanned) setLastScanned(data.lastScanned);
    } catch (err) {
      setFetchError((err as Error)?.message ?? 'Failed to fetch compliance data');
    } finally {
      setIsLoading(false);
    }
  }, [backendBaseUrl]);

  useEffect(() => {
    fetchCompliance();
  }, [fetchCompliance]);

  // ── Overall score ──────────────────────────────────────────

  const overallScore = useMemo(() => {
    if (categories.length === 0) return 0;
    return Math.round(categories.reduce((sum, c) => sum + c.score, 0) / categories.length);
  }, [categories]);

  const totalPassed = categories.reduce((sum, c) => sum + c.passed, 0);
  const totalFailed = categories.reduce((sum, c) => sum + c.failed, 0);
  const totalWarnings = categories.reduce((sum, c) => sum + c.warnings, 0);

  if (isLoading) {
    return <PageSkeleton statCount={4} columnCount={2} rowCount={4} />;
  }

  if (fetchError) {
    return (
      <PageLayout label="Compliance Dashboard">
        <ApiError onRetry={fetchCompliance} message={fetchError} />
      </PageLayout>
    );
  }

  return (
    <PageLayout label="Compliance Dashboard">
      <SectionOverviewHeader
        title="Compliance Dashboard"
        description="Security compliance overview for your Kubernetes cluster"
        icon={Shield}
        iconClassName="bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400"
        onSync={fetchCompliance}
        isSyncing={isLoading}
        extraActions={
          <span className="text-xs text-muted-foreground">
            Last scan: {new Date(lastScanned).toLocaleString()}
          </span>
        }
      />

      {/* Overall score card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card className="overflow-hidden border-none soft-shadow glass-panel card-accent">
          <CardContent className="p-6">
            <div className="flex items-center gap-8">
              {/* Score ring */}
              <div className="relative h-32 w-32 shrink-0">
                <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                  <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/30" />
                  <circle
                    cx="50" cy="50" r="40" fill="none"
                    stroke="currentColor"
                    strokeWidth="8"
                    strokeDasharray={`${overallScore * 2.51} 251`}
                    strokeLinecap="round"
                    className={scoreBgColor(overallScore).replace('bg-', 'text-')}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={cn('text-3xl font-bold', scoreColor(overallScore))}>
                    {overallScore}%
                  </span>
                  <span className="text-xs text-muted-foreground">{scoreLabel(overallScore)}</span>
                </div>
              </div>

              {/* Summary stats */}
              <div className="flex-1 grid grid-cols-3 gap-6">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                  <div>
                    <div className="text-2xl font-bold">{totalPassed}</div>
                    <div className="text-xs text-muted-foreground">Checks Passed</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <XCircle className="h-8 w-8 text-red-500" />
                  <div>
                    <div className="text-2xl font-bold">{totalFailed}</div>
                    <div className="text-xs text-muted-foreground">Checks Failed</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-8 w-8 text-amber-500" />
                  <div>
                    <div className="text-2xl font-bold">{totalWarnings}</div>
                    <div className="text-xs text-muted-foreground">Warnings</div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Empty state */}
      {categories.length === 0 && !isLoading && (
        <Card className="border-none soft-shadow glass-panel">
          <CardContent className="flex flex-col items-center justify-center gap-3 p-12">
            <Shield className="h-12 w-12 text-muted-foreground/50" />
            <p className="text-sm font-medium text-foreground">No compliance data available</p>
            <p className="text-xs text-muted-foreground max-w-sm text-center">
              Connect a compliance engine to see CIS benchmarks, RBAC audits, network policy coverage, and pod security standards.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Category cards */}
      <div className="grid grid-cols-2 gap-4">
        {categories.map((category, idx) => {
          const Icon = category.icon;
          const isExpanded = expandedCategory === category.id;
          return (
            <motion.div
              key={category.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: idx * 0.1 }}
            >
              <Card className="overflow-hidden border-none soft-shadow glass-panel">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="h-5 w-5 text-primary" />
                      <CardTitle className="text-base">{category.name}</CardTitle>
                    </div>
                    <span className={cn('text-2xl font-bold', scoreColor(category.score))}>
                      {category.score}%
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Progress bar */}
                  <div className="space-y-2">
                    <Progress
                      value={category.score}
                      className="h-2"
                    />
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{category.passed}/{category.total} passed</span>
                      <Badge variant={category.score >= 90 ? 'default' : category.score >= 70 ? 'secondary' : 'destructive'} className="text-xs">
                        {scoreLabel(category.score)}
                      </Badge>
                    </div>
                  </div>

                  {/* Quick stats */}
                  <div className="flex items-center gap-4 text-xs">
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" /> {category.passed} pass
                    </span>
                    <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                      <XCircle className="h-3 w-3" /> {category.failed} fail
                    </span>
                    {category.warnings > 0 && (
                      <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="h-3 w-3" /> {category.warnings} warn
                      </span>
                    )}
                  </div>

                  {/* Expand/collapse items */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={() => setExpandedCategory(isExpanded ? null : category.id)}
                  >
                    <ChevronRight className={cn('h-4 w-4 mr-1 transition-transform', isExpanded && 'rotate-90')} />
                    {isExpanded ? 'Hide Details' : 'Show Details'}
                  </Button>

                  {/* Expanded items */}
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="space-y-2 border-t pt-3"
                    >
                      {category.items.map((item) => (
                        <div
                          key={item.id}
                          className={cn(
                            'flex items-start gap-3 rounded-lg p-3 text-sm',
                            item.status === 'fail' && 'bg-red-50 dark:bg-red-900/10',
                            item.status === 'warning' && 'bg-amber-50 dark:bg-amber-900/10',
                            item.status === 'pass' && 'bg-emerald-50/50 dark:bg-emerald-900/5'
                          )}
                        >
                          {statusIcon(item.status)}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{item.title}</span>
                              <Badge
                                variant="outline"
                                className={cn(
                                  'text-xs',
                                  item.severity === 'critical' && 'border-red-300 text-red-600',
                                  item.severity === 'high' && 'border-orange-300 text-orange-600',
                                  item.severity === 'medium' && 'border-yellow-300 text-yellow-600'
                                )}
                              >
                                {item.severity}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                            {item.remediation && item.status !== 'pass' && (
                              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1 flex items-center gap-1">
                                <TrendingUp className="h-3 w-3" />
                                {item.remediation}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>
    </PageLayout>
  );
}
