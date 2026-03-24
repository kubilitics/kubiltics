/**
 * RBACReports — ENT-011
 *
 * RBAC audit report page showing all users, roles, permissions, last activity.
 * Highlights over-permissioned accounts and supports export (JSON, CSV).
 */

import { useState, useMemo, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Shield,
  Download,
  Search,
  Filter,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Users,
  Clock,
  ChevronDown,
  FileJson,
  FileSpreadsheet,
} from 'lucide-react';
import { toast } from '@/components/ui/sonner';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { useBackendConfigStore } from '@/stores/backendConfigStore';

// ─── Types ───────────────────────────────────────────────────

interface RBACReportEntry {
  userId: string;
  username: string;
  email: string;
  roles: string[];
  permissions: string[];
  permissionCount: number;
  lastActivity: string | null;
  loginCount: number;
  isOverPermissioned: boolean;
  overPermissionReason?: string;
  createdAt: string;
  status: 'active' | 'inactive' | 'suspended';
}

interface RBACReportSummary {
  totalUsers: number;
  activeUsers: number;
  overPermissionedUsers: number;
  unusedRoles: number;
  avgPermissionsPerUser: number;
}

// ─── Mock data for demonstration ─────────────────────────────

const MOCK_ENTRIES: RBACReportEntry[] = [
  {
    userId: 'u1',
    username: 'admin',
    email: 'admin@example.com',
    roles: ['admin'],
    permissions: ['*:*'],
    permissionCount: 84,
    lastActivity: new Date(Date.now() - 3600000).toISOString(),
    loginCount: 142,
    isOverPermissioned: false,
    createdAt: '2024-01-01T00:00:00Z',
    status: 'active',
  },
  {
    userId: 'u2',
    username: 'dev-lead',
    email: 'devlead@example.com',
    roles: ['admin', 'operator'],
    permissions: ['pods:*', 'deployments:*', 'services:*', 'secrets:*', 'configmaps:*'],
    permissionCount: 72,
    lastActivity: new Date(Date.now() - 86400000).toISOString(),
    loginCount: 89,
    isOverPermissioned: true,
    overPermissionReason: 'Has admin role but only uses operator-level actions',
    createdAt: '2024-02-15T00:00:00Z',
    status: 'active',
  },
  {
    userId: 'u3',
    username: 'sre-engineer',
    email: 'sre@example.com',
    roles: ['operator'],
    permissions: ['pods:get,list,watch,delete', 'deployments:get,list,watch,update'],
    permissionCount: 35,
    lastActivity: new Date(Date.now() - 7200000).toISOString(),
    loginCount: 214,
    isOverPermissioned: false,
    createdAt: '2024-03-01T00:00:00Z',
    status: 'active',
  },
  {
    userId: 'u4',
    username: 'readonly-user',
    email: 'readonly@example.com',
    roles: ['viewer'],
    permissions: ['pods:get,list,watch', 'deployments:get,list,watch'],
    permissionCount: 18,
    lastActivity: null,
    loginCount: 0,
    isOverPermissioned: false,
    createdAt: '2024-06-01T00:00:00Z',
    status: 'inactive',
  },
  {
    userId: 'u5',
    username: 'former-admin',
    email: 'former@example.com',
    roles: ['admin'],
    permissions: ['*:*'],
    permissionCount: 84,
    lastActivity: new Date(Date.now() - 30 * 86400000).toISOString(),
    loginCount: 5,
    isOverPermissioned: true,
    overPermissionReason: 'No activity in 30+ days but retains admin role',
    createdAt: '2024-01-15T00:00:00Z',
    status: 'active',
  },
];

// ─── Component ───────────────────────────────────────────────

