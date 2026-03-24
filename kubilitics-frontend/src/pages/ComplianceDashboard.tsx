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
  Lock,
  Network,
  Box,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { toast } from '@/components/ui/sonner';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useBackendConfigStore } from '@/stores/backendConfigStore';

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

// ─── Mock data ───────────────────────────────────────────────

function buildDefaultCategories(): ComplianceCategory[] {
  return [
    {
      id: 'cis',
      name: 'CIS Kubernetes Benchmark',
      icon: Shield,
      score: 78,
      passed: 62,
      failed: 8,
      warnings: 10,
      total: 80,
      items: [
        { id: 'cis-1.1', title: 'API Server - Anonymous Auth Disabled', status: 'pass', severity: 'critical', description: 'Anonymous authentication is disabled on the API server' },
        { id: 'cis-1.2', title: 'API Server - RBAC Enabled', status: 'pass', severity: 'critical', description: 'RBAC authorization mode is enabled' },
        { id: 'cis-1.3', title: 'API Server - Audit Logging', status: 'fail', severity: 'high', description: 'Audit logging is not enabled on the API server', remediation: 'Enable audit logging with --audit-policy-file flag' },
        { id: 'cis-2.1', title: 'etcd - Encryption at Rest', status: 'warning', severity: 'high', description: 'etcd encryption at rest may not be configured', remediation: 'Configure EncryptionConfiguration for etcd' },
        { id: 'cis-2.2', title: 'etcd - TLS Enabled', status: 'pass', severity: 'critical', description: 'etcd client and peer TLS is enabled' },
        { id: 'cis-3.1', title: 'Kubelet - Authentication', status: 'pass', severity: 'high', description: 'Kubelet authentication is configured' },
        { id: 'cis-4.1', title: 'Worker Node - Config Permissions', status: 'fail', severity: 'medium', description: 'Worker node config file permissions are too permissive', remediation: 'Set file permissions to 600' },
        { id: 'cis-5.1', title: 'RBAC - Cluster Admin Usage', status: 'warning', severity: 'high', description: 'Multiple users have cluster-admin role', remediation: 'Minimize use of cluster-admin role bindings' },
      ],
    },
    {
      id: 'rbac',
      name: 'RBAC Compliance',
      icon: Lock,
      score: 85,
      passed: 17,
      failed: 2,
      warnings: 1,
      total: 20,
      items: [
        { id: 'rbac-1', title: 'Least Privilege - No Wildcard Roles', status: 'fail', severity: 'high', description: 'Some roles use wildcard (*) permissions', remediation: 'Replace wildcard permissions with explicit resource/verb lists' },
        { id: 'rbac-2', title: 'Service Account Token Auto-Mount', status: 'warning', severity: 'medium', description: 'Some pods auto-mount service account tokens unnecessarily' },
        { id: 'rbac-3', title: 'Default Service Account Restrictions', status: 'pass', severity: 'high', description: 'Default service accounts have restricted permissions' },
        { id: 'rbac-4', title: 'Role Binding Scope', status: 'pass', severity: 'medium', description: 'Role bindings are scoped to appropriate namespaces' },
      ],
    },
    {
      id: 'network',
      name: 'Network Policy Coverage',
      icon: Network,
      score: 62,
      passed: 5,
      failed: 3,
      warnings: 0,
      total: 8,
      items: [
        { id: 'net-1', title: 'Default Deny Policy', status: 'fail', severity: 'critical', description: 'Not all namespaces have a default deny network policy', remediation: 'Apply deny-all network policy to each namespace' },
        { id: 'net-2', title: 'Ingress Policies Defined', status: 'pass', severity: 'high', description: 'Ingress network policies are defined for public-facing services' },
        { id: 'net-3', title: 'Egress Policies Defined', status: 'fail', severity: 'high', description: 'Egress network policies are missing for sensitive namespaces', remediation: 'Define egress policies to restrict outbound traffic' },
        { id: 'net-4', title: 'Cross-Namespace Isolation', status: 'fail', severity: 'medium', description: 'Some namespaces allow unrestricted cross-namespace traffic' },
      ],
    },
    {
      id: 'pss',
      name: 'Pod Security Standards',
      icon: Box,
      score: 91,
      passed: 20,
      failed: 1,
      warnings: 1,
      total: 22,
      items: [
        { id: 'pss-1', title: 'No Privileged Containers', status: 'pass', severity: 'critical', description: 'No containers run in privileged mode' },
        { id: 'pss-2', title: 'Non-Root Users', status: 'pass', severity: 'high', description: 'Containers run as non-root users' },
        { id: 'pss-3', title: 'Read-Only Root Filesystem', status: 'warning', severity: 'medium', description: 'Some containers do not use read-only root filesystem' },
        { id: 'pss-4', title: 'Capability Restrictions', status: 'fail', severity: 'high', description: 'One pod has excessive Linux capabilities', remediation: 'Drop all capabilities and add only required ones' },
        { id: 'pss-5', title: 'Host Namespace Restrictions', status: 'pass', severity: 'critical', description: 'No pods share host PID, network, or IPC namespaces' },
      ],
    },
  ];
}

// ─── Component ───────────────────────────────────────────────

export default function ComplianceDashboard() {
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const [categories, setCategories] = useState<ComplianceCategory[]>(buildDefaultCategories);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [lastScanned, setLastScanned] = useState<string>(new Date().toISOString());

  // ── Fetch compliance data ──────────────────────────────────

  const fetchCompliance = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${backendBaseUrl}/api/v1/compliance/overview`);
      if (res.ok) {
        const data = await res.json();
        if (data.categories) setCategories(data.categories);
        if (data.lastScanned) setLastScanned(data.lastScanned);
      }
    } catch {
      // Use default data
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

  return (
    <div className="container py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Compliance Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Security compliance overview for your Kubernetes cluster
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            Last scan: {new Date(lastScanned).toLocaleString()}
          </span>
          <Button variant="outline" onClick={fetchCompliance} disabled={isLoading}>
            <RefreshCw className={cn('h-4 w-4 mr-2', isLoading && 'animate-spin')} />
            Rescan
          </Button>
        </div>
      </div>

      {/* Overall score card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card className="overflow-hidden">
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
              <Card className="overflow-hidden">
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
    </div>
  );
}
