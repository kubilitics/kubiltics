// Package informer provides a SharedInformerFactory-backed resource cache
// for the kcli TUI. It replaces the 2-second kubectl-subprocess polling loop
// with a Kubernetes Watch API push model: when a resource changes, the
// informer pushes a signal on a lightweight channel, and the TUI reads the
// current snapshot from the in-memory cache with zero API calls.
//
// For clusters with 10 000+ pods, this reduces steady-state API load from
// O(resources/2s) full List calls to O(changes) Watch events — typically
// 10-100× fewer round-trips in a stable cluster.
package informer

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	v1 "k8s.io/api/core/v1"
	netv1 "k8s.io/api/networking/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/cache"
)

// Store manages a SharedInformerFactory and exposes:
//   - NotifyCh(kubectlType) — a channel that receives struct{}{} when a
//     resource of that type changes (buffered 1, non-blocking send).
//   - SnapshotLines(kubectlType, namespace) — the current resource snapshot
//     as text lines formatted identically to `kubectl get <type> --no-headers`,
//     so the existing TUI ParseLine functions work without modification.
type Store struct {
	factory   informers.SharedInformerFactory
	namespace string // "" = all namespaces

	notifyMu  sync.RWMutex
	notifyChs map[string]chan struct{} // keyed by kubectlType

	stopCh chan struct{}
	once   sync.Once
}

// New creates a Store. namespace may be "" for all-namespaces.
// resync is the period between full re-list syncs (0 = disabled).
func New(clientset kubernetes.Interface, namespace string, resync time.Duration) *Store {
	var factory informers.SharedInformerFactory
	if namespace == "" {
		factory = informers.NewSharedInformerFactory(clientset, resync)
	} else {
		factory = informers.NewSharedInformerFactoryWithOptions(
			clientset, resync,
			informers.WithNamespace(namespace),
		)
	}
	return &Store{
		factory:   factory,
		namespace: namespace,
		notifyChs: make(map[string]chan struct{}),
		stopCh:    make(chan struct{}),
	}
}

// Start registers informers for all supported resource types, starts them,
// and waits for the initial cache sync. Returns an error if ctx is cancelled
// before sync completes (e.g. cluster unreachable within the timeout).
func (s *Store) Start(ctx context.Context) error {
	s.registerAll()
	s.factory.Start(s.stopCh)
	synced := s.factory.WaitForCacheSync(ctx.Done())
	for _, ok := range synced {
		if !ok {
			return fmt.Errorf("informer cache sync failed or timed out")
		}
	}
	return nil
}

// Stop shuts down the background informer goroutines. Safe to call multiple times.
func (s *Store) Stop() {
	s.once.Do(func() { close(s.stopCh) })
}

// NotifyCh returns the notification channel for the given kubectlType.
// A struct{}{} is sent (non-blocking) whenever a resource of that type
// is added, updated, or deleted. The channel is buffered with size 1:
// if the TUI has not consumed the previous signal yet, the new one is
// dropped (the pending signal already triggers a re-render).
func (s *Store) NotifyCh(kubectlType string) <-chan struct{} {
	s.notifyMu.Lock()
	defer s.notifyMu.Unlock()
	ch, ok := s.notifyChs[kubectlType]
	if !ok {
		ch = make(chan struct{}, 1)
		s.notifyChs[kubectlType] = ch
	}
	return ch
}

func (s *Store) notify(kubectlType string) {
	s.notifyMu.RLock()
	ch := s.notifyChs[kubectlType]
	s.notifyMu.RUnlock()
	if ch == nil {
		return
	}
	select {
	case ch <- struct{}{}:
	default: // already pending, skip
	}
}

// SnapshotLines returns the current cache snapshot as whitespace-separated
// text lines compatible with the TUI's ParseLine functions.
// namespace "" means all namespaces (produces lines with namespace as first field).
func (s *Store) SnapshotLines(kubectlType, namespace string) ([]string, error) {
	switch kubectlType {
	case "pods":
		return s.podLines(namespace)
	case "deployments":
		return s.deploymentLines(namespace)
	case "services":
		return s.serviceLines(namespace)
	case "nodes":
		return s.nodeLines()
	case "events":
		return s.eventLines(namespace)
	case "namespaces":
		return s.namespaceLines()
	case "ingresses":
		return s.ingressLines(namespace)
	case "configmaps":
		return s.configMapLines(namespace)
	case "secrets":
		return s.secretLines(namespace)
	case "pvc":
		return s.pvcLines(namespace)
	case "jobs":
		return s.jobLines(namespace)
	case "cronjobs":
		return s.cronJobLines(namespace)
	case "replicasets":
		return s.replicaSetLines(namespace)
	case "endpoints":
		return s.endpointLines(namespace)
	case "statefulsets":
		return s.statefulSetLines(namespace)
	case "daemonsets":
		return s.daemonSetLines(namespace)
	case "serviceaccounts":
		return s.serviceAccountLines(namespace)
	case "roles":
		return s.roleLines(namespace)
	case "rolebindings":
		return s.roleBindingLines(namespace)
	default:
		return nil, fmt.Errorf("unsupported resource type %q", kubectlType)
	}
}

