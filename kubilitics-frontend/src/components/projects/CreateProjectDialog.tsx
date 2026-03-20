import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Loader2 } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createProject } from '@/services/backendApiClient';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useMemo } from 'react';
import { toast } from 'sonner';

export function CreateProjectDialog({ children }: { children: React.ReactNode }) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const storedBackendUrl = useBackendConfigStore((s) => s.backendBaseUrl);
    const backendBaseUrl = useMemo(() => getEffectiveBackendBaseUrl(storedBackendUrl), [storedBackendUrl]);
    const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
    const queryClient = useQueryClient();

    const createMutation = useMutation({
        mutationFn: async () => {
            if (!isBackendConfigured) throw new Error('Backend not configured');
            return createProject(backendBaseUrl, name, description);
        },
        onSuccess: (project) => {
            queryClient.invalidateQueries({ queryKey: ['projects'] });
            setOpen(false);
            setName('');
            setDescription('');
            toast.success(`Project "${project.name}" initialized successfully`);
        },
        onError: (error: any) => {
            toast.error(`Failed to initialize project: ${error.message}`);
        }
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim()) {
            createMutation.mutate();
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="sm:max-w-[425px] rounded-[2rem] border-slate-100">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle className="text-xl font-bold">Create New Project</DialogTitle>
                        <DialogDescription className="text-slate-500">
                            Group clusters and namespaces for logicized governance.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-6 py-8">
                        <div className="space-y-2">
                            <Label htmlFor="name" className="text-sm font-semibold text-slate-700">Project Name</Label>
                            <Input
                                id="name"
                                placeholder="e.g. Production Infrastructure"
                                className="rounded-xl border-slate-200 h-11 focus:ring-blue-500"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="description" className="text-sm font-semibold text-slate-700">Description (Optional)</Label>
                            <Textarea
                                id="description"
                                placeholder="Briefly describe the business unit or environment..."
                                className="rounded-xl border-slate-200 min-h-[100px] py-3 focus:ring-blue-500"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            className="rounded-xl h-11 px-6 border-slate-200"
                            onClick={() => setOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            className="rounded-xl h-11 px-6 bg-slate-900 text-white hover:bg-slate-800"
                            disabled={createMutation.isPending || !name.trim()}
                        >
                            {createMutation.isPending && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            Create Project
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
