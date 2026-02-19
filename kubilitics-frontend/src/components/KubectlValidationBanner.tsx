import { useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Terminal, ExternalLink, X } from 'lucide-react';
import { isTauri } from '@/lib/tauri';
import { Button } from '@/components/ui/button';

interface KubectlStatus {
  installed: boolean;
  version?: string;
  path?: string;
}

/**
 * KubectlValidationBanner
 *
 * Shows a soft, dismissible notice when kubectl is not found in PATH.
 *
 * IMPORTANT: kubectl is NOT required to use Kubilitics.
 * - Cluster access, dashboards, resource browsing → all work via kubeconfig only
 * - kubectl is only needed for the built-in terminal / shell tab
 *
 * This mirrors how Headlamp and Lens work — they don't require kubectl either.
 * The app bundles `kcli` for all Kubernetes API calls internally.
 */
export function KubectlValidationBanner() {
  const [kubectlStatus, setKubectlStatus] = useState<KubectlStatus | null>(null);
  const [checked, setChecked] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isTauri() || checked) return;

    // Check persisted dismissal from sessionStorage (resets on app restart)
    const wasDismissed = sessionStorage.getItem('kubectl-banner-dismissed') === 'true';
    if (wasDismissed) {
      setDismissed(true);
      setChecked(true);
      return;
    }

    const checkKubectl = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const status = await invoke<KubectlStatus>('check_kubectl_installed');
        setKubectlStatus(status);
      } catch {
        // Silently ignore — kubectl check failing doesn't block the app
        setKubectlStatus({ installed: true }); // Assume installed to avoid false alarms
      } finally {
        setChecked(true);
      }
    };

    checkKubectl();
  }, [checked]);

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('kubectl-banner-dismissed', 'true');
  };

  // Only show in Tauri, after check, when kubectl is missing, and not dismissed
  if (!isTauri() || !checked || !kubectlStatus || kubectlStatus.installed || dismissed) {
    return null;
  }

  return (
    <Alert className="mx-4 mt-3 mb-0 border-slate-600/40 bg-slate-800/30 dark:bg-slate-900/40 flex items-start gap-3 py-3">
      <Terminal className="h-4 w-4 mt-0.5 text-slate-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <AlertTitle className="text-slate-300 text-sm font-medium mb-0.5">
          Terminal shell needs kubectl
        </AlertTitle>
        <AlertDescription className="text-slate-400 text-xs leading-relaxed">
          kubectl is not in PATH — the built-in terminal tab won't work. Everything else (dashboards,
          workloads, logs, cluster access) works fine with just your kubeconfig.{' '}
          <button
            onClick={() => window.open('https://kubernetes.io/docs/tasks/tools/', '_blank')}
            className="text-blue-400 hover:text-blue-300 underline underline-offset-2 inline-flex items-center gap-1"
          >
            Install kubectl
            <ExternalLink className="h-3 w-3" />
          </button>
        </AlertDescription>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleDismiss}
        className="h-6 w-6 p-0 text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 shrink-0 -mt-0.5"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </Alert>
  );
}