// registerAll registers informers and event handlers for every resource type
// supported by the TUI.
func (s *Store) registerAll() {
	withType := func(t string) cache.ResourceEventHandlerFuncs {
		return cache.ResourceEventHandlerFuncs{
			AddFunc:    func(_ any) { s.notify(t) },
			UpdateFunc: func(_, _ any) { s.notify(t) },
			DeleteFunc: func(_ any) { s.notify(t) },
		}
	}
	s.factory.Core().V1().Pods().Informer().AddEventHandler(withType("pods"))
	s.factory.Apps().V1().Deployments().Informer().AddEventHandler(withType("deployments"))
	s.factory.Core().V1().Services().Informer().AddEventHandler(withType("services"))
	s.factory.Core().V1().Nodes().Informer().AddEventHandler(withType("nodes"))
	s.factory.Core().V1().Events().Informer().AddEventHandler(withType("events"))
	s.factory.Core().V1().Namespaces().Informer().AddEventHandler(withType("namespaces"))
	s.factory.Networking().V1().Ingresses().Informer().AddEventHandler(withType("ingresses"))
	s.factory.Core().V1().ConfigMaps().Informer().AddEventHandler(withType("configmaps"))
	s.factory.Core().V1().Secrets().Informer().AddEventHandler(withType("secrets"))
	s.factory.Core().V1().PersistentVolumeClaims().Informer().AddEventHandler(withType("pvc"))
	s.factory.Batch().V1().Jobs().Informer().AddEventHandler(withType("jobs"))
	s.factory.Batch().V1().CronJobs().Informer().AddEventHandler(withType("cronjobs"))
	s.factory.Apps().V1().ReplicaSets().Informer().AddEventHandler(withType("replicasets"))
	s.factory.Core().V1().Endpoints().Informer().AddEventHandler(withType("endpoints"))
	s.factory.Apps().V1().StatefulSets().Informer().AddEventHandler(withType("statefulsets"))
	s.factory.Apps().V1().DaemonSets().Informer().AddEventHandler(withType("daemonsets"))
	s.factory.Core().V1().ServiceAccounts().Informer().AddEventHandler(withType("serviceaccounts"))
	s.factory.Rbac().V1().Roles().Informer().AddEventHandler(withType("roles"))
	s.factory.Rbac().V1().RoleBindings().Informer().AddEventHandler(withType("rolebindings"))
}

// ---- Helpers ----------------------------------------------------------------

// FormatAge formats a creation time as a compact human-readable age.
func FormatAge(t time.Time) string {
	if t.IsZero() {
		return "<unknown>"
	}
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd", int(d.Hours()/24))
	}
}

// formatDuration formats a duration as a compact string (used for Job durations).
func formatDuration(d time.Duration) string {
	if d < 0 {
		d = 0
	}
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	default:
		return fmt.Sprintf("%dh", int(d.Hours()))
	}
}

// safeField ensures a string is a single whitespace-free token.
// Empty strings are replaced with placeholder, internal spaces with underscores.
func safeField(s, placeholder string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return placeholder
	}
	return strings.ReplaceAll(s, " ", "_")
}

// ---- Pods -------------------------------------------------------------------

func (s *Store) podLines(namespace string) ([]string, error) {
	lister := s.factory.Core().V1().Pods().Lister()
	var pods []*v1.Pod
	var err error
	if namespace == "" {
		pods, err = lister.List(labels.Everything())
	} else {
		pods, err = lister.Pods(namespace).List(labels.Everything())
	}
	if err != nil {
		return nil, err
	}
	lines := make([]string, 0, len(pods))
	for _, pod := range pods {
		lines = append(lines, PodLine(pod, namespace == ""))
	}
	return lines, nil
}

// PodLine formats a pod as a space-separated line matching parsePodsLine.
// All-namespaces format (parsePodsLine picks f[0]=ns,f[1]=name,f[2]=ready,
// f[3]=status,f[4]=restarts,f[5]=age,f[7]=node):
//
//	ns name ready status restarts age ip node nominatedNode readinessGates
//
// Namespaced format (picks f[0]=name,f[1]=ready,f[2]=status,f[3]=restarts,
// f[4]=age,f[6]=node):
//
//	name ready status restarts age ip node
func PodLine(pod *v1.Pod, allNs bool) string {
	ready, total := 0, len(pod.Spec.Containers)
	var restarts int32
	for _, cs := range pod.Status.ContainerStatuses {
		if cs.Ready {
			ready++
		}
		restarts += cs.RestartCount
	}
	status := safeField(string(pod.Status.Phase), "Unknown")
	podIP := safeField(pod.Status.PodIP, "<none>")
	nodeName := safeField(pod.Spec.NodeName, "<none>")
	age := FormatAge(pod.CreationTimestamp.Time)
	readyStr := fmt.Sprintf("%d/%d", ready, total)

	if allNs {
		// f[7] = node; 10 fields total
		return fmt.Sprintf("%s %s %s %s %d %s %s %s <none> <0>",
			pod.Namespace, pod.Name, readyStr, status, restarts, age, podIP, nodeName)
	}
	// f[6] = node; 7 fields total
	return fmt.Sprintf("%s %s %s %d %s %s %s",
		pod.Name, readyStr, status, restarts, age, podIP, nodeName)
}

