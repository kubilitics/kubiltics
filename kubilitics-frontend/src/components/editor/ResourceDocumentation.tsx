import { ExternalLink, BookOpen, FileCode, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// Official Kubernetes documentation links
export const K8S_DOCS: Record<string, {
  docUrl: string;
  apiRef: string;
  description: string;
  examples: { name: string; yaml: string }[];
}> = {
  Pod: {
    docUrl: 'https://kubernetes.io/docs/concepts/workloads/pods/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/pod-v1/',
    description: 'Pods are the smallest deployable units of computing that you can create and manage in Kubernetes.',
    examples: [
      {
        name: 'Simple Pod',
        yaml: `apiVersion: v1
kind: Pod
metadata:
  name: nginx-pod
  labels:
    app: nginx
spec:
  containers:
    - name: nginx
      image: nginx:1.21
      ports:
        - containerPort: 80`
      },
      {
        name: 'Multi-container Pod',
        yaml: `apiVersion: v1
kind: Pod
metadata:
  name: multi-container
spec:
  containers:
    - name: app
      image: app:latest
      ports:
        - containerPort: 8080
    - name: sidecar
      image: sidecar:latest`
      }
    ]
  },
  ReplicaSet: {
    docUrl: 'https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/replica-set-v1/',
    description: 'A ReplicaSet ensures that a specified number of pod replicas are running at any given time.',
    examples: [
      {
        name: 'Basic ReplicaSet',
        yaml: `apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: frontend
  labels:
    app: guestbook
    tier: frontend
spec:
  replicas: 3
  selector:
    matchLabels:
      tier: frontend
  template:
    metadata:
      labels:
        tier: frontend
    spec:
      containers:
      - name: php-redis
        image: gcr.io/google_samples/gb-frontend:v3`
      }
    ]
  },
  PodTemplate: {
    docUrl: 'https://kubernetes.io/docs/concepts/workloads/pods/#pod-templates',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/pod-template-v1/',
    description:
      'PodTemplates are used by controllers (like Deployments, Jobs, and DaemonSets) to create new Pods with a specific configuration.',
    examples: [
      {
        name: 'Basic Pod Template',
        yaml: `apiVersion: v1
kind: PodTemplate
metadata:
  name: my-template
template:
  metadata:
    labels:
      app: my-app
  spec:
    containers:
    - name: nginx
      image: nginx:stable-alpine`,
      },
    ],
  },
  ControllerRevision: {
    docUrl: 'https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/#update-strategies',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/controller-revision-v1/',
    description:
      'ControllerRevision implements an immutable snapshot of state data. It is primarily used by StatefulSets and DaemonSets to track update history and support rollbacks.',
    examples: [
      {
        name: 'Controller Revision Example',
        yaml: `apiVersion: apps/v1
kind: ControllerRevision
metadata:
  name: web-54d6f854db
  namespace: default
revision: 1
data:
  spec:
    template:
      $patch: replace
      spec:
        containers:
        - name: nginx
          image: nginx:1.14.2`,
      },
    ],
  },
  ResourceSlice: {
    docUrl: 'https://kubernetes.io/docs/concepts/scheduling-eviction/dynamic-resource-allocation/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/cluster-resources/resource-slice-v1alpha3/',
    description:
      'ResourceSlice provides information about available capacities for Dynamic Resource Allocation (DRA). It is used by resource drivers to report hardware availability.',
    examples: [
      {
        name: 'Resource Slice Example',
        yaml: `apiVersion: resource.k8s.io/v1alpha3
kind: ResourceSlice
metadata:
  name: node-1-gpu
spec:
  driverName: example.com/gpu-driver
  pool:
    name: cluster-pool
    generation: 1
    resourceSliceCount: 1`,
      },
    ],
  },
  DeviceClass: {
    docUrl: 'https://kubernetes.io/docs/concepts/scheduling-eviction/dynamic-resource-allocation/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/cluster-resources/device-class-v1alpha3/',
    description:
      'DeviceClass is used by Dynamic Resource Allocation (DRA) to define the type of device being requested and the driver responsible for it.',
    examples: [
      {
        name: 'Device Class Example',
        yaml: `apiVersion: resource.k8s.io/v1alpha3
kind: DeviceClass
metadata:
  name: nvidia-gpu
spec:
  selectors:
    - cel:
        expression: "device.driver == 'nvidia.com/gpu-driver' && device.attributes['model'] == 'A100' "`,
      },
    ],
  },
  Deployment: {
    docUrl: 'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/deployment-v1/',
    description: 'A Deployment provides declarative updates for Pods and ReplicaSets.',
    examples: [
      {
        name: 'Basic Deployment',
        yaml: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-deployment
  labels:
    app: nginx
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
        - name: nginx
          image: nginx:1.21
          ports:
            - containerPort: 80`
      },
      {
        name: 'With Resource Limits',
        yaml: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: resource-deployment
spec:
  replicas: 2
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
        - name: myapp
          image: myapp:latest
          resources:
            requests:
              memory: "64Mi"
              cpu: "250m"
            limits:
              memory: "128Mi"
              cpu: "500m"`
      }
    ]
  },
  Service: {
    docUrl: 'https://kubernetes.io/docs/concepts/services-networking/service/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/service-resources/service-v1/',
    description: 'A Service is an abstract way to expose an application running on a set of Pods as a network service.',
    examples: [
      {
        name: 'ClusterIP Service',
        yaml: `apiVersion: v1
kind: Service
metadata:
  name: my-service
spec:
  type: ClusterIP
  selector:
    app: myapp
  ports:
    - protocol: TCP
      port: 80
      targetPort: 8080`
      },
      {
        name: 'LoadBalancer Service',
        yaml: `apiVersion: v1
kind: Service
metadata:
  name: my-loadbalancer
spec:
  type: LoadBalancer
  selector:
    app: myapp
  ports:
    - protocol: TCP
      port: 80
      targetPort: 8080`
      }
    ]
  },
  ConfigMap: {
    docUrl: 'https://kubernetes.io/docs/concepts/configuration/configmap/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/config-and-storage-resources/config-map-v1/',
    description: 'A ConfigMap is an API object used to store non-confidential data in key-value pairs.',
    examples: [
      {
        name: 'Basic ConfigMap',
        yaml: `apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  database_host: "localhost"
  database_port: "5432"
  log_level: "info"`
      }
    ]
  },
  Secret: {
    docUrl: 'https://kubernetes.io/docs/concepts/configuration/secret/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/config-and-storage-resources/secret-v1/',
    description: 'A Secret is an object that contains a small amount of sensitive data such as a password, token, or key.',
    examples: [
      {
        name: 'Opaque Secret',
        yaml: `apiVersion: v1
kind: Secret
metadata:
  name: my-secret
type: Opaque
stringData:
  username: admin
  password: supersecret`
      }
    ]
  },
  ServiceAccount: {
    docUrl: 'https://kubernetes.io/docs/concepts/security/service-accounts/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/authentication-resources/service-account-v1/',
    description: 'A ServiceAccount provides an identity for processes that run in a Pod.',
    examples: [
      {
        name: 'Basic ServiceAccount',
        yaml: `apiVersion: v1
kind: ServiceAccount
metadata:
  name: build-robot`
      }
    ]
  },
  Role: {
    docUrl: 'https://kubernetes.io/docs/reference/access-authn-authz/rbac/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/authorization-resources/role-v1/',
    description: 'A Role contains rules that represent a set of permissions within a single namespace.',
    examples: [
      {
        name: 'Pod Reader Role',
        yaml: `apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: default
  name: pod-reader
rules:
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "watch", "list"]`
      }
    ]
  },
  ClusterRole: {
    docUrl: 'https://kubernetes.io/docs/reference/access-authn-authz/rbac/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/authorization-resources/cluster-role-v1/',
    description: 'A ClusterRole is a cluster-level resource that can be used to grant permissions across the entire cluster.',
    examples: [
      {
        name: 'Secret Reader ClusterRole',
        yaml: `apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: secret-reader
rules:
- apiGroups: [""]
  resources: ["secrets"]
  verbs: ["get", "watch", "list"]`
      }
    ]
  },
  RoleBinding: {
    docUrl: 'https://kubernetes.io/docs/reference/access-authn-authz/rbac/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/authorization-resources/role-binding-v1/',
    description: 'A RoleBinding grants the permissions defined in a role to a user or set of users within a namespace.',
    examples: [
      {
        name: 'Read Pods Binding',
        yaml: `apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: read-pods
  namespace: default
subjects:
- kind: User
  name: jane
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io`
      }
    ]
  },
  ClusterRoleBinding: {
    docUrl: 'https://kubernetes.io/docs/reference/access-authn-authz/rbac/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/authorization-resources/cluster-role-binding-v1/',
    description: 'A ClusterRoleBinding grants permissions cluster-wide to a user or set of users.',
    examples: [
      {
        name: 'Read Secrets Global Binding',
        yaml: `apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: read-secrets-global
subjects:
- kind: Group
  name: manager
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: secret-reader
  apiGroup: rbac.authorization.k8s.io`
      }
    ]
  },
  StatefulSet: {
    docUrl: 'https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/stateful-set-v1/',
    description: 'StatefulSet is the workload API object used to manage stateful applications with persistent storage.',
    examples: [
      {
        name: 'Basic StatefulSet',
        yaml: `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: web
spec:
  serviceName: "nginx"
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
        - name: nginx
          image: nginx:1.21
          ports:
            - containerPort: 80`
      }
    ]
  },
  DaemonSet: {
    docUrl: 'https://kubernetes.io/docs/concepts/workloads/controllers/daemonset/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/daemon-set-v1/',
    description: 'A DaemonSet ensures that all (or some) Nodes run a copy of a Pod.',
    examples: [
      {
        name: 'Node Exporter DaemonSet',
        yaml: `apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-exporter
spec:
  selector:
    matchLabels:
      app: node-exporter
  template:
    metadata:
      labels:
        app: node-exporter
    spec:
      containers:
        - name: exporter
          image: prom/node-exporter:latest`
      }
    ]
  },
  Job: {
    docUrl: 'https://kubernetes.io/docs/concepts/workloads/controllers/job/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/job-v1/',
    description: 'A Job creates one or more Pods and ensures that a specified number of them successfully terminate.',
    examples: [
      {
        name: 'Basic Job',
        yaml: `apiVersion: batch/v1
kind: Job
metadata:
  name: pi
spec:
  template:
    spec:
      containers:
        - name: pi
          image: perl:5.34
          command: ["perl", "-Mbignum=bpi", "-wle", "print bpi(2000)"]
      restartPolicy: Never
  backoffLimit: 4`
      }
    ]
  },
  CronJob: {
    docUrl: 'https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/cron-job-v1/',
    description: 'A CronJob creates Jobs on a repeating schedule.',
    examples: [
      {
        name: 'Hourly CronJob',
        yaml: `apiVersion: batch/v1
kind: CronJob
metadata:
  name: hourly-backup
spec:
  schedule: "0 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: backup
              image: backup:latest
          restartPolicy: OnFailure`
      }
    ]
  },
  Ingress: {
    docUrl: 'https://kubernetes.io/docs/concepts/services-networking/ingress/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/service-resources/ingress-v1/',
    description: 'Ingress exposes HTTP and HTTPS routes from outside the cluster to services within the cluster.',
    examples: [
      {
        name: 'Simple Ingress',
        yaml: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: minimal-ingress
spec:
  rules:
    - host: myapp.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: myapp
                port:
                  number: 80`
      }
    ]
  },
  PersistentVolumeClaim: {
    docUrl: 'https://kubernetes.io/docs/concepts/storage/persistent-volumes/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/config-and-storage-resources/persistent-volume-claim-v1/',
    description: 'A PersistentVolumeClaim is a request for storage by a user.',
    examples: [
      {
        name: 'Basic PVC',
        yaml: `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-pvc
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi`
      }
    ]
  },
  PersistentVolume: {
    docUrl: 'https://kubernetes.io/docs/concepts/storage/persistent-volumes/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/config-and-storage-resources/persistent-volume-v1/',
    description: 'A PersistentVolume is a piece of storage in the cluster that has been provisioned by an administrator or dynamically provisioned using Storage Classes.',
    examples: [
      {
        name: 'Local PV',
        yaml: `apiVersion: v1
kind: PersistentVolume
metadata:
  name: example-pv
spec:
  capacity:
    storage: 10Gi
  volumeMode: Filesystem
  accessModes:
  - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: local-storage
  local:
    path: /mnt/disks/ssd1
  nodeAffinity:
    required:
      nodeSelectorTerms:
      - matchExpressions:
        - key: kubernetes.io/hostname
          operator: In
          values:
          - example-node`
      }
    ]
  },
  StorageClass: {
    docUrl: 'https://kubernetes.io/docs/concepts/storage/storage-classes/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/config-and-storage-resources/storage-class-v1/',
    description: 'A StorageClass provides a way for administrators to describe the "classes" of storage they offer.',
    examples: [
      {
        name: 'Standard SSD StorageClass',
        yaml: `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: standard
provisioner: kubernetes.io/aws-ebs
parameters:
  type: gp2
reclaimPolicy: Retain
allowVolumeExpansion: true
mountOptions:
  - debug
volumeBindingMode: Immediate`
      }
    ]
  },
  Namespace: {
    docUrl: 'https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/cluster-resources/namespace-v1/',
    description: 'Namespaces provide a mechanism for isolating groups of resources within a single cluster.',
    examples: [
      {
        name: 'Create Namespace',
        yaml: `apiVersion: v1
kind: Namespace
metadata:
  name: my-namespace
  labels:
    team: backend`
      }
    ]
  },
  Node: {
    docUrl: 'https://kubernetes.io/docs/concepts/architecture/nodes/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/cluster-resources/node-v1/',
    description: 'A node is a worker machine in Kubernetes, previously known as a minion.',
    examples: [
      {
        name: 'Node with labels',
        yaml: `kind: Node
apiVersion: v1
metadata:
  name: 10.240.79.157
  labels:
    kubernetes.io/hostname: 10.240.79.157
    type: worker`
      }
    ]
  },
  Event: {
    docUrl: 'https://kubernetes.io/docs/reference/kubernetes-api/cluster-resources/event-v1/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/cluster-resources/event-v1/',
    description: 'Events are a resource type in Kubernetes that provides insight into what is happening inside a cluster.',
    examples: []
  },
  Endpoints: {
    docUrl: 'https://kubernetes.io/docs/concepts/services-networking/service/#endpoints/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/service-resources/endpoints-v1/',
    description: 'Endpoints tracks the IP addresses of all the Pods that match a Service selector.',
    examples: [
      {
        name: 'Custom Endpoints',
        yaml: `apiVersion: v1
kind: Endpoints
metadata:
  name: my-service
subsets:
  - addresses:
      - ip: 192.0.2.42
    ports:
      - port: 9376`
      }
    ]
  },
  ResourceQuota: {
    docUrl: 'https://kubernetes.io/docs/concepts/policy/resource-quotas/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/policy-resources/resource-quota-v1/',
    description: 'A resource quota, defined by a ResourceQuota object, provides constraints that limit aggregate resource consumption per namespace.',
    examples: [
      {
        name: 'Compute Quota',
        yaml: `apiVersion: v1
kind: ResourceQuota
metadata:
  name: compute-resources
spec:
  hard:
    requests.cpu: "1"
    requests.memory: 1Gi
    limits.cpu: "2"
    limits.memory: 2Gi`
      }
    ]
  },
  LimitRange: {
    docUrl: 'https://kubernetes.io/docs/concepts/policy/limit-range/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/policy-resources/limit-range-v1/',
    description: 'A LimitRange is a policy to constrain resource allocations (to Pods or Containers) in a namespace.',
    examples: [
      {
        name: 'Container Limits',
        yaml: `apiVersion: v1
kind: LimitRange
metadata:
  name: cpu-min-max-demo-lr
spec:
  limits:
  - max:
      cpu: "800m"
    min:
      cpu: "200m"
    type: Container`
      }
    ]
  },
  NetworkPolicy: {
    docUrl: 'https://kubernetes.io/docs/concepts/services-networking/network-policies/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/policy-resources/network-policy-v1/',
    description: 'NetworkPolicies allow you to specify how a pod is allowed to communicate with various network entities.',
    examples: [
      {
        name: 'Deny All Ingress',
        yaml: `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all-ingress
spec:
  podSelector: {}
  policyTypes:
    - Ingress`
      }
    ]
  },
  HorizontalPodAutoscaler: {
    docUrl: 'https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/horizontal-pod-autoscaler-v2/',
    description: 'The HorizontalPodAutoscaler automatically scales the number of Pods in a workload resource.',
    examples: [
      {
        name: 'CPU-based HPA',
        yaml: `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: cpu-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: myapp
  minReplicas: 1
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50`
      }
    ]
  },
  APIService: {
    docUrl: 'https://kubernetes.io/docs/tasks/extend-kubernetes/configure-aggregation-layer/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/cluster-resources/api-service-v1/',
    description: 'APIService defines a way to register extension API servers (e.g. metrics, custom resources) into the cluster API.',
    examples: [
      {
        name: 'APIService pointing to a service',
        yaml: `apiVersion: apiregistration.k8s.io/v1
kind: APIService
metadata:
  name: v1beta1.metrics.k8s.io
spec:
  service:
    namespace: kube-system
    name: metrics-server
  group: metrics.k8s.io
  version: v1beta1
  insecureSkipTLSVerify: false`
      }
    ]
  },
  VerticalPodAutoscaler: {
    docUrl: 'https://github.com/kubernetes/autoscaler/tree/master/vertical-pod-autoscaler',
    apiRef: 'https://github.com/kubernetes/autoscaler/tree/master/vertical-pod-autoscaler',
    description: 'Vertical Pod Autoscaler (VPA) frees the users from necessity of setting up-to-date resource limits and requests for the containers in their pods.',
    examples: [
      {
        name: 'VPA Auto Mode',
        yaml: `apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: my-app-vpa
spec:
  targetRef:
    apiVersion: "apps/v1"
    kind: Deployment
    name: my-app
  updatePolicy:
    updateMode: "Auto"`
      }
    ]
  },
  PodDisruptionBudget: {
    docUrl: 'https://kubernetes.io/docs/concepts/workloads/pods/disruptions/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/policy-resources/pod-disruption-budget-v1/',
    description: 'A PDB limits the number of Pods of a replicated application that are down simultaneously from voluntary disruptions.',
    examples: [
      {
        name: 'Min Available PDB',
        yaml: `apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: zk-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: zookeeper`
      }
    ]
  },
  CustomResourceDefinition: {
    docUrl: 'https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definitions/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/extend-resources/custom-resource-definition-v1/',
    description: 'The CustomResourceDefinition API resource allows you to define custom resources.',
    examples: [
      {
        name: 'Simple CRD',
        yaml: `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: crontabs.stable.example.com
spec:
  group: stable.example.com
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                cronSpec:
                  type: string
                image:
                  type: string
                replicas:
                  type: integer
  scope: Namespaced
  names:
    plural: crontabs
    singular: crontab
    kind: CronTab
    shortNames:
    - ct`
      }
    ]
  },
  PriorityClass: {
    docUrl: 'https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/cluster-resources/priority-class-v1/',
    description: 'PriorityClass defines mapping from a priority class name to the integer value of the priority.',
    examples: [
      {
        name: 'High Priority Class',
        yaml: `apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: high-priority
value: 1000000
globalDefault: false
description: "This priority class should be used for XYZ service pods only."`
      }
    ]
  }
};

interface ResourceDocumentationProps {
  resourceKind: string;
  className?: string;
}

export function ResourceDocumentation({ resourceKind, className }: ResourceDocumentationProps) {
  const docs = K8S_DOCS[resourceKind as keyof typeof K8S_DOCS];

  const handleCopyExample = (yaml: string) => {
    navigator.clipboard.writeText(yaml);
    toast.success('Example copied to clipboard');
  };

  if (!docs) {
    return (
      <ScrollArea className={cn('h-full', className)}>
        <div className="p-6 space-y-6">
          <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed border-muted rounded-xl bg-muted/20">
            <div className="p-4 bg-background rounded-full shadow-sm mb-4">
              <BookOpen className="h-8 w-8 text-muted-foreground/60" />
            </div>
            <h2 className="text-xl font-semibold mb-2">{resourceKind} Documentation</h2>
            <p className="max-w-xs text-sm text-muted-foreground mb-8">
              Built-in documentation for this resource type is not currently available.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`https://kubernetes.io/docs/search/?q=${resourceKind}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="gap-2"
                >
                  <BookOpen className="h-4 w-4" />
                  Search K8s Docs
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
            <h4 className="text-sm font-medium text-primary mb-2">General Tips</h4>
            <ul className="text-xs text-muted-foreground space-y-1.5">
              <li>• Most resources require <code className="text-foreground bg-muted px-1 py-0.5 rounded">apiVersion</code>, <code className="text-foreground bg-muted px-1 py-0.5 rounded">kind</code>, and <code className="text-foreground bg-muted px-1 py-0.5 rounded">metadata</code></li>
              <li>• Use <code className="text-foreground bg-muted px-1 py-0.5 rounded">kubectl explain {resourceKind.toLowerCase()}</code> for CLI reference</li>
              <li>• Check for required fields in the schema editor</li>
            </ul>
          </div>
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className={cn('h-full', className)}>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            {resourceKind} Documentation
          </h2>
          <p className="text-sm text-muted-foreground mt-2">
            {docs.description}
          </p>
        </div>

        {/* Official Links */}
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" size="sm" asChild className="gap-2">
            <a href={docs.docUrl} target="_blank" rel="noopener noreferrer">
              <BookOpen className="h-4 w-4" />
              Concepts Guide
              <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild className="gap-2">
            <a href={docs.apiRef} target="_blank" rel="noopener noreferrer">
              <FileCode className="h-4 w-4" />
              API Reference
              <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
        </div>

        {/* Examples */}
        {docs.examples.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <FileCode className="h-4 w-4" />
              Examples
            </h3>

            {docs.examples.map((example, idx) => (
              <div key={idx} className="rounded-lg border border-border overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b border-border">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{example.name}</Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopyExample(example.yaml)}
                    className="h-7 gap-1.5"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </Button>
                </div>
                <pre className="p-4 text-xs font-mono overflow-x-auto bg-background">
                  <code className="text-foreground">{example.yaml}</code>
                </pre>
              </div>
            ))}
          </div>
        )}

        {/* Quick Tips */}
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
          <h4 className="text-sm font-medium text-primary mb-2">Quick Tips</h4>
          <ul className="text-xs text-muted-foreground space-y-1.5">
            <li>• Use <code className="text-foreground bg-muted px-1 py-0.5 rounded">metadata.labels</code> for organizing resources</li>
            <li>• Always specify <code className="text-foreground bg-muted px-1 py-0.5 rounded">resources.requests</code> and <code className="text-foreground bg-muted px-1 py-0.5 rounded">limits</code> where applicable</li>
            <li>• Use namespaces to isolate environments</li>
            <li>• Add descriptive names to all containers if applicable</li>
          </ul>
        </div>
      </div>
    </ScrollArea>
  );
}
