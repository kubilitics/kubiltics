import React from 'react';
import { DollarSign, Cpu, Layers, HardDrive } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

interface CostDisplayProps {
    cpuMillicores: number;
    memoryMb: number;
    storageGb: number;
    monthlyCostUsd: number;
    className?: string;
    variant?: 'compact' | 'full';
}

/**
 * T5.22: CostDisplay component
 * Shows estimated resource footprint and cost for an add-on.
 */
export function CostDisplay({
    cpuMillicores,
    memoryMb,
    storageGb,
    monthlyCostUsd,
    className,
    variant = 'full',
}: CostDisplayProps) {
    if (variant === 'compact') {
        return (
            <div className={cn("flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold", className)}>
                <DollarSign className="h-4 w-4" />
                <span>+${monthlyCostUsd.toFixed(2)}/mo</span>
            </div>
        );
    }

    return (
        <div className={cn("grid grid-cols-2 md:grid-cols-4 gap-4", className)}>
            <Card className="bg-muted/30 border-none shadow-none">
                <CardContent className="p-3 flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Cpu className="h-3 w-3" />
                        <span className="text-[10px] uppercase font-bold tracking-wider">CPU</span>
                    </div>
                    <span className="text-sm font-bold">{cpuMillicores}m</span>
                </CardContent>
            </Card>

            <Card className="bg-muted/30 border-none shadow-none">
                <CardContent className="p-3 flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Layers className="h-3 w-3" />
                        <span className="text-[10px] uppercase font-bold tracking-wider">RAM</span>
                    </div>
                    <span className="text-sm font-bold">{memoryMb}MB</span>
                </CardContent>
            </Card>

            <Card className="bg-muted/30 border-none shadow-none">
                <CardContent className="p-3 flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <HardDrive className="h-3 w-3" />
                        <span className="text-[10px] uppercase font-bold tracking-wider">Storage</span>
                    </div>
                    <span className="text-sm font-bold">{storageGb}GB</span>
                </CardContent>
            </Card>

            <Card className="bg-primary/5 border-primary/10 shadow-none">
                <CardContent className="p-3 flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-primary">
                        <DollarSign className="h-3 w-3" />
                        <span className="text-[10px] uppercase font-bold tracking-wider">Cost</span>
                    </div>
                    <div className="flex items-baseline gap-0.5">
                        <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                            ${monthlyCostUsd.toFixed(2)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">/mo</span>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
