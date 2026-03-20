import { Copy } from 'lucide-react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';

export interface CopyNameDropdownItemProps {
  /** Resource name (required). */
  name: string;
  /** Namespace for namespaced resources; omit for cluster-scoped (copy name only). */
  namespace?: string;
  /** Optional className for the menu item. */
  className?: string;
}

/**
 * Row dropdown item: copies resource name (or namespace/name) to clipboard and shows toast.
 * Place before the first separator in every list page row actions.
 */
export function CopyNameDropdownItem({ name, namespace, className = 'gap-2' }: CopyNameDropdownItemProps) {
  const handleCopy = () => {
    const text = namespace ? `${namespace}/${name}` : name;
    navigator.clipboard.writeText(text).then(
      () => toast.success('Copied to clipboard'),
      () => toast.error('Copy failed')
    );
  };

  return (
    <DropdownMenuItem onClick={handleCopy} className={className}>
      <Copy className="h-4 w-4" />
      Copy Name
    </DropdownMenuItem>
  );
}
