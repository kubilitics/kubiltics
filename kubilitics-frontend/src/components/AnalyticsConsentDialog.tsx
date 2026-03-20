import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { isTauri } from '@/lib/tauri';

interface AnalyticsConsentDialogProps {
  open: boolean;
  onConsent: (consent: boolean) => void;
}

export function AnalyticsConsentDialog({ open, onConsent }: AnalyticsConsentDialogProps) {
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleAccept = async () => {
    if (!isTauri()) {
      onConsent(true);
      return;
    }

    setLoading(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_analytics_consent', { consent: true });
      onConsent(true);
    } catch (error) {
      console.error('Failed to save analytics consent:', error);
      onConsent(true); // Default to accepting if save fails
    } finally {
      setLoading(false);
    }
  };

  const handleDecline = async () => {
    if (!isTauri()) {
      onConsent(false);
      return;
    }

    setLoading(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_analytics_consent', { consent: false });
      onConsent(false);
    } catch (error) {
      console.error('Failed to save analytics consent:', error);
      onConsent(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Help Improve Kubilitics</DialogTitle>
          <DialogDescription>
            We'd like to collect anonymous usage data to help improve Kubilitics.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              We collect:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 ml-2">
              <li>App version and operating system</li>
              <li>Feature usage counts (which features you use most)</li>
              <li>Error reports (to fix bugs faster)</li>
            </ul>
          </div>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              We do NOT collect:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 ml-2">
              <li>Cluster data or configuration</li>
              <li>Kubeconfig contents</li>
              <li>Personal information</li>
              <li>Any sensitive or private data</li>
            </ul>
          </div>
          <div className="flex items-center space-x-2 pt-2">
            <Checkbox
              id="understand"
              checked={consent}
              onCheckedChange={(checked) => setConsent(checked === true)}
            />
            <label
              htmlFor="understand"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              I understand and agree to share anonymous usage data
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleDecline}
            disabled={loading}
          >
            Decline
          </Button>
          <Button
            onClick={handleAccept}
            disabled={!consent || loading}
          >
            {loading ? 'Saving...' : 'Accept'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
