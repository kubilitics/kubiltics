import { useState } from 'react';
import { ShieldAlert, Copy, Check, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * P0-004-T03: Permission Denied Error with RBAC Guidance
 *
 * When API returns 403, this component:
 * 1. Parses the error to identify which permission is missing
 * 2. Shows human-readable message about what permission is needed
 * 3. Generates the required RBAC manifest (Role + RoleBinding YAML)
 * 4. Provides a "Copy RBAC Manifest" button
 */

interface PermissionDeniedErrorProps {
  /** The raw error message from the 403 response */
  errorMessage?: string;
  /** The resource kind that was being accessed (e.g. "pods", "deployments") */
  resource?: string;
  /** The verb that was attempted (e.g. "get", "list", "watch", "delete") */
  verb?: string;
  /** The namespace context, if applicable */
  namespace?: string;
  /** The API group (e.g. "apps", "batch", "" for core) */
  apiGroup?: string;
  /** Optional retry callback */
  onRetry?: () => void;
  className?: string;
}

/** Parse a Kubernetes RBAC 403 error message to extract verb, resource, group */
function parseRBACError(msg: string): { verb?: string; resource?: string; apiGroup?: string } {
  // Pattern: "pods is forbidden: User \"system:serviceaccount:...\" cannot list resource \"pods\" in API group \"\" in the namespace \"default\""
  const verbMatch = msg.match(/cannot\s+(\w+)\s+resource/i);
  const resourceMatch = msg.match(/resource\s+"([^"]+)"/i) || msg.match(/(\w+)\s+is\s+forbidden/i);
  const groupMatch = msg.match(/API\s+group\s+"([^"]*)"/i);

  return {
    verb: verbMatch?.[1],
    resource: resourceMatch?.[1],
    apiGroup: groupMatch?.[1] || undefined,
  };
}

/** Generate a Role + RoleBinding YAML manifest for the missing permission */
function generateRBACManifest(opts: {
  verb: string;
  resource: string;
  namespace?: string;
  apiGroup?: string;
}): string {
  const { verb, resource, namespace = 'default', apiGroup = '' } = opts;
  const verbs = verb === 'list' ? ['get', 'list', 'watch'] : [verb];
  const roleName = `kubilitics-${resource}-${verb}`;

  return `# Role granting ${verbs.join(', ')} access to ${resource}
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: ${roleName}
  namespace: ${namespace}
rules:
  - apiGroups: ["${apiGroup}"]
    resources: ["${resource}"]
    verbs: [${verbs.map((v) => `"${v}"`).join(', ')}]
---
# RoleBinding — update 'subjects' with your user or service account
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${roleName}-binding
  namespace: ${namespace}
subjects:
  - kind: User
    name: "<YOUR_USER_OR_SA>"
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: Role
  name: ${roleName}
  apiGroup: rbac.authorization.k8s.io`;
}

export function PermissionDeniedError({
  errorMessage = '',
  resource: propResource,
  verb: propVerb,
  namespace,
  apiGroup: propApiGroup,
  onRetry,
  className,
}: PermissionDeniedErrorProps) {
  const [copied, setCopied] = useState(false);
  const [showManifest, setShowManifest] = useState(false);

  // Parse error for RBAC details, fall back to props
  const parsed = parseRBACError(errorMessage);
  const verb = propVerb || parsed.verb || 'get';
  const resource = propResource || parsed.resource || 'resources';
  const apiGroup = propApiGroup || parsed.apiGroup || '';

  const manifest = generateRBACManifest({ verb, resource, namespace, apiGroup });

  const handleCopy = async () => {
    await navigator.clipboard.writeText(manifest);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={cn(
        'rounded-xl border border-destructive/30 bg-destructive/5 dark:bg-destructive/10 p-6 max-w-2xl mx-auto',
        className
      )}
    >
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-xl bg-destructive/10 dark:bg-destructive/20 shrink-0">
          <ShieldAlert className="h-6 w-6 text-destructive" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-foreground mb-1">Permission Denied</h3>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            You need the <code className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono font-medium">{verb}</code> permission
            on <code className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono font-medium">{resource}</code>
            {namespace && (
              <>
                {' '}in namespace{' '}
                <code className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono font-medium">{namespace}</code>
              </>
            )}
            {apiGroup && (
              <>
                {' '}(API group: <code className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono font-medium">{apiGroup || 'core'}</code>)
              </>
            )}
          </p>

          {/* Expandable RBAC manifest */}
          <button
            onClick={() => setShowManifest(!showManifest)}
            className="flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors mb-3"
          >
            {showManifest ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {showManifest ? 'Hide' : 'Show'} RBAC Manifest
          </button>

          {showManifest && (
            <div className="relative rounded-lg border border-border bg-muted/30 dark:bg-muted/10 mb-4">
              <div className="flex items-center justify-between px-4 py-2 border-b border-border/60">
                <span className="text-xs font-medium text-muted-foreground">role.yaml</span>
                <Button variant="ghost" size="sm" onClick={handleCopy} className="h-7 gap-1.5 text-xs">
                  {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
              </div>
              <pre className="p-4 overflow-x-auto text-xs font-mono text-foreground/80 leading-relaxed whitespace-pre">
                {manifest}
              </pre>
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            {onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                Retry
              </Button>
            )}
            <Button variant="ghost" size="sm" asChild className="gap-1.5">
              <a
                href="https://kubernetes.io/docs/reference/access-authn-authz/rbac/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Learn about RBAC
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