// ---- Deployments ------------------------------------------------------------

func (s *Store) deploymentLines(namespace string) ([]string, error) {
	lister := s.factory.Apps().V1().Deployments().Lister()
	var items []*appsv1.Deployment
	var err error
	if namespace == "" {
		items, err = lister.List(labels.Everything())
	} else {
		items, err = lister.Deployments(namespace).List(labels.Everything())
	}
	if err != nil {
		return nil, err
	}
	lines := make([]string, 0, len(items))
	for _, d := range items {
		lines = append(lines, DeploymentLine(d, namespace == ""))
	}
	return lines, nil
}

// DeploymentLine formats a deployment matching parseDeploymentsLine.
// All-ns (f[0]=ns,f[1]=name,f[2]=ready,f[3]=upToDate,f[4]=available,f[5]=age):
//
//	ns name ready upToDate available age
//
// Namespaced (f[0]=name,f[1]=ready,f[2]=upToDate,f[3]=available,f[4]=age):
//
//	name ready upToDate available age
func DeploymentLine(d *appsv1.Deployment, allNs bool) string {
	ready := d.Status.ReadyReplicas
	total := d.Status.Replicas
	upToDate := d.Status.UpdatedReplicas
	available := d.Status.AvailableReplicas
	age := FormatAge(d.CreationTimestamp.Time)
	readyStr := fmt.Sprintf("%d/%d", ready, total)

	if allNs {
		return fmt.Sprintf("%s %s %s %d %d %s", d.Namespace, d.Name, readyStr, upToDate, available, age)
	}
	return fmt.Sprintf("%s %s %d %d %s", d.Name, readyStr, upToDate, available, age)
}

// ---- Services ---------------------------------------------------------------

func (s *Store) serviceLines(namespace string) ([]string, error) {
	lister := s.factory.Core().V1().Services().Lister()
	var items []*v1.Service
	var err error
	if namespace == "" {
		items, err = lister.List(labels.Everything())
	} else {
		items, err = lister.Services(namespace).List(labels.Everything())
	}
	if err != nil {
		return nil, err
	}
	lines := make([]string, 0, len(items))
	for _, svc := range items {
		lines = append(lines, ServiceLine(svc, namespace == ""))
	}
	return lines, nil
}

// ServiceLine formats a service matching parseServicesLine.
// All-ns (ns,name,type,clusterip,[externalip skipped],ports,age):
//
//	ns name type clusterip externalip ports age
//
// Namespaced (name,type,clusterip,[externalip skipped],ports,age):
//
//	name type clusterip externalip ports age
func ServiceLine(svc *v1.Service, allNs bool) string {
	svcType := safeField(string(svc.Spec.Type), "ClusterIP")
	clusterIP := safeField(svc.Spec.ClusterIP, "<none>")
	externalIP := "<none>"
	if len(svc.Status.LoadBalancer.Ingress) > 0 {
		if ip := svc.Status.LoadBalancer.Ingress[0].IP; ip != "" {
			externalIP = ip
		} else if h := svc.Status.LoadBalancer.Ingress[0].Hostname; h != "" {
			externalIP = h
		}
	}
	portParts := make([]string, 0, len(svc.Spec.Ports))
	for _, p := range svc.Spec.Ports {
		portParts = append(portParts, fmt.Sprintf("%d/%s", p.Port, p.Protocol))
	}
	portStr := "<none>"
	if len(portParts) > 0 {
		portStr = strings.Join(portParts, ",")
	}
	age := FormatAge(svc.CreationTimestamp.Time)

	if allNs {
		return fmt.Sprintf("%s %s %s %s %s %s %s",
			svc.Namespace, svc.Name, svcType, clusterIP, externalIP, portStr, age)
	}
	return fmt.Sprintf("%s %s %s %s %s %s",
		svc.Name, svcType, clusterIP, externalIP, portStr, age)
}

// ---- Nodes ------------------------------------------------------------------

func (s *Store) nodeLines() ([]string, error) {
	nodes, err := s.factory.Core().V1().Nodes().Lister().List(labels.Everything())
	if err != nil {
		return nil, err
	}
	lines := make([]string, 0, len(nodes))
	for _, node := range nodes {
		lines = append(lines, NodeLine(node))
	}
	return lines, nil
}

