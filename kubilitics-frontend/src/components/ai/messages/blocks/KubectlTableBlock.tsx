import type { KubectlTableData } from './render-types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STATUS_CLASS: Record<string, string> = {
  Running: 'bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30',
  Pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  Failed: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30',
  Succeeded: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30',
  Unknown: 'bg-muted text-muted-foreground',
};

export function KubectlTableBlock({ data }: { data: KubectlTableData }) {
  if (!data?.rows?.length) {
    return (
      <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        No resources.
      </div>
    );
  }
  return (
    <div className="kubectl-table rounded-md border bg-background/50 overflow-x-auto">
      <table className="w-full font-mono text-xs">
        <thead className="bg-muted/60 text-left">
          <tr>
            {data.columns.map((c) => (
              <th
                key={c.key}
                className={cn('px-3 py-1.5 font-semibold', c.align === 'right' && 'text-right')}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr key={i} className="border-t border-border/40">
              {data.columns.map((c) => {
                const v = row[c.key];
                if (c.key === 'STATUS') {
                  const cls = STATUS_CLASS[String(v)] ?? STATUS_CLASS.Unknown;
                  return (
                    <td key={c.key} className="px-3 py-1.5">
                      <Badge variant="outline" className={cls}>
                        {String(v ?? '')}
                      </Badge>
                    </td>
                  );
                }
                return (
                  <td
                    key={c.key}
                    className={cn('px-3 py-1.5', c.align === 'right' && 'text-right')}
                  >
                    {String(v ?? '')}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
