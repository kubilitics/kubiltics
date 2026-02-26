import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBackendClient } from '@/hooks/useBackendClient';
import { Card, CardContent } from '@/components/ui/card';
import { History, Activity, CheckCircle2, XCircle, Clock, User, Package } from 'lucide-react';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';

interface AuditHistoryPanelProps {
    clusterId: string;
    installId: string;
}

/**
 * T5.24: AuditHistoryPanel component
 * Displays a chronological list of operations performed on the add-on.
 */
export function AuditHistoryPanel({ clusterId, installId }: AuditHistoryPanelProps) {
    const client = useBackendClient();

    const { data: events, isLoading, error } = useQuery({
        queryKey: ['addon-audit', clusterId, installId],
        queryFn: () => client.getAddonAuditEvents(clusterId, installId),
    });

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center p-12 gap-2 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-xs">Loading audit history...</span>
            </div>
        );
    }

    if (error || !events || events.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center text-muted-foreground border-2 border-dashed rounded-xl bg-muted/20">
                <History className="h-8 w-8 opacity-20" />
                <span className="text-sm">No audit history found.</span>
            </div>
        );
    }

    return (
        <div className="relative pl-6 space-y-6 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-muted">
            {events.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((event) => (
                <div key={event.id} className="relative">
                    <div className={`absolute -left-[21px] top-1 h-5 w-5 rounded-full border-2 bg-background flex items-center justify-center z-10 ${event.result === 'SUCCESS' ? 'border-emerald-500' : 'border-destructive'
                        }`}>
                        {event.result === 'SUCCESS' ? (
                            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                        ) : (
                            <XCircle className="h-3 w-3 text-destructive" />
                        )}
                    </div>

                    <Card className="border-none shadow-none bg-muted/10 group hover:bg-muted/20 transition-colors">
                        <CardContent className="p-4 flex flex-col gap-2">
                            <div className="flex justify-between items-start">
                                <div className="flex flex-col">
                                    <span className="text-sm font-bold tracking-tight uppercase">{event.operation}</span>
                                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
                                        <span className="flex items-center gap-1 font-medium">
                                            <Clock className="h-3 w-3" /> {format(new Date(event.created_at), 'PPP p')}
                                        </span>
                                        <span className="flex items-center gap-1 font-medium">
                                            <User className="h-3 w-3" /> {event.actor}
                                        </span>
                                    </div>
                                </div>
                                {event.duration_ms && (
                                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-background border">
                                        {event.duration_ms}ms
                                    </span>
                                )}
                            </div>

                            <div className="flex flex-wrap gap-2 mt-1">
                                {event.old_version && (
                                    <div className="flex items-center gap-1.5 p-1 px-2 rounded-lg bg-background border text-[10px]">
                                        <span className="text-muted-foreground">From</span>
                                        <span className="font-mono font-bold">v{event.old_version}</span>
                                    </div>
                                )}
                                {event.new_version && (
                                    <div className="flex items-center gap-1.5 p-1 px-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 text-[10px]">
                                        <span className="text-muted-foreground">To</span>
                                        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">v{event.new_version}</span>
                                    </div>
                                )}
                            </div>

                            {event.error_message && (
                                <div className="mt-2 p-2 rounded bg-destructive/5 border border-destructive/10 text-[10px] text-destructive font-mono break-words">
                                    {event.error_message}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            ))}
        </div>
    );
}
