package v2

import (
	"fmt"

	admissionv1 "k8s.io/api/admissionregistration/v1"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	policyv1 "k8s.io/api/policy/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	storagev1 "k8s.io/api/storage/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
)

// NewTestFixtureBundle returns a ResourceBundle for tests (P0-05). Contains 2 Namespaces, 3 Deployments,
// 3 ReplicaSets, 9 Pods, 3 Services, 1 Ingress, 1 IngressClass, 2 ConfigMaps, 2 Secrets, 1 PVC, 1 PV,
// 1 StorageClass, 3 ServiceAccounts, 3 RoleBindings, 3 Roles, 1 HPA, 1 PDB, 1 NetworkPolicy, 3 Nodes,
// 1 Endpoints, 1 EndpointSlice, 1 MutatingWebhook, 1 ValidatingWebhook. Cross-references are valid.
func NewTestFixtureBundle() *ResourceBundle {
	nsDefault := corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "default", UID: types.UID("ns-default")}}
	nsProd := corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "production", UID: types.UID("ns-prod")}}

	depUID1 := types.UID("dep-1")
	depUID2 := types.UID("dep-2")
	depUID3 := types.UID("dep-3")
	rsUID1 := types.UID("rs-1")
	rsUID2 := types.UID("rs-2")
	rsUID3 := types.UID("rs-3")

	deployments := []appsv1.Deployment{
		{ObjectMeta: metav1.ObjectMeta{Name: "app-a", Namespace: "default", UID: depUID1}, Spec: appsv1.DeploymentSpec{Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "app-a"}}}},
		{ObjectMeta: metav1.ObjectMeta{Name: "app-b", Namespace: "default", UID: depUID2}, Spec: appsv1.DeploymentSpec{Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "app-b"}}}},
		{ObjectMeta: metav1.ObjectMeta{Name: "app-c", Namespace: "production", UID: depUID3}, Spec: appsv1.DeploymentSpec{Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "app-c"}}}},
	}
	controllerTrue := true
	replicaSets := []appsv1.ReplicaSet{
		{ObjectMeta: metav1.ObjectMeta{Name: "app-a-rs", Namespace: "default", UID: rsUID1, OwnerReferences: []metav1.OwnerReference{{UID: depUID1, Kind: "Deployment", Name: "app-a", Controller: &controllerTrue}}}, Spec: appsv1.ReplicaSetSpec{Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "app-a"}}}},
		{ObjectMeta: metav1.ObjectMeta{Name: "app-b-rs", Namespace: "default", UID: rsUID2, OwnerReferences: []metav1.OwnerReference{{UID: depUID2, Kind: "Deployment", Name: "app-b", Controller: &controllerTrue}}}, Spec: appsv1.ReplicaSetSpec{Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "app-b"}}}},
		{ObjectMeta: metav1.ObjectMeta{Name: "app-c-rs", Namespace: "production", UID: rsUID3, OwnerReferences: []metav1.OwnerReference{{UID: depUID3, Kind: "Deployment", Name: "app-c", Controller: &controllerTrue}}}, Spec: appsv1.ReplicaSetSpec{Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "app-c"}}}},
	}

	pods := make([]corev1.Pod, 0, 9)
	for i, rs := range replicaSets {
		for j := 0; j < 3; j++ {
			name := fmt.Sprintf("%s-pod-%d", rs.Name, j)
			appLabel := "app-a"
			if i == 1 {
				appLabel = "app-b"
			} else if i == 2 {
				appLabel = "app-c"
			}
			pod := corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Name: name, Namespace: rs.Namespace, UID: types.UID(name),
					OwnerReferences: []metav1.OwnerReference{{UID: rs.UID, Kind: "ReplicaSet", Name: rs.Name, Controller: &controllerTrue}},
					Labels:          map[string]string{"app": appLabel},
				},
				Spec: corev1.PodSpec{
					NodeName:            "node-1",
					ServiceAccountName:  "sa-" + rs.Namespace,
					Volumes:             []corev1.Volume{{Name: "cfg", VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{LocalObjectReference: corev1.LocalObjectReference{Name: "config-a"}}}}},
					Containers:          []corev1.Container{{Name: "c", VolumeMounts: []corev1.VolumeMount{{Name: "cfg", MountPath: "/etc/config"}}}},
				},
				Status: corev1.PodStatus{Phase: corev1.PodRunning},
			}
			if j == 0 {
				pod.Spec.Volumes = append(pod.Spec.Volumes, corev1.Volume{Name: "secret", VolumeSource: corev1.VolumeSource{Secret: &corev1.SecretVolumeSource{SecretName: "secret-a"}}})
			}
			if i == 0 && j == 0 {
				pod.Spec.Volumes = append(pod.Spec.Volumes, corev1.Volume{Name: "pvc", VolumeSource: corev1.VolumeSource{PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: "data-pvc"}}})
			}
			pods = append(pods, pod)
		}
	}

	services := []corev1.Service{
		{ObjectMeta: metav1.ObjectMeta{Name: "svc-a", Namespace: "default"}, Spec: corev1.ServiceSpec{Selector: map[string]string{"app": "app-a"}}},
		{ObjectMeta: metav1.ObjectMeta{Name: "svc-b", Namespace: "default"}, Spec: corev1.ServiceSpec{Selector: map[string]string{"app": "app-b"}}},
		{ObjectMeta: metav1.ObjectMeta{Name: "svc-c", Namespace: "production"}, Spec: corev1.ServiceSpec{Selector: map[string]string{"app": "app-c"}}},
	}
	ingressClass := networkingv1.IngressClass{ObjectMeta: metav1.ObjectMeta{Name: "nginx"}}
	pathPrefix := networkingv1.PathTypePrefix
	ingresses := []networkingv1.Ingress{
		{
			ObjectMeta: metav1.ObjectMeta{Name: "ing", Namespace: "default"},
			Spec: networkingv1.IngressSpec{
				IngressClassName: ptr("nginx"),
				Rules: []networkingv1.IngressRule{
					{
						Host: "example.com",
						IngressRuleValue: networkingv1.IngressRuleValue{
							HTTP: &networkingv1.HTTPIngressRuleValue{
								Paths: []networkingv1.HTTPIngressPath{
									{
										Path:     "/",
										PathType: &pathPrefix,
										Backend: networkingv1.IngressBackend{
											Service: &networkingv1.IngressServiceBackend{Name: "svc-a", Port: networkingv1.ServiceBackendPort{Number: 80}},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}

	configMaps := []corev1.ConfigMap{
		{ObjectMeta: metav1.ObjectMeta{Name: "config-a", Namespace: "default"}},
		{ObjectMeta: metav1.ObjectMeta{Name: "config-b", Namespace: "default"}},
	}
	secrets := []corev1.Secret{
		{ObjectMeta: metav1.ObjectMeta{Name: "secret-a", Namespace: "default"}},
		{ObjectMeta: metav1.ObjectMeta{Name: "secret-b", Namespace: "default"}},
	}
	storageClass := storagev1.StorageClass{ObjectMeta: metav1.ObjectMeta{Name: "gp3"}}
	pv := corev1.PersistentVolume{
		ObjectMeta: metav1.ObjectMeta{Name: "pv-1", UID: types.UID("pv-1")},
		Spec:      corev1.PersistentVolumeSpec{StorageClassName: "gp3", ClaimRef: &corev1.ObjectReference{Namespace: "default", Name: "data-pvc"}},
		Status:    corev1.PersistentVolumeStatus{Phase: corev1.VolumeBound},
	}
	pvcs := []corev1.PersistentVolumeClaim{{
		ObjectMeta: metav1.ObjectMeta{Name: "data-pvc", Namespace: "default"},
		Spec:      corev1.PersistentVolumeClaimSpec{StorageClassName: ptr("gp3")},
		Status:    corev1.PersistentVolumeClaimStatus{Phase: corev1.ClaimBound},
	}}

	serviceAccounts := []corev1.ServiceAccount{
		{ObjectMeta: metav1.ObjectMeta{Name: "sa-default", Namespace: "default"}},
		{ObjectMeta: metav1.ObjectMeta{Name: "sa-production", Namespace: "production"}},
		{ObjectMeta: metav1.ObjectMeta{Name: "default", Namespace: "default"}},
	}
	roles := []rbacv1.Role{
		{ObjectMeta: metav1.ObjectMeta{Name: "role-a", Namespace: "default"}},
		{ObjectMeta: metav1.ObjectMeta{Name: "role-b", Namespace: "default"}},
		{ObjectMeta: metav1.ObjectMeta{Name: "role-c", Namespace: "production"}},
	}
	roleBindings := []rbacv1.RoleBinding{
		{ObjectMeta: metav1.ObjectMeta{Name: "rb-a", Namespace: "default"}, RoleRef: rbacv1.RoleRef{Kind: "Role", Name: "role-a"}, Subjects: []rbacv1.Subject{{Kind: "ServiceAccount", Name: "sa-default", Namespace: "default"}}},
		{ObjectMeta: metav1.ObjectMeta{Name: "rb-b", Namespace: "default"}, RoleRef: rbacv1.RoleRef{Kind: "Role", Name: "role-b"}, Subjects: []rbacv1.Subject{{Kind: "ServiceAccount", Name: "default", Namespace: "default"}}},
		{ObjectMeta: metav1.ObjectMeta{Name: "rb-c", Namespace: "production"}, RoleRef: rbacv1.RoleRef{Kind: "Role", Name: "role-c"}, Subjects: []rbacv1.Subject{{Kind: "ServiceAccount", Name: "sa-production", Namespace: "production"}}},
	}

	hpa := autoscalingv2.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{Name: "hpa-a", Namespace: "default"},
		Spec:       autoscalingv2.HorizontalPodAutoscalerSpec{ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{Kind: "Deployment", Name: "app-a"}},
	}
	pdb := policyv1.PodDisruptionBudget{
		ObjectMeta: metav1.ObjectMeta{Name: "pdb-a", Namespace: "default"},
		Spec:       policyv1.PodDisruptionBudgetSpec{Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "app-a"}}, MinAvailable: &intstr.IntOrString{Type: intstr.Int, IntVal: 2}},
	}
	np := networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{Name: "allow-a", Namespace: "default"},
		Spec:       networkingv1.NetworkPolicySpec{PodSelector: metav1.LabelSelector{MatchLabels: map[string]string{"app": "app-a"}}},
	}

	nodes := []corev1.Node{
		{ObjectMeta: metav1.ObjectMeta{Name: "node-1"}, Status: corev1.NodeStatus{Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}}}},
		{ObjectMeta: metav1.ObjectMeta{Name: "node-2"}, Status: corev1.NodeStatus{Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}}}},
		{ObjectMeta: metav1.ObjectMeta{Name: "node-3"}, Status: corev1.NodeStatus{Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}}}},
	}

	endpoints := []corev1.Endpoints{{
		ObjectMeta: metav1.ObjectMeta{Name: "svc-a", Namespace: "default"},
		Subsets:   []corev1.EndpointSubset{{Addresses: []corev1.EndpointAddress{{TargetRef: &corev1.ObjectReference{Kind: "Pod", Namespace: "default", Name: "app-a-rs-pod-0"}}}}},
	}}
	endpointSlices := []discoveryv1.EndpointSlice{{
		ObjectMeta: metav1.ObjectMeta{Name: "svc-a-xyz", Namespace: "default", Labels: map[string]string{"kubernetes.io/service-name": "svc-a"}},
		Endpoints:  []discoveryv1.Endpoint{{TargetRef: &corev1.ObjectReference{Kind: "Pod", Namespace: "default", Name: "app-a-rs-pod-0"}}},
	}}

	mutatingWebhook := admissionv1.MutatingWebhookConfiguration{
		ObjectMeta: metav1.ObjectMeta{Name: "webhook-mutate"},
		Webhooks:   []admissionv1.MutatingWebhook{{Name: "w", ClientConfig: admissionv1.WebhookClientConfig{Service: &admissionv1.ServiceReference{Namespace: "default", Name: "svc-a"}}}},
	}
	validatingWebhook := admissionv1.ValidatingWebhookConfiguration{
		ObjectMeta: metav1.ObjectMeta{Name: "webhook-validate"},
		Webhooks:   []admissionv1.ValidatingWebhook{{Name: "w", ClientConfig: admissionv1.WebhookClientConfig{Service: &admissionv1.ServiceReference{Namespace: "default", Name: "svc-a"}}}},
	}

	return &ResourceBundle{
		Pods:               pods,
		Deployments:        deployments,
		ReplicaSets:        replicaSets,
		Services:           services,
		Endpoints:          endpoints,
		EndpointSlices:     endpointSlices,
		Ingresses:          ingresses,
		IngressClasses:     []networkingv1.IngressClass{ingressClass},
		ConfigMaps:         configMaps,
		Secrets:            secrets,
		PVCs:               pvcs,
		PVs:                []corev1.PersistentVolume{pv},
		StorageClasses:     []storagev1.StorageClass{storageClass},
		Nodes:              nodes,
		Namespaces:         []corev1.Namespace{nsDefault, nsProd},
		ServiceAccounts:    serviceAccounts,
		Roles:              roles,
		RoleBindings:       roleBindings,
		HPAs:               []autoscalingv2.HorizontalPodAutoscaler{hpa},
		PDBs:               []policyv1.PodDisruptionBudget{pdb},
		NetworkPolicies:    []networkingv1.NetworkPolicy{np},
		MutatingWebhooks:   []admissionv1.MutatingWebhookConfiguration{mutatingWebhook},
		ValidatingWebhooks: []admissionv1.ValidatingWebhookConfiguration{validatingWebhook},
	}
}

func ptr[T any](v T) *T { return &v }
