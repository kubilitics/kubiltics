package informer

import (
	"fmt"
	"strings"
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	v1 "k8s.io/api/core/v1"
	netv1 "k8s.io/api/networking/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ---- FormatAge --------------------------------------------------------------

func TestFormatAge(t *testing.T) {
	now := time.Now()
	cases := []struct {
		d    time.Duration
		want string
	}{
		{30 * time.Second, "30s"},
		{90 * time.Second, "1m"},
		{2*time.Hour + 30*time.Minute, "2h"},
		{3 * 24 * time.Hour, "3d"},
	}
	for _, c := range cases {
		got := FormatAge(now.Add(-c.d))
		if got != c.want {
			t.Errorf("FormatAge(-%v) = %q, want %q", c.d, got, c.want)
		}
	}
	if got := FormatAge(time.Time{}); got != "<unknown>" {
		t.Errorf("FormatAge(zero) = %q, want %q", got, "<unknown>")
	}
}

// ---- PodLine ----------------------------------------------------------------

func makePod(ns, name, phase string, ready, total int, restarts int32, nodeName string) *v1.Pod {
	containers := make([]v1.Container, total)
	statuses := make([]v1.ContainerStatus, total)
	for i := 0; i < total; i++ {
		containers[i] = v1.Container{Name: "c"}
		statuses[i] = v1.ContainerStatus{
			Ready:        i < ready,
			RestartCount: restarts,
		}
	}
	return &v1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:         ns,
			Name:              name,
			CreationTimestamp: metav1.NewTime(time.Now().Add(-24 * time.Hour)),
		},
		Spec: v1.PodSpec{
			Containers: containers,
			NodeName:   nodeName,
		},
		Status: v1.PodStatus{
			Phase:             v1.PodPhase(phase),
			ContainerStatuses: statuses,
			PodIP:             "10.0.0.1",
		},
	}
}

func TestPodLine_AllNs(t *testing.T) {
	pod := makePod("default", "nginx-abc", "Running", 1, 1, 3, "node-1")
	line := PodLine(pod, true)
	f := strings.Fields(line)
	if len(f) < 8 {
		t.Fatalf("PodLine all-ns produced %d fields (need ≥8): %q", len(f), line)
	}
	// parsePodsLine all-ns: f[0]=ns,f[1]=name,f[2]=ready,f[3]=status,f[4]=restarts,f[5]=age,f[7]=node
	if f[0] != "default" {
		t.Errorf("f[0] namespace = %q, want %q", f[0], "default")
	}
	if f[1] != "nginx-abc" {
		t.Errorf("f[1] name = %q, want %q", f[1], "nginx-abc")
	}
	if f[2] != "1/1" {
		t.Errorf("f[2] ready = %q, want 1/1", f[2])
	}
	if f[3] != "Running" {
		t.Errorf("f[3] status = %q, want Running", f[3])
	}
	if f[7] != "node-1" {
		t.Errorf("f[7] node = %q, want node-1", f[7])
	}
}

func TestPodLine_Namespaced(t *testing.T) {
	pod := makePod("prod", "api-0", "Running", 2, 3, 0, "node-2")
	line := PodLine(pod, false)
	f := strings.Fields(line)
	if len(f) < 7 {
		t.Fatalf("PodLine namespaced produced %d fields (need ≥7): %q", len(f), line)
	}
	// parsePodsLine namespaced: f[0]=name,f[6]=node
	if f[0] != "api-0" {
		t.Errorf("f[0] name = %q, want api-0", f[0])
	}
	if f[1] != "2/3" {
		t.Errorf("f[1] ready = %q, want 2/3", f[1])
	}
	if f[6] != "node-2" {
		t.Errorf("f[6] node = %q, want node-2", f[6])
	}
}

// ---- DeploymentLine ---------------------------------------------------------

func makeDeployment(ns, name string, ready, total, upToDate, available int32) *appsv1.Deployment {
	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:         ns,
			Name:              name,
			CreationTimestamp: metav1.NewTime(time.Now().Add(-2 * time.Hour)),
		},
		Status: appsv1.DeploymentStatus{
			ReadyReplicas:     ready,
			Replicas:          total,
			UpdatedReplicas:   upToDate,
			AvailableReplicas: available,
		},
	}
}

