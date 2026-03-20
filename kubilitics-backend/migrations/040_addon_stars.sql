-- Add Artifact Hub stars count to addon_catalog for community packages.
ALTER TABLE addon_catalog ADD COLUMN stars INTEGER DEFAULT 0;
