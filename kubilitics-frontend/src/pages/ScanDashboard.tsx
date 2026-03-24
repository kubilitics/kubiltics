import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ShieldCheck,
  Play,
  Download,
  AlertTriangle,
  CheckCircle,
  Clock,
  Filter,
  RefreshCw,
  FileText,
  Bug,
  Eye,
  XCircle,
} from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import {
  getScanStats,
  listScanRuns,
  listAllFindings,
  startScan,
  getAvailableTools,
  getReportUrl,
} from '@/services/scannerApi';
import type {
  ScanRun,
  ScanFinding,
  ScanSeverity,
  ScanRunStatus,
} from '@/types/scanner';

// ─── Constants ──────────────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#ef4444',
  HIGH: '#f97316',
  MEDIUM: '#eab308',
  LOW: '#3b82f6',
  INFO: '#6b7280',
};

const SEVERITY_ORDER: ScanSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

const STATUS_CONFIG: Record<ScanRunStatus, { label: string; color: string; icon: React.ElementType }> = {
  pending: { label: 'Pending', color: 'bg-slate-500', icon: Clock },
  running: { label: 'Running', color: 'bg-blue-500', icon: RefreshCw },
  completed: { label: 'Completed', color: 'bg-emerald-500', icon: CheckCircle },
  failed: { label: 'Failed', color: 'bg-red-500', icon: XCircle },
};

// ─── Helpers ────────────────────────────────────────────────────────────────────

