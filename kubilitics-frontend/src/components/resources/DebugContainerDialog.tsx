import { useState } from 'react';
import { Bug, Loader2, Terminal } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { toast } from '@/components/ui/sonner';
import { createDebugContainer } from '@/services/backendApiClient';

const PRESET_IMAGES = [
  { label: 'BusyBox (minimal shell)', value: 'busybox:latest' },
  { label: 'Alpine (lightweight)', value: 'alpine:latest' },
  { label: 'Netshoot (network debug)', value: 'nicolaka/netshoot:latest' },
  { label: 'Ubuntu (full toolkit)', value: 'ubuntu:latest' },
] as const;

export interface DebugContainerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  podName: string;
  namespace: string;
  baseUrl: string;
  clusterId: string;
  /** List of container names in the pod (for target selection). */
  containers: string[];
  /** Callback after a debug container is successfully created. Receives the ephemeral container name. */
  onCreated?: (debugContainerName: string) => void;
}

export function DebugContainerDialog({
  open,
  onOpenChange,
  podName,
  namespace,
  baseUrl,
  clusterId,
  containers,
  onCreated,
}: DebugContainerDialogProps) {
  const [selectedPreset, setSelectedPreset] = useState(PRESET_IMAGES[0].value);
  const [customImage, setCustomImage] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [targetContainer, setTargetContainer] = useState(containers[0] ?? '');
  const [isCreating, setIsCreating] = useState(false);

  const image = useCustom ? customImage.trim() : selectedPreset;

  const handleCreate = async () => {
    if (!image) {
      toast.error('Please specify a debug container image');
      return;
    }
    if (!targetContainer) {
      toast.error('Please select a target container');
      return;
    }

    setIsCreating(true);
    try {
      const result = await createDebugContainer(
        baseUrl,
        clusterId,
        namespace,
        podName,
        image,
        targetContainer,
      );
      toast.success(`Debug container "${result.name}" created`, {
        description: 'Switch to the Terminal tab to attach to the debug session.',
        action: onCreated
          ? {
              label: 'Open Terminal',
              onClick: () => onCreated(result.name),
            }
          : undefined,
      });
      onOpenChange(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Failed to create debug container', { description: msg });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bug className="h-5 w-5" />
            Debug Container
          </DialogTitle>
          <DialogDescription>
            Attach an ephemeral debug container to <strong>{podName}</strong> sharing the
            target container's process namespace.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Image selection */}
          <div className="space-y-2">
            <Label>Debug Image</Label>
            {!useCustom ? (
              <Select value={selectedPreset} onValueChange={setSelectedPreset}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an image" />
                </SelectTrigger>
                <SelectContent>
                  {PRESET_IMAGES.map((img) => (
                    <SelectItem key={img.value} value={img.value}>
                      {img.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                placeholder="e.g. my-registry/debug-tools:v1"
                value={customImage}
                onChange={(e) => setCustomImage(e.target.value)}
              />
            )}
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => setUseCustom(!useCustom)}
            >
              {useCustom ? 'Use preset image' : 'Use custom image'}
            </Button>
          </div>

          {/* Target container */}
          <div className="space-y-2">
            <Label>Target Container</Label>
            <Select value={targetContainer} onValueChange={setTargetContainer}>
              <SelectTrigger>
                <SelectValue placeholder="Select target container" />
              </SelectTrigger>
              <SelectContent>
                {containers.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The debug container shares the process namespace of this container.
            </p>
          </div>

          {/* Submit */}
          <Button
            className="w-full"
            onClick={handleCreate}
            disabled={isCreating || !image || !targetContainer}
          >
            {isCreating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Terminal className="mr-2 h-4 w-4" />
                Start Debug Session
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
