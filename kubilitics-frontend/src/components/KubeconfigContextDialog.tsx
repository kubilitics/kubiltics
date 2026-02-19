
import { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Server, User, Loader2 } from 'lucide-react';
import { KubernetesLogo } from '@/components/icons/KubernetesIcons';

interface KubeconfigContext {
    name: string;
    cluster: string;
    user: string;
    namespace?: string;
}

interface KubeconfigContextDialogProps {
    open: boolean;
    contexts: KubeconfigContext[];
    onSelect: (selectedContexts: string[]) => void;
    onCancel: () => void;
}

export function KubeconfigContextDialog({
    open,
    contexts,
    onSelect,
    onCancel,
}: KubeconfigContextDialogProps) {
    const [selected, setSelected] = useState<string[]>(
        contexts.map((c) => c.name) // Default select all
    );
    const [isSubmitting, setIsSubmitting] = useState(false);

    const toggleContext = (name: string) => {
        setSelected((prev) =>
            prev.includes(name)
                ? prev.filter((c) => c !== name)
                : [...prev, name]
        );
    };

    const toggleAll = () => {
        if (selected.length === contexts.length) {
            setSelected([]);
        } else {
            setSelected(contexts.map((c) => c.name));
        }
    };

    const handleConfirm = async () => {
        setIsSubmitting(true);
        await new Promise(resolve => setTimeout(resolve, 300));
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('save_selected_contexts', { contexts: selected });
        } catch (e) {
            console.error('Failed to save selected contexts:', e);
        }
        // P1-5: Parent (KubeconfigContextWrapper) registers clusters with backend, then calls mark_first_launch_complete and navigates.
        onSelect(selected);
        setIsSubmitting(false);
    };

    return (
        <Dialog open={open} onOpenChange={(val) => !val && onCancel()}>
            <DialogContent className="sm:max-w-[600px] border-slate-800 bg-[#020617] text-slate-50">
                <DialogHeader>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 rounded-lg bg-blue-500/10">
                            <KubernetesLogo className="h-6 w-6 text-blue-500" />
                        </div>
                        <DialogTitle className="text-xl">Discovered Clusters</DialogTitle>
                    </div>
                    <DialogDescription className="text-slate-400">
                        We found the following contexts in your default kubeconfig. Select the ones you want to import into Kubilitics.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4">
                    <div className="flex items-center justify-between mb-4 px-1">
                        <div className="text-sm text-slate-400 font-medium">
                            {selected.length} of {contexts.length} selected
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={toggleAll}
                            className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 h-8"
                        >
                            {selected.length === contexts.length ? 'Deselect All' : 'Select All'}
                        </Button>
                    </div>

                    <ScrollArea className="h-[300px] pr-4 rounded-xl border border-slate-800/50 bg-slate-900/20">
                        <div className="space-y-2 p-2">
                            {contexts.map((ctx) => (
                                <div
                                    key={ctx.name}
                                    className={`
                    flex items-start gap-4 p-3 rounded-lg border transition-all cursor-pointer
                    ${selected.includes(ctx.name)
                                            ? 'border-blue-500/50 bg-blue-500/10'
                                            : 'border-transparent hover:bg-slate-800/50 hover:border-slate-700'}
                  `}
                                    onClick={() => toggleContext(ctx.name)}
                                >
                                    <Checkbox
                                        checked={selected.includes(ctx.name)}
                                        onCheckedChange={() => toggleContext(ctx.name)}
                                        className="mt-1 border-slate-600 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="font-medium text-sm text-slate-200 truncate">
                                                {ctx.name}
                                            </span>
                                            {ctx.namespace && (
                                                <Badge variant="outline" className="text-[10px] h-5 border-slate-700 text-slate-400">
                                                    {ctx.namespace}
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-4 text-xs text-slate-500">
                                            <div className="flex items-center gap-1 truncate">
                                                <Server className="h-3 w-3" />
                                                <span className="truncate">{ctx.cluster}</span>
                                            </div>
                                            <div className="flex items-center gap-1 truncate">
                                                <User className="h-3 w-3" />
                                                <span className="truncate">{ctx.user}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button
                        variant="outline"
                        onClick={onCancel}
                        className="border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white"
                    >
                        Skip for now
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        disabled={selected.length === 0 || isSubmitting}
                        className="bg-blue-600 hover:bg-blue-500 text-white min-w-[140px]"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Importing...
                            </>
                        ) : (
                            `Import ${selected.length} Clusters`
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
