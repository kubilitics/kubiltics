/**
 * RBACManagement — ENT-006
 *
 * Role list page showing all RBAC roles (built-in + custom).
 * Create/Edit role dialog with permission checkboxes in a resource:action grid.
 * Delete confirmation for custom roles.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  Plus,
  Pencil,
  Trash2,
  Search,
  Filter,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Lock,
  Users,
  Copy,
} from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { useBackendConfigStore } from '@/stores/backendConfigStore';

// ─── Types ───────────────────────────────────────────────────

interface Permission {
  resource: string;
  actions: string[];
}

interface RBACRole {
  id: string;
  name: string;
  displayName: string;
  description: string;
  type: 'built-in' | 'custom';
  permissions: Permission[];
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Constants ───────────────────────────────────────────────

const RESOURCES = [
  'pods',
  'deployments',
  'services',
  'configmaps',
  'secrets',
  'namespaces',
  'nodes',
  'ingresses',
  'persistentvolumeclaims',
  'roles',
  'clusterroles',
  'serviceaccounts',
];

const ACTIONS = ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'];

const BUILT_IN_ROLES: RBACRole[] = [
  {
    id: 'admin',
    name: 'admin',
    displayName: 'Administrator',
    description: 'Full access to all resources and operations',
    type: 'built-in',
    permissions: RESOURCES.map((r) => ({ resource: r, actions: [...ACTIONS] })),
    userCount: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'viewer',
    name: 'viewer',
    displayName: 'Viewer',
    description: 'Read-only access to all resources',
    type: 'built-in',
    permissions: RESOURCES.map((r) => ({ resource: r, actions: ['get', 'list', 'watch'] })),
    userCount: 5,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'operator',
    name: 'operator',
    displayName: 'Operator',
    description: 'Manage workloads and services, read-only for RBAC',
    type: 'built-in',
    permissions: [
      { resource: 'pods', actions: ['get', 'list', 'watch', 'create', 'update', 'delete'] },
      { resource: 'deployments', actions: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'] },
      { resource: 'services', actions: ['get', 'list', 'watch', 'create', 'update', 'delete'] },
      { resource: 'configmaps', actions: ['get', 'list', 'watch', 'create', 'update'] },
      { resource: 'secrets', actions: ['get', 'list', 'watch'] },
      { resource: 'namespaces', actions: ['get', 'list', 'watch'] },
      { resource: 'nodes', actions: ['get', 'list', 'watch'] },
      { resource: 'ingresses', actions: ['get', 'list', 'watch', 'create', 'update', 'delete'] },
      { resource: 'persistentvolumeclaims', actions: ['get', 'list', 'watch', 'create', 'delete'] },
      { resource: 'roles', actions: ['get', 'list', 'watch'] },
      { resource: 'clusterroles', actions: ['get', 'list', 'watch'] },
      { resource: 'serviceaccounts', actions: ['get', 'list', 'watch'] },
    ],
    userCount: 3,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
];

// ─── Component ───────────────────────────────────────────────

export default function RBACManagement() {
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const [roles, setRoles] = useState<RBACRole[]>(BUILT_IN_ROLES);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'built-in' | 'custom'>('all');

  // Dialog state
  const [editDialog, setEditDialog] = useState<{ open: boolean; role: RBACRole | null }>({
    open: false,
    role: null,
  });
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; role: RBACRole | null }>({
    open: false,
    role: null,
  });
  const [isSaving, setIsSaving] = useState(false);

  // Edit form state
  const [formName, setFormName] = useState('');
  const [formDisplayName, setFormDisplayName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPermissions, setFormPermissions] = useState<Record<string, Set<string>>>({});

  // ── Fetch roles ────────────────────────────────────────────

  const fetchRoles = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${backendBaseUrl}/api/v1/rbac/roles`);
      if (res.ok) {
        const data = await res.json();
        if (data.roles) {
          setRoles([...BUILT_IN_ROLES, ...data.roles.filter((r: RBACRole) => r.type === 'custom')]);
        }
      }
    } catch {
      // Use built-in defaults if backend is unavailable
    } finally {
      setIsLoading(false);
    }
  }, [backendBaseUrl]);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  // ── Filtered roles ─────────────────────────────────────────

  const filteredRoles = useMemo(() => {
    let result = roles;
    if (typeFilter !== 'all') {
      result = result.filter((r) => r.type === typeFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.displayName.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q)
      );
    }
    return result;
  }, [roles, typeFilter, searchQuery]);

  // ── Permission grid helpers ────────────────────────────────

  function initPermissionGrid(permissions: Permission[]): Record<string, Set<string>> {
    const grid: Record<string, Set<string>> = {};
    for (const res of RESOURCES) {
      grid[res] = new Set<string>();
    }
    for (const perm of permissions) {
      if (grid[perm.resource]) {
        for (const action of perm.actions) {
          grid[perm.resource].add(action);
        }
      }
    }
    return grid;
  }

  function togglePermission(resource: string, action: string) {
    setFormPermissions((prev) => {
      const next = { ...prev };
      const set = new Set(next[resource] ?? []);
      if (set.has(action)) {
        set.delete(action);
      } else {
        set.add(action);
      }
      next[resource] = set;
      return next;
    });
  }

  function toggleAllForResource(resource: string) {
    setFormPermissions((prev) => {
      const next = { ...prev };
      const current = next[resource] ?? new Set();
      if (current.size === ACTIONS.length) {
        next[resource] = new Set();
      } else {
        next[resource] = new Set(ACTIONS);
      }
      return next;
    });
  }

  function toggleAllForAction(action: string) {
    setFormPermissions((prev) => {
      const next = { ...prev };
      const allHave = RESOURCES.every((r) => (next[r] ?? new Set()).has(action));
      for (const r of RESOURCES) {
        const set = new Set(next[r] ?? []);
        if (allHave) {
          set.delete(action);
        } else {
          set.add(action);
        }
        next[r] = set;
      }
      return next;
    });
  }

  // ── Dialog handlers ────────────────────────────────────────

  function openCreateDialog() {
    setFormName('');
    setFormDisplayName('');
    setFormDescription('');
    setFormPermissions(initPermissionGrid([]));
    setEditDialog({ open: true, role: null });
  }

  function openEditDialog(role: RBACRole) {
    setFormName(role.name);
    setFormDisplayName(role.displayName);
    setFormDescription(role.description);
    setFormPermissions(initPermissionGrid(role.permissions));
    setEditDialog({ open: true, role });
  }

  async function handleSave() {
    if (!formName.trim()) {
      toast.error('Role name is required');
      return;
    }
    if (!formDisplayName.trim()) {
      toast.error('Display name is required');
      return;
    }

    setIsSaving(true);
    const permissions: Permission[] = [];
    for (const [resource, actions] of Object.entries(formPermissions)) {
      if (actions.size > 0) {
        permissions.push({ resource, actions: Array.from(actions) });
      }
    }

    const payload = {
      name: formName.trim(),
      displayName: formDisplayName.trim(),
      description: formDescription.trim(),
      permissions,
    };

    try {
      const isEdit = !!editDialog.role;
      const url = isEdit
        ? `${backendBaseUrl}/api/v1/rbac/roles/${editDialog.role!.id}`
        : `${backendBaseUrl}/api/v1/rbac/roles`;
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || res.statusText);
      }
      toast.success(isEdit ? 'Role updated' : 'Role created');
      setEditDialog({ open: false, role: null });
      fetchRoles();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save role');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteDialog.role) return;
    setIsSaving(true);
    try {
      const res = await fetch(`${backendBaseUrl}/api/v1/rbac/roles/${deleteDialog.role.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete role');
      toast.success(`Role "${deleteDialog.role.displayName}" deleted`);
      setDeleteDialog({ open: false, role: null });
      fetchRoles();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete role');
    } finally {
      setIsSaving(false);
    }
  }

  // ── Permission count helper ────────────────────────────────

  function permissionCount(role: RBACRole): number {
    return role.permissions.reduce((sum, p) => sum + p.actions.length, 0);
  }

  return (
    <div className="container py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">RBAC Management</h1>
            <p className="text-sm text-muted-foreground">
              Manage roles and permissions for Kubilitics users
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchRoles} disabled={isLoading}>
            <RefreshCw className={cn('h-4 w-4 mr-2', isLoading && 'animate-spin')} />
            Refresh
          </Button>
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-2" />
            Create Role
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search roles..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
          <SelectTrigger className="w-[160px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="built-in">Built-in</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <Shield className="h-8 w-8 text-primary" />
            <div>
              <div className="text-2xl font-bold">{roles.length}</div>
              <div className="text-xs text-muted-foreground">Total Roles</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <Lock className="h-8 w-8 text-amber-500" />
            <div>
              <div className="text-2xl font-bold">{roles.filter((r) => r.type === 'built-in').length}</div>
              <div className="text-xs text-muted-foreground">Built-in Roles</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <Users className="h-8 w-8 text-emerald-500" />
            <div>
              <div className="text-2xl font-bold">{roles.reduce((sum, r) => sum + r.userCount, 0)}</div>
              <div className="text-xs text-muted-foreground">Total Users</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Role table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-center">Permissions</TableHead>
                <TableHead className="text-center">Users</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence>
                {filteredRoles.map((role) => (
                  <motion.tr
                    key={role.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="border-b hover:bg-muted/50 transition-colors"
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Shield className={cn('h-4 w-4', role.type === 'built-in' ? 'text-primary' : 'text-emerald-500')} />
                        <div>
                          <div className="font-medium">{role.displayName}</div>
                          <div className="text-xs text-muted-foreground font-mono">{role.name}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={role.type === 'built-in' ? 'secondary' : 'outline'}>
                        {role.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate text-sm text-muted-foreground">
                      {role.description}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline">{permissionCount(role)}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline">{role.userCount}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditDialog(role)}
                          disabled={role.type === 'built-in'}
                          title={role.type === 'built-in' ? 'Built-in roles cannot be edited' : 'Edit role'}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            // Clone role for creating a new custom role based on an existing one
                            const clone: RBACRole = {
                              ...role,
                              id: '',
                              name: `${role.name}-copy`,
                              displayName: `${role.displayName} (Copy)`,
                              type: 'custom',
                            };
                            setFormName(clone.name);
                            setFormDisplayName(clone.displayName);
                            setFormDescription(clone.description);
                            setFormPermissions(initPermissionGrid(clone.permissions));
                            setEditDialog({ open: true, role: null });
                          }}
                          title="Clone role"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        {role.type === 'custom' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleteDialog({ open: true, role })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </TableBody>
          </Table>
          {filteredRoles.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Shield className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No roles match your filters</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={editDialog.open} onOpenChange={(open) => !open && setEditDialog({ open: false, role: null })}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {editDialog.role ? 'Edit Role' : 'Create Custom Role'}
            </DialogTitle>
            <DialogDescription>
              Define permissions using the resource:action grid below
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-auto space-y-6 py-4">
            {/* Basic info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="role-name">Role Name</Label>
                <Input
                  id="role-name"
                  placeholder="my-custom-role"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role-display">Display Name</Label>
                <Input
                  id="role-display"
                  placeholder="My Custom Role"
                  value={formDisplayName}
                  onChange={(e) => setFormDisplayName(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-desc">Description</Label>
              <Input
                id="role-desc"
                placeholder="Describe what this role is for..."
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
              />
            </div>

            {/* Permission grid */}
            <div className="space-y-3">
              <Label>Permissions</Label>
              <div className="border rounded-lg overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 bg-background z-10 min-w-[160px]">Resource</TableHead>
                      {ACTIONS.map((action) => (
                        <TableHead key={action} className="text-center min-w-[70px]">
                          <button
                            type="button"
                            className="hover:text-primary transition-colors text-xs"
                            onClick={() => toggleAllForAction(action)}
                            title={`Toggle all ${action}`}
                          >
                            {action}
                          </button>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {RESOURCES.map((resource) => {
                      const perms = formPermissions[resource] ?? new Set();
                      return (
                        <TableRow key={resource}>
                          <TableCell className="sticky left-0 bg-background z-10">
                            <button
                              type="button"
                              className="text-sm font-mono hover:text-primary transition-colors"
                              onClick={() => toggleAllForResource(resource)}
                              title={`Toggle all for ${resource}`}
                            >
                              {resource}
                            </button>
                          </TableCell>
                          {ACTIONS.map((action) => (
                            <TableCell key={action} className="text-center">
                              <Checkbox
                                checked={perms.has(action)}
                                onCheckedChange={() => togglePermission(resource, action)}
                              />
                            </TableCell>
                          ))}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog({ open: false, role: null })}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Role'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => !open && setDeleteDialog({ open: false, role: null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Delete Role
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the role "{deleteDialog.role?.displayName}"?
              This action cannot be undone. Users assigned to this role will lose their permissions.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog({ open: false, role: null })}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete Role'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