export default function RBACReports() {
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const [entries, setEntries] = useState<RBACReportEntry[]>(MOCK_ENTRIES);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'over-permissioned'>('all');

  // ── Fetch report ───────────────────────────────────────────

  const fetchReport = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${backendBaseUrl}/api/v1/rbac/reports`);
      if (res.ok) {
        const data = await res.json();
        if (data.entries) setEntries(data.entries);
      }
    } catch {
      // Use mock data
    } finally {
      setIsLoading(false);
    }
  }, [backendBaseUrl]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // ── Filters ────────────────────────────────────────────────

  const filteredEntries = useMemo(() => {
    let result = entries;
    if (statusFilter === 'active') result = result.filter((e) => e.status === 'active');
    else if (statusFilter === 'inactive') result = result.filter((e) => e.status === 'inactive' || !e.lastActivity);
    else if (statusFilter === 'over-permissioned') result = result.filter((e) => e.isOverPermissioned);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.username.toLowerCase().includes(q) ||
          e.email.toLowerCase().includes(q) ||
          e.roles.some((r) => r.toLowerCase().includes(q))
      );
    }
    return result;
  }, [entries, statusFilter, searchQuery]);

  // ── Summary ────────────────────────────────────────────────

  const summary: RBACReportSummary = useMemo(() => ({
    totalUsers: entries.length,
    activeUsers: entries.filter((e) => e.status === 'active').length,
    overPermissionedUsers: entries.filter((e) => e.isOverPermissioned).length,
    unusedRoles: 0, // Would come from backend
    avgPermissionsPerUser: entries.length
      ? Math.round(entries.reduce((sum, e) => sum + e.permissionCount, 0) / entries.length)
      : 0,
  }), [entries]);

  // ── Export ─────────────────────────────────────────────────

  function exportJSON() {
    const blob = new Blob([JSON.stringify({ entries: filteredEntries, summary, exportedAt: new Date().toISOString() }, null, 2)], {
      type: 'application/json',
    });
    downloadBlob(blob, 'rbac-report.json');
    toast.success('Report exported as JSON');
  }

  function exportCSV() {
    const headers = ['Username', 'Email', 'Roles', 'Permission Count', 'Last Activity', 'Login Count', 'Over-Permissioned', 'Status'];
    const rows = filteredEntries.map((e) => [
      e.username,
      e.email,
      e.roles.join(';'),
      e.permissionCount.toString(),
      e.lastActivity ?? 'Never',
      e.loginCount.toString(),
      e.isOverPermissioned ? 'Yes' : 'No',
      e.status,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.map((v) => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    downloadBlob(blob, 'rbac-report.csv');
    toast.success('Report exported as CSV');
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Time formatting ────────────────────────────────────────

  function formatRelativeTime(isoDate: string | null): string {
    if (!isoDate) return 'Never';
    const diff = Date.now() - new Date(isoDate).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }

  return (
    <div className="container py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">RBAC Audit Reports</h1>
            <p className="text-sm text-muted-foreground">
              Review user permissions, activity, and identify over-permissioned accounts
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchReport} disabled={isLoading}>
            <RefreshCw className={cn('h-4 w-4 mr-2', isLoading && 'animate-spin')} />
            Refresh
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Download className="h-4 w-4 mr-2" />
                Export
                <ChevronDown className="h-3.5 w-3.5 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportJSON}>
                <FileJson className="h-4 w-4 mr-2" />
                Export as JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportCSV}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Export as CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <Users className="h-8 w-8 text-primary" />
            <div>
              <div className="text-2xl font-bold">{summary.totalUsers}</div>
              <div className="text-xs text-muted-foreground">Total Users</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <Clock className="h-8 w-8 text-emerald-500" />
            <div>
              <div className="text-2xl font-bold">{summary.activeUsers}</div>
              <div className="text-xs text-muted-foreground">Active Users</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="h-8 w-8 text-amber-500" />
            <div>
              <div className="text-2xl font-bold">{summary.overPermissionedUsers}</div>
              <div className="text-xs text-muted-foreground">Over-Permissioned</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <Shield className="h-8 w-8 text-blue-500" />
            <div>
              <div className="text-2xl font-bold">{summary.avgPermissionsPerUser}</div>
              <div className="text-xs text-muted-foreground">Avg Permissions</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Over-permissioned warning */}
      {summary.overPermissionedUsers > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {summary.overPermissionedUsers} user{summary.overPermissionedUsers > 1 ? 's' : ''} may have
            more permissions than needed. Review and apply the principle of least privilege.
          </AlertDescription>
        </Alert>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search users, roles..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-[200px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Users</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="over-permissioned">Over-Permissioned</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Report table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead className="text-center">Permissions</TableHead>
                <TableHead>Last Activity</TableHead>
                <TableHead className="text-center">Logins</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Flags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEntries.map((entry) => (
                <motion.tr
                  key={entry.userId}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className={cn(
                    'border-b hover:bg-muted/50 transition-colors',
                    entry.isOverPermissioned && 'bg-amber-50/50 dark:bg-amber-900/10'
                  )}
                >
                  <TableCell>
                    <div>
                      <div className="font-medium">{entry.username}</div>
                      <div className="text-xs text-muted-foreground">{entry.email}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {entry.roles.map((role) => (
                        <Badge key={role} variant="secondary" className="text-xs">
                          {role}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline">{entry.permissionCount}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className={cn('text-sm', !entry.lastActivity && 'text-muted-foreground italic')}>
                      {formatRelativeTime(entry.lastActivity)}
                    </span>
                  </TableCell>
                  <TableCell className="text-center text-sm">{entry.loginCount}</TableCell>
                  <TableCell>
                    <Badge
                      variant={entry.status === 'active' ? 'default' : entry.status === 'suspended' ? 'destructive' : 'outline'}
                    >
                      {entry.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {entry.isOverPermissioned && (
                      <div className="flex items-center gap-1" title={entry.overPermissionReason}>
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                        <span className="text-xs text-amber-600 dark:text-amber-400 max-w-[160px] truncate">
                          {entry.overPermissionReason}
                        </span>
                      </div>
                    )}
                  </TableCell>
                </motion.tr>
              ))}
            </TableBody>
          </Table>
          {filteredEntries.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No users match your filters</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
