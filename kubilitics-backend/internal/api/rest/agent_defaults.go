package rest

// defaultOrgID is the placeholder organization ID for single-tenant
// installs that predate the multi-tenant org model. Used by agent
// register/admin handlers when no Org header or claim is present.
// Keep as a production symbol (not test-only) — the production handlers
// reference it in their "no org yet" fallback paths.
const defaultOrgID = "00000000-0000-0000-0000-000000000001"
