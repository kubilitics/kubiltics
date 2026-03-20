-- Add provider column to clusters for EKS, GKE, AKS, Kind, Minikube, etc.
ALTER TABLE clusters ADD COLUMN provider TEXT DEFAULT 'on-prem';

CREATE INDEX IF NOT EXISTS idx_clusters_provider ON clusters(provider);
