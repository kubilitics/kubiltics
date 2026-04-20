import { ListOrdered } from 'lucide-react';

export interface PlanBlockData {
  type: 'plan_proposed';
  planId: string;
  summary: string;
  steps?: Array<{ title?: string; description?: string }>;
}

export function PlanBlock({ block }: { block: PlanBlockData }) {
  return (
    <div className="my-1 rounded-md border border-blue-300/60 bg-blue-50/70 dark:bg-blue-950/30 dark:border-blue-800/60 px-2.5 py-2 text-xs">
      <div className="flex items-center gap-2 font-medium text-blue-900 dark:text-blue-200">
        <ListOrdered className="h-3.5 w-3.5" />
        <span>Plan proposed</span>
      </div>
      {block.summary && <div className="mt-1 text-foreground/80">{block.summary}</div>}
      {block.steps && block.steps.length > 0 && (
        <ol className="mt-2 space-y-1 pl-4 list-decimal text-foreground/80">
          {block.steps.map((s, i) => (
            <li key={i}>
              {s.title && <span className="font-medium">{s.title}</span>}
              {s.title && s.description && <span>: </span>}
              {s.description}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
