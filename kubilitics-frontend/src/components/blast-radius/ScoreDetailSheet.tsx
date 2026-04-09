import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BlastRadiusResult, SubScoreDetail, ServiceImpact, Remediation } from '@/services/api/types';
import { useState } from 'react';

interface ScoreDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: 'resilience' | 'exposure' | 'recovery' | 'impact';
  result: BlastRadiusResult;
}

function classificationBadge(cls: string) {
  switch (cls) {
    case 'broken': return <Badge variant="destructive" className="text-[10px]">Broken</Badge>;
    case 'degraded': return <Badge className="text-[10px] bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Degraded</Badge>;
    default: return <Badge className="text-[10px] bg-green-500/10 text-green-500 border-green-500/20">Self-healing</Badge>;
  }
}

function SubScoreSection({ title, detail, defaultOpen }: { title: string; detail: SubScoreDetail; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-2 px-3 rounded-lg hover:bg-muted/50">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-sm font-bold">{detail.score}</span>
          {detail.source && (
            <span className="text-[10px] text-muted-foreground">via {detail.source}</span>
          )}
        </div>
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left py-1 font-medium">Factor</th>
                <th className="text-left py-1 font-medium">Value</th>
                <th className="text-right py-1 font-medium">Effect</th>
              </tr>
            </thead>
            <tbody>
              {detail.factors.map((f, i) => (
                <tr key={i} className="border-t border-border/50">
                  <td className="py-1.5 text-muted-foreground">{f.note}</td>
                  <td className="py-1.5">{f.value}</td>
                  <td className={cn('py-1.5 text-right font-mono',
                    f.effect > 0 ? 'text-green-500' : f.effect < 0 ? 'text-red-400' : 'text-muted-foreground'
                  )}>
                    {f.effect > 0 ? '+' : ''}{Math.round(f.effect)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {detail.confidence && (
            <div className="mt-2 text-[10px] text-muted-foreground">
              Confidence: {detail.confidence}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ScoreDetailSheet({ open, onOpenChange, initialSection, result }: ScoreDetailSheetProps) {
  const handleExport = () => {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blast-radius-audit-${result.targetResource.kind}-${result.targetResource.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center justify-between">
            <span>Score Breakdown</span>
            <Badge variant={result.criticalityLevel === 'critical' ? 'destructive' : 'secondary'}>
              {Math.round(result.criticalityScore)} {result.criticalityLevel.toUpperCase()}
            </Badge>
          </SheetTitle>
          <p className="text-sm text-muted-foreground">{result.verdict}</p>
        </SheetHeader>

        <div className="mt-6 space-y-2">
          <SubScoreSection title="Resilience" detail={result.subScores.resilience} defaultOpen={initialSection === 'resilience'} />
          <SubScoreSection title="Exposure" detail={result.subScores.exposure} defaultOpen={initialSection === 'exposure'} />
          <SubScoreSection title="Recovery" detail={result.subScores.recovery} defaultOpen={initialSection === 'recovery'} />
          <SubScoreSection title="Impact" detail={result.subScores.impact} defaultOpen={initialSection === 'impact'} />
        </div>

        {result.affectedServices && result.affectedServices.length > 0 && (
          <div className="mt-6">
            <h4 className="text-sm font-semibold mb-2">Affected Services</h4>
            <div className="space-y-2">
              {result.affectedServices.map((si: ServiceImpact, i: number) => (
                <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg bg-muted/30">
                  <div>
                    <span className="font-medium">{si.service.name}</span>
                    <span className="text-muted-foreground ml-2">
                      {si.remainingEndpoints}/{si.totalEndpoints} endpoints
                    </span>
                  </div>
                  {classificationBadge(si.classification)}
                </div>
              ))}
            </div>
          </div>
        )}

        {result.remediations && result.remediations.length > 0 && (
          <div className="mt-6">
            <h4 className="text-sm font-semibold mb-2">Remediations</h4>
            <div className="space-y-2">
              {result.remediations.map((r: Remediation, i: number) => (
                <div key={i} className="text-xs p-2 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{r.priority}</Badge>
                    <span>{r.description}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6">
          <Button variant="outline" size="sm" onClick={handleExport} className="w-full">
            <Download className="h-4 w-4 mr-2" />
            Export Audit Trail (JSON)
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
