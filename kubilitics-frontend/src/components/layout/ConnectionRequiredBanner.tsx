/**
 * Banner shown when no cluster is connected (useConnectionStatus().isConnected === false).
 * Per TASK-077: single top-of-page alert with "Connect Now" to cluster connect; no error toasts needed.
 */
import { WifiOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { cn } from '@/lib/utils';

export function ConnectionRequiredBanner({ className }: { className?: string }) {
  const { isConnected } = useConnectionStatus();

  if (isConnected) return null;

  return (
    <Alert
      variant="default"
      className={cn(
        'border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-100 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400',
        className
      )}
      role="alert"
    >
      <WifiOff className="h-4 w-4" />
      <AlertTitle className="mb-0">Cluster connection required</AlertTitle>
      <AlertDescription>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <span>Connect a Kubernetes cluster to browse and manage its resources.</span>
          <Button size="sm" variant="outline" className="shrink-0 border-amber-600/50 hover:bg-amber-500/20" asChild>
            <Link to="/">Connect now</Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
