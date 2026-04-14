import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import type { Diagnosis } from '@/lib/diagnose/types';
import { toDescribeText } from '@/lib/diagnose/describeFormat';

/**
 * Copies a kubectl describe-style plain-text representation of the diagnosis
 * to the clipboard. Falls back to a hidden textarea + document.execCommand
 * for environments where navigator.clipboard is unavailable.
 */
export interface CopyAsDescribeButtonProps {
  diagnosis: Diagnosis;
  resource: { metadata: { name: string; namespace?: string } };
  size?: 'default' | 'sm';
  className?: string;
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to fallback
    }
  }
  // Legacy fallback for environments without the async clipboard API
  if (typeof document !== 'undefined') {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
  return false;
}

export function CopyAsDescribeButton({
  diagnosis,
  resource,
  size = 'sm',
  className,
}: CopyAsDescribeButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    const text = toDescribeText(diagnosis, resource);
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      toast.success('Diagnosis copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error('Failed to copy diagnosis');
    }
  };

  return (
    <Button
      variant="outline"
      size={size}
      onClick={handleClick}
      className={className}
      aria-label="Copy diagnosis to clipboard"
    >
      {copied ? (
        <>
          <Check className="h-4 w-4 mr-1.5" aria-hidden />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-4 w-4 mr-1.5" aria-hidden />
          Copy as describe
        </>
      )}
    </Button>
  );
}
