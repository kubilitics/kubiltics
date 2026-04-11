import { AlertTriangle } from 'lucide-react';

interface CoverageBannerProps {
  coverageLevel: string;
  coverageNote?: string;
}

export function CoverageBanner({ coverageLevel, coverageNote }: CoverageBannerProps) {
  if (coverageLevel !== 'partial') return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-200 text-sm">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
      <span>
        {coverageNote || 'Dependency coverage is partial — enable tracing for full analysis'}
      </span>
    </div>
  );
}