func TestDeploymentLine_AllNs(t *testing.T) {
	d := makeDeployment("default", "web", 3, 3, 3, 3)
	line := DeploymentLine(d, true)
	f := strings.Fields(line)
	if len(f) < 6 {
		t.Fatalf("DeploymentLine all-ns: %d fields (need ≥6): %q", len(f), line)
	}
	// parseDeploymentsLine all-ns: f[0]=ns,f[1]=name,f[2]=ready,f[3]=upToDate,f[4]=available,f[5]=age
	if f[0] != "default" || f[1] != "web" || f[2] != "3/3" {
		t.Errorf("unexpected deployment line: %q", line)
	}
}

func TestDeploymentLine_Namespaced(t *testing.T) {
	d := makeDeployment("prod", "api", 2, 3, 2, 2)
	line := DeploymentLine(d, false)
	f := strings.Fields(line)
	if len(f) < 5 {
		t.Fatalf("DeploymentLine namespaced: %d fields (need ≥5): %q", len(f), line)
	}
	// parseDeploymentsLine namespaced: f[0]=name,f[1]=ready,f[2]=upToDate,f[3]=available,f[4]=age
	if f[0] != "api" || f[1] != "2/3" {
		t.Errorf("unexpected deployment line: %q", line)
	}
}

// ---- StatefulSetLine --------------------------------------------------------

func makeStatefulSet(ns, name string, ready, replicas int32) *appsv1.StatefulSet {
	r := replicas
	return &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:         ns,
			Name:              name,
			CreationTimestamp: metav1.NewTime(time.Now().Add(-24 * time.Hour)),
		},
		Spec:   appsv1.StatefulSetSpec{Replicas: &r},
		Status: appsv1.StatefulSetStatus{ReadyReplicas: ready},
	}
}

func TestStatefulSetLine_AllNs(t *testing.T) {
	sts := makeStatefulSet("default", "web", 2, 2)
	line := StatefulSetLine(sts, true)
	f := strings.Fields(line)
	if len(f) < 4 {
		t.Fatalf("StatefulSetLine all-ns: %d fields (need ≥4): %q", len(f), line)
	}
	if f[0] != "default" || f[1] != "web" || f[2] != "2/2" {
		t.Errorf("unexpected statefulset line: %q", line)
	}
}

func TestStatefulSetLine_Namespaced(t *testing.T) {
	sts := makeStatefulSet("prod", "postgres", 1, 1)
	line := StatefulSetLine(sts, false)
	f := strings.Fields(line)
	if len(f) < 3 {
		t.Fatalf("StatefulSetLine namespaced: %d fields (need ≥3): %q", len(f), line)
	}
	if f[0] != "postgres" || f[1] != "1/1" {
		t.Errorf("unexpected statefulset line: %q", line)
	}
}

// ---- DaemonSetLine ----------------------------------------------------------

func makeDaemonSet(ns, name string, desired, current, ready, upToDate, available int32) *appsv1.DaemonSet {
	return &appsv1.DaemonSet{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:         ns,
			Name:              name,
			CreationTimestamp: metav1.NewTime(time.Now().Add(-24 * time.Hour)),
		},
		Spec: appsv1.DaemonSetSpec{
			Template: v1.PodTemplateSpec{
				Spec: v1.PodSpec{
					NodeSelector: map[string]string{"kubernetes.io/os": "linux"},
				},
			},
		},
		Status: appsv1.DaemonSetStatus{
			DesiredNumberScheduled:   desired,
			CurrentNumberScheduled:   current,
			NumberReady:              ready,
			UpdatedNumberScheduled:   upToDate,
			NumberAvailable:          available,
		},
	}
}

func TestDaemonSetLine_AllNs(t *testing.T) {
	ds := makeDaemonSet("kube-system", "kindnet", 3, 3, 3, 3, 3)
	line := DaemonSetLine(ds, true)
	f := strings.Fields(line)
	if len(f) < 9 {
		t.Fatalf("DaemonSetLine all-ns: %d fields (need ≥9): %q", len(f), line)
	}
	if f[0] != "kube-system" || f[1] != "kindnet" || f[2] != "3" {
		t.Errorf("unexpected daemonset line: %q", line)
	}
}

func TestDaemonSetLine_Namespaced(t *testing.T) {
	ds := makeDaemonSet("default", "fluentd", 2, 2, 2, 2, 2)
	line := DaemonSetLine(ds, false)
	f := strings.Fields(line)
	if len(f) < 8 {
		t.Fatalf("DaemonSetLine namespaced: %d fields (need ≥8): %q", len(f), line)
	}
	if f[0] != "fluentd" || f[1] != "2" {
		t.Errorf("unexpected daemonset line: %q", line)
	}
}

