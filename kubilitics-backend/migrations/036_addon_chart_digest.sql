-- Migration: 036_addon_chart_digest
-- T8.08: Add chart_digest field to addon_catalog for integrity verification.

ALTER TABLE addon_catalog ADD COLUMN chart_digest TEXT;
