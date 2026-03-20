/**
 * Edit Project Dialog — Update project name and description.
 */
import { useState, useEffect } from 'react';
import { Pencil, Loader2 } from 'lucide-react';
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
import { useProjectMutations } from '@/hooks/useProjects';
import { toast } from 'sonner';

interface EditProjectDialogProps {
  projectId: string;
  projectName: string;
  projectDescription: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditProjectDialog({
  projectId,
  projectName,
  projectDescription,
  open,
  onOpenChange,
}: EditProjectDialogProps) {
  const [name, setName] = useState(projectName);
  const [description, setDescription] = useState(projectDescription);
  const { update } = useProjectMutations();

  useEffect(() => {
    if (open) {
      setName(projectName);
      setDescription(projectDescription);
    }
  }, [open, projectName, projectDescription]);

  const canSave = name.trim().length > 0 && (name !== projectName || description !== projectDescription);

  const handleSave = async () => {
    if (!canSave) return;
    try {
      await update.mutateAsync({
        projectId,
        data: { name: name.trim(), description: description.trim() },
      });
      toast.success('Project updated');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update project');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5" />
            Edit Project
          </DialogTitle>
          <DialogDescription>
            Update the project name and description.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-desc">Description</Label>
            <Input
              id="edit-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || update.isPending}>
            {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