// NodeLine formats a node matching parseNodesLine (f[0]=name,f[1]=status,f[2]=roles,f[3]=age,f[4]=version).
func NodeLine(node *v1.Node) string {
	status := "NotReady"
	for _, cond := range node.Status.Conditions {
		if cond.Type == v1.NodeReady && cond.Status == v1.ConditionTrue {
			status = "Ready"
			break
		}
	}
	roles := []string{}
	for k := range node.Labels {
		if strings.HasPrefix(k, "node-role.kubernetes.io/") {
			role := strings.TrimPrefix(k, "node-role.kubernetes.io/")
			if role != "" {
				roles = append(roles, role)
			}
		}
	}
	if len(roles) == 0 {
		roles = []string{"<none>"}
	}
	rolesStr := strings.Join(roles, ",")
	age := FormatAge(node.CreationTimestamp.Time)
	version := safeField(node.Status.NodeInfo.KubeletVersion, "<unknown>")
	return fmt.Sprintf("%s %s %s %s %s", node.Name, status, rolesStr, age, version)
}

// ---- Events -----------------------------------------------------------------

func (s *Store) eventLines(namespace string) ([]string, error) {
	lister := s.factory.Core().V1().Events().Lister()
	var items []*v1.Event
	var err error
	if namespace == "" {
		items, err = lister.List(labels.Everything())
	} else {
		items, err = lister.Events(namespace).List(labels.Everything())
	}
	if err != nil {
		return nil, err
	}
	lines := make([]string, 0, len(items))
	for _, ev := range items {
		lines = append(lines, EventLine(ev, namespace == ""))
	}
	return lines, nil
}

// EventLine formats an event matching parseEventsLine.
// parseEventsLine uses relative positions from the END of the field list:
//
//	f[len-2]=obj, f[len-3]=reason, f[len-4]=typ
//
// All-ns (also uses f[0]=ns, f[1]=age; picks 5 fields from front+back):
//
//	ns age typ reason obj x   →  6 fields; len-4=2=typ ✓
//
// Namespaced (also uses f[0]=age):
//
//	age typ reason obj x      →  5 fields; len-4=1=typ ✓
func EventLine(ev *v1.Event, allNs bool) string {
	t := ev.LastTimestamp.Time
	if t.IsZero() {
		t = ev.CreationTimestamp.Time
	}
	age := FormatAge(t)
	typ := safeField(ev.Type, "Normal")
	reason := safeField(ev.Reason, "Unknown")
	obj := safeField(ev.InvolvedObject.Kind+"/"+ev.InvolvedObject.Name, "unknown/unknown")
	ns := safeField(ev.Namespace, "default")

	if allNs {
		// 6 fields: ns(0) age(1) typ(2) reason(3) obj(4) x(5)
		// len=6: len-4=2=typ ✓, len-3=3=reason ✓, len-2=4=obj ✓
		return fmt.Sprintf("%s %s %s %s %s x", ns, age, typ, reason, obj)
	}
	// 5 fields: age(0) typ(1) reason(2) obj(3) x(4)
	// len=5: len-4=1=typ ✓, len-3=2=reason ✓, len-2=3=obj ✓
	return fmt.Sprintf("%s %s %s %s x", age, typ, reason, obj)
}

// ---- Namespaces -------------------------------------------------------------

func (s *Store) namespaceLines() ([]string, error) {
	nss, err := s.factory.Core().V1().Namespaces().Lister().List(labels.Everything())
	if err != nil {
		return nil, err
	}
	lines := make([]string, 0, len(nss))
	for _, ns := range nss {
		// parseNamespacesLine: f[0]=name, f[1]=status, f[2]=age
		status := safeField(string(ns.Status.Phase), "Active")
		age := FormatAge(ns.CreationTimestamp.Time)
		lines = append(lines, fmt.Sprintf("%s %s %s", ns.Name, status, age))
	}
	return lines, nil
}

// ---- Ingresses --------------------------------------------------------------

func (s *Store) ingressLines(namespace string) ([]string, error) {
	lister := s.factory.Networking().V1().Ingresses().Lister()
	var items []*netv1.Ingress
	var err error
	if namespace == "" {
		items, err = lister.List(labels.Everything())
	} else {
		items, err = lister.Ingresses(namespace).List(labels.Everything())
	}
	if err != nil {
		return nil, err
	}
	lines := make([]string, 0, len(items))
	for _, ing := range items {
		lines = append(lines, IngressLine(ing, namespace == ""))
	}
	return lines, nil
}