function severityBadge(severity: ScanSeverity) {
  const colors: Record<string, string> = {
    CRITICAL: 'bg-red-900/80 text-red-200 border-red-700/50',
    HIGH: 'bg-orange-900/80 text-orange-200 border-orange-700/50',
    MEDIUM: 'bg-yellow-900/80 text-yellow-200 border-yellow-700/50',
    LOW: 'bg-blue-900/80 text-blue-200 border-blue-700/50',
    INFO: 'bg-slate-700/80 text-slate-300 border-slate-600/50',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border ${colors[severity] || colors.INFO}`}
    >
      {severity}
    </span>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function ScanDashboard() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('overview');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [toolFilter, setToolFilter] = useState<string>('all');

  // Data fetching
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['scanner-stats'],
    queryFn: getScanStats,
    refetchInterval: 15_000,
  });

  const { data: runsData, isLoading: runsLoading } = useQuery({
    queryKey: ['scanner-runs'],
    queryFn: () => listScanRuns(20, 0),
    refetchInterval: 5_000,
  });

  const { data: findingsData, isLoading: findingsLoading } = useQuery({
    queryKey: ['scanner-findings', severityFilter, toolFilter],
    queryFn: () =>
      listAllFindings({
        severity: severityFilter === 'all' ? undefined : severityFilter,
        tool: toolFilter === 'all' ? undefined : toolFilter,
        limit: 200,
      }),
    refetchInterval: 30_000,
  });

  const { data: toolsData } = useQuery({
    queryKey: ['scanner-tools'],
    queryFn: getAvailableTools,
    staleTime: 60_000,
  });

  const scanMutation = useMutation({
    mutationFn: () => startScan('directory', '.'),
    onSuccess: (run) => {
      toast.success(`Scan started (${run.id.slice(0, 8)})`);
      queryClient.invalidateQueries({ queryKey: ['scanner-runs'] });
    },
    onError: (err: Error) => {
      toast.error(`Failed to start scan: ${err.message}`);
    },
  });

  const handleRunScan = useCallback(() => {
    scanMutation.mutate();
  }, [scanMutation]);

  // Chart data
  const severityPieData = useMemo(() => {
    if (!stats?.findings_by_severity) return [];
    return SEVERITY_ORDER.map((sev) => ({
      name: sev,
      value: stats.findings_by_severity[sev] || 0,
      color: SEVERITY_COLORS[sev],
    })).filter((d) => d.value > 0);
  }, [stats]);

  const trendData = useMemo(() => {
    if (!stats?.trend) return [];
    return stats.trend.map((t) => ({
      ...t,
      total: t.critical + t.high + t.medium + t.low + t.info,
    }));
  }, [stats]);

  const runs = runsData?.runs || [];
  const findings = findingsData?.findings || [];
  const findingsTotal = findingsData?.total || 0;
  const tools = toolsData?.tools || [];
  const availableCount = tools.filter((t) => t.available).length;

  const totalFindings = stats?.total_findings ?? 0;
  const criticalCount = stats?.findings_by_severity?.CRITICAL ?? 0;
  const highCount = stats?.findings_by_severity?.HIGH ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="h-full w-full flex flex-col min-h-0 bg-background text-foreground"
    >
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-6 pb-6 scroll-smooth w-full">
        <div className="w-full space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <ShieldCheck className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">Security Scanner</h1>
                <p className="text-sm text-muted-foreground">
                  DevSecOps scanning engine &mdash; {availableCount}/{tools.length} tools available
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Tool status badges */}
              <div className="hidden md:flex items-center gap-1.5">
                {tools.map((tool) => (
                  <Badge
                    key={tool.name}
                    variant={tool.available ? 'default' : 'secondary'}
                    className="text-[10px] capitalize"
                  >
                    {tool.name}
                  </Badge>
                ))}
              </div>
              <Button onClick={handleRunScan} disabled={scanMutation.isPending}>
                {scanMutation.isPending ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Run Scan
              </Button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatCard label="Total Findings" value={totalFindings} icon={Bug} />
            <StatCard
              label="Critical"
              value={criticalCount}
              icon={AlertTriangle}
              valueColor="text-red-500"
            />
            <StatCard
              label="High"
              value={highCount}
              icon={AlertTriangle}
              valueColor="text-orange-500"
            />
            <StatCard
              label="Total Scans"
              value={stats?.total_runs ?? 0}
              icon={Eye}
            />
            <StatCard
              label="Tools Active"
              value={`${availableCount}/${tools.length}`}
              icon={ShieldCheck}
              valueColor="text-emerald-500"
            />
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="findings">
                Findings {findingsTotal > 0 && `(${findingsTotal})`}
              </TabsTrigger>
              <TabsTrigger value="runs">Scan Runs</TabsTrigger>
            </TabsList>

            {/* ── Overview Tab ── */}
            <TabsContent value="overview" className="space-y-6 mt-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Severity Distribution */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold">
                      Severity Distribution
                    </CardTitle>
                    <CardDescription>Open findings by severity level</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {severityPieData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={250}>
                        <PieChart>
                          <Pie
                            data={severityPieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={100}
                            paddingAngle={2}
                            dataKey="value"
                          >
                            {severityPieData.map((entry, i) => (
                              <Cell key={i} fill={entry.color} />
                            ))}
                          </Pie>
                          <RechartsTooltip
                            contentStyle={{
                              background: '#1e293b',
                              border: '1px solid #334155',
                              borderRadius: '8px',
                              color: '#e2e8f0',
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
                        No findings yet. Run a scan to get started.
                      </div>
                    )}
                    <div className="flex justify-center gap-4 mt-2">
                      {severityPieData.map((d) => (
                        <div key={d.name} className="flex items-center gap-1.5 text-xs">
                          <div
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: d.color }}
                          />
                          <span className="text-muted-foreground">{d.name}</span>
                          <span className="font-semibold">{d.value}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Trend Chart */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold">
                      Findings Trend (30 days)
                    </CardTitle>
                    <CardDescription>Finding counts over time</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {trendData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={250}>
                        <AreaChart data={trendData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                          <XAxis
                            dataKey="date"
                            tick={{ fontSize: 11, fill: '#94a3b8' }}
                            tickFormatter={(v) =>
                              new Date(v).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                              })
                            }
                          />
                          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
                          <RechartsTooltip
                            contentStyle={{
                              background: '#1e293b',
                              border: '1px solid #334155',
                              borderRadius: '8px',
                              color: '#e2e8f0',
                            }}
                          />
                          <Area
                            type="monotone"
                            dataKey="critical"
                            stackId="1"
                            fill="#ef4444"
                            stroke="#ef4444"
                            fillOpacity={0.6}
                          />
                          <Area
                            type="monotone"
                            dataKey="high"
                            stackId="1"
                            fill="#f97316"
                            stroke="#f97316"
                            fillOpacity={0.6}
                          />
                          <Area
                            type="monotone"
                            dataKey="medium"
                            stackId="1"
                            fill="#eab308"
                            stroke="#eab308"
                            fillOpacity={0.4}
                          />
                          <Area
                            type="monotone"
                            dataKey="low"
                            stackId="1"
                            fill="#3b82f6"
                            stroke="#3b82f6"
                            fillOpacity={0.3}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
                        No trend data available yet.
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Tool Breakdown */}
              {stats?.findings_by_tool &&
                Object.keys(stats.findings_by_tool).length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm font-semibold">
                        Findings by Tool
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {Object.entries(stats.findings_by_tool).map(
                          ([tool, count]) => (
                            <div
                              key={tool}
                              className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/40"
                            >
                              <span className="text-sm font-medium capitalize">
                                {tool}
                              </span>
                              <span className="text-lg font-bold">{count}</span>
                            </div>
                          )
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}
            </TabsContent>

            {/* ── Findings Tab ── */}
            <TabsContent value="findings" className="space-y-4 mt-4">
              {/* Filters */}
              <div className="flex items-center gap-3">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <Select
                  value={severityFilter}
                  onValueChange={setSeverityFilter}
                >
                  <SelectTrigger className="w-[140px] h-8 text-xs">
                    <SelectValue placeholder="Severity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Severities</SelectItem>
                    {SEVERITY_ORDER.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={toolFilter} onValueChange={setToolFilter}>
                  <SelectTrigger className="w-[140px] h-8 text-xs">
                    <SelectValue placeholder="Tool" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Tools</SelectItem>
                    {tools.map((t) => (
                      <SelectItem key={t.name} value={t.name}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground ml-auto">
                  {findingsTotal} findings
                </span>
              </div>

              {/* Findings Table */}
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[100px]">Severity</TableHead>
                        <TableHead className="w-[90px]">Tool</TableHead>
                        <TableHead>Title</TableHead>
                        <TableHead className="w-[200px]">Location</TableHead>
                        <TableHead className="w-[120px]">Rule</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {findingsLoading ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                            Loading findings...
                          </TableCell>
                        </TableRow>
                      ) : findings.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                            No findings match the current filters.
                          </TableCell>
                        </TableRow>
                      ) : (
                        findings.map((f) => (
                          <TableRow key={f.id} className="group">
                            <TableCell>{severityBadge(f.severity)}</TableCell>
                            <TableCell>
                              <span className="text-xs font-medium capitalize text-muted-foreground">
                                {f.tool}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className="max-w-[400px]">
                                <p className="text-sm font-medium truncate">{f.title}</p>
                                {f.remediation && (
                                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                                    {f.remediation}
                                  </p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <code className="text-xs text-muted-foreground">
                                {f.file_path
                                  ? f.start_line > 0
                                    ? `${f.file_path}:${f.start_line}`
                                    : f.file_path
                                  : '-'}
                              </code>
                            </TableCell>
                            <TableCell>
                              <code className="text-xs text-muted-foreground">
                                {f.rule_id}
                              </code>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Runs Tab ── */}
            <TabsContent value="runs" className="space-y-4 mt-4">
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[100px]">Status</TableHead>
                        <TableHead>Target</TableHead>
                        <TableHead className="w-[100px]">Findings</TableHead>
                        <TableHead className="w-[80px]">Critical</TableHead>
                        <TableHead className="w-[80px]">High</TableHead>
                        <TableHead className="w-[100px]">Duration</TableHead>
                        <TableHead className="w-[140px]">Started</TableHead>
                        <TableHead className="w-[80px]">Report</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {runsLoading ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                            Loading scan runs...
                          </TableCell>
                        </TableRow>
                      ) : runs.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                            No scans yet. Click "Run Scan" to get started.
                          </TableCell>
                        </TableRow>
                      ) : (
                        runs.map((run) => {
                          const cfg = STATUS_CONFIG[run.status];
                          const StatusIcon = cfg.icon;
                          return (
                            <TableRow key={run.id}>
                              <TableCell>
                                <div className="flex items-center gap-1.5">
                                  <StatusIcon className="h-3.5 w-3.5" />
                                  <span className="text-xs font-medium">{cfg.label}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <code className="text-xs">{run.target_path}</code>
                              </TableCell>
                              <TableCell className="font-semibold">
                                {run.total_findings}
                              </TableCell>
                              <TableCell>
                                {run.critical_count > 0 ? (
                                  <span className="text-red-500 font-semibold">
                                    {run.critical_count}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">0</span>
                                )}
                              </TableCell>
                              <TableCell>
                                {run.high_count > 0 ? (
                                  <span className="text-orange-500 font-semibold">
                                    {run.high_count}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">0</span>
                                )}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {run.duration_ms > 0
                                  ? formatDuration(run.duration_ms)
                                  : '-'}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {run.started_at ? formatDate(run.started_at) : '-'}
                              </TableCell>
                              <TableCell>
                                {run.status === 'completed' && (
                                  <a
                                    href={getReportUrl(run.id, 'html')}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                  >
                                    <Download className="h-3 w-3" />
                                    HTML
                                  </a>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              {/* Running scan progress */}
              {runs.some((r) => r.status === 'running') && (
                <Card className="border-blue-500/30">
                  <CardContent className="py-4">
                    <div className="flex items-center gap-3">
                      <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />
                      <span className="text-sm font-medium">Scan in progress...</span>
                      <Progress value={undefined} className="flex-1 h-2" />
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Stat Card ──────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  valueColor,
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  valueColor?: string;
}) {
  return (
    <Card className="border-border/40">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              {label}
            </p>
            <p className={`text-2xl font-bold mt-1 ${valueColor || 'text-foreground'}`}>
              {value}
            </p>
          </div>
          <div className="h-9 w-9 rounded-lg bg-muted/50 flex items-center justify-center">
            <Icon className="h-4.5 w-4.5 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
