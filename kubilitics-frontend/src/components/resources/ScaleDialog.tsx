import { useState, useEffect } from 'react';
import { Scale, Minus, Plus, Loader2 } from 'lucide-react';
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
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { NamespaceBadge } from '@/components/list';
import { cn } from '@/lib/utils';

export interface ScaleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceType: string;
  resourceName: string;
  namespace?: string;
  currentReplicas: number;
  onScale: (replicas: number) => Promise<void> | void;
}

export function ScaleDialog({
  open,
  onOpenChange,
  resourceType,
  resourceName,
  namespace,
  currentReplicas,
  onScale,
}: ScaleDialogProps) {
  const [replicas, setReplicas] = useState(currentReplicas);
  const [isScaling, setIsScaling] = useState(false);

  useEffect(() => {
    if (open) {
      setReplicas(currentReplicas);
    }
  }, [open, currentReplicas]);

  const handleScale = async () => {
    if (replicas === currentReplicas) {
      onOpenChange(false);
      return;
    }

    setIsScaling(true);
    try {
      await onScale(replicas);
      onOpenChange(false);
    } catch (error) {
      console.error('Scale failed:', error);
    } finally {
      setIsScaling(false);
    }
  };

  const increment = () => setReplicas((prev) => Math.min(prev + 1, 100));
  const decrement = () => setReplicas((prev) => Math.max(prev - 1, 0));

  const scaleDirection = replicas > currentReplicas ? 'up' : replicas < currentReplicas ? 'down' : 'none';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-full bg-primary/10">
              <Scale className="h-5 w-5 text-primary" />
            </div>
            <DialogTitle className="text-xl">Scale {resourceType}</DialogTitle>
          </div>
          <DialogDescription className="text-left">
            Adjust the number of replicas for{' '}
            <span className="font-mono font-medium text-foreground">{resourceName}</span>
            {namespace && (
              <span className="text-muted-foreground">
                {' '}in <NamespaceBadge namespace={namespace} className="ml-1" />
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Current vs New Replicas Display */}
          <div className="flex items-center justify-center gap-4">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">Current</p>
              <div className="text-3xl font-bold text-muted-foreground">{currentReplicas}</div>
            </div>
            <div className="text-2xl text-muted-foreground">→</div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">New</p>
              <div className={cn(
                'text-3xl font-bold',
                scaleDirection === 'up' && 'text-success',
                scaleDirection === 'down' && 'text-warning',
                scaleDirection === 'none' && 'text-foreground'
              )}>
                {replicas}
              </div>
            </div>
          </div>

          {/* Stepper Controls */}
          <div className="flex items-center justify-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={decrement}
              disabled={replicas <= 0 || isScaling}
              className="h-10 w-10"
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Input
              type="number"
              min={0}
              max={100}
              value={replicas}
              onChange={(e) => setReplicas(Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))}
              className="w-20 text-center font-mono text-lg"
              disabled={isScaling}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={increment}
              disabled={replicas >= 100 || isScaling}
              className="h-10 w-10"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {/* Slider */}
          <div className="px-2">
            <Slider
              value={[replicas]}
              onValueChange={(values) => setReplicas(values[0])}
              min={0}
              max={20}
              step={1}
              disabled={isScaling}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>0</span>
              <span>20</span>
            </div>
          </div>

          {/* Quick Scale Buttons */}
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Quick Scale</Label>
            <div className="flex flex-wrap gap-2">
              {[0, 1, 3, 5, 10].map((count) => (
                <Button
                  key={count}
                  variant={replicas === count ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setReplicas(count)}
                  disabled={isScaling}
                  className="min-w-12"
                >
                  {count}
                </Button>
              ))}
            </div>
          </div>

          {/* Warning for scale to zero */}
          {replicas === 0 && (
            <div className="p-3 rounded-lg bg-warning/10 border border-warning/20 text-warning text-sm">
              ⚠️ Scaling to 0 replicas will stop all pods for this {resourceType.toLowerCase()}.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isScaling}>
            Cancel
          </Button>
          <Button onClick={handleScale} disabled={isScaling || replicas === currentReplicas}>
            {isScaling ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Scaling...
              </>
            ) : (
              <>
                <Scale className="h-4 w-4 mr-2" />
                Scale to {replicas}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
