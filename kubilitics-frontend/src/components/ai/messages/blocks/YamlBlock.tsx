import type { YamlBlockData } from './render-types';
import { Button } from '@/components/ui/button';
import { Copy } from 'lucide-react';

export function YamlBlock({ data }: { data: YamlBlockData }) {
  const copy = () => {
    void navigator.clipboard?.writeText(data.yaml);
  };
  return (
    <div className="yaml-block rounded-md border bg-background/50">
      <div className="flex items-center justify-between px-2 py-1 border-b text-xs text-muted-foreground">
        <span>YAML</span>
        <Button variant="ghost" size="sm" onClick={copy} aria-label="Copy YAML">
          <Copy className="h-3.5 w-3.5 mr-1" /> Copy
        </Button>
      </div>
      <pre className="px-3 py-2 font-mono text-xs overflow-auto whitespace-pre max-h-[500px]">
        <code>{data.yaml}</code>
      </pre>
    </div>
  );
}