// IngressLine formats an ingress matching parseIngressesLine.
// All-ns: ns name class hosts address ports age
// Namespaced: name class hosts address ports age
func IngressLine(ing *netv1.Ingress, allNs bool) string {
	class := "<none>"
	if ing.Spec.IngressClassName != nil {
		class = safeField(*ing.Spec.IngressClassName, "<none>")
	}
	hostParts := []string{}
	for _, rule := range ing.Spec.Rules {
		if rule.Host != "" {
			hostParts = append(hostParts, rule.Host)
		}
	}
	hostsStr := "<none>"
	if len(hostParts) > 0 {
		hostsStr = strings.Join(hostParts, ",")
	}
	address := "<none>"
	if len(ing.Status.LoadBalancer.Ingress) > 0 {
		if ip := ing.Status.LoadBalancer.Ingress[0].IP; ip != "" {
			address = ip
		} else if h := ing.Status.LoadBalancer.Ingress[0].Hostname; h != "" {
			address = h
		}
	}
	ports := "80"
	if len(ing.Spec.TLS) > 0 {
		ports = "80,443"
	}
	age := FormatAge(ing.CreationTimestamp.Time)

	if allNs {
		return fmt.Sprintf("%s %s %s %s %s %s %s",
			ing.Namespace, ing.Name, class, hostsStr, address, ports, age)
	}
	return fmt.Sprintf("%s %s %s %s %s %s",
		ing.Name, class, hostsStr, address, ports, age)
}

// ---- ConfigMaps -------------------------------------------------------------

func (s *Store) configMapLines(namespace string) ([]string, error) {
	lister := s.factory.Core().V1().ConfigMaps().Lister()
	var items []*v1.ConfigMap
	var err error
	if namespace == "" {
		items, err = lister.List(labels.Everything())
	} else {
		items, err = lister.ConfigMaps(namespace).List(labels.Everything())
	}
	if err != nil {
		return nil, err
	}
	lines := make([]string, 0, len(items))
	for _, cm := range items {
		// parseConfigMapsLine all-ns: f[0]=ns,f[1]=name,f[2]=data,f[3]=age
		// namespaced: f[0]=name,f[1]=data,f[2]=age
		age := FormatAge(cm.CreationTimestamp.Time)
		if namespace == "" {
			lines = append(lines, fmt.Sprintf("%s %s %d %s", cm.Namespace, cm.Name, len(cm.Data), age))
		} else {
			lines = append(lines, fmt.Sprintf("%s %d %s", cm.Name, len(cm.Data), age))
		}
	}
	return lines, nil
}

// ---- Secrets ----------------------------------------------------------------

func (s *Store) secretLines(namespace string) ([]string, error) {
	lister := s.factory.Core().V1().Secrets().Lister()
	var items []*v1.Secret
	var err error
	if namespace == "" {
		items, err = lister.List(labels.Everything())
	} else {
		items, err = lister.Secrets(namespace).List(labels.Everything())
	}
	if err != nil {
		return nil, err
	}
	lines := make([]string, 0, len(items))
	for _, sec := range items {
		// parseSecretsLine all-ns: f[0]=ns,f[1]=name,f[2]=type,f[3]=data,f[4]=age
		// namespaced: f[0]=name,f[1]=type,f[2]=data,f[3]=age
		secType := safeField(string(sec.Type), "Opaque")
		age := FormatAge(sec.CreationTimestamp.Time)
		if namespace == "" {
			lines = append(lines, fmt.Sprintf("%s %s %s %d %s",
				sec.Namespace, sec.Name, secType, len(sec.Data), age))
		} else {
			lines = append(lines, fmt.Sprintf("%s %s %d %s",
				sec.Name, secType, len(sec.Data), age))
		}
	}
	return lines, nil
}

// ---- PVCs -------------------------------------------------------------------

func (s *Store) pvcLines(namespace string) ([]string, error) {
	lister := s.factory.Core().V1().PersistentVolumeClaims().Lister()
	var items []*v1.PersistentVolumeClaim
	var err error
	if namespace == "" {
		items, err = lister.List(labels.Everything())
	} else {
		items, err = lister.PersistentVolumeClaims(namespace).List(labels.Everything())
	}
	if err != nil {
		return nil, err
	}
	lines := make([]string, 0, len(items))
	for _, pvc := range items {
		lines = append(lines, PVCLine(pvc, namespace == ""))
	}
	return lines, nil
}

// PVCLine formats a PVC matching parsePVCLine.
// parsePVCLine uses f[len-1] for age; we include a storageClass field so
// the minimum field count (≥8 all-ns, ≥7 namespaced) is always satisfied.
//
// All-ns: ns name status volume capacity accessModes storageClass age
// Namespaced: name status volume capacity accessModes storageClass age
func PVCLine(pvc *v1.PersistentVolumeClaim, allNs bool) string {
	status := safeField(string(pvc.Status.Phase), "Pending")
	volume := safeField(pvc.Spec.VolumeName, "<none>")
	capacity := "<none>"
	if q, ok := pvc.Status.Capacity[v1.ResourceStorage]; ok {
		capacity = q.String()
	}
	modes := make([]string, 0, len(pvc.Spec.AccessModes))
	for _, am := range pvc.Spec.AccessModes {
		modes = append(modes, string(am))
	}
	accessStr := "<none>"
	if len(modes) > 0 {
		accessStr = strings.Join(modes, ",")
	}
	storageClass := "<none>"
	if pvc.Spec.StorageClassName != nil {
		storageClass = safeField(*pvc.Spec.StorageClassName, "<none>")
	}
	age := FormatAge(pvc.CreationTimestamp.Time)

	if allNs {
		// 8 fields: ns name status volume capacity accessModes storageClass age
		return fmt.Sprintf("%s %s %s %s %s %s %s %s",
			pvc.Namespace, pvc.Name, status, volume, capacity, accessStr, storageClass, age)
	}
	// 7 fields: name status volume capacity accessModes storageClass age
	return fmt.Sprintf("%s %s %s %s %s %s %s",
		pvc.Name, status, volume, capacity, accessStr, storageClass, age)
}

