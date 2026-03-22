import { BackendApiError } from '@/services/backendApiClient';
import { toast } from '@/components/ui/sonner';

export type NotificationAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'scale'
  | 'restart'
  | 'rollback'
  | 'connect'
  | 'load'
  | 'apply'
  | 'download'
  | 'test'
  | 'other'
  | (string & {});

export interface NotificationContext {
  action: NotificationAction;
  resourceType?: string;
  resourceName?: string;
  namespace?: string;
}

export interface NormalizedError {
  title: string;
  description: string;
  details?: string;
  statusCode?: number;
  requestId?: string;
}

function humanizeResourceType(resourceType?: string): string {
  if (!resourceType) return 'resource';
  const base = resourceType.replace(/_/g, ' ');
  const singular = base.endsWith('s') ? base.slice(0, -1) : base;
  return singular.charAt(0).toUpperCase() + singular.slice(1);
}

function buildActionNoun(ctx: NotificationContext): string {
  const type = humanizeResourceType(ctx.resourceType);
  const name = ctx.resourceName;
  if (name) {
    if (ctx.namespace) {
      return `${type} ${name} in ${ctx.namespace}`;
    }
    return `${type} ${name}`;
  }
  return type;
}

function buildErrorTitle(ctx: NotificationContext): string {
  const noun = buildActionNoun(ctx);
  switch (ctx.action) {
    case 'create':
      return `${noun} not created`;
    case 'update':
    case 'apply':
      return `${noun} not updated`;
    case 'delete':
      return `${noun} not deleted`;
    case 'scale':
      return `${noun} not scaled`;
    case 'restart':
    case 'rollback':
      return `${noun} not changed`;
    case 'connect':
      return `Could not connect to ${noun}`;
    case 'load':
      return `Could not load ${noun}`;
    case 'download':
      return `${noun} download failed`;
    case 'test':
      return `${noun} test failed`;
    default:
      return `Operation failed`;
  }
}

function buildSuccessTitle(ctx: NotificationContext): string {
  const noun = buildActionNoun(ctx);
  switch (ctx.action) {
    case 'create':
      return `${noun} created`;
    case 'update':
    case 'apply':
      return `${noun} updated`;
    case 'delete':
      return `${noun} deleted`;
    case 'scale':
      return `${noun} scaled`;
    case 'restart':
      return `${noun} restarted`;
    case 'rollback':
      return `${noun} rolled back`;
    case 'connect':
      return `Connected to ${noun}`;
    case 'load':
      return `${noun} loaded`;
    case 'download':
      return `${noun} downloaded`;
    case 'test':
      return `${noun} test passed`;
    default:
      return `Action completed`;
  }
}

function firstSentence(message: string): string {
  const trimmed = message.trim();
  const newlineIndex = trimmed.indexOf('\n');
  const bracketIndex = trimmed.indexOf('] "');
  let end = trimmed.length;
  if (newlineIndex !== -1) end = Math.min(end, newlineIndex);
  if (bracketIndex !== -1) end = Math.min(end, bracketIndex + 1);
  const sentence = trimmed.slice(0, end).trim();
  return sentence || trimmed;
}

function summarizeRawMessage(raw: string, ctx: NotificationContext): string {
  const lower = raw.toLowerCase();
  const type = humanizeResourceType(ctx.resourceType);
  const name = ctx.resourceName;
  const ns = ctx.namespace;

  if (lower.includes('already exists')) {
    if (name) {
      return `${type} “${name}” already exists${ns ? ` in ${ns}` : ''}. Choose a different name or delete the existing one.`;
    }
    return `${type} with this name already exists. Choose a different name or delete the existing one.`;
  }

  if (lower.includes('may not change fields other than')) {
    return `Kubernetes does not allow changing most fields on an existing ${type}. Update the owning workload (for example a Deployment) or create a new ${type.toLowerCase()}.`;
  }

  if (lower.includes('qos is immutable')) {
    return `Pod QoS is immutable. To change QoS or resource requests, update the Deployment or recreate the Pod instead of editing the live Pod.`;
  }

  if (lower.includes('forbidden:')) {
    return `You do not have permission to perform this action on this ${type.toLowerCase()}. Check cluster RBAC or use an account with the required permissions.`;
  }

  if (lower.includes('connection refused') || lower.includes('failed to fetch')) {
    return 'The backend could not be reached. Check that the Kubilitics backend is running and the URL in Settings is correct.';
  }

  return firstSentence(raw);
}

function extractBodyError(body: string | undefined): { message?: string; details?: string } {
  if (!body) return {};
  const trimmed = body.trim();
  if (!trimmed) return {};

  // Try JSON first
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === 'string') {
      return { message: parsed };
    }
    if (parsed && typeof (parsed as Record<string, unknown>).error === 'string') {
      return { message: (parsed as Record<string, unknown>).error as string, details: trimmed };
    }
    if (parsed && typeof (parsed as Record<string, unknown>).message === 'string') {
      return { message: (parsed as Record<string, unknown>).message as string, details: trimmed };
    }
  } catch {
    // Not JSON – fall through
  }

  return { message: trimmed, details: trimmed };
}

export function normalizeError(err: unknown, ctx: NotificationContext): NormalizedError {
  let rawMessage = 'Unexpected error';
  let details: string | undefined;
  let statusCode: number | undefined;
  let requestId: string | undefined;

  if (err instanceof BackendApiError) {
    statusCode = err.status;
    requestId = err.requestId;
    const bodyInfo = extractBodyError(err.body);
    if (bodyInfo.message) {
      rawMessage = bodyInfo.message;
      details = bodyInfo.details ?? err.body ?? err.message;
    } else {
      rawMessage = err.message;
      details = err.body ?? err.message;
    }
  } else if (err instanceof Error) {
    rawMessage = err.message || 'Unexpected error';
  } else if (typeof err === 'string') {
    rawMessage = err;
  }

  // Remove noisy prefixes like \"Kubernetes API error: 500 - \"
  const apiPrefixMatch = rawMessage.match(/^[A-Z][a-zA-Z\\s]+ API error: \\d+ -\\s*/);
  if (apiPrefixMatch) {
    rawMessage = rawMessage.slice(apiPrefixMatch[0].length);
  }

  const description = summarizeRawMessage(rawMessage, ctx);
  const title = buildErrorTitle(ctx);

  return {
    title,
    description,
    details: details ?? rawMessage,
    statusCode,
    requestId,
  };
}

export function notifySuccess(ctx: NotificationContext, options?: { description?: string; durationMs?: number }) {
  const title = buildSuccessTitle(ctx);
  const description =
    options?.description ??
    (() => {
      const ns = ctx.namespace;
      if (ns && ctx.resourceName) {
        return `${ctx.resourceName} · ${ns}`;
      }
      if (ctx.resourceName) {
        return ctx.resourceName;
      }
      if (ns) {
        return ns;
      }
      return '';
    })();

  toast.success(title, {
    description: description || undefined,
    duration: options?.durationMs ?? 5000,
  });
}

export function notifyError(err: unknown, ctx: NotificationContext, options?: { durationMs?: number }) {
  const normalized = normalizeError(err, ctx);
  const hasDetails = !!normalized.details && normalized.details.trim().length > 0;

  toast.error(normalized.title, {
    description: normalized.description,
    duration: options?.durationMs ?? 12000,
    action: hasDetails
      ? {
          label: 'Copy details',
          onClick: () => {
            if (!normalized.details) return;
            try {
              void navigator.clipboard.writeText(normalized.details);
            } catch {
              // ignore clipboard errors
            }
          },
        }
      : undefined,
  });
}