// ---- ServiceAccountLine -----------------------------------------------------

func makeServiceAccount(ns, name string, numSecrets int) *v1.ServiceAccount {
	sa := &v1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:         ns,
			Name:              name,
			CreationTimestamp: metav1.NewTime(time.Now().Add(-52 * 24 * time.Hour)),
		},
	}
	for i := 0; i < numSecrets; i++ {
		sa.Secrets = append(sa.Secrets, v1.ObjectReference{Name: "secret-" + fmt.Sprintf("%d", i)})
	}
	return sa
}

func TestServiceAccountLine_AllNs(t *testing.T) {
	sa := makeServiceAccount("default", "default", 0)
	line := ServiceAccountLine(sa, true)
	f := strings.Fields(line)
	if len(f) < 4 {
		t.Fatalf("ServiceAccountLine all-ns: %d fields (need ≥4): %q", len(f), line)
	}
	if f[0] != "default" || f[1] != "default" || f[2] != "0" {
		t.Errorf("unexpected serviceaccount line: %q", line)
	}
}

func TestServiceAccountLine_Namespaced(t *testing.T) {
	sa := makeServiceAccount("apps", "ci-deployer", 2)
	line := ServiceAccountLine(sa, false)
	f := strings.Fields(line)
	if len(f) < 3 {
		t.Fatalf("ServiceAccountLine namespaced: %d fields (need ≥3): %q", len(f), line)
	}
	if f[0] != "ci-deployer" || f[1] != "2" {
		t.Errorf("unexpected serviceaccount line: %q", line)
	}
}

// ---- RoleLine ---------------------------------------------------------------

func TestRoleLine(t *testing.T) {
	r := &rbacv1.Role{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:         "default",
			Name:              "pod-reader",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-91 * 24 * time.Hour)),
		},
	}
	line := RoleLine(r, true)
	f := strings.Fields(line)
	if len(f) < 3 {
		t.Fatalf("RoleLine all-ns: %d fields (need ≥3): %q", len(f), line)
	}
	if f[0] != "default" || f[1] != "pod-reader" {
		t.Errorf("unexpected role line: %q", line)
	}
}

// ---- RoleBindingLine --------------------------------------------------------

func TestRoleBindingLine(t *testing.T) {
	rb := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:         "default",
			Name:              "pod-monitor-binding",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-91 * 24 * time.Hour)),
		},
		RoleRef: rbacv1.RoleRef{
			Kind: "Role",
			Name: "pod-reader",
		},
	}
	line := RoleBindingLine(rb, true)
	f := strings.Fields(line)
	if len(f) < 4 {
		t.Fatalf("RoleBindingLine all-ns: %d fields (need ≥4): %q", len(f), line)
	}
	if f[0] != "default" || f[1] != "pod-monitor-binding" || f[2] != "Role/pod-reader" {
		t.Errorf("unexpected rolebinding line: %q", line)
	}
}

// ---- EventLine --------------------------------------------------------------

func makeEvent(ns, typ, reason, kind, objName string) *v1.Event {
	return &v1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:         ns,
			Name:              reason + "-123",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-5 * time.Minute)),
		},
		Type:   typ,
		Reason: reason,
		InvolvedObject: v1.ObjectReference{
			Kind: kind,
			Name: objName,
		},
		LastTimestamp: metav1.NewTime(time.Now().Add(-3 * time.Minute)),
	}
}

func TestEventLine_AllNs(t *testing.T) {
	ev := makeEvent("default", "Warning", "OOMKilling", "Pod", "nginx-abc")
	line := EventLine(ev, true)
	f := strings.Fields(line)
	// parseEventsLine all-ns needs ≥5 fields; uses f[0]=ns, f[1]=age, f[len-4]=typ, f[len-3]=reason, f[len-2]=obj
	if len(f) < 5 {
		t.Fatalf("EventLine all-ns: %d fields (need ≥5): %q", len(f), line)
	}
	if f[0] != "default" {
		t.Errorf("f[0] ns = %q, want default", f[0])
	}
	typ := f[len(f)-4]
	reason := f[len(f)-3]
	obj := f[len(f)-2]
	if typ != "Warning" {
		t.Errorf("typ (f[len-4]) = %q, want Warning", typ)
	}
	if reason != "OOMKilling" {
		t.Errorf("reason (f[len-3]) = %q, want OOMKilling", reason)
	}
	if !strings.Contains(obj, "nginx-abc") {
		t.Errorf("obj (f[len-2]) = %q, should contain nginx-abc", obj)
	}
}

