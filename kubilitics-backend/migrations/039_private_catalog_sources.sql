-- Migration: 039_private_catalog_sources
-- T9.04: Private Helm/OCI registry management for adding custom catalog sources.

CREATE TABLE IF NOT EXISTS private_catalog_sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    -- url is the base URL of the Helm repo (e.g. https://charts.example.com)
    -- or OCI registry (e.g. oci://registry.example.com/charts).
    url TEXT NOT NULL UNIQUE,
    -- type: 'helm' (Helm HTTP repo with index.yaml) or 'oci' (OCI registry).
    type TEXT NOT NULL DEFAULT 'helm' CHECK (type IN ('helm', 'oci')),
    -- auth_type: 'none' | 'basic' (username/password) | 'token' (bearer token).
    auth_type TEXT NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none', 'basic', 'token')),
    sync_enabled INTEGER NOT NULL DEFAULT 1,
    last_synced_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
