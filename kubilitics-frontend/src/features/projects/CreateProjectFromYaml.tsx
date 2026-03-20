/**
 * Create Project from YAML — Import project definition via YAML.
 * Project name, cluster selection, upload files or load from URL.
 */
import { useState } from 'react';
import { Loader2, ArrowLeft, Upload, Link } from 'lucide-react';
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
import { useProjectMutations } from '@/hooks/useProjects';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface CreateProjectFromYamlProps {
  onSuccess: () => void;
  onBack: () => void;
  onCancel: () => void;
}

export function CreateProjectFromYaml({ onSuccess, onBack, onCancel }: CreateProjectFromYamlProps) {
  const [activeTab, setActiveTab] = useState<'upload' | 'url'>('upload');
  const [projectName, setProjectName] = useState('');
  const [clusterId, setClusterId] = useState('');
  const [yamlContent, setYamlContent] = useState('');
  const [yamlUrl, setYamlUrl] = useState('');
  const [fileNames, setFileNames] = useState<string[]>([]);

  const clustersQuery = useClustersFromBackend();
  const clusters = clustersQuery.data ?? [];
  const { create } = useProjectMutations();

  const canCreate = projectName.trim().length > 0;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const names: string[] = [];
    const reader = new FileReader();
    const loadNext = (i: number) => {
      if (i >= files.length) {
        setFileNames(names);
        return;
      }
      const f = files[i];
      names.push(f.name);
      reader.onload = () => {
        setYamlContent((prev) => (prev ? prev + '\n---\n' : '') + (reader.result as string));
        loadNext(i + 1);
      };
      reader.readAsText(f);
    };
    loadNext(0);
  };

  const handleCreate = async () => {
    if (!canCreate) return;
    try {
      const desc = [yamlContent && 'YAML uploaded', yamlUrl && `URL: ${yamlUrl}`, clusterId && `Target: ${clusters.find((c) => c.id === clusterId)?.name ?? clusterId}`]
        .filter(Boolean)
        .join('; ');
      await create.mutateAsync({
        name: projectName.trim(),
        description: desc || 'Created from YAML',
      });
      toast.success(
        'Project created. Add clusters and namespaces, or apply YAML via kubectl.',
        { duration: 5000 }
      );
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create project');
    }
  };

  return (
    <div className="space-y-6 py-4">
      <div className="space-y-2">
        <Label htmlFor="yaml-project-name">Project name</Label>
        <Input
          id="yaml-project-name"
          placeholder="Project Name *"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">Give your project a descriptive name</p>
      </div>

      <div className="space-y-2">
        <Label>Cluster</Label>
        <Select value={clusterId} onValueChange={setClusterId}>
          <SelectTrigger>
            <SelectValue placeholder="Clusters *" />
          </SelectTrigger>
          <SelectContent>
            {clusters.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name} {c.provider && `(${c.provider})`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Select cluster for this project</p>
      </div>

      <div className="space-y-2">
        <Label>Load resources</Label>
        <p className="text-xs text-muted-foreground">Upload files or load from URL</p>
        <div className="flex gap-2 border-b">
          <button
            type="button"
            onClick={() => setActiveTab('upload')}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === 'upload' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'
            )}
          >
            Upload Files
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('url')}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === 'url' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'
            )}
          >
            Load from URL
          </button>
        </div>

        {activeTab === 'upload' && (
          <div
            className={cn(
              'border-2 border-dashed rounded-xl p-8 text-center transition-colors',
              'border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50'
            )}
          >
            <input
              type="file"
              accept=".yaml,.yml"
              multiple
              className="hidden"
              id="yaml-upload"
              onChange={handleFileSelect}
            />
            <label htmlFor="yaml-upload" className="cursor-pointer block">
              <div className="p-4 rounded-2xl bg-primary/10 w-fit mx-auto mb-4">
                <Upload className="h-8 w-8 text-primary" />
              </div>
              <Button type="button" variant="outline" asChild>
                <span>Choose Files</span>
              </Button>
              <p className="text-sm text-muted-foreground mt-2">Supports .yaml and .yml files</p>
              {fileNames.length > 0 && (
                <p className="text-xs text-primary mt-2">{fileNames.join(', ')}</p>
              )}
            </label>
          </div>
        )}

        {activeTab === 'url' && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="h-10 w-10 shrink-0 rounded-lg border flex items-center justify-center text-muted-foreground">
                <Link className="h-5 w-5" />
              </div>
              <Input
                placeholder="https://example.com/manifests/project.yaml"
                value={yamlUrl}
                onChange={(e) => setYamlUrl(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Fetch YAML from a URL. Resources will be applied to the selected cluster.
            </p>
          </div>
        )}
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!canCreate || create.isPending}>
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
}
