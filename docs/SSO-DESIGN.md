# SSO Integration Design (D2.1)

## Scope

This document describes a design for optional SSO (SAML 2.0 / OIDC) integration for the Kubilitics backend and frontend (web and desktop). Implementation can be phased.

## Goals

- **Enterprise expectation:** Many enterprises require SSO (SAML or OIDC) for internal tools.
- **Single sign-on:** Users authenticate once with the IdP; the app receives an identity (and optionally groups).
- **Group-based access (optional):** Restrict which clusters or namespaces a user can see based on IdP groups or attributes.

## Current state

- **No built-in auth:** The backend today does not authenticate or authorize users; it assumes a trusted environment (e.g. desktop sidecar, or network-level access control).
- **Kubernetes identity:** When the backend talks to K8s, it uses a single kubeconfig per cluster (service account or user credentials). There is no per-request user identity propagated to K8s yet.

## Proposed architecture

### 1. Auth layer (backend)

- **Reverse proxy / API gateway:** In production, place an API gateway or reverse proxy (e.g. nginx, Envoy, OAuth2 Proxy, or a custom middleware) in front of the backend. The proxy can:
  - Terminate TLS.
  - Perform OIDC or SAML authentication (e.g. via OAuth2 Proxy, Keycloak Gatekeeper, or custom service).
  - Forward identity to the backend via headers (e.g. `X-Forwarded-User`, `X-Remote-Groups`, `Authorization: Bearer <JWT>`).
- **Backend changes (optional):**
  - Read identity from trusted headers or from a validated JWT in `Authorization`.
  - Optionally enforce group membership for cluster or namespace access (e.g. allow list of clusters per group).
  - Map “no access” to 403 and log audit events with user ID.

### 2. OIDC flow (recommended for new deployments)

- **Flow:** Authorization Code flow with PKCE for web/desktop.
- **IdP:** Any OIDC provider (Keycloak, Okta, Auth0, Azure AD, Google Workspace).
- **Backend:** Either:
  - **Option A:** Backend validates the access token (JWT) on each request and extracts `sub`, `groups`, etc. Requires JWKS endpoint and token validation.
  - **Option B:** A sidecar or gateway validates the token and sets headers; backend trusts those headers when running in a trusted network.
- **Frontend:** Redirect to IdP login when unauthenticated; store access token (memory or secure storage); send `Authorization: Bearer <token>` on API calls. For desktop, use system browser or embedded webview for login.

### 3. SAML 2.0

- **Flow:** SP-initiated or IdP-initiated; IdP returns SAML assertion.
- **Backend:** Typically implemented via a gateway or middleware that converts SAML to session or JWT and forwards identity to the backend. Backend then behaves as in OIDC (trust headers or validate JWT).
- **Frontend:** Redirect to IdP for SAML login; after callback, frontend receives session cookie or token and uses it for API calls.

### 4. Group-based access (optional)

- **Model:** IdP sends groups in token or assertion (e.g. OIDC `groups` claim, SAML attribute).
- **Backend:** Configuration mapping groups to allowed cluster IDs or namespace patterns. For each request, if identity is present, check that the requested `clusterId` (and optionally namespace) is in the allowed set for the user’s groups. Return 403 if not.
- **Data model:** e.g. `group_cluster_allowlist`: (group_id, cluster_id) or (group_id, cluster_id, namespace_pattern).

## Implementation phases

| Phase | Deliverable | Effort |
|-------|-------------|--------|
| 1 | Design doc (this document), decision on gateway vs in-process auth | Done |
| 2 | OAuth2 Proxy (or similar) in front of backend; backend reads `X-Forwarded-User` for audit only | Low |
| 3 | Backend: validate JWT, extract groups; config for group → cluster allow list; return 403 when not allowed | Medium |
| 4 | Frontend: login redirect, token storage, attach Bearer token to API client | Medium |
| 5 | SAML support via gateway or dedicated service | Medium |

## Security considerations

- **Token storage:** Web: avoid long-lived tokens in localStorage; prefer short-lived access token + refresh in memory or httpOnly cookie. Desktop: use secure storage or system keychain.
- **HTTPS:** All SSO and API traffic over TLS in production.
- **Trust boundaries:** If backend trusts headers (e.g. `X-Forwarded-User`), ensure only the gateway can reach the backend (network or mTLS).

## Definition of done (optional implementation)

- [ ] Design doc (this document) agreed.
- [ ] Optional: OIDC login flow (web or desktop) with one IdP.
- [ ] Optional: Backend accepts and validates JWT; audit log includes user id.
- [ ] Optional: Group-based cluster (or namespace) allow list and 403 when not allowed.
