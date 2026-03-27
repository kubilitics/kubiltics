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
    extra?: Record<string, unknown>;
}

/**
 * Shape of an entry stored in the ring buffer and posted to the remote endpoint.
 */
export interface ErrorEntry {
    id: string;
    timestamp: string;
    level: 'error' | 'warning' | 'info';
    error: { name: string; message: string; stack?: string } | unknown;
    context: {
        user?: ErrorContext['user'];
        tags?: Record<string, string>;
        extra?: Record<string, unknown>;
    };
}

/** Max errors retained in the in-memory ring buffer. */
const RING_BUFFER_SIZE = 50;

/**
 * Singleton class for tracking frontend errors.
 *
 * Features:
 *  - Console-based tracking for development
 *  - If VITE_ERROR_TRACKING_URL is set, POSTs error payloads to that URL
 *  - Global window.onerror + unhandledrejection handlers
 *  - Ring buffer of last 50 errors inspectable via window.__kubilitics_errors
 */
class ErrorTrackerService {
    private static instance: ErrorTrackerService;
    private context: ErrorContext = {
        tags: {},
        extra: {},
    };
    private isInitialized = false;

    /** Circular ring buffer of recent errors. */
    private ringBuffer: ErrorEntry[] = [];

    /** Remote endpoint (from VITE_ERROR_TRACKING_URL). Empty string = disabled. */
    private remoteUrl = '';

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
     * Initialize the error tracker.
     * Should be called as early as possible in the app lifecycle (before React mounts).
     */
    public init(_config?: unknown) {
        if (this.isInitialized) return;
        this.isInitialized = true;

        // Read the optional remote endpoint from Vite env vars.
        try {
            this.remoteUrl = (import.meta as any).env?.VITE_ERROR_TRACKING_URL ?? '';
        } catch {
            // import.meta may not exist in test environments; ignore.
            this.remoteUrl = '';
        }

        // Expose the ring buffer on the window for debugging / support.
        (window as any).__kubilitics_errors = this.ringBuffer;

        // Global unhandled promise rejection handler
        window.addEventListener('unhandledrejection', (event) => {
            this.captureException(event.reason, {
                extra: { type: 'unhandledrejection' },
            });
        });

        // Global error handler
        window.addEventListener('error', (event) => {
            this.captureException(event.error ?? event.message, {
                extra: {
                    type: 'global_error',
                    colno: event.colno,
                    lineno: event.lineno,
                    filename: event.filename,
                },
            });
        });
    }

    // ── Context setters ────────────────────────────────────────────────

    /**
     * Set user context
     */
    public setUser(user: ErrorContext['user']) {
        this.context.user = user;
    }

    /**
     * Set a tag for filtering
     */
    public setTag(key: string, value: string) {
        if (!this.context.tags) this.context.tags = {};
        this.context.tags[key] = value;
    }

    /**
     * Set extra context data
     */
    public setExtra(key: string, value: unknown) {
        if (!this.context.extra) this.context.extra = {};
        this.context.extra[key] = value;
    }

    // ── Capture methods ────────────────────────────────────────────────

    /**
     * Capture an exception and return a unique error ID.
     */
    public captureException(error: unknown, context?: Partial<ErrorContext>): string {
        const entry = this.buildEntry(error, 'error', context);

        // Console logging (always, for dev visibility)
        console.group(`[ErrorTracker] Exception Captured (${entry.id})`);
        console.error(error);
        if (entry.context.tags && Object.keys(entry.context.tags).length > 0) {
            console.table(entry.context.tags);
        }
        console.groupEnd();

        this.pushToBuffer(entry);
        this.sendToRemote(entry);

        return entry.id;
    }

    /**
     * Capture a message (breadcrumb / diagnostic note).
     */
    public captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): string {
        const entry = this.buildEntry(
            { name: 'Message', message, stack: undefined },
            level,
        );

        if (level === 'error') {
            console.error(`[ErrorTracker] ${message}`);
        } else if (level === 'warning') {
            console.warn(`[ErrorTracker] ${message}`);
        } else {
            console.info(`[ErrorTracker] ${message}`);
        }

        this.pushToBuffer(entry);
        this.sendToRemote(entry);

        return entry.id;
    }

    /**
     * Capture a performance metric (e.g. from reportWebVitals).
     */
    public captureMetric(metric: unknown) {
        // Metrics are lower priority -- log in dev, post if remote is configured.
        if (import.meta.env?.DEV) {
            console.debug('[ErrorTracker] metric', metric);
        }
        if (this.remoteUrl) {
            this.postPayload({ type: 'metric', timestamp: new Date().toISOString(), metric }).catch(() => {
                // fire-and-forget; do not recurse into captureException
            });
        }
    }

    /**
     * Return a shallow copy of the current ring buffer contents (oldest first).
     */
    public getRecentErrors(): ReadonlyArray<ErrorEntry> {
        return [...this.ringBuffer];
    }

    // ── Internal helpers ───────────────────────────────────────────────

    private buildEntry(
        error: unknown,
        level: ErrorEntry['level'],
        context?: Partial<ErrorContext>,
    ): ErrorEntry {
        const errorId = uuidv4();
        const timestamp = new Date().toISOString();

        const mergedContext = {
            user: { ...this.context.user, ...context?.user } as ErrorContext['user'],
            tags: { ...this.context.tags, ...context?.tags },
            extra: { ...this.context.extra, ...context?.extra },
        };

        return {
            id: errorId,
            timestamp,
            level,
            error:
                error instanceof Error
                    ? { name: error.name, message: error.message, stack: error.stack }
                    : error,
            context: mergedContext,
        };
    }

    /** Push an entry into the ring buffer, evicting the oldest when full. */
    private pushToBuffer(entry: ErrorEntry) {
        if (this.ringBuffer.length >= RING_BUFFER_SIZE) {
            this.ringBuffer.shift();
        }
        this.ringBuffer.push(entry);
    }

    /** POST a payload to the configured remote URL (fire-and-forget). */
    private sendToRemote(entry: ErrorEntry) {
        if (!this.remoteUrl) return;
        this.postPayload(entry).catch(() => {
            // Silently drop -- we must not recurse into captureException here.
        });
    }

    private async postPayload(payload: unknown): Promise<void> {
        await fetch(this.remoteUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            // Use keepalive so the request survives page unloads
            keepalive: true,
        });
    }
}

export const ErrorTracker = ErrorTrackerService.getInstance();
