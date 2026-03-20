/**
 * Structured error handling for Kubilitics frontend.
 *
 * Parses API responses into typed error codes with user-friendly messages,
 * retry hints, and action suggestions. Works with both Kubilitics backend
 * responses and raw Kubernetes API errors.
 *
 * TASK-SCALE-004
 */

// ── Error Codes ────────────────────────────────────────────────────────────────

export const ERROR_CODES = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  K8S_UNAVAILABLE: 'K8S_UNAVAILABLE',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  TIMEOUT: 'TIMEOUT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNKNOWN: 'UNKNOWN',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// ── Structured Error ───────────────────────────────────────────────────────────

export interface StructuredError {
  /** Machine-readable error code */
  code: ErrorCode;
  /** HTTP status code, if available */
  httpStatus?: number;
  /** User-friendly title */
  title: string;
  /** User-friendly description */
  message: string;
  /** Original error detail from the API */
  detail?: string;
  /** Whether the operation can be retried */
  retryable: boolean;
  /** Suggested action label (e.g. "Sign In", "Go Back") */
  actionLabel?: string;
  /** Suggested action route or callback key */
  actionHref?: string;
  /** Retry-After header value in seconds, if present */
  retryAfterSeconds?: number;
  /** Kubernetes-specific: affected resource */
  resource?: { kind?: string; name?: string; namespace?: string };
  /** Timestamp when the error was captured */
  timestamp: string;
}

// ── User-Friendly Message Map ──────────────────────────────────────────────────

interface ErrorTemplate {
  title: string;
  message: string;
  retryable: boolean;
  actionLabel?: string;
  actionHref?: string;
}

const ERROR_TEMPLATES: Record<ErrorCode, ErrorTemplate> = {
  AUTH_REQUIRED: {
    title: 'Authentication Required',
    message: 'Your session has expired or you are not signed in. Please sign in to continue.',
    retryable: false,
    actionLabel: 'Sign In',
    actionHref: '/login',
  },
  FORBIDDEN: {
    title: 'Access Denied',
    message: 'You do not have permission to perform this action. Contact your cluster administrator for access.',
    retryable: false,
    actionLabel: 'Request Access',
  },
  NOT_FOUND: {
    title: 'Resource Not Found',
    message: 'The requested resource does not exist or has been deleted.',
    retryable: false,
    actionLabel: 'Go Back',
  },
  CONFLICT: {
    title: 'Conflict',
    message: 'The resource was modified by another user. Refresh and try again.',
    retryable: true,
    actionLabel: 'Refresh',
  },
  RATE_LIMITED: {
    title: 'Too Many Requests',
    message: 'You have exceeded the API rate limit. Please wait a moment before retrying.',
    retryable: true,
    actionLabel: 'Retry',
  },
  K8S_UNAVAILABLE: {
    title: 'Cluster Unavailable',
    message: 'Unable to reach the Kubernetes API server. The cluster may be down or your network connection interrupted.',
    retryable: true,
    actionLabel: 'Retry Connection',
  },
  VALIDATION_FAILED: {
    title: 'Validation Error',
    message: 'The request contains invalid data. Please check your input and try again.',
    retryable: false,
    actionLabel: 'Fix Input',
  },
  TIMEOUT: {
    title: 'Request Timed Out',
    message: 'The request took too long to complete. The cluster may be under heavy load.',
    retryable: true,
    actionLabel: 'Retry',
  },
  NETWORK_ERROR: {
    title: 'Network Error',
    message: 'Unable to reach the server. Check your internet connection and try again.',
    retryable: true,
    actionLabel: 'Retry',
  },
  INTERNAL_ERROR: {
    title: 'Internal Server Error',
    message: 'An unexpected error occurred on the server. If this persists, check the server logs.',
    retryable: true,
    actionLabel: 'Retry',
  },
  UNKNOWN: {
    title: 'Something Went Wrong',
    message: 'An unexpected error occurred. Please try again or contact support.',
    retryable: true,
    actionLabel: 'Retry',
  },
};

// ── HTTP Status → Error Code Mapping ───────────────────────────────────────────

function httpStatusToErrorCode(status: number): ErrorCode {
  switch (status) {
    case 401: return ERROR_CODES.AUTH_REQUIRED;
    case 403: return ERROR_CODES.FORBIDDEN;
    case 404: return ERROR_CODES.NOT_FOUND;
    case 409: return ERROR_CODES.CONFLICT;
    case 422: return ERROR_CODES.VALIDATION_FAILED;
    case 429: return ERROR_CODES.RATE_LIMITED;
    case 502:
    case 503:
    case 504: return ERROR_CODES.K8S_UNAVAILABLE;
    case 408: return ERROR_CODES.TIMEOUT;
    default:
      if (status >= 500) return ERROR_CODES.INTERNAL_ERROR;
      return ERROR_CODES.UNKNOWN;
  }
}

// ── Kubernetes API Error Body ──────────────────────────────────────────────────

interface K8sStatusError {
  kind?: string;
  apiVersion?: string;
  status?: string;
  message?: string;
  reason?: string;
  code?: number;
  details?: {
    name?: string;
    group?: string;
    kind?: string;
    causes?: Array<{ field?: string; message?: string; reason?: string }>;
  };
}

function isK8sStatusError(body: unknown): body is K8sStatusError {
  return (
    typeof body === 'object' &&
    body !== null &&
    'kind' in body &&
    (body as K8sStatusError).kind === 'Status'
  );
}

