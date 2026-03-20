import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';
import { ErrorTracker } from '@/lib/errorTracker';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorId: string | null;
}

export class GlobalErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorId: null,
        };
    }

    static getDerivedStateFromError(error: Error): State {
        return {
            hasError: true,
            error,
            errorId: null,
        };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('GLOBAL_ERROR_BOUNDARY_CAUGHT:', error);
        const errorId = ErrorTracker.captureException(error, {
            extra: {
                componentStack: errorInfo.componentStack,
            },
        });

        this.setState({ errorId });
    }

    handleReload = () => {
        window.location.reload();
    };

    handleGoHome = () => {
        // In Tauri (MemoryRouter), window.location.reload() resets to the start route.
        // Using href='/index.html' works for Tauri; '/' works for browser.
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
                    <Card className="w-full max-w-md shadow-lg border-red-200 dark:border-red-900">
                        <CardHeader className="text-center pb-2">
                            <div className="mx-auto w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-4">
                                <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
                            </div>
                            <CardTitle className="text-xl text-red-700 dark:text-red-400">
                                Something went wrong
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="text-center space-y-4">
                            <p className="text-muted-foreground text-sm">
                                We encountered an unexpected error. Ideally, you shouldn't see this.
                            </p>

                            {this.state.error && (
                                <div className="text-left bg-gray-100 dark:bg-gray-800 p-3 rounded-md overflow-auto max-h-48 text-xs font-mono text-red-900 dark:text-red-300 border border-gray-200 dark:border-gray-700 space-y-1">
                                    <div className="font-bold">{this.state.error.name}: {this.state.error.message || '(no message)'}</div>
                                    {this.state.error.stack && (
                                        <div className="text-gray-600 dark:text-gray-400 text-[10px] whitespace-pre-wrap">{this.state.error.stack.split('\n').slice(1, 5).join('\n')}</div>
                                    )}
                                </div>
                            )}

                            {this.state.errorId && (
                                <p className="text-xs text-gray-400">
                                    Error ID: <span className="font-mono select-all">{this.state.errorId}</span>
                                </p>
                            )}
                        </CardContent>
                        <CardFooter className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
                            <Button onClick={this.handleReload} variant="default" className="w-full sm:w-auto">
                                <RefreshCw className="mr-2 h-4 w-4" />
                                Reload App
                            </Button>
                        </CardFooter>
                    </Card>
                </div>
            );
        }

        return this.props.children;
    }
}

/**
 * Route-level error boundary: catches errors in a single route/page without
 * crashing the whole app (layout/sidebar stays intact). Shows an inline error
 * panel with a "Try Again" button that resets the boundary so the user can
 * retry without a full reload.
 *
 * Usage: wrap individual route elements or the <Suspense> block inside each route.
 */

interface RouteErrorBoundaryProps {
    children: ReactNode;
    /** Optional route name shown in the error panel (e.g. "Pods"). */
    routeName?: string;
    /** Optional callback when the user clicks "Go Back" — typically useNavigate(-1). */
    onGoBack?: () => void;
}

interface RouteErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
    constructor(props: RouteErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('ROUTE_ERROR_BOUNDARY_CAUGHT:', error);
        ErrorTracker.captureException(error, {
            extra: { componentStack: errorInfo.componentStack, routeName: this.props.routeName },
        });
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center">
                    <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-4">
                        <AlertCircle className="h-6 w-6 text-red-500 dark:text-red-400" />
                    </div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
                        {this.props.routeName ? `Failed to load ${this.props.routeName}` : 'Page error'}
                    </h2>
                    <p className="text-sm text-muted-foreground mb-2 max-w-sm">
                        {this.state.error?.message || 'An unexpected error occurred loading this page.'}
                    </p>
                    <div className="flex gap-2 mt-4">
                        {this.props.onGoBack && (
                            <Button variant="outline" size="sm" onClick={this.props.onGoBack}>
                                <Home className="mr-2 h-4 w-4" />
                                Go Back
                            </Button>
                        )}
                        <Button size="sm" onClick={this.handleReset}>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Try Again
                        </Button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