// ---- Jobs -------------------------------------------------------------------

func (s *Store) jobLines(namespace string) ([]string, error) {
	lister := s.factory.Batch().V1().Jobs().Lister()
	var items []*batchv1.Job
	var err error
	if namespace == "" {
		items, err = lister.List(labels.Everything())
	} else {
		items, err = lister.Jobs(namespace).List(labels.Everything())
	}
	if err != nil {
		return nil, err
	}
	lines := make([]string, 0, len(items))
	for _, job := range items {
		lines = append(lines, JobLine(job, namespace == ""))
	}
	return lines, nil
}

// JobLine formats a job matching parseJobsLine.
// All-ns: ns name completions duration age
// Namespaced: name completions duration age
func JobLine(job *batchv1.Job, allNs bool) string {
	desired := int32(1)
	if job.Spec.Completions != nil {
		desired = *job.Spec.Completions
	}
	completions := fmt.Sprintf("%d/%d", job.Status.Succeeded, desired)
	duration := "<none>"
	if job.Status.StartTime != nil {
		end := time.Now()
		if job.Status.CompletionTime != nil {
			end = job.Status.CompletionTime.Time
		}
		duration = formatDuration(end.Sub(job.Status.StartTime.Time))
	}
	age := FormatAge(job.CreationTimestamp.Time)

	if allNs {
		return fmt.Sprintf("%s %s %s %s %s", job.Namespace, job.Name, completions, duration, age)
	}
	return fmt.Sprintf("%s %s %s %s", job.Name, completions, duration, age)
}

// ---- CronJobs ---------------------------------------------------------------

func (s *Store) cronJobLines(namespace string) ([]string, error) {
	lister := s.factory.Batch().V1().CronJobs().Lister()
	var items []*batchv1.CronJob
	var err error
	if namespace == "" {
		items, err = lister.List(labels.Everything())
	} else {
		items, err = lister.CronJobs(namespace).List(labels.Everything())
	}
	if err != nil {
		return nil, err
	}
	lines := make([]string, 0, len(items))
	for _, cj := range items {
		lines = append(lines, CronJobLine(cj, namespace == ""))
	}
	return lines, nil
}

// CronJobLine formats a cronjob matching parseCronJobsLine.
// parseCronJobsLine picks: all-ns → f[0]=ns,f[1]=name,f[2]=schedule,f[4]=suspend,
// f[5]=active,f[len-2]=last,f[len-1]=age (needs ≥7 fields).
// namespaced → f[0]=name,f[1]=schedule,f[3]=suspend,f[4]=active,f[len-2]=last,f[len-1]=age (needs ≥6).
//
// All-ns: ns name schedule _ suspend active last age   (8 fields)
// Namespaced: name schedule _ suspend active last age  (7 fields)
func CronJobLine(cj *batchv1.CronJob, allNs bool) string {
	schedule := safeField(cj.Spec.Schedule, "<none>")
	suspend := "False"
	if cj.Spec.Suspend != nil && *cj.Spec.Suspend {
		suspend = "True"
	}
	active := len(cj.Status.Active)
	lastSchedule := "<none>"
	if cj.Status.LastScheduleTime != nil {
		lastSchedule = FormatAge(cj.Status.LastScheduleTime.Time)
	}
	age := FormatAge(cj.CreationTimestamp.Time)

	if allNs {
		// 8 fields: ns(0) name(1) schedule(2) _(3) suspend(4) active(5) last(6=len-2) age(7=len-1)
		return fmt.Sprintf("%s %s %s _ %s %d %s %s",
			cj.Namespace, cj.Name, schedule, suspend, active, lastSchedule, age)
	}
	// 7 fields: name(0) schedule(1) _(2) suspend(3) active(4) last(5=len-2) age(6=len-1)
	return fmt.Sprintf("%s %s _ %s %d %s %s",
		cj.Name, schedule, suspend, active, lastSchedule, age)
}

// ---- StatefulSets ------------------------------------------------------------

