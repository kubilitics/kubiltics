import { v4 as uuidv4 } from 'uuid';

/**
 * Interface for error context data
 */
export interface ErrorContext {
    user?: {
        id: string;
        username?: string;
        email?: string;
    };
    tags?: Record<string, string>;
    extra?: Record<string, any>;
}

/**
 * Singleton class for tracking frontend errors.
 * Currently logs to console, but designed to easily plug in Sentry, Datadog, etc.
 */
class ErrorTrackerService {
    private static instance: ErrorTrackerService;
    private context: ErrorContext = {
        tags: {},
        extra: {},
    };
    private isInitialized = false;

    private constructor() {
        // Private constructor to enforce singleton
    }

    public static getInstance(): ErrorTrackerService {
        if (!ErrorTrackerService.instance) {
            ErrorTrackerService.instance = new ErrorTrackerService();
        }
        return ErrorTrackerService.instance;
    }

    /**
     * Initialize the error tracker (e.g., Sentry.init)
     */
    public init(config?: any) {
        if (this.isInitialized) return;

        console.log('[ErrorTracker] Initialized');
        this.isInitialized = true;

        // Global unhandled promise rejection handler
        window.addEventListener('unhandledrejection', (event) => {
            this.captureException(event.reason, {
                extra: { type: 'unhandledrejection' }
            });
        });

        // Global error handler
        window.addEventListener('error', (event) => {
            this.captureException(event.error, {
                extra: { type: 'global_error', colno: event.colno, lineno: event.lineno, filename: event.filename }
            });
        });
    }

    /**
     * Set user context
     */
    public setUser(user: ErrorContext['user']) {
        this.context.user = user;
        // Example: Sentry.setUser(user);
    }

    /**
     * Set a tag for filtering
     */
    public setTag(key: string, value: string) {
        if (!this.context.tags) this.context.tags = {};
        this.context.tags[key] = value;
        // Example: Sentry.setTag(key, value);
    }

    /**
     * Set extra context data
     */
    public setExtra(key: string, value: any) {
        if (!this.context.extra) this.context.extra = {};
        this.context.extra[key] = value;
        // Example: Sentry.setExtra(key, value);
    }

    /**
     * Capture an exception
     */
    public captureException(error: any, context?: Partial<ErrorContext>) {
        const errorId = uuidv4();
        const timestamp = new Date().toISOString();

        // Merge global context with local context
        const mergedContext = {
            user: { ...this.context.user, ...context?.user },
            tags: { ...this.context.tags, ...context?.tags },
            extra: { ...this.context.extra, ...context?.extra },
        };

        const errorLog = {
            id: errorId,
            timestamp,
            error: error instanceof Error ? {
                name: error.name,
                message: error.message,
                stack: error.stack
            } : error,
            context: mergedContext,
        };

        // Log to console in a distinct way
        console.group(`🚨 [ErrorTracker] Exception Captured (${errorId})`);
        console.error(error);
        console.table(mergedContext.tags);
        console.log('Context:', mergedContext);
        console.groupEnd();

        // TODO: Send to external service (Sentry, Datadog, etc.)
        // if (process.env.NODE_ENV === 'production') {
        //   Sentry.captureException(error, { ... });
        // }

        return errorId;
    }

    /**
     * Capture a message
     */
    public captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info') {
        const timestamp = new Date().toISOString();

        console.log(`[ErrorTracker] [${level.toUpperCase()}] ${message}`, {
            timestamp,
            context: this.context
        });

        // Example: Sentry.captureMessage(message, level);
    }
    /**
     * Capture a performance metric
     */
    public captureMetric(metric: any) {
        // Log to console in dev, or send to analytics in prod
        if (import.meta.env.DEV) {
            console.debug(`[ErrorTracker] [METRIC] ${metric.name}:`, metric.value);
        }
        // Example: Sentry.metrics.add(metric.name, metric.value);
    }
}

export const ErrorTracker = ErrorTrackerService.getInstance();
