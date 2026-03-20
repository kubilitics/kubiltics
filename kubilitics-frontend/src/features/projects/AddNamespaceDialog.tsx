/**
 * Add Namespace Dialog — Add a namespace to a project (per cluster, optional team).
 */
import { useState, useEffect } from 'react';
import { Layers, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useProjectMutations } from '@/hooks/useProjects';
import { toast } from 'sonner';

interface ClusterOption {
  cluster_id: string;
  cluster_name: string;
}

interface AddNamespaceDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clusters: ClusterOption[];
  /** Pre-select cluster when opening from a cluster-specific "Add" button */
  initialClusterId?: string;
}

export function AddNamespaceDialog({
  projectId,
  open,
  onOpenChange,
  clusters,
  initialClusterId,
}: AddNamespaceDialogProps) {
  const [clusterId, setClusterId] = useState(initialClusterId ?? '');
  const [namespaceName, setNamespaceName] = useState('');
  const [team, setTeam] = useState('');
  const { addNamespace } = useProjectMutations();

  useEffect(() => {
    if (open) {
      setClusterId(initialClusterId ?? '');
    }
  }, [open, initialClusterId]);

  const canAdd = !!clusterId && !!namespaceName.trim();

  const handleAdd = async () => {
    if (!canAdd) return;
    try {
      await addNamespace.mutateAsync({
        projectId,
        clusterId,
        namespaceName: namespaceName.trim(),
        team: team.trim() || undefined,
      });
      toast.success('Namespace added to project');
      setNamespaceName('');
      setTeam('');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add namespace');
    }
  };

  const handleClose = () => {
    setClusterId('');
    setNamespaceName('');
    setTeam('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Add Namespace
          </DialogTitle>
          <DialogDescription>
            Add a namespace to this project. Optionally tag it with a team for multi-tenancy.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Cluster</Label>
            <Select value={clusterId} onValueChange={setClusterId}>
              <SelectTrigger>
                <SelectValue placeholder="Select cluster" />
              </SelectTrigger>
              <SelectContent>
                {clusters.map((c) => (
                  <SelectItem key={c.cluster_id} value={c.cluster_id}>
                    {c.cluster_name}
                  </SelectItem>
                ))}
                {clusters.length === 0 && (
                  <SelectItem value="__none__" disabled>
                    Add clusters first
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ns-name">Namespace name</Label>
            <Input
              id="ns-name"
              placeholder="e.g. abc-team-app"
              value={namespaceName}
              onChange={(e) => setNamespaceName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ns-team">Team (optional)</Label>
            <Input
              id="ns-team"
              placeholder="e.g. abc team"
              value={team}
              onChange={(e) => setTeam(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!canAdd || addNamespace.isPending}>
            {addNamespace.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
