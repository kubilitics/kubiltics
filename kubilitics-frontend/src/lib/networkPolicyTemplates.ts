/**
 * networkPolicyTemplates — ENT-002
 *
 * Pre-built Kubernetes NetworkPolicy templates for common security patterns.
 * Each template includes metadata, description, use-case guidance, and the
 * full YAML manifest ready to be applied to a cluster.
 */

export interface NetworkPolicyTemplate {
  id: string;
  name: string;
  description: string;
  category: 'isolation' | 'allow' | 'monitoring' | 'dns';
  severity: 'critical' | 'high' | 'medium' | 'low';
  tags: string[];
  /** The namespace placeholder — user can override before applying */
  defaultNamespace: string;
  /** Full Kubernetes manifest YAML */
  yaml: string;
}

export const NETWORK_POLICY_TEMPLATES: NetworkPolicyTemplate[] = [
  // ── deny-all ──────────────────────────────────────────────
  {
    id: 'deny-all',
    name: 'Deny All Traffic',
    description:
      'Blocks all ingress and egress traffic to pods in the namespace. ' +
      'This is the recommended baseline — start with deny-all, then add explicit allow rules.',
    category: 'isolation',
    severity: 'critical',
    tags: ['baseline', 'zero-trust', 'cis-benchmark'],
    defaultNamespace: 'default',
    yaml: `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all
  namespace: "{{namespace}}"
  labels:
    kubilitics.io/template: deny-all
    kubilitics.io/managed-by: kubilitics
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress`,
  },

  // ── allow-web ─────────────────────────────────────────────
  {
    id: 'allow-web',
    name: 'Allow Web Traffic (80/443)',
    description:
      'Permits inbound HTTP (80) and HTTPS (443) traffic from any source. ' +
      'Apply to namespaces hosting public-facing web services.',
    category: 'allow',
    severity: 'medium',
    tags: ['web', 'http', 'https', 'ingress'],
    defaultNamespace: 'default',
    yaml: `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-web
  namespace: "{{namespace}}"
  labels:
    kubilitics.io/template: allow-web
    kubilitics.io/managed-by: kubilitics
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/role: web
  policyTypes:
    - Ingress
  ingress:
    - ports:
        - protocol: TCP
          port: 80
        - protocol: TCP
          port: 443`,
  },

  // ── allow-dns ─────────────────────────────────────────────
  {
    id: 'allow-dns',
    name: 'Allow DNS Resolution',
    description:
      'Permits egress DNS traffic (UDP/TCP 53) to kube-system CoreDNS pods. ' +
      'Required when using deny-all baseline to avoid breaking service discovery.',
    category: 'dns',
    severity: 'high',
    tags: ['dns', 'coredns', 'egress', 'kube-system'],
    defaultNamespace: 'default',
    yaml: `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
  namespace: "{{namespace}}"
  labels:
    kubilitics.io/template: allow-dns
    kubilitics.io/managed-by: kubilitics
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53`,
  },

  // ── allow-monitoring ──────────────────────────────────────
  {
    id: 'allow-monitoring',
    name: 'Allow Monitoring Scrape',
    description:
      'Permits ingress from Prometheus/monitoring namespace on metrics ports (9090, 9100, 8080). ' +
      'Ensures observability stack can scrape application metrics.',
    category: 'monitoring',
    severity: 'medium',
    tags: ['prometheus', 'metrics', 'observability', 'scrape'],
    defaultNamespace: 'default',
    yaml: `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-monitoring
  namespace: "{{namespace}}"
  labels:
    kubilitics.io/template: allow-monitoring
    kubilitics.io/managed-by: kubilitics
spec:
  podSelector: {}
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: monitoring
      ports:
        - protocol: TCP
          port: 9090
        - protocol: TCP
          port: 9100
        - protocol: TCP
          port: 8080`,
  },

  // ── namespace-isolation ───────────────────────────────────
  {
    id: 'namespace-isolation',
    name: 'Namespace Isolation',
    description:
      'Allows traffic only between pods within the same namespace. ' +
      'Blocks all cross-namespace communication. Combine with allow-dns for service discovery.',
    category: 'isolation',
    severity: 'high',
    tags: ['namespace', 'isolation', 'multi-tenant'],
    defaultNamespace: 'default',
    yaml: `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: namespace-isolation
  namespace: "{{namespace}}"
  labels:
    kubilitics.io/template: namespace-isolation
    kubilitics.io/managed-by: kubilitics
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector: {}
  egress:
    - to:
        - podSelector: {}
    # Also allow DNS so service discovery works
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53`,
  },
];

/**
 * Returns a template with namespace placeholders replaced.
 */
export function renderTemplate(template: NetworkPolicyTemplate, namespace: string): string {
  return template.yaml.replace(/\{\{namespace\}\}/g, namespace);
}

/**
 * Look up a template by its ID.
 */
export function getTemplateById(id: string): NetworkPolicyTemplate | undefined {
  return NETWORK_POLICY_TEMPLATES.find((t) => t.id === id);
}

/**
 * Filter templates by category.
 */
export function getTemplatesByCategory(category: NetworkPolicyTemplate['category']): NetworkPolicyTemplate[] {
  return NETWORK_POLICY_TEMPLATES.filter((t) => t.category === category);
}

/**
 * Search templates by name, description, or tags.
 */
export function searchTemplates(query: string): NetworkPolicyTemplate[] {
  const q = query.toLowerCase().trim();
  if (!q) return NETWORK_POLICY_TEMPLATES;
  return NETWORK_POLICY_TEMPLATES.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.tags.some((tag) => tag.includes(q))
  );
}
