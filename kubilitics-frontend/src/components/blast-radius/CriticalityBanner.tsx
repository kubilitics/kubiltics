import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const gradientMap: Record<string, string> = {
  critical: 'from-red-600 to-red-900',
  high: 'from-orange-500 to-orange-800',
  medium: 'from-yellow-500 to-yellow-700',
  low: 'from-blue-500 to-blue-700',
};

export interface CriticalityBannerProps {
  criticalityScore: number;
  criticalityLevel: 'critical' | 'high' | 'medium' | 'low';
  verdict: string;
  targetName: string;
  failureMode: string;
  onFailureModeChange: (mode: string) => void;
}

export function CriticalityBanner({
  criticalityScore,
  criticalityLevel,
  verdict,
  targetName,
  failureMode,
  onFailureModeChange,
}: CriticalityBannerProps) {
  const gradient = gradientMap[criticalityLevel] || gradientMap.low;

  return (
    <div className={cn('relative rounded-xl p-5 bg-gradient-to-r text-white overflow-hidden', gradient)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <h3 className="text-sm font-medium text-white/80">
              Impact Analysis for <span className="font-bold text-white">{targetName}</span>
            </h3>
          </div>
          <p className="text-sm text-white/70 line-clamp-2 mt-1">{verdict}</p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <Select value={failureMode} onValueChange={onFailureModeChange}>
            <SelectTrigger className="h-7 w-[160px] text-xs bg-white/10 border-white/20 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pod-crash">Pod Crash</SelectItem>
              <SelectItem value="workload-deletion">Workload Deletion</SelectItem>
              <SelectItem value="namespace-deletion">Namespace Deletion</SelectItem>
            </SelectContent>
          </Select>
          <div className="text-right">
            <div className="text-4xl font-bold leading-none">{Math.round(criticalityScore)}</div>
            <div className="text-xs font-semibold uppercase tracking-wider mt-1 text-white/80">
              {criticalityLevel}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
