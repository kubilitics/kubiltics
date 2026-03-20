package v2

import (
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

// FixtureOptions configures the large fixture generator.
type FixtureOptions struct {
	Namespaces    int // default: 5
	Deployments   int // default: 50
	PodsPerDeploy int // default: 3
	Services      int // default: 50
	ConfigMaps    int // default: 20
	Secrets       int // default: 20
	Nodes         int // default: 10
}

// DefaultFixtureOptions returns sensible defaults for benchmarking.
func DefaultFixtureOptions() FixtureOptions {
	return FixtureOptions{
		Namespaces:    5,
		Deployments:   50,
		PodsPerDeploy: 3,
		Services:      50,
		ConfigMaps:    20,
		Secrets:       20,
		Nodes:         10,
	}
}

// NewLargeFixture generates a parameterized ResourceBundle for performance benchmarks.
// All cross-references are valid at any scale.
func NewLargeFixture(opts FixtureOptions) *ResourceBundle {
	if opts.Namespaces == 0 {
		opts = DefaultFixtureOptions()
	}

	bundle := &ResourceBundle{}

	// Create namespaces
	namespaces := make([]string, opts.Namespaces)
	for i := 0; i < opts.Namespaces; i++ {
		nsName := fmt.Sprintf("ns-%d", i)
		namespaces[i] = nsName
		bundle.Namespaces = append(bundle.Namespaces, corev1.Namespace{
			ObjectMeta: metav1.ObjectMeta{
				Name: nsName,
				UID:  types.UID(fmt.Sprintf("ns-uid-%d", i)),
			},
		})
	}

	// Create nodes
	for i := 0; i < opts.Nodes; i++ {
		bundle.Nodes = append(bundle.Nodes, corev1.Node{
			ObjectMeta: metav1.ObjectMeta{
				Name: fmt.Sprintf("node-%d", i),
				UID:  types.UID(fmt.Sprintf("node-uid-%d", i)),
			},
			Status: corev1.NodeStatus{
				Conditions: []corev1.NodeCondition{
					{Type: corev1.NodeReady, Status: corev1.ConditionTrue},
				},
			},
		})
	}

	// Create configmaps and secrets distributed across namespaces
	for i := 0; i < opts.ConfigMaps; i++ {
		ns := namespaces[i%opts.Namespaces]
		bundle.ConfigMaps = append(bundle.ConfigMaps, corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{
				Name:      fmt.Sprintf("cm-%d", i),
				Namespace: ns,
				UID:       types.UID(fmt.Sprintf("cm-uid-%d", i)),
			},
		})
	}

	for i := 0; i < opts.Secrets; i++ {
		ns := namespaces[i%opts.Namespaces]
		bundle.Secrets = append(bundle.Secrets, corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      fmt.Sprintf("secret-%d", i),
				Namespace: ns,
				UID:       types.UID(fmt.Sprintf("secret-uid-%d", i)),
			},
		})
	}

	// Create deployments, replicasets, pods, and services
	replicas := int32(opts.PodsPerDeploy)
	for i := 0; i < opts.Deployments; i++ {
		ns := namespaces[i%opts.Namespaces]
		depName := fmt.Sprintf("deploy-%d", i)
		depUID := types.UID(fmt.Sprintf("dep-uid-%d", i))
		rsName := fmt.Sprintf("rs-%d", i)
		rsUID := types.UID(fmt.Sprintf("rs-uid-%d", i))

		labels := map[string]string{
			"app":  depName,
			"tier": "backend",
		}

		// Deployment
		bundle.Deployments = append(bundle.Deployments, appsv1.Deployment{
			ObjectMeta: metav1.ObjectMeta{
				Name:      depName,
				Namespace: ns,
				UID:       depUID,
				Labels:    labels,
			},
			Spec: appsv1.DeploymentSpec{
				Replicas: &replicas,
				Selector: &metav1.LabelSelector{MatchLabels: labels},
			},
			Status: appsv1.DeploymentStatus{
				Replicas:          replicas,
				ReadyReplicas:     replicas,
				AvailableReplicas: replicas,
			},
		})

		// ReplicaSet
		bundle.ReplicaSets = append(bundle.ReplicaSets, appsv1.ReplicaSet{
			ObjectMeta: metav1.ObjectMeta{
				Name:      rsName,
				Namespace: ns,
				UID:       rsUID,
				Labels:    labels,
				OwnerReferences: []metav1.OwnerReference{
					{APIVersion: "apps/v1", Kind: "Deployment", Name: depName, UID: depUID},
				},
			},
			Spec: appsv1.ReplicaSetSpec{
				Replicas: &replicas,
				Selector: &metav1.LabelSelector{MatchLabels: labels},
			},
		})

		// Pods
		for j := 0; j < opts.PodsPerDeploy; j++ {
			podName := fmt.Sprintf("pod-%d-%d", i, j)
			nodeIdx := (i*opts.PodsPerDeploy + j) % opts.Nodes
			cmIdx := i % opts.ConfigMaps

			bundle.Pods = append(bundle.Pods, corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Name:      podName,
					Namespace: ns,
					UID:       types.UID(fmt.Sprintf("pod-uid-%d-%d", i, j)),
					Labels:    labels,
					OwnerReferences: []metav1.OwnerReference{
						{APIVersion: "apps/v1", Kind: "ReplicaSet", Name: rsName, UID: rsUID},
					},
				},
				Spec: corev1.PodSpec{
					NodeName: fmt.Sprintf("node-%d", nodeIdx),
					Containers: []corev1.Container{
						{
							Name:  "app",
							Image: fmt.Sprintf("image-%d:latest", i),
							VolumeMounts: []corev1.VolumeMount{
								{Name: "config", MountPath: "/etc/config"},
							},
						},
					},
					Volumes: []corev1.Volume{
						{
							Name: "config",
							VolumeSource: corev1.VolumeSource{
								ConfigMap: &corev1.ConfigMapVolumeSource{
									LocalObjectReference: corev1.LocalObjectReference{
										Name: fmt.Sprintf("cm-%d", cmIdx),
									},
								},
							},
						},
					},
				},
				Status: corev1.PodStatus{
					Phase: corev1.PodRunning,
					Conditions: []corev1.PodCondition{
						{Type: corev1.ContainersReady, Status: corev1.ConditionTrue},
					},
				},
			})
		}

		// Service (one per deployment, up to opts.Services)
		if i < opts.Services {
			bundle.Services = append(bundle.Services, corev1.Service{
				ObjectMeta: metav1.ObjectMeta{
					Name:      fmt.Sprintf("svc-%d", i),
					Namespace: ns,
					UID:       types.UID(fmt.Sprintf("svc-uid-%d", i)),
				},
				Spec: corev1.ServiceSpec{
					Selector: labels,
					Type:     corev1.ServiceTypeClusterIP,
					Ports: []corev1.ServicePort{
						{Port: 8080, Protocol: corev1.ProtocolTCP},
					},
				},
			})
		}
	}

	return bundle
}

// TotalResourceCount returns the total number of resources in a FixtureOptions config.
func (opts FixtureOptions) TotalResourceCount() int {
	return opts.Namespaces + opts.Nodes + opts.ConfigMaps + opts.Secrets +
		opts.Deployments + opts.Deployments + // RS = 1 per deploy
		opts.Deployments*opts.PodsPerDeploy + opts.Services
}
