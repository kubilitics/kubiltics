// ControllerMetricsResolver resolves a workload identity to the set of pods whose
// metrics should be aggregated. Controllers (ReplicaSet, Deployment, etc.) do not
// emit metrics; we aggregate from owned pods and avoid double-counting.
package metrics

import (
	"context"
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// PodRef identifies a single pod for metrics aggregation.
type PodRef struct {
	Namespace string
	Name      string
}

// ControllerMetricsResolver resolves ResourceIdentity to the list of pods to aggregate.
// For pod/node/namespace the caller does not use this; for controllers it returns
// the set of pods that belong to the workload (by selector or ownerReferences).
type ControllerMetricsResolver struct{}

// NewControllerMetricsResolver returns the default resolver.
func NewControllerMetricsResolver() *ControllerMetricsResolver {
	return &ControllerMetricsResolver{}
}

// ResolvePods returns the list of pods whose metrics should be summed for the given identity.
// Returns nil, nil if identity is not a controller type (caller should use provider for single pod/node).
func (r *ControllerMetricsResolver) ResolvePods(ctx context.Context, client *k8s.Client, id models.ResourceIdentity) ([]PodRef, error) {
	if !id.ResourceType.IsController() {
		return nil, nil
	}
	switch id.ResourceType {
	case models.ResourceTypeReplicaSet:
		return r.resolveReplicaSetPods(ctx, client, id.Namespace, id.ResourceName)
	case models.ResourceTypeDeployment:
		return r.resolveDeploymentPods(ctx, client, id.Namespace, id.ResourceName)
	case models.ResourceTypeStatefulSet:
		return r.resolveStatefulSetPods(ctx, client, id.Namespace, id.ResourceName)
	case models.ResourceTypeDaemonSet:
		return r.resolveDaemonSetPods(ctx, client, id.Namespace, id.ResourceName)
	case models.ResourceTypeJob:
		return r.resolveJobPods(ctx, client, id.Namespace, id.ResourceName)
	case models.ResourceTypeCronJob:
		return r.resolveCronJobPods(ctx, client, id.Namespace, id.ResourceName)
	default:
		return nil, nil
	}
}

func (r *ControllerMetricsResolver) resolveReplicaSetPods(ctx context.Context, client *k8s.Client, namespace, name string) ([]PodRef, error) {
	rs, err := client.Clientset.AppsV1().ReplicaSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("replicaset not found: %w", err)
	}
	sel, err := metav1.LabelSelectorAsSelector(rs.Spec.Selector)
	if err != nil {
		return nil, fmt.Errorf("invalid replicaset selector: %w", err)
	}
	list, err := client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: sel.String()})
	if err != nil {
		return nil, fmt.Errorf("list replicaset pods: %w", err)
	}
	return podListToRefs(list.Items), nil
}

func (r *ControllerMetricsResolver) resolveDeploymentPods(ctx context.Context, client *k8s.Client, namespace, name string) ([]PodRef, error) {
	dep, err := client.Clientset.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("deployment not found: %w", err)
	}
	sel, err := metav1.LabelSelectorAsSelector(dep.Spec.Selector)
	if err != nil {
		return nil, fmt.Errorf("invalid deployment selector: %w", err)
	}
	list, err := client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: sel.String()})
	if err != nil {
		return nil, fmt.Errorf("list deployment pods: %w", err)
	}
	return podListToRefs(list.Items), nil
}

func (r *ControllerMetricsResolver) resolveStatefulSetPods(ctx context.Context, client *k8s.Client, namespace, name string) ([]PodRef, error) {
	sts, err := client.Clientset.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("statefulset not found: %w", err)
	}
	sel, err := metav1.LabelSelectorAsSelector(sts.Spec.Selector)
	if err != nil {
		return nil, fmt.Errorf("invalid statefulset selector: %w", err)
	}
	list, err := client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: sel.String()})
	if err != nil {
		return nil, fmt.Errorf("list statefulset pods: %w", err)
	}
	return podListToRefs(list.Items), nil
}

func (r *ControllerMetricsResolver) resolveDaemonSetPods(ctx context.Context, client *k8s.Client, namespace, name string) ([]PodRef, error) {
	ds, err := client.Clientset.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("daemonset not found: %w", err)
	}
	sel, err := metav1.LabelSelectorAsSelector(ds.Spec.Selector)
	if err != nil {
		return nil, fmt.Errorf("invalid daemonset selector: %w", err)
	}
	list, err := client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: sel.String()})
	if err != nil {
		return nil, fmt.Errorf("list daemonset pods: %w", err)
	}
	return podListToRefs(list.Items), nil
}

func (r *ControllerMetricsResolver) resolveJobPods(ctx context.Context, client *k8s.Client, namespace, name string) ([]PodRef, error) {
	job, err := client.Clientset.BatchV1().Jobs(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("job not found: %w", err)
	}
	selector := metav1.FormatLabelSelector(&metav1.LabelSelector{MatchLabels: map[string]string{"job-name": job.Name}})
	list, err := client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, fmt.Errorf("list job pods: %w", err)
	}
	return podListToRefs(list.Items), nil
}

func (r *ControllerMetricsResolver) resolveCronJobPods(ctx context.Context, client *k8s.Client, namespace, name string) ([]PodRef, error) {
	_, err := client.Clientset.BatchV1().CronJobs(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("cronjob not found: %w", err)
	}
	jobList, err := client.Clientset.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list jobs: %w", err)
	}
	var pods []corev1.Pod
	for i := range jobList.Items {
		job := &jobList.Items[i]
		owner := metav1.GetControllerOf(job)
		if owner == nil || owner.Kind != "CronJob" || owner.Name != name {
			continue
		}
		selector := metav1.FormatLabelSelector(&metav1.LabelSelector{MatchLabels: map[string]string{"job-name": job.Name}})
		podList, err := client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
		if err != nil {
			continue
		}
		pods = append(pods, podList.Items...)
	}
	return podListToRefs(pods), nil
}

func podListToRefs(items []corev1.Pod) []PodRef {
	out := make([]PodRef, 0, len(items))
	for _, p := range items {
		out = append(out, PodRef{Namespace: p.Namespace, Name: p.Name})
	}
	return out
}