func (s *Store) statefulSetLines(namespace string) ([]string, error) {
	lister := s.factory.Apps().V1().StatefulSets().Lister()
	var items []*appsv1.StatefulSet
	var err error
	if namespace == "" {
		items, err = lister.List(labels.Everything())
	} else {
		items, err = lister.StatefulSets(namespace).List(labels.Everything())
	}
	if err != nil {
		return nil, err
	}
	lines := make([]string, 0, len(items))
	for _, sts := range items {
		lines = append(lines, StatefulSetLine(sts, namespace == ""))
	}
	return lines, nil
}

// StatefulSetLine formats a StatefulSet matching parseStatefulSetsLine.
// kubectl default: NAME READY AGE. With -A: NAMESPACE NAME READY AGE.
func StatefulSetLine(sts *appsv1.StatefulSet, allNs bool) string {
	replicas := int32(0)
	if sts.Spec.Replicas != nil {
		replicas = *sts.Spec.Replicas
	}
	ready := sts.Status.ReadyReplicas
	readyStr := fmt.Sprintf("%d/%d", ready, replicas)
	age := FormatAge(sts.CreationTimestamp.Time)
	if allNs {
		return fmt.Sprintf("%s %s %s %s", sts.Namespace, sts.Name, readyStr, age)
	}
	return fmt.Sprintf("%s %s %s", sts.Name, readyStr, age)
}

// ---- DaemonSets --------------------------------------------------------------

func (s *Store) daemonSetLines(namespace string) ([]string, error) {
	lister := s.factory.Apps().V1().DaemonSets().Lister()
	var items []*appsv1.DaemonSet
	var err error
	if namespace == "" {
		items, err = lister.List(labels.Everything())
	} else {
		items, err = lister.DaemonSets(namespace).List(labels.Everything())
	}
	if err != nil {
		return nil, err
	}
	lines := make([]string, 0, len(items))
	for _, ds := range items {
		lines = append(lines, DaemonSetLine(ds, namespace == ""))
	}
	return lines, nil
}

// DaemonSetLine formats a DaemonSet matching parseDaemonSetsLine.
// kubectl default: NAME DESIRED CURRENT READY UP-TO-DATE AVAILABLE NODE SELECTOR AGE.
func DaemonSetLine(ds *appsv1.DaemonSet, allNs bool) string {
	desired := ds.Status.DesiredNumberScheduled
	current := ds.Status.CurrentNumberScheduled
	ready := ds.Status.NumberReady
	upToDate := ds.Status.UpdatedNumberScheduled
	available := ds.Status.NumberAvailable
	nodeSelector := "<none>"
	if len(ds.Spec.Template.Spec.NodeSelector) > 0 {
		parts := make([]string, 0, len(ds.Spec.Template.Spec.NodeSelector))
		for k, v := range ds.Spec.Template.Spec.NodeSelector {
			parts = append(parts, fmt.Sprintf("%s=%s", k, v))
		}
		sort.Strings(parts) // deterministic output
		nodeSelector = strings.Join(parts, ",")
	}
	age := FormatAge(ds.CreationTimestamp.Time)
	if allNs {
		return fmt.Sprintf("%s %s %d %d %d %d %d %s %s",
			ds.Namespace, ds.Name, desired, current, ready, upToDate, available, nodeSelector, age)
	}
	return fmt.Sprintf("%s %d %d %d %d %d %s %s",
		ds.Name, desired, current, ready, upToDate, available, nodeSelector, age)
}

// ---- ServiceAccounts --------------------------------------------------------

func (s *Store) serviceAccountLines(namespace string) ([]string, error) {
	lister := s.factory.Core().V1().ServiceAccounts().Lister()
	var items []*v1.ServiceAccount
	var err error
	if namespace == "" {
		items, err = lister.List(labels.Everything())
	} else {
		items, err = lister.ServiceAccounts(namespace).List(labels.Everything())
	}
	if err != nil {
		return nil, err
	}
	lines := make([]string, 0, len(items))
	for _, sa := range items {
		lines = append(lines, ServiceAccountLine(sa, namespace == ""))
	}
	return lines, nil
}

// ServiceAccountLine formats a ServiceAccount matching parseServiceAccountsLine.
// kubectl default: NAME SECRETS AGE. With -A: NAMESPACE NAME SECRETS AGE.
func ServiceAccountLine(sa *v1.ServiceAccount, allNs bool) string {
	secrets := len(sa.Secrets)
	age := FormatAge(sa.CreationTimestamp.Time)
	if allNs {
		return fmt.Sprintf("%s %s %d %s", sa.Namespace, sa.Name, secrets, age)
	}
	return fmt.Sprintf("%s %d %s", sa.Name, secrets, age)
}

// ---- Roles -------------------------------------------------------------------

func (s *Store) roleLines(namespace string) ([]string, error) {
	lister := s.factory.Rbac().V1().Roles().Lister()
	var items []*rbacv1.Role
	var err error
	if namespace == "" {
		items, err = lister.List(labels.Everything())
	} else {
		items, err = lister.Roles(namespace).List(labels.Everything())
	}
	if err != nil {
		return nil, err
	}
	lines := make([]string, 0, len(items))
	for _, r := range items {
		lines = append(lines, RoleLine(r, namespace == ""))
	}
	return lines, nil
}

