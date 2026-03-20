import React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, RefreshCcw, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DriftAlertProps {
    severity: "COSMETIC" | "STRUCTURAL" | "DESTRUCTIVE";
    message: string;
    onRemediate?: () => void;
}

/**
 * T5.25: DriftAlert component
 * Warns the user when the cluster state deviates from the add-on's desired config.
 */
export function DriftAlert({ severity, message, onRemediate }: DriftAlertProps) {
    const isDestructive = severity === 'DESTRUCTIVE';
    const isStructural = severity === 'STRUCTURAL';

    return (
        <Alert
            variant={isDestructive ? 'destructive' : 'default'}
            className={!isDestructive ? 'border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-800 text-amber-800 dark:text-amber-400' : ''}
        >
            <div className="flex gap-4 items-start">
                <div className="mt-1">
                    {isDestructive ? <ShieldAlert className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
                </div>
                <div className="flex-1">
                    <AlertTitle className="font-bold flex items-center gap-2">
                        Configuration Drift Detected
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${isDestructive ? 'bg-destructive/10 border-destructive' : 'bg-amber-100 border-amber-300 dark:bg-amber-900/40 text-amber-700'
                            }`}>
                            {severity}
                        </span>
                    </AlertTitle>
                    <AlertDescription className="text-xs mt-1 leading-relaxed opacity-90">
                        {message}
                    </AlertDescription>
                    {onRemediate && (
                        <div className="mt-4">
                            <Button
                                variant={isDestructive ? 'destructive' : 'outline'}
                                size="sm"
                                onClick={onRemediate}
                                className={`h-8 gap-2 ${!isDestructive ? 'border-amber-300 hover:bg-amber-100 dark:border-amber-700' : ''}`}
                            >
                                <RefreshCcw className="h-3.5 w-3.5" />
                                Remediate Drift
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </Alert>
    );
}