// ── Parse Error from Response ──────────────────────────────────────────────────

/**
 * Parse a fetch Response into a StructuredError.
 * Attempts to read the body as JSON (Kubernetes Status or generic API error),
 * falling back to text.
 */
export async function parseResponseError(response: Response): Promise<StructuredError> {
  const httpStatus = response.status;
  const code = httpStatusToErrorCode(httpStatus);
  const template = ERROR_TEMPLATES[code];

  let detail: string | undefined;
  let resource: StructuredError['resource'] | undefined;
  let retryAfterSeconds: number | undefined;

  // Parse Retry-After header
  const retryAfter = response.headers.get('Retry-After');
  if (retryAfter) {
    const parsed = parseInt(retryAfter, 10);
    if (!Number.isNaN(parsed)) {
      retryAfterSeconds = parsed;
    }
  }

  try {
    const body = await response.json();

    if (isK8sStatusError(body)) {
      detail = body.message ?? body.reason;
      if (body.details) {
        resource = {
          kind: body.details.kind,
          name: body.details.name,
        };
      }
    } else if (typeof body === 'object' && body !== null) {
      // Generic Kubilitics backend error: { error: string; message?: string }
      const generic = body as Record<string, unknown>;
      detail =
        typeof generic.message === 'string'
          ? generic.message
          : typeof generic.error === 'string'
            ? generic.error
            : JSON.stringify(body);
    }
  } catch {
    try {
      detail = await response.text();
    } catch {
      // ignore
    }
  }

  return {
    code,
    httpStatus,
    title: template.title,
    message: detail ?? template.message,
    detail,
    retryable: template.retryable,
    actionLabel: template.actionLabel,
    actionHref: template.actionHref,
    retryAfterSeconds,
    resource,
    timestamp: new Date().toISOString(),
  };
}

// ── Parse Error from Caught Exception ──────────────────────────────────────────

/**
 * Convert any caught error (TypeError from fetch, Error, or unknown) into a
 * StructuredError.
 */
export function parseError(error: unknown): StructuredError {
  if (error instanceof TypeError) {
    const msg = error.message.toLowerCase();
    if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed')) {
      const template = ERROR_TEMPLATES[ERROR_CODES.NETWORK_ERROR];
      return {
        code: ERROR_CODES.NETWORK_ERROR,
        title: template.title,
        message: template.message,
        detail: error.message,
        retryable: true,
        actionLabel: template.actionLabel,
        timestamp: new Date().toISOString(),
      };
    }
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    const template = ERROR_TEMPLATES[ERROR_CODES.TIMEOUT];
    return {
      code: ERROR_CODES.TIMEOUT,
      title: template.title,
      message: template.message,
      detail: 'Request was aborted.',
      retryable: true,
      actionLabel: template.actionLabel,
      timestamp: new Date().toISOString(),
    };
  }

  if (error instanceof Error) {
    // Attempt to detect HTTP status from Error message (e.g. from k8sRequest)
    const match = error.message.match(/(?:error|status)[:\s]*(\d{3})/i);
    if (match) {
      const status = parseInt(match[1]!, 10);
      const code = httpStatusToErrorCode(status);
      const template = ERROR_TEMPLATES[code];
      return {
        code,
        httpStatus: status,
        title: template.title,
        message: error.message,
        detail: error.message,
        retryable: template.retryable,
        actionLabel: template.actionLabel,
        actionHref: template.actionHref,
        timestamp: new Date().toISOString(),
      };
    }

    const template = ERROR_TEMPLATES[ERROR_CODES.UNKNOWN];
    return {
      code: ERROR_CODES.UNKNOWN,
      title: template.title,
      message: error.message,
      detail: error.message,
      retryable: true,
      actionLabel: template.actionLabel,
      timestamp: new Date().toISOString(),
    };
  }

  const template = ERROR_TEMPLATES[ERROR_CODES.UNKNOWN];
  return {
    code: ERROR_CODES.UNKNOWN,
    title: template.title,
    message: typeof error === 'string' ? error : template.message,
    detail: typeof error === 'string' ? error : undefined,
    retryable: true,
    actionLabel: template.actionLabel,
    timestamp: new Date().toISOString(),
  };
}

// ── Convenience helpers ────────────────────────────────────────────────────────

/** Create a StructuredError for a known error code with optional detail. */
export function createError(code: ErrorCode, detail?: string): StructuredError {
  const template = ERROR_TEMPLATES[code];
  return {
    code,
    title: template.title,
    message: detail ?? template.message,
    detail,
    retryable: template.retryable,
    actionLabel: template.actionLabel,
    actionHref: template.actionHref,
    timestamp: new Date().toISOString(),
  };
}

/** Check if a StructuredError indicates the user should re-authenticate. */
export function isAuthError(error: StructuredError): boolean {
  return error.code === ERROR_CODES.AUTH_REQUIRED || error.code === ERROR_CODES.FORBIDDEN;
}

/** Check if a StructuredError indicates the cluster is unreachable. */
export function isClusterError(error: StructuredError): boolean {
  return error.code === ERROR_CODES.K8S_UNAVAILABLE || error.code === ERROR_CODES.NETWORK_ERROR;
}

/** Get the template for an error code (useful for static rendering). */
export function getErrorTemplate(code: ErrorCode): ErrorTemplate {
  return ERROR_TEMPLATES[code];
}
