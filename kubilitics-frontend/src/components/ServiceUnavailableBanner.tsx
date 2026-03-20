import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface ServiceUnavailableBannerProps {
    serviceName: string;
    message?: string;
    retryAction?: () => void;
    isRetrying?: boolean;
    className?: string;
}

export function ServiceUnavailableBanner({
    serviceName,
    message,
    retryAction,
    isRetrying = false,
    className = '',
}: ServiceUnavailableBannerProps) {
    return (
        <Alert variant="destructive" className={`bg-red-50 text-red-900 border-red-200 dark:bg-red-900/10 dark:text-red-200 dark:border-red-900/50 ${className}`}>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Service Unavailable</AlertTitle>
            <AlertDescription className="mt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <p className="text-sm font-medium">
                        Could not connect to {serviceName}.
                    </p>
                    <p className="text-xs opacity-90 mt-1">
                        {message || 'Please check your connection or try again later.'}
                    </p>
                </div>
                {retryAction && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={retryAction}
                        disabled={isRetrying}
                        className="border-red-200 hover:bg-red-100 text-red-900 dark:border-red-800 dark:hover:bg-red-900/50 dark:text-red-200 shrink-0"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 mr-2 ${isRetrying ? 'animate-spin' : ''}`} />
                        {isRetrying ? 'Retrying...' : 'Retry Connection'}
                    </Button>
                )}
            </AlertDescription>
        </Alert>
    );
}
