import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Box, Network, Database, Shield } from 'lucide-react';

interface RelatedResource {
  type: string;
  name: string;
  namespace?: string;
  status?: string;
  link: string;
}

interface RelatedResourcesPanelProps {
  resourceType: string;
  resourceName: string;
  namespace?: string;
  relatedResources?: RelatedResource[];
}

// Auto-detect related resources based on resource type
function detectRelatedResources(
  resourceType: string,
  resourceName: string,
  namespace?: string
): RelatedResource[] {
  const related: RelatedResource[] = [];

  switch (resourceType.toLowerCase()) {
    case 'pod':
      // Pods have: Service, ConfigMap, Secret, PVC
      related.push({
        type: 'Service',
        name: resourceName.split('-')[0], // Extract base name
        namespace,
        link: `/services/${namespace}/${resourceName.split('-')[0]}`
      });
      related.push({
        type: 'ConfigMap',
        name: `${resourceName}-config`,
        namespace,
        link: `/configmaps/${namespace}/${resourceName}-config`
      });
      related.push({
        type: 'Secret',
        name: `${resourceName}-secret`,
        namespace,
        link: `/secrets/${namespace}/${resourceName}-secret`
      });
      break;

    case 'deployment':
      // Deployments have: ReplicaSets, Pods, Service, HPA
      related.push({
        type: 'ReplicaSet',
        name: `${resourceName}-*`,
        namespace,
        link: `/replicasets?namespace=${namespace}&deployment=${resourceName}`
      });
      related.push({
        type: 'Pod',
        name: `${resourceName}-*`,
        namespace,
        link: `/pods?namespace=${namespace}&deployment=${resourceName}`
      });
      related.push({
        type: 'Service',
        name: resourceName,
        namespace,
        link: `/services/${namespace}/${resourceName}`
      });
      related.push({
        type: 'HPA',
        name: resourceName,
        namespace,
        link: `/horizontalpodautoscalers/${namespace}/${resourceName}`
      });
      break;

    case 'service':
      // Services have: Pods, Endpoints, Ingress
      related.push({
        type: 'Pod',
        name: `Pods with selector`,
        namespace,
        link: `/pods?namespace=${namespace}&service=${resourceName}`
      });
      related.push({
        type: 'Endpoint',
        name: resourceName,
        namespace,
        link: `/endpoints/${namespace}/${resourceName}`
      });
      related.push({
        type: 'Ingress',
        name: `Ingresses using ${resourceName}`,
        namespace,
        link: `/ingresses?namespace=${namespace}&service=${resourceName}`
      });
      break;

    case 'statefulset':
      // StatefulSets have: Pods, PVCs, Service
      related.push({
        type: 'Pod',
        name: `${resourceName}-*`,
        namespace,
        link: `/pods?namespace=${namespace}&statefulset=${resourceName}`
      });
      related.push({
        type: 'PVC',
        name: `${resourceName}-*`,
        namespace,
        link: `/persistentvolumeclaims?namespace=${namespace}&statefulset=${resourceName}`
      });
      related.push({
        type: 'Service',
        name: resourceName,
        namespace,
        link: `/services/${namespace}/${resourceName}`
      });
      break;

    case 'daemonset':
      // DaemonSets have: Pods
      related.push({
        type: 'Pod',
        name: `${resourceName}-*`,
        namespace,
        link: `/pods?namespace=${namespace}&daemonset=${resourceName}`
      });
      break;

    case 'configmap':
      // ConfigMaps used by: Pods, Deployments
      related.push({
        type: 'Pod',
        name: `Pods using this ConfigMap`,
        namespace,
        link: `/pods?namespace=${namespace}&configmap=${resourceName}`
      });
      break;

    case 'secret':
      // Secrets used by: Pods, ServiceAccounts
      related.push({
        type: 'Pod',
        name: `Pods using this Secret`,
        namespace,
        link: `/pods?namespace=${namespace}&secret=${resourceName}`
      });
      related.push({
        type: 'ServiceAccount',
        name: `ServiceAccounts using this Secret`,
        namespace,
        link: `/serviceaccounts?namespace=${namespace}&secret=${resourceName}`
      });
      break;

    case 'persistentvolumeclaim':
      // PVCs have: PV, Pods
      related.push({
        type: 'PersistentVolume',
        name: `Bound volume`,
        link: `/persistentvolumes`
      });
      related.push({
        type: 'Pod',
        name: `Pods using this PVC`,
        namespace,
        link: `/pods?namespace=${namespace}&pvc=${resourceName}`
      });
      break;

    case 'ingress':
      // Ingress has: Services, IngressClass
      related.push({
        type: 'Service',
        name: `Backend services`,
        namespace,
        link: `/services?namespace=${namespace}&ingress=${resourceName}`
      });
      related.push({
        type: 'IngressClass',
        name: `Ingress class`,
        link: `/ingressclasses`
      });
      break;
  }

  return related;
}

const getResourceIcon = (type: string) => {
  const lowerType = type.toLowerCase();
  if (lowerType.includes('pod')) return <Box className="h-4 w-4" />;
  if (lowerType.includes('service') || lowerType.includes('ingress')) return <Network className="h-4 w-4" />;
  if (lowerType.includes('pv') || lowerType.includes('configmap') || lowerType.includes('secret')) return <Database className="h-4 w-4" />;
  if (lowerType.includes('service')) return <Shield className="h-4 w-4" />;
  return <Box className="h-4 w-4" />;
};

export function RelatedResourcesPanel({
  resourceType,
  resourceName,
  namespace,
  relatedResources
}: RelatedResourcesPanelProps) {
  const related = relatedResources || detectRelatedResources(resourceType, resourceName, namespace);

  if (related.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Network className="h-4 w-4" />
          Related Resources
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {related.map((resource, idx) => (
            <Link
              key={idx}
              to={resource.link}
              className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 transition-colors group"
            >
              <div className="flex items-center gap-2">
                {getResourceIcon(resource.type)}
                <div>
                  <p className="text-sm font-medium group-hover:text-blue-600">
                    {resource.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {resource.type}
                    {resource.namespace && ` • ${resource.namespace}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {resource.status && (
                  <Badge variant="outline" className="text-xs">
                    {resource.status}
                  </Badge>
                )}
                <ExternalLink className="h-3 w-3 text-gray-400 group-hover:text-blue-600" />
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