func TestEventLine_Namespaced(t *testing.T) {
	ev := makeEvent("prod", "Normal", "Scheduled", "Pod", "api-0")
	line := EventLine(ev, false)
	f := strings.Fields(line)
	// parseEventsLine namespaced needs ≥4 fields; uses f[0]=age, f[len-4]=typ, f[len-3]=reason, f[len-2]=obj
	if len(f) < 4 {
		t.Fatalf("EventLine namespaced: %d fields (need ≥4): %q", len(f), line)
	}
	typ := f[len(f)-4]
	reason := f[len(f)-3]
	if typ != "Normal" {
		t.Errorf("typ = %q, want Normal", typ)
	}
	if reason != "Scheduled" {
		t.Errorf("reason = %q, want Scheduled", reason)
	}
}

// ---- PVCLine ----------------------------------------------------------------

func makePVC(ns, name, status, volume string, capacityGi int64) *v1.PersistentVolumeClaim {
	sc := "standard"
	pvc := &v1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:         ns,
			Name:              name,
			CreationTimestamp: metav1.NewTime(time.Now().Add(-24 * time.Hour)),
		},
		Spec: v1.PersistentVolumeClaimSpec{
			VolumeName:       volume,
			StorageClassName: &sc,
			AccessModes:      []v1.PersistentVolumeAccessMode{v1.ReadWriteOnce},
		},
		Status: v1.PersistentVolumeClaimStatus{
			Phase: v1.PersistentVolumeClaimPhase(status),
		},
	}
	if capacityGi > 0 {
		pvc.Status.Capacity = v1.ResourceList{
			v1.ResourceStorage: resource.MustParse(
				strings.TrimSpace(strings.ReplaceAll(strings.TrimRight(strings.TrimRight(
					resource.NewMilliQuantity(capacityGi*1024*1024*1024*1000, resource.BinarySI).String(), "0"), "."), " ", "")),
			),
		}
		pvc.Status.Capacity = v1.ResourceList{
			v1.ResourceStorage: *resource.NewQuantity(capacityGi<<30, resource.BinarySI),
		}
	}
	return pvc
}

func TestPVCLine_AllNs(t *testing.T) {
	pvc := makePVC("default", "data-pvc", "Bound", "pv-123", 10)
	line := PVCLine(pvc, true)
	f := strings.Fields(line)
	// parsePVCLine all-ns needs ≥8 fields; uses f[0]=ns,f[1]=name,...,f[len-1]=age
	if len(f) < 8 {
		t.Fatalf("PVCLine all-ns: %d fields (need ≥8): %q", len(f), line)
	}
	if f[0] != "default" || f[1] != "data-pvc" || f[2] != "Bound" {
		t.Errorf("unexpected PVC line: %q", line)
	}
	// last field is age
	age := f[len(f)-1]
	if age == "" || age == "<unknown>" {
		t.Errorf("unexpected age: %q", age)
	}
}

func TestPVCLine_Namespaced(t *testing.T) {
	pvc := makePVC("prod", "logs-pvc", "Pending", "", 0)
	line := PVCLine(pvc, false)
	f := strings.Fields(line)
	// parsePVCLine namespaced needs ≥7 fields
	if len(f) < 7 {
		t.Fatalf("PVCLine namespaced: %d fields (need ≥7): %q", len(f), line)
	}
	if f[0] != "logs-pvc" || f[1] != "Pending" {
		t.Errorf("unexpected PVC line: %q", line)
	}
}

// ---- NodeLine ---------------------------------------------------------------

func makeNode(name, kubeletVersion string, ready bool, roles []string) *v1.Node {
	conds := []v1.NodeCondition{{
		Type:   v1.NodeReady,
		Status: v1.ConditionFalse,
	}}
	if ready {
		conds[0].Status = v1.ConditionTrue
	}
	lbls := make(map[string]string)
	for _, r := range roles {
		lbls["node-role.kubernetes.io/"+r] = ""
	}
	return &v1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name:              name,
			Labels:            lbls,
			CreationTimestamp: metav1.NewTime(time.Now().Add(-7 * 24 * time.Hour)),
		},
		Status: v1.NodeStatus{
			Conditions: conds,
			NodeInfo:   v1.NodeSystemInfo{KubeletVersion: kubeletVersion},
		},
	}
}

