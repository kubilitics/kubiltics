import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RotateCcw, History, AlertTriangle, Loader2 } from 'lucide-react';
import type { AddOnInstallWithHealth, HelmReleaseRevision } from '@/types/api/addons';
import { useAddonMutations } from '@/hooks/useAddonInstall';
import { useQuery } from '@tanstack/react-query';
import { useBackendClient } from '@/hooks/useBackendClient';
import { format } from 'date-fns';

interface RollbackDialogProps {
    open: boolean;
    onClose: () => void;
    install: AddOnInstallWithHealth;
}

/**
 * T5.21: RollbackDialog component
 * Shows Helm history and allows selecting a revision to rollback to.
 */
export function RollbackDialog({ open, onClose, install }: RollbackDialogProps) {
    const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const client = useBackendClient();
    const { rollback } = useAddonMutations(install.cluster_id);

    const { data: history, isLoading } = useQuery({
        queryKey: ['addon-history', install.id],
        queryFn: () => client.getAddonReleaseHistory(install.cluster_id, install.id),
        enabled: open,
    });

    const handleRollback = async () => {
        if (selectedRevision === null) return;
        setIsSubmitting(true);
        try {
            await rollback({ installId: install.id, revision: selectedRevision });
            onClose();
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="sm:max-w-[500px] max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <RotateCcw className="h-5 w-5 text-amber-500" />
                        Rollback Add-on
                    </DialogTitle>
                    <DialogDescription>
                        Revert {install.catalog_entry?.display_name || install.addon_id} to a previous stable revision.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto py-4">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
                            <Loader2 className="h-8 w-8 animate-spin" />
                            <span className="text-sm">Fetching revision history...</span>
                        </div>
                    ) : !history || history.length <= 1 ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-2 text-center text-muted-foreground border-2 border-dashed rounded-xl bg-muted/20">
                            <History className="h-8 w-8 opacity-20" />
                            <span className="text-sm">No previous revisions found.</span>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <h4 className="text-xs font-bold uppercase text-muted-foreground tracking-wider mb-3">Select Revision</h4>
                            {history
                                .filter(rev => rev.revision !== install.helm_revision)
                                .sort((a, b) => b.revision - a.revision)
                                .map((rev) => (
                                    <div
                                        key={rev.revision}
                                        onClick={() => setSelectedRevision(rev.revision)}
                                        className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${selectedRevision === rev.revision
                                                ? 'bg-amber-50 border-amber-200 dark:bg-amber-900/10 dark:border-amber-800'
                                                : 'hover:bg-muted/50 border-transparent'
                                            }`}
                                    >
                                        <div className="flex flex-col gap-0.5">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-bold">Revision {rev.revision}</span>
                                                <Badge variant="outline" className="text-[10px] py-0">{rev.chart_version}</Badge>
                                            </div>
                                            <span className="text-[10px] text-muted-foreground">
                                                {rev.deployed_at ? format(new Date(rev.deployed_at), 'PPP p') : 'Unknown date'}
                                            </span>
                                            <p className="text-[10px] italic text-muted-foreground truncate max-w-[300px]">
                                                {rev.description || 'No description'}
                                            </p>
                                        </div>
                                        {selectedRevision === rev.revision && (
                                            <Badge className="bg-amber-500 text-white">Selected</Badge>
                                        )}
                                    </div>
                                ))}
                        </div>
                    )}

                    <div className="mt-6 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/50 flex gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                        <p className="text-[10px] text-amber-700 dark:text-amber-400">
                            Rollback will restart pods. Ensure you've backed up any critical data before reverting.
                        </p>
                    </div>
                </div>

                <DialogFooter className="mt-4">
                    <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
                    <Button
                        onClick={handleRollback}
                        disabled={selectedRevision === null || isSubmitting}
                        className="bg-amber-600 hover:bg-amber-700 text-white"
                    >
                        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RotateCcw className="h-4 w-4 mr-2" />}
                        Rollback to Revision {selectedRevision}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
