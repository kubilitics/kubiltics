CREATE TABLE IF NOT EXISTS addon_catalog (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    tier TEXT NOT NULL CHECK (tier IN ('CORE','COMMUNITY','PRIVATE')),
    version TEXT NOT NULL,
    k8s_compat_min TEXT NOT NULL,
    k8s_compat_max TEXT,
    helm_repo_url TEXT NOT NULL,
    helm_chart TEXT NOT NULL,
    helm_chart_version TEXT NOT NULL,
    icon_url TEXT,
    tags TEXT,
    home_url TEXT,
    source_url TEXT,
    maintainer TEXT,
    is_deprecated INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_addon_catalog_tier ON addon_catalog(tier);
CREATE INDEX IF NOT EXISTS idx_addon_catalog_name ON addon_catalog(name);
