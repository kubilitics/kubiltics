/**
 * Create Project Form — Guided project creation.
 * Project name, clusters (multi-select), namespaces (per cluster, per team).
 * No cloud-specific filters — cluster-only association.
 */
import { useState } from 'react';
import { Loader2, ArrowLeft, Plus, Trash2, Server, Layers, FolderKanban, ChevronRight } from 'lucide-react';
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
import { useClustersFromBackend } from '@/hooks/useClustersFromBackend';
import { useNamespacesFromCluster } from '@/hooks/useNamespacesFromCluster';
import { useProjectMutations } from '@/hooks/useProjects';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Check, ChevronsUpDown } from 'lucide-react';

interface NamespaceAssignment {
  clusterId: string;
  namespaceName: string;
  team: string;
}

interface CreateProjectFormProps {
  onSuccess: () => void;
  onBack: () => void;
  onCancel: () => void;
  onStepChange: (step: number) => void;
}

export function CreateProjectForm({ onSuccess, onBack, onCancel, onStepChange }: CreateProjectFormProps) {
  const [step, setStep] = useState(0); // 0: Basics, 1: Clusters, 2: Namespaces, 3: Review
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [clusterIds, setClusterIds] = useState<string[]>([]);
  const [namespaces, setNamespaces] = useState<NamespaceAssignment[]>([]);
  const [newNsCluster, setNewNsCluster] = useState('');
  const [newNsName, setNewNsName] = useState('');
  const [newNsTeam, setNewNsTeam] = useState('');
  const [openNsSelect, setOpenNsSelect] = useState(false);

  const clustersQuery = useClustersFromBackend();
  const availableClusters = clustersQuery.data ?? [];
  const namespacesQuery = useNamespacesFromCluster(newNsCluster || null);
  const fetchedNamespaces = namespacesQuery.data ?? [];

  const { create, addCluster, addNamespace } = useProjectMutations();

  const canNext = () => {
    if (step === 0) return name.trim().length > 0;
    if (step === 1) return clusterIds.length > 0;
    return true;
  };

  const handleNext = () => {
    if (step < 3) {
      const nextStep = step + 1;
      setStep(nextStep);
      onStepChange(nextStep);
    }
  };

  const handlePrev = () => {
    if (step > 0) {
      const prevStep = step - 1;
      setStep(prevStep);
      onStepChange(prevStep);
    } else {
      onBack();
    }
  };

  const handleAddCluster = (cid: string) => {
    if (clusterIds.includes(cid)) {
      setClusterIds((prev) => prev.filter((id) => id !== cid));
      setNamespaces((prev) => prev.filter((n) => n.clusterId !== cid));
    } else {
      setClusterIds((prev) => [...prev, cid]);
    }
  };

  const handleAddNamespace = () => {
    if (!newNsCluster || !newNsName.trim()) {
      toast.error('Select cluster and enter namespace name');
      return;
    }
    const key = `${newNsCluster}:${newNsName.trim()}`;
    if (namespaces.some((n) => `${n.clusterId}:${n.namespaceName}` === key)) {
      toast.error('Namespace already added for this cluster');
      return;
    }
    setNamespaces((prev) => [
      ...prev,
      { clusterId: newNsCluster, namespaceName: newNsName.trim(), team: newNsTeam.trim() },
    ]);
    setNewNsName('');
    setNewNsTeam('');
  };

  const handleRemoveNamespace = (clusterId: string, namespaceName: string) => {
    setNamespaces((prev) => prev.filter((n) => !(n.clusterId === clusterId && n.namespaceName === namespaceName)));
  };

  const handleSubmit = async () => {
    try {
      const project = await create.mutateAsync({ name: name.trim(), description: description.trim() });
      for (const cid of clusterIds) {
        await addCluster.mutateAsync({ projectId: project.id, clusterId: cid });
      }
      for (const n of namespaces) {
        await addNamespace.mutateAsync({
          projectId: project.id,
          clusterId: n.clusterId,
          namespaceName: n.namespaceName,
          team: n.team || undefined,
        });
      }
      toast.success(`Project "${name}" created`);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create project');
    }
  };

  const clusterIdsSet = new Set(clusterIds);

  return (
    <div className="flex flex-col md:flex-row gap-8 min-h-[400px]">
      <div className="flex-1 space-y-6">
        {step === 0 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="project-name" className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Project Identity</Label>
                <Input
                  id="project-name"
                  placeholder="e.g. Finance Hub"
                  className="text-xl h-14 bg-background/50 border-2 focus-visible:ring-primary/20"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <p className="text-xs text-muted-foreground italic">Give your project a recognizable name across the organization.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="project-desc" className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Description (Optional)</Label>
                <Input
                  id="project-desc"
                  placeholder="e.g. Core banking infrastructure and microservices"
                  className="h-12 bg-background/50 transition-all focus:bg-background"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
            <div className="space-y-4">
              <Label className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Select Infrastructure</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {availableClusters.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => handleAddCluster(c.id)}
                    className={cn(
                      "flex items-center gap-4 p-4 rounded-xl border-2 transition-all duration-300 text-left group overflow-hidden relative",
                      clusterIdsSet.has(c.id)
                        ? "border-primary bg-primary/5 shadow-lg shadow-primary/5"
                        : "border-border bg-card/50 hover:border-primary/30 hover:bg-primary/5"
                    )}
                  >
                    {clusterIdsSet.has(c.id) && (
                      <div className="absolute top-0 right-0 p-1.5 bg-primary text-primary-foreground rounded-bl-lg">
                        <Plus className="h-3 w-3 rotate-45" />
                      </div>
                    )}
                    <div className={cn(
                      "p-3 rounded-lg transition-colors",
                      clusterIdsSet.has(c.id) ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"
                    )}>
                      <Server className="h-6 w-6" />
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <p className="font-bold truncate">{c.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{c.provider || 'Internal Cluster'}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
            <div className="space-y-4">
              <Label className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Namespace Scoping</Label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Select value={newNsCluster} onValueChange={setNewNsCluster}>
                  <SelectTrigger className="w-[180px] h-11">
                    <SelectValue placeholder="Target Cluster" />
                  </SelectTrigger>
                  <SelectContent>
                    {clusterIds.map((cid) => {
                      const cluster = availableClusters.find((x) => x.id === cid);
                      return (
                        <SelectItem key={cid} value={cid}>
                          {cluster?.name ?? cid}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <Popover open={openNsSelect} onOpenChange={setOpenNsSelect}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={openNsSelect}
                      disabled={!newNsCluster}
                      className="flex-1 h-11 justify-between bg-background/50"
                    >
                      {newNsName ? newNsName : "Select Namespace..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search namespaces..." />
                      <CommandList>
                        <CommandEmpty>
                          {namespacesQuery.isLoading ? (
                            <div className="p-4 flex items-center justify-center">
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            </div>
                          ) : (
                            "No namespace found."
                          )}
                        </CommandEmpty>
                        <CommandGroup>
                          {fetchedNamespaces.map((ns) => (
                            <CommandItem
                              key={ns}
                              value={ns}
                              onSelect={(currentValue) => {
                                setNewNsName(currentValue);
                                setOpenNsSelect(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  newNsName === ns ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {ns}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <Input
                  placeholder="Team label"
                  className="w-[120px] h-11"
                  value={newNsTeam}
                  onChange={(e) => setNewNsTeam(e.target.value)}
                />
                <Button
                  type="button"
                  onClick={handleAddNamespace}
                  disabled={!newNsCluster || !newNsName.trim()}
                  className="h-11 px-6 rounded-lg"
                >
                  Add
                </Button>
              </div>

              <div className="space-y-2 max-h-[200px] overflow-y-auto pr-2">
                {namespaces.map((n) => {
                  const cluster = availableClusters.find((x) => x.id === n.clusterId);
                  return (
                    <div key={`${n.clusterId}:${n.namespaceName}`} className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border group">
                      <div className="flex items-center gap-3">
                        <Layers className="h-4 w-4 text-primary" />
                        <div>
                          <p className="font-medium text-sm">{n.namespaceName}</p>
                          <p className="text-[10px] text-muted-foreground">In {cluster?.name}</p>
                        </div>
                        {n.team && (
                          <span className="text-[10px] font-bold uppercase py-0.5 px-1.5 rounded bg-primary/10 text-primary">{n.team}</span>
                        )}
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => handleRemoveNamespace(n.clusterId, n.namespaceName)} className="h-8 w-8 text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
            <div className="space-y-4">
              <Label className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Final Review</Label>
              <div className="p-6 rounded-2xl bg-primary/5 border border-primary/20 space-y-4">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-primary/10 text-primary">
                    <FolderKanban className="h-8 w-8" />
                  </div>
                  <div>
                    <h4 className="text-xl font-bold">{name}</h4>
                    <p className="text-sm text-muted-foreground">{description || 'No description provided'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-primary/10 text-sm">
                  <div>
                    <p className="text-muted-foreground mb-1 uppercase text-[10px] font-bold tracking-widest">Clusters</p>
                    <p className="font-bold">{clusterIds.length} Connected</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1 uppercase text-[10px] font-bold tracking-widest">Namespaces</p>
                    <p className="font-bold">{namespaces.length} Assigned</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-between pt-8">
          <Button variant="ghost" onClick={handlePrev} className="rounded-full px-6">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {step === 0 ? 'Exit' : 'Previous'}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel} className="rounded-full px-6">
              Cancel
            </Button>
            {step < 3 ? (
              <Button onClick={handleNext} disabled={!canNext()} className="rounded-full px-8 shadow-lg shadow-primary/20 group">
                Next Step
                <ChevronRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={create.isPending} className="rounded-full px-10 shadow-lg shadow-primary/25 bg-primary hover:scale-105 transition-transform">
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create Project'}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="hidden md:block w-72 bg-muted/20 rounded-2xl border border-border p-6 space-y-6">
        <h4 className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Live Context</h4>

        <div className="space-y-4">
          <div className="transition-all duration-300">
            <p className="text-[10px] font-bold uppercase text-primary/70 mb-2">Project Name</p>
            <p className={cn("text-lg font-bold tracking-tight", !name && "text-muted-foreground/30")}>
              {name || "Untitled Project"}
            </p>
          </div>

          <div className="h-px bg-border/50" />

          <div>
            <p className="text-[10px] font-bold uppercase text-primary/70 mb-3">Clusters ({clusterIds.length})</p>
            <div className="space-y-2">
              {clusterIds.map(cid => {
                const c = availableClusters.find(x => x.id === cid);
                return (
                  <div key={cid} className="flex items-center gap-2 text-sm text-foreground/80 bg-background/50 p-2 rounded-lg border border-border/30">
                    <Server className="h-3 w-3 text-primary/50" />
                    <span className="truncate">{c?.name || cid}</span>
                  </div>
                );
              })}
              {clusterIds.length === 0 && <p className="text-xs text-muted-foreground/40 italic font-light">No clusters linked</p>}
            </div>
          </div>

          <div className="h-px bg-border/50" />

          <div>
            <p className="text-[10px] font-bold uppercase text-primary/70 mb-3">Namespaces ({namespaces.length})</p>
            <div className="space-y-2">
              {namespaces.slice(0, 5).map((n, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px] text-foreground/60">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" />
                  <span className="truncate font-medium">{n.namespaceName}</span>
                </div>
              ))}
              {namespaces.length > 5 && <p className="text-[10px] text-muted-foreground italic">+{namespaces.length - 5} more...</p>}
              {namespaces.length === 0 && <p className="text-xs text-muted-foreground/40 italic font-light">No namespaces scoped</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