func TestNodeLine(t *testing.T) {
	node := makeNode("worker-1", "v1.30.0", true, []string{"worker"})
	line := NodeLine(node)
	f := strings.Fields(line)
	// parseNodesLine: f[0]=name,f[1]=status,f[2]=roles,f[3]=age,f[4]=version
	if len(f) < 5 {
		t.Fatalf("NodeLine: %d fields (need ≥5): %q", len(f), line)
	}
	if f[0] != "worker-1" {
		t.Errorf("f[0] name = %q", f[0])
	}
	if f[1] != "Ready" {
		t.Errorf("f[1] status = %q, want Ready", f[1])
	}
	if f[4] != "v1.30.0" {
		t.Errorf("f[4] version = %q, want v1.30.0", f[4])
	}
}

// ---- CronJobLine ------------------------------------------------------------

func makeCronJob(ns, name, schedule string, suspended bool) *batchv1.CronJob {
	susp := suspended
	return &batchv1.CronJob{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:         ns,
			Name:              name,
			CreationTimestamp: metav1.NewTime(time.Now().Add(-3 * 24 * time.Hour)),
		},
		Spec: batchv1.CronJobSpec{
			Schedule: schedule,
			Suspend:  &susp,
		},
	}
}

func TestCronJobLine_AllNs(t *testing.T) {
	cj := makeCronJob("default", "backup", "0 2 * * *", false)
	line := CronJobLine(cj, true)
	f := strings.Fields(line)
	// parseCronJobsLine all-ns needs ≥7 fields
	if len(f) < 7 {
		t.Fatalf("CronJobLine all-ns: %d fields (need ≥7): %q", len(f), line)
	}
	// Columns picked: f[0]=ns,f[1]=name,f[2]=schedule,f[4]=suspend,f[5]=active,f[len-2]=last,f[len-1]=age
	if f[0] != "default" || f[1] != "backup" {
		t.Errorf("unexpected cronjob line: %q", line)
	}
	suspend := f[4]
	if suspend != "False" {
		t.Errorf("f[4] suspend = %q, want False", suspend)
	}
}

func TestCronJobLine_Namespaced(t *testing.T) {
	cj := makeCronJob("prod", "cleanup", "*/5 * * * *", true)
	line := CronJobLine(cj, false)
	f := strings.Fields(line)
	// parseCronJobsLine namespaced needs ≥6 fields
	if len(f) < 6 {
		t.Fatalf("CronJobLine namespaced: %d fields (need ≥6): %q", len(f), line)
	}
	// Columns: f[0]=name,f[1]=schedule,f[3]=suspend,f[4]=active,f[len-2]=last,f[len-1]=age
	if f[0] != "cleanup" {
		t.Errorf("f[0] name = %q, want cleanup", f[0])
	}
	suspend := f[3]
	if suspend != "True" {
		t.Errorf("f[3] suspend = %q, want True", suspend)
	}
}

// ---- IngressLine ------------------------------------------------------------

func makeIngress(ns, name, className string, hosts []string, tls bool) *netv1.Ingress {
	rules := make([]netv1.IngressRule, len(hosts))
	for i, h := range hosts {
		rules[i] = netv1.IngressRule{Host: h}
	}
	var tlsSpec []netv1.IngressTLS
	if tls {
		tlsSpec = []netv1.IngressTLS{{Hosts: hosts}}
	}
	ing := &netv1.Ingress{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:         ns,
			Name:              name,
			CreationTimestamp: metav1.NewTime(time.Now().Add(-time.Hour)),
		},
		Spec: netv1.IngressSpec{
			IngressClassName: &className,
			Rules:            rules,
			TLS:              tlsSpec,
		},
	}
	return ing
}

func TestIngressLine_AllNs(t *testing.T) {
	ing := makeIngress("default", "web-ing", "nginx", []string{"example.com"}, true)
	line := IngressLine(ing, true)
	f := strings.Fields(line)
	// parseIngressesLine all-ns: needs ≥7 fields; f[0]=ns,f[1]=name,f[2]=class,f[3]=hosts,f[4]=address,f[5]=ports,f[6]=age
	if len(f) < 7 {
		t.Fatalf("IngressLine all-ns: %d fields (need ≥7): %q", len(f), line)
	}
	if f[0] != "default" || f[1] != "web-ing" || f[2] != "nginx" {
		t.Errorf("unexpected ingress line: %q", line)
	}
	if !strings.Contains(f[3], "example.com") {
		t.Errorf("f[3] hosts = %q, should contain example.com", f[3])
	}
	if f[5] != "80,443" {
		t.Errorf("f[5] ports = %q, want 80,443", f[5])
	}
}

