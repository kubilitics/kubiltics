import { useState } from 'react';
import { Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { NamespaceBadge } from '@/components/list';
import { cn } from '@/lib/utils';

export interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceType: string;
  resourceName: string;
  namespace?: string;
  onConfirm: () => Promise<void> | void;
  requireNameConfirmation?: boolean;
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  resourceType,
  resourceName,
  namespace,
  onConfirm,
  requireNameConfirmation = false,
}: DeleteConfirmDialogProps) {
  const [confirmInput, setConfirmInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  
  const canDelete = !requireNameConfirmation || confirmInput === resourceName;

  const handleConfirm = async () => {
    if (!canDelete) return;
    
    setIsDeleting(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (error) {
      console.error('Delete failed:', error);
    } finally {
      setIsDeleting(false);
      setConfirmInput('');
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setConfirmInput('');
    }
    onOpenChange(open);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-full bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <AlertDialogTitle className="text-xl">Delete {resourceType}?</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="text-left space-y-3">
            <p>
              You are about to delete the following {resourceType.toLowerCase()}:
            </p>
            <div className="p-3 rounded-lg bg-muted border border-border">
              <div className="flex items-center gap-2">
                <Trash2 className="h-4 w-4 text-muted-foreground" />
                <span className="font-mono font-medium text-foreground">{resourceName}</span>
              </div>
              {namespace && (
                <div className="mt-1 text-sm">
                  Namespace: <NamespaceBadge namespace={namespace} className="ml-1" />
                </div>
              )}
            </div>
            <p className="text-destructive font-medium">
              This action cannot be undone.
            </p>
            
            {requireNameConfirmation && (
              <div className="space-y-2 pt-2">
                <Label htmlFor="confirm-name" className="text-foreground">
                  Type <span className="font-mono font-semibold">{resourceName}</span> to confirm:
                </Label>
                <Input
                  id="confirm-name"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  placeholder={resourceName}
                  className={cn(
                    'font-mono',
                    confirmInput && confirmInput !== resourceName && 'border-destructive'
                  )}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={!canDelete || isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