// RoleLine formats a Role matching parseRolesLine.
// kubectl default: NAME CREATED_AT. With -A: NAMESPACE NAME CREATED_AT.
func RoleLine(r *rbacv1.Role, allNs bool) string {
	age := FormatAge(r.CreationTimestamp.Time)
	if allNs {
		return fmt.Sprintf("%s %s %s", r.Namespace, r.Name, age)
	}
	return fmt.Sprintf("%s %s", r.Name, age)
}

// ---- RoleBindings -----------------------------------------------------------

func (s *Store) roleBindingLines(namespace string) ([]string, error) {
	lister := s.factory.Rbac().V1().RoleBindings().Lister()
	var items []*rbacv1.RoleBinding
	var err error
	if namespace == "" {
		items, err = lister.List(labels.Everything())
	} else {
		items, err = lister.RoleBindings(namespace).List(labels.Everything())
	}
	if err != nil {
		return nil, err
	}
	lines := make([]string, 0, len(items))
	for _, rb := range items {
		lines = append(lines, RoleBindingLine(rb, namespace == ""))
	}
	return lines, nil
}

// RoleBindingLine formats a RoleBinding matching parseRoleBindingsLine.
// kubectl default: NAME ROLE AGE. With -A: NAMESPACE NAME ROLE AGE.
func RoleBindingLine(rb *rbacv1.RoleBinding, allNs bool) string {
	roleRef := rb.RoleRef.Kind + "/" + rb.RoleRef.Name
	age := FormatAge(rb.CreationTimestamp.Time)
	if allNs {
		return fmt.Sprintf("%s %s %s %s", rb.Namespace, rb.Name, roleRef, age)
	}
	return fmt.Sprintf("%s %s %s", rb.Name, roleRef, age)
}

// ---- ReplicaSets ------------------------------------------------------------

func (s *Store) replicaSetLines(namespace string) ([]string, error) {
	lister := s.factory.Apps().V1().ReplicaSets().Lister()
	var items []*appsv1.ReplicaSet
	var err error
	if namespace == "" {
		items, err = lister.List(labels.Everything())
	} else {
		items, err = lister.ReplicaSets(namespace).List(labels.Everything())
	}
	if err != nil {
		return nil, err
	}
	lines := make([]string, 0, len(items))
	for _, rs := range items {
		// parseReplicaSetsLine all-ns: f[0]=ns,f[1]=name,f[2]=desired,f[3]=current,f[4]=ready,f[5]=age
		// namespaced: f[0]=name,f[1]=desired,f[2]=current,f[3]=ready,f[4]=age
		desired := int32(0)
		if rs.Spec.Replicas != nil {
			desired = *rs.Spec.Replicas
		}
		age := FormatAge(rs.CreationTimestamp.Time)
		if namespace == "" {
			lines = append(lines, fmt.Sprintf("%s %s %d %d %d %s",
				rs.Namespace, rs.Name, desired, rs.Status.Replicas, rs.Status.ReadyReplicas, age))
		} else {
			lines = append(lines, fmt.Sprintf("%s %d %d %d %s",
				rs.Name, desired, rs.Status.Replicas, rs.Status.ReadyReplicas, age))
		}
	}
	return lines, nil
}

// ---- Endpoints --------------------------------------------------------------

func (s *Store) endpointLines(namespace string) ([]string, error) {
	lister := s.factory.Core().V1().Endpoints().Lister()
	var items []*v1.Endpoints
	var err error
	if namespace == "" {
		items, err = lister.List(labels.Everything())
	} else {
		items, err = lister.Endpoints(namespace).List(labels.Everything())
	}
	if err != nil {
		return nil, err
	}
	lines := make([]string, 0, len(items))
	for _, ep := range items {
		// parseEndpointsLine all-ns: f[0]=ns,f[1]=name,f[2]=endpoints,f[3]=age
		// namespaced: f[0]=name,f[1]=endpoints,f[2]=age
		addrs := []string{}
		for _, sub := range ep.Subsets {
			for _, addr := range sub.Addresses {
				for _, port := range sub.Ports {
					addrs = append(addrs, fmt.Sprintf("%s:%d", addr.IP, port.Port))
				}
			}
		}
		epStr := "<none>"
		if len(addrs) > 0 {
			epStr = strings.Join(addrs, ",")
		}
		age := FormatAge(ep.CreationTimestamp.Time)
		if namespace == "" {
			lines = append(lines, fmt.Sprintf("%s %s %s %s", ep.Namespace, ep.Name, epStr, age))
		} else {
			lines = append(lines, fmt.Sprintf("%s %s %s", ep.Name, epStr, age))
		}
	}
	return lines, nil
}