// ---- NotifyCh / notify ------------------------------------------------------

func TestNotifyChannel(t *testing.T) {
	s := &Store{
		notifyChs: make(map[string]chan struct{}),
		stopCh:    make(chan struct{}),
	}

	ch := s.NotifyCh("pods")
	if ch == nil {
		t.Fatal("NotifyCh returned nil")
	}

	// Channel should start empty
	select {
	case <-ch:
		t.Fatal("channel had unexpected message before notify")
	default:
	}

	// notify should send a signal
	s.notify("pods")
	select {
	case <-ch:
		// expected
	default:
		t.Fatal("channel empty after notify")
	}

	// A second notify on a full channel should not block (non-blocking send)
	s.notify("pods")
	s.notify("pods") // should not block even though channel not drained
	// Drain
	select {
	case <-ch:
	default:
		t.Fatal("expected at least one pending signal")
	}

	// notify for an unregistered type should be a no-op (no panic)
	s.notify("nonexistent")
}

// ---- ServiceLine ------------------------------------------------------------

func TestServiceLine_AllNs(t *testing.T) {
	svc := &v1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:         "default",
			Name:              "web-svc",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-time.Hour)),
		},
		Spec: v1.ServiceSpec{
			Type:      v1.ServiceTypeClusterIP,
			ClusterIP: "10.96.0.1",
			Ports:     []v1.ServicePort{{Port: 80, Protocol: v1.ProtocolTCP}},
		},
	}
	line := ServiceLine(svc, true)
	f := strings.Fields(line)
	// parseServicesLine all-ns: needs ≥7 fields; f[0]=ns,f[1]=name,f[2]=type,f[3]=clusterip,[4]=externalip(skip),f[5]=ports,f[6]=age
	if len(f) < 7 {
		t.Fatalf("ServiceLine all-ns: %d fields (need ≥7): %q", len(f), line)
	}
	if f[0] != "default" || f[1] != "web-svc" || f[2] != "ClusterIP" {
		t.Errorf("unexpected service line: %q", line)
	}
	// f[5] = ports
	if !strings.Contains(f[5], "80") {
		t.Errorf("f[5] ports = %q, should contain 80", f[5])
	}
}

func TestServiceLine_Namespaced(t *testing.T) {
	svc := &v1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:         "prod",
			Name:              "api-svc",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-2 * time.Hour)),
		},
		Spec: v1.ServiceSpec{
			Type:      v1.ServiceTypeLoadBalancer,
			ClusterIP: "10.96.0.2",
			Ports: []v1.ServicePort{
				{Port: 443, Protocol: v1.ProtocolTCP},
			},
		},
	}
	line := ServiceLine(svc, false)
	f := strings.Fields(line)
	// parseServicesLine namespaced: needs ≥6 fields; f[0]=name,f[1]=type,f[2]=clusterip,[3]=externalip(skip),f[4]=ports,f[5]=age
	if len(f) < 6 {
		t.Fatalf("ServiceLine namespaced: %d fields (need ≥6): %q", len(f), line)
	}
	if f[0] != "api-svc" || f[1] != "LoadBalancer" {
		t.Errorf("unexpected service line: %q", line)
	}
}

// ---- JobLine ----------------------------------------------------------------

func TestJobLine(t *testing.T) {
	completions := int32(3)
	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:         "default",
			Name:              "migrate",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-30 * time.Minute)),
		},
		Spec: batchv1.JobSpec{
			Completions: &completions,
		},
		Status: batchv1.JobStatus{
			Succeeded: 2,
		},
	}
	line := JobLine(job, false)
	f := strings.Fields(line)
	// parseJobsLine namespaced: needs ≥4 fields; f[0]=name,f[1]=completions,f[2]=duration,f[3]=age
	if len(f) < 4 {
		t.Fatalf("JobLine namespaced: %d fields (need ≥4): %q", len(f), line)
	}
	if f[0] != "migrate" || f[1] != "2/3" {
		t.Errorf("unexpected job line: %q", line)
	}
}
