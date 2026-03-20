/**
 * Add Cluster Dialog — Add a cluster to an existing project.
 */
import { useState } from 'react';
import { Server, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useClustersFromBackend } from '@/hooks/useClustersFromBackend';
import { useProjectMutations } from '@/hooks/useProjects';
import { toast } from 'sonner';

interface AddClusterDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingClusterIds: string[];
}

export function AddClusterDialog({
  projectId,
  open,
  onOpenChange,
  existingClusterIds,
}: AddClusterDialogProps) {
  const [clusterId, setClusterId] = useState('');
  const clustersQuery = useClustersFromBackend();
  const availableClusters = clustersQuery.data ?? [];
  const { addCluster } = useProjectMutations();

  const options = availableClusters.filter((c) => !existingClusterIds.includes(c.id));
  const canAdd = !!clusterId && options.length > 0;

  const handleAdd = async () => {
    if (!canAdd) return;
    try {
      await addCluster.mutateAsync({ projectId, clusterId });
      toast.success('Cluster added to project');
      setClusterId('');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add cluster');
    }
  };

  const handleClose = () => {
    setClusterId('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Add Cluster
          </DialogTitle>
          <DialogDescription>
            Select a cluster to add to this project. You can connect to any cluster from the project view.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          {options.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              All clusters are already in this project. Connect more clusters from Home to add them.
            </p>
          ) : (
            <Select value={clusterId} onValueChange={setClusterId}>
              <SelectTrigger>
                <SelectValue placeholder="Select cluster" />
              </SelectTrigger>
              <SelectContent>
                {options.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="flex items-center gap-2">
                      {c.name}
                      {c.provider && (
                        <span className="text-muted-foreground text-xs">({c.provider})</span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          {options.length > 0 && (
            <Button onClick={handleAdd} disabled={!canAdd || addCluster.isPending}>
              {addCluster.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
