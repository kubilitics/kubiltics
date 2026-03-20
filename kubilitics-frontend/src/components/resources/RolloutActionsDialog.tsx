import { useState } from 'react';
import { RotateCcw, History, Loader2, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { NamespaceBadge } from '@/components/list';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

export interface RolloutRevision {
  revision: number;
  createdAt: string;
  current: boolean;
  changeReason?: string;
  image?: string;
}

export interface RolloutActionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceType: string;
  resourceName: string;
  namespace?: string;
  revisions?: RolloutRevision[];
  onRestart: () => Promise<void> | void;
  onRollback?: (revision: number) => Promise<void> | void;
}

export function RolloutActionsDialog({
  open,
  onOpenChange,
  resourceType,
  resourceName,
  namespace,
  revisions = [],
  onRestart,
  onRollback,
}: RolloutActionsDialogProps) {
  const [activeTab, setActiveTab] = useState<'restart' | 'rollback'>('restart');
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleRestart = async () => {
    setIsLoading(true);
    try {
      await onRestart();
      onOpenChange(false);
    } catch (error) {
      console.error('Restart failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRollback = async () => {
    if (!selectedRevision || !onRollback) return;
    setIsLoading(true);
    try {
      await onRollback(selectedRevision);
      onOpenChange(false);
    } catch (error) {
      console.error('Rollback failed:', error);
    } finally {
      setIsLoading(false);
      setSelectedRevision(null);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setSelectedRevision(null);
      setActiveTab('restart');
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-full bg-primary/10">
              <RotateCcw className="h-5 w-5 text-primary" />
            </div>
            <DialogTitle className="text-xl">Rollout Actions</DialogTitle>
          </div>
          <DialogDescription className="text-left">
            Manage rollout for{' '}
            <span className="font-mono font-medium text-foreground">{resourceName}</span>
            {namespace && (
              <span className="text-muted-foreground">
                {' '}in <NamespaceBadge namespace={namespace} className="ml-1" />
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'restart' | 'rollback')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="restart" className="gap-2">
              <RotateCcw className="h-4 w-4" />
              Restart
            </TabsTrigger>
            <TabsTrigger value="rollback" className="gap-2" disabled={!onRollback}>
              <History className="h-4 w-4" />
              Rollback
            </TabsTrigger>
          </TabsList>

          <TabsContent value="restart" className="space-y-4 mt-4">
            <div className="p-4 rounded-lg bg-muted/50 border border-border">
              <h4 className="font-medium mb-2">Rollout Restart</h4>
              <p className="text-sm text-muted-foreground mb-4">
                This will trigger a rolling restart of all pods in this {resourceType.toLowerCase()}.
                Pods will be recreated one by one to minimize downtime.
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-success" />
                  <span>Zero downtime during restart</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-success" />
                  <span>Pods are recreated with same configuration</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-success" />
                  <span>New pods pull latest image (if using :latest tag)</span>
                </div>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-warning/10 border border-warning/20 text-warning text-sm flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Active connections may be briefly interrupted during the restart.</span>
            </div>
          </TabsContent>

          <TabsContent value="rollback" className="space-y-4 mt-4">
            <div className="text-sm text-muted-foreground mb-2">
              Select a revision to rollback to:
            </div>
            {revisions.filter((r) => !r.current).length === 0 ? (
              <div className="p-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-2">No other revisions available</p>
                <p className="mb-2">
                  Revisions are created only when the <strong>pod template</strong> changes (e.g. image, env, resources).
                  Changing replica count (e.g. 5 → 6) does <strong>not</strong> create a new revision.
                </p>
                <p>
                  To revert a replica count change (e.g. 6 → 5), close this dialog and use <strong>Scale</strong> in the deployment header or the <strong>Scaling</strong> tab.
                </p>
              </div>
            ) : (
            <ScrollArea className="h-[240px] rounded-lg border border-border">
              <div className="p-2 space-y-1">
                {revisions.map((rev) => (
                  <button
                    key={rev.revision}
                    onClick={() => !rev.current && setSelectedRevision(rev.revision)}
                    disabled={rev.current || isLoading}
                    className={cn(
                      'w-full p-3 rounded-lg text-left transition-colors',
                      rev.current && 'bg-primary/5 border border-primary/20 cursor-not-allowed',
                      !rev.current && selectedRevision === rev.revision && 'bg-primary/10 border border-primary',
                      !rev.current && selectedRevision !== rev.revision && 'hover:bg-muted/50 border border-transparent',
                      isLoading && 'opacity-50'
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium">Revision {rev.revision}</span>
                        {rev.current && (
                          <Badge variant="default" className="text-xs">Current</Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">{rev.createdAt}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      {rev.image && (
                        <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                          {rev.image}
                        </span>
                      )}
                      {rev.changeReason && (
                        <span className="text-xs">{rev.changeReason}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
            )}

            {selectedRevision && (
              <div className="p-3 rounded-lg bg-warning/10 border border-warning/20 text-warning text-sm flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Rolling back to revision {selectedRevision} will replace the current configuration.
                  This action can be undone by rolling forward.
                </span>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          {activeTab === 'restart' ? (
            <Button onClick={handleRestart} disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Restarting...
                </>
              ) : (
                <>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Restart Rollout
                </>
              )}
            </Button>
          ) : (
            <Button
              onClick={handleRollback}
              disabled={isLoading || !selectedRevision}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Rolling back...
                </>
              ) : (
                <>
                  <History className="h-4 w-4 mr-2" />
                  Rollback to Rev {selectedRevision || '?'}
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
