import * as Sentry from '@sentry/react';
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

/** App version baked in at build time from package.json via vite.config.ts define. */
function getAppVersion(): string {
    try {
        return typeof __VITE_APP_VERSION__ !== 'undefined' ? __VITE_APP_VERSION__ : 'unknown';
    } catch {
        return 'unknown';
    }
}

/**
 * Shape of a crash report that can be POSTed or copied to clipboard.
 */
export interface CrashReport {
    appVersion: string;
    platform: string;
    userAgent: string;
    url: string;
    timestamp: string;
    triggeringError: { name: string; message: string; stack?: string };
    recentErrors: ReadonlyArray<ErrorEntry>;
}

/**
 * Singleton class for tracking frontend errors.
 *
 * Features:
 *  - Sentry integration when VITE_SENTRY_DSN is configured
 *  - Graceful fallback to console-only when DSN is absent
 *  - Ring buffer of last 50 errors inspectable via window.__kubilitics_errors
 *  - Legacy remote endpoint support via VITE_ERROR_TRACKING_URL
 *  - Global window.onerror + unhandledrejection handlers
 */
class ErrorTrackerService {
    private static instance: ErrorTrackerService;
    private context: ErrorContext = {
        tags: {},
        extra: {},
    };
    private isInitialized = false;
    private sentryEnabled = false;

    /** Circular ring buffer of recent errors. */
    private ringBuffer: ErrorEntry[] = [];

    /** Legacy remote endpoint (from VITE_ERROR_TRACKING_URL). Empty string = disabled. */
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

        // Read env vars
        let sentryDsn = '';
        try {
            const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
            sentryDsn = env?.VITE_SENTRY_DSN ?? '';
            this.remoteUrl = env?.VITE_ERROR_TRACKING_URL ?? '';
        } catch {
            // import.meta may not exist in test environments; ignore.
        }

        // Initialize Sentry if DSN is configured
        if (sentryDsn) {
            const isTauri = typeof __VITE_IS_TAURI_BUILD__ !== 'undefined' && __VITE_IS_TAURI_BUILD__;
            Sentry.init({
                dsn: sentryDsn,
                release: `kubilitics@${getAppVersion()}`,
                environment: import.meta.env?.MODE ?? 'production',
                integrations: [
                    Sentry.browserTracingIntegration(),
                ],
                tracesSampleRate: 0.1,
                // Don't send PII by default
                sendDefaultPii: false,
                // Tag the platform
                initialScope: {
                    tags: { platform: isTauri ? 'desktop' : 'browser' },
                },
            });
            this.sentryEnabled = true;
        }

        // Expose the ring buffer on the window for debugging / support.
        (window as unknown as Record<string, unknown>).__kubilitics_errors = this.ringBuffer;

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
        if (this.sentryEnabled && user) {
            Sentry.setUser({ id: user.id, username: user.username, email: user.email });
        }
    }

    /**
     * Set a tag for filtering
     */
    public setTag(key: string, value: string) {
        if (!this.context.tags) this.context.tags = {};
        this.context.tags[key] = value;
        if (this.sentryEnabled) {
            Sentry.setTag(key, value);
        }
    }

    /**
     * Set extra context data
     */
    public setExtra(key: string, value: unknown) {
        if (!this.context.extra) this.context.extra = {};
        this.context.extra[key] = value;
        if (this.sentryEnabled) {
            Sentry.setExtra(key, value);
        }
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

        // Send to Sentry
        if (this.sentryEnabled) {
            const sentryId = Sentry.captureException(error, {
                tags: context?.tags,
                extra: context?.extra,
            });
            entry.id = sentryId;
        }

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

        // Send to Sentry
        if (this.sentryEnabled) {
            const sentryLevel = level === 'warning' ? 'warning' : level;
            const sentryId = Sentry.captureMessage(message, sentryLevel);
            entry.id = sentryId;
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

    /**
     * Return the app version baked in at build time.
     */
    public getAppVersion(): string {
        return getAppVersion();
    }

    /**
     * Whether a remote error-tracking endpoint is configured (Sentry or legacy URL).
     */
    public hasRemoteEndpoint(): boolean {
        return this.sentryEnabled || !!this.remoteUrl;
    }

    /**
     * Build a crash report payload from the current state and a triggering error.
     */
    public buildCrashReport(error: Error): CrashReport {
        const platformLabel =
            typeof __VITE_IS_TAURI_BUILD__ !== 'undefined' && __VITE_IS_TAURI_BUILD__
                ? 'Desktop (Tauri)'
                : 'Browser';

        return {
            appVersion: getAppVersion(),
            platform: platformLabel,
            userAgent: navigator.userAgent,
            url: window.location.href,
            timestamp: new Date().toISOString(),
            triggeringError: {
                name: error.name,
                message: error.message,
                stack: error.stack,
            },
            recentErrors: this.getRecentErrors(),
        };
    }

    /**
     * Submit a crash report to the remote endpoint.
     * Returns true if the report was sent, false if no endpoint is configured.
     */
    public async submitCrashReport(report: CrashReport): Promise<boolean> {
        // Send to Sentry as a special event
        if (this.sentryEnabled) {
            Sentry.captureMessage('Crash Report Submitted', {
                level: 'fatal',
                extra: { report },
            });
        }
        // Also send to legacy endpoint if configured
        if (this.remoteUrl) {
            try {
                await fetch(this.remoteUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'crash_report', ...report }),
                    keepalive: true,
                });
            } catch {
                // Silently fail — Sentry already has the report if configured
            }
        }
        return this.sentryEnabled || !!this.remoteUrl;
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

    /** POST a payload to the configured legacy remote URL (fire-and-forget). */
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
