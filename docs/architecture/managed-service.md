# Managed Service Architecture

**Status:** Future design (Kubilitics is currently self-hosted only)
**Audience:** Product architects, engineering leadership
**Last updated:** 2026-03-16

---

## Table of Contents

1. [Overview](#1-overview)
2. [Multi-Tenant Architecture](#2-multi-tenant-architecture)
3. [Tenant Isolation Model](#3-tenant-isolation-model)
4. [Data Plane Architecture](#4-data-plane-architecture)
5. [Control Plane Architecture](#5-control-plane-architecture)
6. [Billing Integration](#6-billing-integration)
7. [Security Considerations](#7-security-considerations)
8. [Migration Path from Self-Hosted](#8-migration-path-from-self-hosted)
9. [Decision: Pool vs Silo](#9-decision-pool-vs-silo)

---

## 1. Overview

Kubilitics is designed as a self-hosted, desktop-first Kubernetes management platform. This document explores the architecture required to offer Kubilitics as a managed service (SaaS), where multiple tenants share infrastructure while maintaining strict isolation.

### Design Principles

1. **Zero trust between tenants** -- No tenant can access another tenant's data, cluster credentials, or topology.
2. **Kubernetes credentials never leave the tenant's network** -- The managed service connects to tenant clusters via an agent, not by storing kubeconfigs centrally.
3. **Predictable per-tenant resource consumption** -- Resource limits prevent noisy neighbors.
4. **Self-hosted parity** -- The managed service offers the same features as self-hosted, not a subset.

---

## 2. Multi-Tenant Architecture

### Tenancy Model: Hybrid Pool-Silo

```
┌────────────────────────────────────────────────────────────┐
│                    CONTROL PLANE (shared)                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Auth/IAM │  │ Billing  │  │ Tenant   │  │ Provision  │  │
│  │ Service  │  │ Service  │  │ Registry │  │ Controller │  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────┘  │
└────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  DATA CELL #1   │ │  DATA CELL #2   │ │  DATA CELL #3   │
│  (pool: free +  │ │  (pool: team)   │ │  (silo: entpr)  │
│   starter)      │ │                 │ │                 │
│ ┌──────┐┌─────┐ │ │ ┌──────┐┌─────┐│ │ ┌──────┐┌─────┐│
│ │T1 BE ││T2 BE│ │ │ │T5 BE ││T6 BE││ │ │T9 BE ││     ││
│ └──────┘└─────┘ │ │ └──────┘└─────┘│ │ └──────┘│  PG ││
│ ┌──────┐┌─────┐ │ │ ┌──────┐       │ │         │ (ded)││
│ │T3 BE ││T4 BE│ │ │ │T7 BE │       │ │         └─────┘│
│ └──────┘└─────┘ │ │ └──────┘       │ │                 │
│ ┌─────────────┐ │ │ ┌─────────────┐│ │                 │
│ │  Shared PG  │ │ │ │  Shared PG  ││ │                 │
│ │ (schema/row) │ │ │ │ (schema/row) ││ │                 │
│ └─────────────┘ │ │ └─────────────┘│ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

### Tier Mapping

| Tier | Isolation Level | Database | Compute | Clusters |
|---|---|---|---|---|
| Free | Row-level in shared pool | Shared PG, row-level isolation | Shared backend pods | 1 |
| Starter | Row-level in shared pool | Shared PG, row-level isolation | Shared backend pods | 3 |
| Team | Schema-level in shared pool | Shared PG, schema-per-tenant | Dedicated backend pod | 10 |
| Enterprise | Dedicated cell | Dedicated PG instance | Dedicated backend pods | Unlimited |

---

## 3. Tenant Isolation Model

### 3.1 Data Isolation

#### Row-Level (Free / Starter)

Every table includes a `tenant_id` column. All queries are scoped via PostgreSQL Row-Level Security:

```sql
-- Row-Level Security policy
CREATE POLICY tenant_isolation ON clusters
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE clusters FORCE ROW LEVEL SECURITY;
```

The backend sets the tenant context on every connection:

```go
func (r *MultiTenantRepo) withTenant(ctx context.Context, tenantID string) (*sql.Conn, error) {
    conn, err := r.pool.Conn(ctx)
    if err != nil {
        return nil, err
    }
    _, err = conn.ExecContext(ctx, "SET app.tenant_id = $1", tenantID)
    if err != nil {
        conn.Close()
        return nil, err
    }
    return conn, nil
}
```

#### Schema-Level (Team)

Each tenant gets a PostgreSQL schema:

```sql
CREATE SCHEMA tenant_abc123;
SET search_path TO tenant_abc123, public;
```

Benefits: no `tenant_id` column needed, simpler queries, easier per-tenant backup/restore.

#### Instance-Level (Enterprise)

Dedicated PostgreSQL instance per tenant. Full isolation with independent scaling, backup schedules, and connection limits.

### 3.2 Compute Isolation

#### Shared Backend (Free / Starter)

Multiple tenants share backend pods. Tenant context is derived from the JWT:

```go
func TenantFromJWT(claims jwt.MapClaims) string {
    return claims["tenant_id"].(string)
}
```

Resource limits per tenant enforced at the application level:
- Max concurrent topology requests: 2
- Max WebSocket connections: 5
- Max API requests/minute: 60

#### Dedicated Backend (Team / Enterprise)

Each tenant gets their own backend deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kubilitics-tenant-abc123
  namespace: kubilitics-tenants
  labels:
    kubilitics.io/tenant: abc123
    kubilitics.io/tier: team
```

### 3.3 Network Isolation

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: tenant-abc123-isolation
  namespace: kubilitics-tenants
spec:
  podSelector:
    matchLabels:
      kubilitics.io/tenant: abc123
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              kubilitics.io/component: gateway
  egress:
    - to:
        - podSelector:
            matchLabels:
              kubilitics.io/tenant: abc123
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - port: 53
          protocol: UDP
```

---

## 4. Data Plane Architecture

### Cluster Agent

Kubilitics managed service does NOT store tenant kubeconfig credentials. Instead, tenants install a lightweight agent in their clusters:

```
┌─────────────────────────────┐         ┌───────────────────┐
│    Tenant's Cluster          │         │ Kubilitics Cloud  │
│                              │         │                   │
│  ┌────────────────────────┐  │         │  ┌─────────────┐  │
│  │  kubilitics-agent      │  │ ──gRPC──│  │ Tenant's    │  │
│  │  (watches resources,   │  │  (TLS)  │  │ Backend     │  │
│  │   pushes topology)     │  │         │  │ Instance    │  │
│  └────────────────────────┘  │         │  └─────────────┘  │
│                              │         │                   │
└─────────────────────────────┘         └───────────────────┘
```

Agent design:
- **Outbound only** -- The agent initiates a gRPC stream to the Kubilitics service. No inbound ports or public endpoints.
- **Minimal RBAC** -- The agent needs only read access to cluster resources (`get`, `list`, `watch`). Write operations (scale, restart) require explicit opt-in with additional RBAC.
- **Helm install** -- `helm install kubilitics-agent kubilitics/agent --set tenantToken=xxx`
- **Heartbeat** -- Agent sends a heartbeat every 30 seconds. If missed for 5 minutes, cluster status is set to `disconnected`.

### Agent Protocol

```protobuf
service AgentService {
  // Agent opens a bidirectional stream
  rpc Connect(stream AgentMessage) returns (stream ControlMessage);
}

message AgentMessage {
  oneof payload {
    Heartbeat heartbeat = 1;
    TopologySnapshot topology = 2;
    ResourceEvent resource_event = 3;
    MetricsSnapshot metrics = 4;
  }
}

message ControlMessage {
  oneof payload {
    Ack ack = 1;
    ScaleCommand scale = 2;
    RestartCommand restart = 3;
    ConfigUpdate config = 4;
  }
}
```

---

## 5. Control Plane Architecture

### Tenant Registry

Stores tenant metadata, subscription status, and configuration:

```sql
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  billing_customer_id TEXT,
  billing_subscription_id TEXT,
  max_clusters INT NOT NULL DEFAULT 1,
  max_users INT NOT NULL DEFAULT 3,
  data_cell TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Provision Controller

A Kubernetes controller that watches the tenant registry and provisions/deprovisions tenant resources:

1. **Tenant created** -> Create namespace (if dedicated), deploy backend pod, create database schema/instance, generate agent token.
2. **Tier upgraded** -> Migrate from shared to dedicated resources, update resource limits.
3. **Tenant suspended** -> Scale backend to 0, block API access, retain data for 30 days.
4. **Tenant deleted** -> Delete data after 30-day grace period, deprovision resources.

### Auth / IAM Service

- **Authentication:** OIDC (Google, GitHub, Microsoft) + email/password.
- **Authorization:** Tenant-scoped RBAC. Roles: `owner`, `admin`, `editor`, `viewer`.
- **API keys:** Scoped to a tenant and a set of permissions.
- **SSO:** SAML 2.0 and OIDC for Enterprise tier.

---

## 6. Billing Integration

### Provider: Stripe

### Pricing Model

| Tier | Price | Included | Overage |
|---|---|---|---|
| Free | $0/month | 1 cluster, 3 users, 500 resources | N/A (hard limit) |
| Starter | $29/month | 3 clusters, 10 users, 5,000 resources | $5/cluster, $3/user |
| Team | $99/month | 10 clusters, 25 users, 50,000 resources | $8/cluster, $5/user |
| Enterprise | Custom | Unlimited | Custom |

### Usage Metering

Track usage dimensions per billing period:

```sql
CREATE TABLE usage_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  dimension TEXT NOT NULL,
  quantity BIGINT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  billing_period TEXT NOT NULL
);

CREATE INDEX idx_usage_tenant_period ON usage_records(tenant_id, billing_period);
```

### Stripe Integration Flow

```
1. User signs up          -> Create Stripe Customer
2. User selects plan      -> Create Stripe Subscription
3. Monthly usage sync     -> Report usage via Stripe Usage Records API
4. Stripe invoices        -> Webhook: invoice.paid / invoice.payment_failed
5. Payment failed         -> Suspend tenant after 7-day grace period
6. Subscription cancelled -> Suspend immediately, delete after 30 days
```

### Webhook Handlers

```
POST /billing/webhooks/stripe

Events handled:
  customer.subscription.created    -> Activate tenant
  customer.subscription.updated    -> Update tier/limits
  customer.subscription.deleted    -> Suspend tenant
  invoice.paid                     -> Record payment
  invoice.payment_failed           -> Send warning, start grace period
```

---

## 7. Security Considerations

### Credential Handling

| Credential Type | Storage | Encryption |
|---|---|---|
| Tenant kubeconfig | **Never stored** -- agent model | N/A |
| Agent tokens | PostgreSQL | AES-256-GCM at rest |
| User passwords | PostgreSQL | bcrypt (cost 12) |
| API keys | PostgreSQL | SHA-256 hash stored, plaintext shown once |
| Stripe keys | Vault / KMS | Runtime-only in memory |

### Audit Trail

Every tenant action is logged:

```json
{
  "tenant_id": "abc-123",
  "user_id": "user-456",
  "action": "cluster.topology.view",
  "resource": "cluster/prod-us-east",
  "ip": "203.0.113.1",
  "user_agent": "Mozilla/5.0...",
  "timestamp": "2026-03-16T10:30:00Z"
}
```

Retention: 90 days (free), 1 year (team), 7 years (enterprise).

### Compliance

| Standard | Applicability | Status |
|---|---|---|
| SOC 2 Type II | Required for enterprise sales | Planned |
| GDPR | EU tenants | Data residency via cell placement |
| HIPAA | Healthcare tenants | Dedicated cells with BAA |
| ISO 27001 | Enterprise requirement | Planned |

---

## 8. Migration Path from Self-Hosted

For users migrating from self-hosted Kubilitics to the managed service:

1. **Export data** -- Use `kcli export --format json` to export clusters, settings, and add-on configurations.
2. **Create managed tenant** -- Sign up at kubilitics.io, create organization.
3. **Import data** -- Use `kcli import --target managed --tenant abc123` to import configuration.
4. **Install agents** -- Replace direct kubeconfig connections with agents in each cluster.
5. **Verify** -- Confirm all clusters appear in the managed dashboard with topology and events.

### Feature Parity Matrix

| Feature | Self-Hosted | Managed (Free) | Managed (Team) | Managed (Enterprise) |
|---|:---:|:---:|:---:|:---:|
| Topology visualization | Yes | Yes | Yes | Yes |
| Add-on management | Yes | View only | Yes | Yes |
| AI insights | Yes (self-hosted AI) | Basic | Full | Full + custom models |
| SSO/SAML | Yes (configure yourself) | No | OIDC only | OIDC + SAML |
| Audit logs | Yes | 7 days | 90 days | 7 years |
| API access | Yes | Rate limited | Yes | Yes |
| Custom branding | Yes | No | No | Yes |
| SLA | None (you manage) | None | 99.9% | 99.99% |

---

## 9. Decision: Pool vs Silo

### Recommendation: Start with Pool, offer Silo for Enterprise

**Phase 1 (MVP):** Pool model with row-level isolation. Minimizes infrastructure cost and operational complexity. Suitable for free and starter tiers.

**Phase 2:** Schema-level isolation for team tier. Improves query performance (no `tenant_id` filter on every query) and simplifies per-tenant operations.

**Phase 3:** Dedicated cells for enterprise tier. Full infrastructure isolation for compliance and performance requirements.

### Risk Assessment

| Risk | Pool | Silo | Mitigation |
|---|---|---|---|
| Data leak between tenants | Higher (app-level isolation) | Minimal | Row-Level Security + integration tests |
| Noisy neighbor | Higher | None | Per-tenant resource quotas |
| Operational complexity | Lower | Higher | Provision controller automation |
| Cost per tenant | Lower | Higher | Price tiers accordingly |
| Compliance | Harder to certify | Easier | Dedicated cells for regulated tenants |
