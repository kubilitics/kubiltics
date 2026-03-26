package v2

import (
	"context"

	admissionv1 "k8s.io/api/admissionregistration/v1"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	nodev1 "k8s.io/api/node/v1"
	policyv1 "k8s.io/api/policy/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	schedulingv1 "k8s.io/api/scheduling/v1"
	storagev1 "k8s.io/api/storage/v1"
)

// ResourceBundle groups all Kubernetes resources needed for topology construction (design doc 2.2).
type ResourceBundle struct {
	Pods                  []corev1.Pod
	Deployments           []appsv1.Deployment
	StatefulSets          []appsv1.StatefulSet
	DaemonSets            []appsv1.DaemonSet
	ReplicaSets           []appsv1.ReplicaSet
	Jobs                  []batchv1.Job
	CronJobs              []batchv1.CronJob
	Services              []corev1.Service
	Endpoints             []corev1.Endpoints
	EndpointSlices        []discoveryv1.EndpointSlice
	Ingresses             []networkingv1.Ingress
	IngressClasses        []networkingv1.IngressClass
	ConfigMaps            []corev1.ConfigMap
	Secrets               []corev1.Secret
	PVCs                  []corev1.PersistentVolumeClaim
	PVs                   []corev1.PersistentVolume
	StorageClasses        []storagev1.StorageClass
	Nodes                 []corev1.Node
	Namespaces            []corev1.Namespace
	ServiceAccounts       []corev1.ServiceAccount
	Roles                 []rbacv1.Role
	RoleBindings          []rbacv1.RoleBinding
	ClusterRoles          []rbacv1.ClusterRole
	ClusterRoleBindings   []rbacv1.ClusterRoleBinding
	HPAs                  []autoscalingv2.HorizontalPodAutoscaler
	PDBs                  []policyv1.PodDisruptionBudget
	NetworkPolicies       []networkingv1.NetworkPolicy
	PriorityClasses       []schedulingv1.PriorityClass
	RuntimeClasses        []nodev1.RuntimeClass
	MutatingWebhooks      []admissionv1.MutatingWebhookConfiguration
	ValidatingWebhooks    []admissionv1.ValidatingWebhookConfiguration
	Events                []corev1.Event
	ResourceQuotas        []corev1.ResourceQuota
	LimitRanges           []corev1.LimitRange
}

// Collector defines the interface for collecting resources from a cluster.
type Collector interface {
	Collect(ctx context.Context, clusterID string, namespace string) (*ResourceBundle, error)
}

