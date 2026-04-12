import aws from './providers/aws.svg';
import azure from './providers/azure.svg';
import gcp from './providers/gcp.svg';
import openshift from './providers/openshift.svg';
import rancher from './providers/rancher.svg';
import k3s from './providers/k3s.svg';
import docker from './providers/docker.svg';
import minikube from './providers/minikube.svg';
import kind from './providers/kind.svg';
import onprem from './providers/onprem.svg';

const providerLogoMap: Record<string, string> = {
  eks: aws,
  aks: azure,
  gke: gcp,
  openshift: openshift,
  rancher: rancher,
  k3s: k3s,
  'docker-desktop': docker,
  'docker desktop': docker,
  minikube: minikube,
  kind: kind,
  'on-prem': onprem,
};

export function getProviderLogo(provider?: string): string | null {
  if (!provider) return null;
  return providerLogoMap[provider] ?? providerLogoMap[provider.toLowerCase()] ?? null;
}

export function getProviderLabel(provider?: string): string {
  if (!provider) return 'Unknown';
  const labels: Record<string, string> = {
    eks: 'AWS EKS',
    aks: 'Azure AKS',
    gke: 'GCP GKE',
    openshift: 'OpenShift',
    rancher: 'Rancher',
    k3s: 'K3s',
    'docker-desktop': 'Docker Desktop',
    'docker desktop': 'Docker Desktop',
    minikube: 'Minikube',
    kind: 'Kind',
    'on-prem': 'On-Prem',
  };
  return labels[provider] ?? labels[provider.toLowerCase()] ?? provider;
}
