package cli

// details.go — kcli details command group.
//
// Rich, human-readable details for any Kubernetes resource.
// Goes far beyond `kubectl describe` by presenting structured,
// color-coded, actionable output with health signals, cost estimates,
// RBAC bindings, events, and AI diagnosis.
//
// Commands:
//   kcli pod details <name>           — full pod detail (status, containers, env, resources, events)
//   kcli deployment details <name>    — deployment rollout, replicas, strategy, pods
//   kcli service details <name>       — endpoints, ports, selectors, backend pods
//   kcli node details <name>          — capacity, allocatable, taints, conditions, pods
//   kcli configmap details <name>     — keys and sizes (values redacted by default)
//   kcli secret details <name>        — keys and sizes (values always redacted)
//   kcli ingress details <name>       — rules, TLS, backends
//   kcli pvc details <name>           — storage class, capacity, access modes, phase
//   kcli job details <name>           — completion status, duration, pod log hints
//   kcli cronjob details <name>       — schedule, last run, next run, history
//   kcli hpa details <name>           — current/desired/min/max replicas, metrics
//   kcli statefulset details <name>   — replicas, storage, pods
//   kcli daemonset details <name>     — desired/current/ready counts, per-node status

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

// ─── Shared detail output helpers ─────────────────────────────────────────────


type detailWriter struct {
	a *app
}

func (d *detailWriter) section(title string) {
	fmt.Fprintf(d.a.stdout, "\n%s%s %s %s%s\n",
		ansiBold, ansiCyan, title, strings.Repeat("─", max(0, 55-len(title))), ansiReset)
}

func (d *detailWriter) field(label, value string) {
	fmt.Fprintf(d.a.stdout, "  %s%-28s%s %s\n", ansiBold, label+":", ansiReset, value)
}

func (d *detailWriter) fieldColor(label, value, color string) {
	fmt.Fprintf(d.a.stdout, "  %s%-28s%s %s%s%s\n", ansiBold, label+":", ansiReset, color, value, ansiReset)
}

func (d *detailWriter) badge(label, value string) {
	color := ansiGray
	switch strings.ToLower(value) {
	case "running", "ready", "true", "active", "bound", "complete", "succeeded":
		color = ansiGreen
	case "pending", "waiting", "progressing":
		color = ansiYellow
	case "failed", "error", "crashloopbackoff", "oomkilled", "false", "lost", "evicted":
		color = ansiRed
	case "terminating":
		color = ansiYellow
	}
	fmt.Fprintf(d.a.stdout, "  %s%-28s%s %s%s%s\n", ansiBold, label+":", ansiReset, color+ansiBold, value, ansiReset)
}

func (d *detailWriter) header(title, name, ns string) {
	fmt.Fprintf(d.a.stdout, "\n%s%s %s Details%s", ansiBold, ansiCyan, title, ansiReset)
	if name != "" {
		fmt.Fprintf(d.a.stdout, " — %s%s%s", ansiYellow, name, ansiReset)
	}
	if ns != "" {
		fmt.Fprintf(d.a.stdout, " %s(namespace: %s)%s", ansiGray, ns, ansiReset)
	}
	fmt.Fprintln(d.a.stdout)
	fmt.Fprintf(d.a.stdout, "%s%s%s\n", ansiGray, strings.Repeat("═", 60), ansiReset)
}

func (d *detailWriter) table(headers []string, rows [][]string) {
	widths := make([]int, len(headers))
	for i, h := range headers {
		widths[i] = len(h)
	}
	for _, row := range rows {
		for i, cell := range row {
			if i < len(widths) && len(stripANSI(cell)) > widths[i] {
				widths[i] = len(stripANSI(cell))
			}
		}
	}
	// Header
	fmt.Fprintf(d.a.stdout, "  %s", ansiBold)
	for i, h := range headers {
		fmt.Fprintf(d.a.stdout, "%-*s  ", widths[i], h)
	}
	fmt.Fprintf(d.a.stdout, "%s\n", ansiReset)
	// Sep
	sep := "  "
	for _, w := range widths {
		sep += strings.Repeat("─", w) + "  "
	}
	fmt.Fprintln(d.a.stdout, sep)
	// Rows
	for _, row := range rows {
		fmt.Fprintf(d.a.stdout, "  ")
		for i, cell := range row {
			pad := widths[i] - len(stripANSI(cell))
			if pad < 0 {
				pad = 0
			}
			fmt.Fprintf(d.a.stdout, "%s%s  ", cell, strings.Repeat(" ", pad))
		}
		fmt.Fprintln(d.a.stdout)
	}
}

// stripANSI removes ANSI escape codes for length calculation.
func stripANSI(s string) string {
	var out strings.Builder
	inEsc := false
	for _, c := range s {
		if c == '\033' {
			inEsc = true
			continue
		}
		if inEsc {
			if c == 'm' {
				inEsc = false
			}
			continue
		}
		out.WriteRune(c)
	}
	return out.String()
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// boolIcon returns a colored checkmark or cross.
func boolIcon(v bool) string {
	if v {
		return ansiGreen + "✓" + ansiReset
	}
	return ansiRed + "✗" + ansiReset
}

// conditionIcon returns colored status for k8s condition status.
func conditionIcon(status string) string {
	switch strings.ToLower(status) {
	case "true":
		return ansiGreen + "True" + ansiReset
	case "false":
		return ansiRed + "False" + ansiReset
	default:
		return ansiGray + status + ansiReset
	}
}

// stateColor wraps a pod state with appropriate color.
func stateColor(state string) string {
	switch strings.ToLower(state) {
	case "running":
		return ansiGreen + state + ansiReset
	case "pending", "terminating":
		return ansiYellow + state + ansiReset
	case "failed", "crashloopbackoff", "oomkilled", "error":
		return ansiRed + state + ansiReset
	case "succeeded", "completed":
		return ansiGray + state + ansiReset
	default:
		return state
	}
}

// ─── Full Kubernetes resource detail types ────────────────────────────────────

type fullPod struct {
	Metadata struct {
		Name            string            `json:"name"`
		Namespace       string            `json:"namespace"`
		Labels          map[string]string `json:"labels"`
		Annotations     map[string]string `json:"annotations"`
		OwnerReferences []struct {
			Kind string `json:"kind"`
			Name string `json:"name"`
		} `json:"ownerReferences"`
		CreationTimestamp string `json:"creationTimestamp"`
	} `json:"metadata"`
	Spec struct {
		NodeName          string        `json:"nodeName"`
		ServiceAccountName string       `json:"serviceAccountName"`
		RestartPolicy     string        `json:"restartPolicy"`
		Tolerations       []struct {
			Key      string `json:"key"`
			Operator string `json:"operator"`
			Value    string `json:"value"`
			Effect   string `json:"effect"`
		} `json:"tolerations"`
		Volumes    []struct {
			Name string `json:"name"`
		} `json:"volumes"`
		Containers []struct {
			Name            string   `json:"name"`
			Image           string   `json:"image"`
			ImagePullPolicy string   `json:"imagePullPolicy"`
			Command         []string `json:"command"`
			Args            []string `json:"args"`
			Ports           []struct {
				ContainerPort int    `json:"containerPort"`
				Protocol      string `json:"protocol"`
				Name          string `json:"name"`
			} `json:"ports"`
			Env []struct {
				Name  string `json:"name"`
				Value string `json:"value"`
				ValueFrom *struct {
					FieldRef *struct {
						FieldPath string `json:"fieldPath"`
					} `json:"fieldRef"`
					SecretKeyRef *struct {
						Name string `json:"name"`
						Key  string `json:"key"`
					} `json:"secretKeyRef"`
					ConfigMapKeyRef *struct {
						Name string `json:"name"`
						Key  string `json:"key"`
					} `json:"configMapKeyRef"`
				} `json:"valueFrom"`
			} `json:"env"`
			Resources k8sResourceRequirements `json:"resources"`
			VolumeMounts []struct {
				Name      string `json:"name"`
				MountPath string `json:"mountPath"`
				ReadOnly  bool   `json:"readOnly"`
			} `json:"volumeMounts"`
			ReadinessProbe *struct {
				HTTPGet *struct {
					Path string `json:"path"`
					Port int    `json:"port"`
				} `json:"httpGet"`
				TCPSocket *struct {
					Port int `json:"port"`
				} `json:"tcpSocket"`
				Exec *struct {
					Command []string `json:"command"`
				} `json:"exec"`
				InitialDelaySeconds int `json:"initialDelaySeconds"`
				PeriodSeconds       int `json:"periodSeconds"`
				FailureThreshold    int `json:"failureThreshold"`
			} `json:"readinessProbe"`
			LivenessProbe *struct {
				HTTPGet *struct {
					Path string `json:"path"`
					Port int    `json:"port"`
				} `json:"httpGet"`
				TCPSocket *struct {
					Port int `json:"port"`
				} `json:"tcpSocket"`
				InitialDelaySeconds int `json:"initialDelaySeconds"`
				PeriodSeconds       int `json:"periodSeconds"`
			} `json:"livenessProbe"`
			SecurityContext *struct {
				RunAsUser              *int64 `json:"runAsUser"`
				RunAsNonRoot           *bool  `json:"runAsNonRoot"`
				ReadOnlyRootFilesystem *bool  `json:"readOnlyRootFilesystem"`
				AllowPrivilegeEscalation *bool `json:"allowPrivilegeEscalation"`
				Privileged             *bool  `json:"privileged"`
			} `json:"securityContext"`
		} `json:"containers"`
		InitContainers []struct {
			Name  string `json:"name"`
			Image string `json:"image"`
		} `json:"initContainers"`
	} `json:"spec"`
	Status struct {
		Phase      string `json:"phase"`
		PodIP      string `json:"podIP"`
		HostIP     string `json:"hostIP"`
		StartTime  string `json:"startTime"`
		QosClass   string `json:"qosClass"`
		Conditions []struct {
			Type               string `json:"type"`
			Status             string `json:"status"`
			LastTransitionTime string `json:"lastTransitionTime"`
		} `json:"conditions"`
		ContainerStatuses []struct {
			Name         string `json:"name"`
			Image        string `json:"image"`
			ImageID      string `json:"imageID"`
			ContainerID  string `json:"containerID"`
			Ready        bool   `json:"ready"`
			RestartCount int    `json:"restartCount"`
			State        struct {
				Running *struct {
					StartedAt string `json:"startedAt"`
				} `json:"running"`
				Waiting *struct {
					Reason  string `json:"reason"`
					Message string `json:"message"`
				} `json:"waiting"`
				Terminated *struct {
					Reason     string `json:"reason"`
					ExitCode   int    `json:"exitCode"`
					FinishedAt string `json:"finishedAt"`
				} `json:"terminated"`
			} `json:"state"`
			LastState struct {
				Terminated *struct {
					Reason     string `json:"reason"`
					ExitCode   int    `json:"exitCode"`
					FinishedAt string `json:"finishedAt"`
				} `json:"terminated"`
			} `json:"lastState"`
		} `json:"containerStatuses"`
	} `json:"status"`
}

type fullDeployment struct {
	Metadata struct {
		Name              string            `json:"name"`
		Namespace         string            `json:"namespace"`
		Labels            map[string]string `json:"labels"`
		Annotations       map[string]string `json:"annotations"`
		CreationTimestamp string            `json:"creationTimestamp"`
	} `json:"metadata"`
	Spec struct {
		Replicas int `json:"replicas"`
		Strategy struct {
			Type           string `json:"type"`
			RollingUpdate *struct {
				MaxSurge       interface{} `json:"maxSurge"`
				MaxUnavailable interface{} `json:"maxUnavailable"`
			} `json:"rollingUpdate"`
		} `json:"strategy"`
		MinReadySeconds int `json:"minReadySeconds"`
		Selector        struct {
			MatchLabels map[string]string `json:"matchLabels"`
		} `json:"selector"`
		Template struct {
			Spec struct {
				Containers []struct {
					Name      string                  `json:"name"`
					Image     string                  `json:"image"`
					Resources k8sResourceRequirements `json:"resources"`
					Ports     []struct {
						ContainerPort int    `json:"containerPort"`
						Protocol      string `json:"protocol"`
					} `json:"ports"`
				} `json:"containers"`
			} `json:"spec"`
		} `json:"template"`
	} `json:"spec"`
	Status struct {
		Replicas            int `json:"replicas"`
		ReadyReplicas       int `json:"readyReplicas"`
		AvailableReplicas   int `json:"availableReplicas"`
		UpdatedReplicas     int `json:"updatedReplicas"`
		UnavailableReplicas int `json:"unavailableReplicas"`
		Conditions          []struct {
			Type    string `json:"type"`
			Status  string `json:"status"`
			Reason  string `json:"reason"`
			Message string `json:"message"`
		} `json:"conditions"`
	} `json:"status"`
}

type fullService struct {
	Metadata struct {
		Name              string            `json:"name"`
		Namespace         string            `json:"namespace"`
		Labels            map[string]string `json:"labels"`
		Annotations       map[string]string `json:"annotations"`
		CreationTimestamp string            `json:"creationTimestamp"`
	} `json:"metadata"`
	Spec struct {
		Type        string            `json:"type"`
		ClusterIP   string            `json:"clusterIP"`
		ExternalIPs []string          `json:"externalIPs"`
		Selector    map[string]string `json:"selector"`
		Ports       []struct {
			Name       string `json:"name"`
			Port       int    `json:"port"`
			TargetPort interface{} `json:"targetPort"`
			NodePort   int    `json:"nodePort"`
			Protocol   string `json:"protocol"`
		} `json:"ports"`
		SessionAffinity string `json:"sessionAffinity"`
	} `json:"spec"`
	Status struct {
		LoadBalancer struct {
			Ingress []struct {
				IP       string `json:"ip"`
				Hostname string `json:"hostname"`
			} `json:"ingress"`
		} `json:"loadBalancer"`
	} `json:"status"`
}

type fullNode struct {
	Metadata struct {
		Name              string            `json:"name"`
		Labels            map[string]string `json:"labels"`
		Annotations       map[string]string `json:"annotations"`
		CreationTimestamp string            `json:"creationTimestamp"`
	} `json:"metadata"`
	Spec struct {
		Taints []struct {
			Key    string `json:"key"`
			Value  string `json:"value"`
			Effect string `json:"effect"`
		} `json:"taints"`
		Unschedulable bool `json:"unschedulable"`
	} `json:"spec"`
	Status struct {
		Capacity    map[string]string `json:"capacity"`
		Allocatable map[string]string `json:"allocatable"`
		NodeInfo    struct {
			OSImage                 string `json:"osImage"`
			KubeletVersion          string `json:"kubeletVersion"`
			KubeProxyVersion        string `json:"kubeProxyVersion"`
			ContainerRuntimeVersion string `json:"containerRuntimeVersion"`
			Architecture            string `json:"architecture"`
			KernelVersion           string `json:"kernelVersion"`
		} `json:"nodeInfo"`
		Conditions []struct {
			Type               string `json:"type"`
			Status             string `json:"status"`
			Reason             string `json:"reason"`
			Message            string `json:"message"`
			LastTransitionTime string `json:"lastTransitionTime"`
		} `json:"conditions"`
		Addresses []struct {
			Type    string `json:"type"`
			Address string `json:"address"`
		} `json:"addresses"`
	} `json:"status"`
}

type fullStatefulSet struct {
	Metadata struct {
		Name              string            `json:"name"`
		Namespace         string            `json:"namespace"`
		Labels            map[string]string `json:"labels"`
		CreationTimestamp string            `json:"creationTimestamp"`
	} `json:"metadata"`
	Spec struct {
		Replicas            int    `json:"replicas"`
		ServiceName         string `json:"serviceName"`
		PodManagementPolicy string `json:"podManagementPolicy"`
		UpdateStrategy      struct {
			Type string `json:"type"`
		} `json:"updateStrategy"`
		Selector struct {
			MatchLabels map[string]string `json:"matchLabels"`
		} `json:"selector"`
		VolumeClaimTemplates []struct {
			Metadata struct {
				Name string `json:"name"`
			} `json:"metadata"`
			Spec struct {
				StorageClassName *string  `json:"storageClassName"`
				AccessModes      []string `json:"accessModes"`
				Resources        struct {
					Requests map[string]string `json:"requests"`
				} `json:"resources"`
			} `json:"spec"`
		} `json:"volumeClaimTemplates"`
		Template struct {
			Spec struct {
				Containers []struct {
					Name      string                  `json:"name"`
					Image     string                  `json:"image"`
					Resources k8sResourceRequirements `json:"resources"`
				} `json:"containers"`
			} `json:"spec"`
		} `json:"template"`
	} `json:"spec"`
	Status struct {
		Replicas        int `json:"replicas"`
		ReadyReplicas   int `json:"readyReplicas"`
		CurrentReplicas int `json:"currentReplicas"`
		UpdatedReplicas int `json:"updatedReplicas"`
	} `json:"status"`
}

type fullDaemonSet struct {
	Metadata struct {
		Name              string            `json:"name"`
		Namespace         string            `json:"namespace"`
		Labels            map[string]string `json:"labels"`
		CreationTimestamp string            `json:"creationTimestamp"`
	} `json:"metadata"`
	Spec struct {
		Selector struct {
			MatchLabels map[string]string `json:"matchLabels"`
		} `json:"selector"`
		Template struct {
			Spec struct {
				Containers []struct {
					Name      string                  `json:"name"`
					Image     string                  `json:"image"`
					Resources k8sResourceRequirements `json:"resources"`
				} `json:"containers"`
			} `json:"spec"`
		} `json:"template"`
	} `json:"spec"`
	Status struct {
		DesiredNumberScheduled int `json:"desiredNumberScheduled"`
		CurrentNumberScheduled int `json:"currentNumberScheduled"`
		NumberReady            int `json:"numberReady"`
		NumberAvailable        int `json:"numberAvailable"`
		NumberUnavailable      int `json:"numberUnavailable"`
		UpdatedNumberScheduled int `json:"updatedNumberScheduled"`
		NumberMisscheduled     int `json:"numberMisscheduled"`
	} `json:"status"`
}

type fullJob struct {
	Metadata struct {
		Name              string            `json:"name"`
		Namespace         string            `json:"namespace"`
		Labels            map[string]string `json:"labels"`
		CreationTimestamp string            `json:"creationTimestamp"`
	} `json:"metadata"`
	Spec struct {
		Completions           *int `json:"completions"`
		Parallelism           *int `json:"parallelism"`
		BackoffLimit          *int `json:"backoffLimit"`
		ActiveDeadlineSeconds *int `json:"activeDeadlineSeconds"`
		Template              struct {
			Spec struct {
				Containers []struct {
					Name      string                  `json:"name"`
					Image     string                  `json:"image"`
					Resources k8sResourceRequirements `json:"resources"`
				} `json:"containers"`
			} `json:"spec"`
		} `json:"template"`
	} `json:"spec"`
	Status struct {
		Active         int    `json:"active"`
		Succeeded      int    `json:"succeeded"`
		Failed         int    `json:"failed"`
		StartTime      string `json:"startTime"`
		CompletionTime string `json:"completionTime"`
		Conditions     []struct {
			Type    string `json:"type"`
			Status  string `json:"status"`
			Reason  string `json:"reason"`
			Message string `json:"message"`
		} `json:"conditions"`
	} `json:"status"`
}

type fullCronJob struct {
	Metadata struct {
		Name              string `json:"name"`
		Namespace         string `json:"namespace"`
		CreationTimestamp string `json:"creationTimestamp"`
	} `json:"metadata"`
	Spec struct {
		Schedule                string `json:"schedule"`
		ConcurrencyPolicy       string `json:"concurrencyPolicy"`
		Suspend                 *bool  `json:"suspend"`
		SuccessfulJobsHistory   *int   `json:"successfulJobsHistoryLimit"`
		FailedJobsHistoryLimit  *int   `json:"failedJobsHistoryLimit"`
		StartingDeadlineSeconds *int64 `json:"startingDeadlineSeconds"`
	} `json:"spec"`
	Status struct {
		LastScheduleTime   string `json:"lastScheduleTime"`
		LastSuccessfulTime string `json:"lastSuccessfulTime"`
		Active             []struct {
			Name      string `json:"name"`
			Namespace string `json:"namespace"`
		} `json:"active"`
	} `json:"status"`
}

type fullHPA struct {
	Metadata struct {
		Name              string `json:"name"`
		Namespace         string `json:"namespace"`
		CreationTimestamp string `json:"creationTimestamp"`
	} `json:"metadata"`
	Spec struct {
		ScaleTargetRef struct {
			Kind string `json:"kind"`
			Name string `json:"name"`
		} `json:"scaleTargetRef"`
		MinReplicas                    *int `json:"minReplicas"`
		MaxReplicas                    int  `json:"maxReplicas"`
		TargetCPUUtilizationPercentage *int `json:"targetCPUUtilizationPercentage"`
		Metrics                        []struct {
			Type     string `json:"type"`
			Resource *struct {
				Name   string `json:"name"`
				Target struct {
					Type               string `json:"type"`
					AverageUtilization *int   `json:"averageUtilization"`
					AverageValue       string `json:"averageValue"`
				} `json:"target"`
			} `json:"resource"`
		} `json:"metrics"`
	} `json:"spec"`
	Status struct {
		CurrentReplicas                 int    `json:"currentReplicas"`
		DesiredReplicas                 int    `json:"desiredReplicas"`
		CurrentCPUUtilizationPercentage *int   `json:"currentCPUUtilizationPercentage"`
		LastScaleTime                   string `json:"lastScaleTime"`
		Conditions                      []struct {
			Type    string `json:"type"`
			Status  string `json:"status"`
			Reason  string `json:"reason"`
			Message string `json:"message"`
		} `json:"conditions"`
	} `json:"status"`
}

type fullPVC struct {
	Metadata struct {
		Name              string            `json:"name"`
		Namespace         string            `json:"namespace"`
		Labels            map[string]string `json:"labels"`
		Annotations       map[string]string `json:"annotations"`
		CreationTimestamp string            `json:"creationTimestamp"`
	} `json:"metadata"`
	Spec struct {
		StorageClassName *string  `json:"storageClassName"`
		AccessModes      []string `json:"accessModes"`
		VolumeMode       string   `json:"volumeMode"`
		VolumeName       string   `json:"volumeName"`
		Resources        struct {
			Requests map[string]string `json:"requests"`
		} `json:"resources"`
	} `json:"spec"`
	Status struct {
		Phase    string            `json:"phase"`
		Capacity map[string]string `json:"capacity"`
	} `json:"status"`
}

type fullIngress struct {
	Metadata struct {
		Name              string            `json:"name"`
		Namespace         string            `json:"namespace"`
		Labels            map[string]string `json:"labels"`
		Annotations       map[string]string `json:"annotations"`
		CreationTimestamp string            `json:"creationTimestamp"`
	} `json:"metadata"`
	Spec struct {
		IngressClassName *string `json:"ingressClassName"`
		DefaultBackend   *struct {
			Service struct {
				Name string `json:"name"`
				Port struct {
					Number int    `json:"number"`
					Name   string `json:"name"`
				} `json:"port"`
			} `json:"service"`
		} `json:"defaultBackend"`
		TLS []struct {
			Hosts      []string `json:"hosts"`
			SecretName string   `json:"secretName"`
		} `json:"tls"`
		Rules []struct {
			Host string `json:"host"`
			HTTP *struct {
				Paths []struct {
					Path     string `json:"path"`
					PathType string `json:"pathType"`
					Backend  struct {
						Service struct {
							Name string `json:"name"`
							Port struct {
								Number int    `json:"number"`
								Name   string `json:"name"`
							} `json:"port"`
						} `json:"service"`
					} `json:"backend"`
				} `json:"paths"`
			} `json:"http"`
		} `json:"rules"`
	} `json:"spec"`
	Status struct {
		LoadBalancer struct {
			Ingress []struct {
				IP       string `json:"ip"`
				Hostname string `json:"hostname"`
			} `json:"ingress"`
		} `json:"loadBalancer"`
	} `json:"status"`
}

type fullConfigMap struct {
	Metadata struct {
		Name              string            `json:"name"`
		Namespace         string            `json:"namespace"`
		Labels            map[string]string `json:"labels"`
		CreationTimestamp string            `json:"creationTimestamp"`
	} `json:"metadata"`
	Data       map[string]string `json:"data"`
	BinaryData map[string]string `json:"binaryData"`
}

type fullSecret struct {
	Metadata struct {
		Name              string            `json:"name"`
		Namespace         string            `json:"namespace"`
		Labels            map[string]string `json:"labels"`
		CreationTimestamp string            `json:"creationTimestamp"`
	} `json:"metadata"`
	Type string            `json:"type"`
	Data map[string]string `json:"data"`
}

// ─── kcli pod details ──────────────────────────────────────────────────────────

func newPodDetailsCmd(a *app) *cobra.Command {
	var showEvents bool
	var showAI bool

	cmd := &cobra.Command{
		Use:     "details <pod-name>",
		Short:   "Rich pod details — status, containers, env, resources, events",
		Aliases: []string{"detail", "info", "show"},
		Args:    cobra.ExactArgs(1),
		Example: `  kcli pod details my-pod-6d8f9c7b8-xk2p4
  kcli pod details my-pod -n production
  kcli pod details my-pod --events
  kcli pod details my-pod --ai`,
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]
			ns := a.namespace

			getArgs := []string{"get", "pod", name, "-o", "json"}
			if ns != "" {
				getArgs = append([]string{"-n", ns}, getArgs...)
			} else {
				getArgs = append([]string{"-A"}, getArgs...)
			}
			out, err := a.captureKubectl(getArgs)
			if err != nil {
				return fmt.Errorf("pod %q not found: %w", name, err)
			}

			var pod fullPod
			if err := json.Unmarshal([]byte(out), &pod); err != nil {
				return fmt.Errorf("failed to parse pod: %w", err)
			}

			dw := &detailWriter{a: a}
			dw.header("Pod", pod.Metadata.Name, pod.Metadata.Namespace)

			// ── Identity ──────────────────────────────────────────────────
			dw.section("Identity")
			dw.field("Name", pod.Metadata.Name)
			dw.field("Namespace", pod.Metadata.Namespace)
			dw.badge("Phase", pod.Status.Phase)
			dw.field("Node", pod.Spec.NodeName)
			dw.field("Pod IP", pod.Status.PodIP)
			dw.field("Host IP", pod.Status.HostIP)
			dw.field("QoS Class", pod.Status.QosClass)
			dw.field("Restart Policy", pod.Spec.RestartPolicy)
			dw.field("Service Account", pod.Spec.ServiceAccountName)
			if pod.Metadata.CreationTimestamp != "" {
				dw.field("Created", fmtAge(pod.Metadata.CreationTimestamp))
			}
			if pod.Status.StartTime != "" {
				dw.field("Started", fmtAge(pod.Status.StartTime))
			}
			if len(pod.Metadata.OwnerReferences) > 0 {
				owners := make([]string, 0, len(pod.Metadata.OwnerReferences))
				for _, o := range pod.Metadata.OwnerReferences {
					owners = append(owners, fmt.Sprintf("%s/%s", o.Kind, o.Name))
				}
				dw.field("Owned By", strings.Join(owners, ", "))
			}

			// ── Labels ────────────────────────────────────────────────────
			if len(pod.Metadata.Labels) > 0 {
				dw.section("Labels")
				keys := sortedKeys(pod.Metadata.Labels)
				for _, k := range keys {
					fmt.Fprintf(a.stdout, "  %s%s%s=%s\n", ansiGray, k, ansiReset, pod.Metadata.Labels[k])
				}
			}

			// ── Conditions ────────────────────────────────────────────────
			if len(pod.Status.Conditions) > 0 {
				dw.section("Conditions")
				rows := make([][]string, 0, len(pod.Status.Conditions))
				for _, c := range pod.Status.Conditions {
					rows = append(rows, []string{c.Type, conditionIcon(c.Status), fmtAge(c.LastTransitionTime)})
				}
				dw.table([]string{"CONDITION", "STATUS", "SINCE"}, rows)
			}

			// ── Containers ────────────────────────────────────────────────
			for _, cs := range pod.Spec.Containers {
				dw.section(fmt.Sprintf("Container: %s%s%s", ansiYellow, cs.Name, ansiReset))

				// Find matching status
				var cStatus *struct {
					Name         string
					Image        string
					ImageID      string
					ContainerID  string
					Ready        bool
					RestartCount int
					State        struct {
						Running *struct {
							StartedAt string `json:"startedAt"`
						} `json:"running"`
						Waiting *struct {
							Reason  string `json:"reason"`
							Message string `json:"message"`
						} `json:"waiting"`
						Terminated *struct {
							Reason     string `json:"reason"`
							ExitCode   int    `json:"exitCode"`
							FinishedAt string `json:"finishedAt"`
						} `json:"terminated"`
					}
					LastState struct {
						Terminated *struct {
							Reason     string `json:"reason"`
							ExitCode   int    `json:"exitCode"`
							FinishedAt string `json:"finishedAt"`
						} `json:"terminated"`
					}
				}
				for i := range pod.Status.ContainerStatuses {
					if pod.Status.ContainerStatuses[i].Name == cs.Name {
						s := pod.Status.ContainerStatuses[i]
						cStatus = &struct {
							Name         string
							Image        string
							ImageID      string
							ContainerID  string
							Ready        bool
							RestartCount int
							State        struct {
								Running *struct {
									StartedAt string `json:"startedAt"`
								} `json:"running"`
								Waiting *struct {
									Reason  string `json:"reason"`
									Message string `json:"message"`
								} `json:"waiting"`
								Terminated *struct {
									Reason     string `json:"reason"`
									ExitCode   int    `json:"exitCode"`
									FinishedAt string `json:"finishedAt"`
								} `json:"terminated"`
							}
							LastState struct {
								Terminated *struct {
									Reason     string `json:"reason"`
									ExitCode   int    `json:"exitCode"`
									FinishedAt string `json:"finishedAt"`
								} `json:"terminated"`
							}
						}{
							Name:         s.Name,
							Image:        s.Image,
							ImageID:      s.ImageID,
							ContainerID:  s.ContainerID,
							Ready:        s.Ready,
							RestartCount: s.RestartCount,
						}
						// Copy state
						if s.State.Running != nil {
							cStatus.State.Running = &struct {
								StartedAt string `json:"startedAt"`
							}{StartedAt: s.State.Running.StartedAt}
						}
						if s.State.Waiting != nil {
							cStatus.State.Waiting = &struct {
								Reason  string `json:"reason"`
								Message string `json:"message"`
							}{Reason: s.State.Waiting.Reason, Message: s.State.Waiting.Message}
						}
						if s.State.Terminated != nil {
							cStatus.State.Terminated = &struct {
								Reason     string `json:"reason"`
								ExitCode   int    `json:"exitCode"`
								FinishedAt string `json:"finishedAt"`
							}{Reason: s.State.Terminated.Reason, ExitCode: s.State.Terminated.ExitCode, FinishedAt: s.State.Terminated.FinishedAt}
						}
						if s.LastState.Terminated != nil {
							cStatus.LastState.Terminated = &struct {
								Reason     string `json:"reason"`
								ExitCode   int    `json:"exitCode"`
								FinishedAt string `json:"finishedAt"`
							}{Reason: s.LastState.Terminated.Reason, ExitCode: s.LastState.Terminated.ExitCode, FinishedAt: s.LastState.Terminated.FinishedAt}
						}
						break
					}
				}

				dw.field("Image", cs.Image)
				dw.field("Pull Policy", cs.ImagePullPolicy)

				if cStatus != nil {
					dw.field("Ready", boolIcon(cStatus.Ready))
					// Current state
					switch {
					case cStatus.State.Running != nil:
						dw.fieldColor("State", "Running (started: "+fmtAge(cStatus.State.Running.StartedAt)+")", ansiGreen)
					case cStatus.State.Waiting != nil:
						msg := cStatus.State.Waiting.Reason
						if cStatus.State.Waiting.Message != "" {
							msg += " — " + truncate(cStatus.State.Waiting.Message, 60)
						}
						dw.fieldColor("State", msg, ansiYellow)
					case cStatus.State.Terminated != nil:
						t := cStatus.State.Terminated
						dw.fieldColor("State", fmt.Sprintf("Terminated (exit %d: %s)", t.ExitCode, t.Reason), ansiRed)
					}

					// Restart count with color
					restartStr := fmt.Sprintf("%d", cStatus.RestartCount)
					restartColor := ansiGray
					if cStatus.RestartCount >= 10 {
						restartColor = ansiRed
					} else if cStatus.RestartCount >= 3 {
						restartColor = ansiYellow
					}
					dw.fieldColor("Restarts", restartStr, restartColor)

					// Last state (if relevant)
					if cStatus.LastState.Terminated != nil {
						lt := cStatus.LastState.Terminated
						dw.fieldColor("Previous State",
							fmt.Sprintf("Terminated exit=%d reason=%s at=%s",
								lt.ExitCode, lt.Reason, fmtAge(lt.FinishedAt)),
							ansiGray)
					}

					// Container ID (short)
					if cStatus.ContainerID != "" {
						parts := strings.Split(cStatus.ContainerID, "//")
						id := cStatus.ContainerID
						if len(parts) > 1 {
							id = parts[len(parts)-1]
						}
						if len(id) > 12 {
							id = id[:12]
						}
						dw.field("Container ID", id)
					}
				}

				// Ports
				if len(cs.Ports) > 0 {
					ports := make([]string, 0, len(cs.Ports))
					for _, p := range cs.Ports {
						proto := p.Protocol
						if proto == "" {
							proto = "TCP"
						}
						entry := fmt.Sprintf("%d/%s", p.ContainerPort, proto)
						if p.Name != "" {
							entry = p.Name + ":" + entry
						}
						ports = append(ports, entry)
					}
					dw.field("Ports", strings.Join(ports, ", "))
				}

				// Resources
				if len(cs.Resources.Requests) > 0 || len(cs.Resources.Limits) > 0 {
					fmt.Fprintf(a.stdout, "  %sResources:%s\n", ansiBold, ansiReset)
					if cpu := cs.Resources.Requests["cpu"]; cpu != "" {
						fmt.Fprintf(a.stdout, "    %-22s %s\n", "CPU Request:", cpu)
					}
					if mem := cs.Resources.Requests["memory"]; mem != "" {
						fmt.Fprintf(a.stdout, "    %-22s %s\n", "Memory Request:", mem)
					}
					if cpu := cs.Resources.Limits["cpu"]; cpu != "" {
						fmt.Fprintf(a.stdout, "    %-22s %s\n", "CPU Limit:", cpu)
					}
					if mem := cs.Resources.Limits["memory"]; mem != "" {
						fmt.Fprintf(a.stdout, "    %-22s %s\n", "Memory Limit:", mem)
					}
					// QoS hint
					_, hasCPUReq := cs.Resources.Requests["cpu"]
					_, hasMemReq := cs.Resources.Requests["memory"]
					_, hasCPULim := cs.Resources.Limits["cpu"]
					_, hasMemLim := cs.Resources.Limits["memory"]
					if !hasCPUReq && !hasMemReq {
						fmt.Fprintf(a.stdout, "    %sWARN: No resource requests — BestEffort QoS, first to be evicted!%s\n", ansiYellow, ansiReset)
					} else if !hasCPULim || !hasMemLim {
						fmt.Fprintf(a.stdout, "    %sWARN: No resource limits — risk of resource contention%s\n", ansiYellow, ansiReset)
					}
				} else {
					fmt.Fprintf(a.stdout, "  %sResources:           %sNone set (BestEffort — no requests or limits!)%s\n",
						ansiBold, ansiRed, ansiReset)
				}

				// Security context
				if cs.SecurityContext != nil {
					sc := cs.SecurityContext
					fmt.Fprintf(a.stdout, "  %sSecurity Context:%s\n", ansiBold, ansiReset)
					if sc.RunAsUser != nil {
						fmt.Fprintf(a.stdout, "    %-22s %d\n", "Run As User:", *sc.RunAsUser)
					}
					if sc.RunAsNonRoot != nil {
						fmt.Fprintf(a.stdout, "    %-22s %s\n", "Run As Non-Root:", boolIcon(*sc.RunAsNonRoot))
					}
					if sc.ReadOnlyRootFilesystem != nil {
						fmt.Fprintf(a.stdout, "    %-22s %s\n", "Read-Only FS:", boolIcon(*sc.ReadOnlyRootFilesystem))
					}
					if sc.AllowPrivilegeEscalation != nil {
						fmt.Fprintf(a.stdout, "    %-22s %s\n", "Allow Priv Escalation:", boolIcon(*sc.AllowPrivilegeEscalation))
					}
					if sc.Privileged != nil && *sc.Privileged {
						fmt.Fprintf(a.stdout, "    %sWARN: Container is running as PRIVILEGED%s\n", ansiRed+ansiBold, ansiReset)
					}
				}

				// Environment
				if len(cs.Env) > 0 {
					fmt.Fprintf(a.stdout, "  %sEnvironment Variables:%s\n", ansiBold, ansiReset)
					for _, e := range cs.Env {
						val := e.Value
						if e.ValueFrom != nil {
							switch {
							case e.ValueFrom.FieldRef != nil:
								val = fmt.Sprintf("%s(fieldRef: %s)%s", ansiGray, e.ValueFrom.FieldRef.FieldPath, ansiReset)
							case e.ValueFrom.SecretKeyRef != nil:
								val = fmt.Sprintf("%s(secretRef: %s/%s)%s", ansiGray, e.ValueFrom.SecretKeyRef.Name, e.ValueFrom.SecretKeyRef.Key, ansiReset)
							case e.ValueFrom.ConfigMapKeyRef != nil:
								val = fmt.Sprintf("%s(configMapRef: %s/%s)%s", ansiGray, e.ValueFrom.ConfigMapKeyRef.Name, e.ValueFrom.ConfigMapKeyRef.Key, ansiReset)
							}
						}
						// Redact likely secrets
						lName := strings.ToLower(e.Name)
						if strings.Contains(lName, "password") || strings.Contains(lName, "secret") || strings.Contains(lName, "token") || strings.Contains(lName, "key") {
							val = ansiGray + "***redacted***" + ansiReset
						}
						fmt.Fprintf(a.stdout, "    %s%-30s%s %s\n", ansiGray, e.Name, ansiReset, val)
					}
				}

				// Probes
				if cs.ReadinessProbe != nil {
					p := cs.ReadinessProbe
					probeStr := formatProbe(p.HTTPGet != nil, p.TCPSocket != nil, p.Exec != nil,
						p.InitialDelaySeconds, p.PeriodSeconds, p.FailureThreshold)
					dw.field("Readiness Probe", probeStr)
				} else {
					dw.fieldColor("Readiness Probe", "Not configured (pod may receive traffic before ready)", ansiYellow)
				}
				if cs.LivenessProbe != nil {
					p := cs.LivenessProbe
					probeStr := formatProbe(p.HTTPGet != nil, p.TCPSocket != nil, false,
						p.InitialDelaySeconds, p.PeriodSeconds, 0)
					dw.field("Liveness Probe", probeStr)
				} else {
					dw.fieldColor("Liveness Probe", "Not configured (crashes may not trigger restart)", ansiYellow)
				}
			}

			// ── Init Containers ───────────────────────────────────────────
			if len(pod.Spec.InitContainers) > 0 {
				dw.section("Init Containers")
				for _, ic := range pod.Spec.InitContainers {
					fmt.Fprintf(a.stdout, "  %s%-20s%s %s\n", ansiYellow, ic.Name+":", ansiReset, ic.Image)
				}
			}

			// ── Volumes ───────────────────────────────────────────────────
			if len(pod.Spec.Volumes) > 0 {
				dw.section("Volumes")
				for _, v := range pod.Spec.Volumes {
					fmt.Fprintf(a.stdout, "  - %s\n", v.Name)
				}
			}

			// ── Tolerations ───────────────────────────────────────────────
			if len(pod.Spec.Tolerations) > 0 {
				dw.section("Tolerations")
				for _, t := range pod.Spec.Tolerations {
					if t.Key == "" {
						continue // skip default tolerations
					}
					fmt.Fprintf(a.stdout, "  %s=%s %s %s\n", t.Key, t.Value, t.Effect, t.Operator)
				}
			}

			// ── Events ────────────────────────────────────────────────────
			if showEvents {
				dw.section("Recent Events")
				evOut, err := a.captureKubectl([]string{
					"get", "events",
					"--field-selector", fmt.Sprintf("involvedObject.name=%s", pod.Metadata.Name),
					"-n", pod.Metadata.Namespace,
					"--sort-by=.lastTimestamp",
				})
				if err == nil && strings.TrimSpace(evOut) != "" {
					fmt.Fprintln(a.stdout, evOut)
				} else {
					fmt.Fprintf(a.stdout, "  %sNo recent events%s\n", ansiGray, ansiReset)
				}
			}

			// ── AI Diagnosis ──────────────────────────────────────────────
			if showAI {
				client := a.aiClient()
				if client.Enabled() {
					dw.section("AI Diagnosis")
					prompt := fmt.Sprintf("Analyze this Kubernetes pod and provide:\n1. Health assessment\n2. Any issues detected\n3. Recommended actions\n\nPod: %s/%s\nPhase: %s\nQoS: %s\nContainers: %d\nTotal Restarts: %d\nConditions: %v",
						pod.Metadata.Namespace, pod.Metadata.Name,
						pod.Status.Phase, pod.Status.QosClass,
						len(pod.Spec.Containers),
						func() int {
							t := 0
							for _, cs := range pod.Status.ContainerStatuses {
								t += cs.RestartCount
							}
							return t
						}(),
						func() []string {
							conds := make([]string, 0)
							for _, c := range pod.Status.Conditions {
								conds = append(conds, c.Type+"="+c.Status)
							}
							return conds
						}(),
					)
					result, err := client.Analyze(context.Background(), "pod-details", prompt)
					if err == nil {
						fmt.Fprintln(a.stdout, result)
					}
				} else {
					fmt.Fprintf(a.stdout, "  %sAI not configured. Run: kcli config set ai.provider openai%s\n", ansiGray, ansiReset)
				}
			}

			// ── Quick actions tip ─────────────────────────────────────────
			fmt.Fprintf(a.stdout, "\n%sQuick Actions:%s\n", ansiBold, ansiReset)
			fmt.Fprintf(a.stdout, "  kcli logs %s/%s\n", pod.Metadata.Namespace, pod.Metadata.Name)
			fmt.Fprintf(a.stdout, "  kcli exec -n %s %s -- /bin/sh\n", pod.Metadata.Namespace, pod.Metadata.Name)
			fmt.Fprintf(a.stdout, "  kcli delete pod %s -n %s\n\n", pod.Metadata.Name, pod.Metadata.Namespace)
			return nil
		},
	}
	cmd.Flags().BoolVar(&showEvents, "events", false, "show recent events for this pod")
	cmd.Flags().BoolVar(&showAI, "ai", false, "AI diagnosis of pod health")
	return cmd
}

// ─── kcli deployment details ──────────────────────────────────────────────────

func newDeploymentDetailsCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:     "details <deployment-name>",
		Short:   "Rich deployment details — replicas, strategy, containers, conditions",
		Aliases: []string{"detail", "info", "show"},
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]
			getArgs := []string{"get", "deployment", name, "-o", "json"}
			if a.namespace != "" {
				getArgs = append([]string{"-n", a.namespace}, getArgs...)
			}
			out, err := a.captureKubectl(getArgs)
			if err != nil {
				return fmt.Errorf("deployment %q not found: %w", name, err)
			}
			var d fullDeployment
			if err := json.Unmarshal([]byte(out), &d); err != nil {
				return fmt.Errorf("failed to parse deployment: %w", err)
			}

			dw := &detailWriter{a: a}
			dw.header("Deployment", d.Metadata.Name, d.Metadata.Namespace)

			dw.section("Identity")
			dw.field("Name", d.Metadata.Name)
			dw.field("Namespace", d.Metadata.Namespace)
			dw.field("Created", fmtAge(d.Metadata.CreationTimestamp))
			if len(d.Metadata.Labels) > 0 {
				dw.field("Labels", labelsStr(d.Metadata.Labels))
			}

			dw.section("Replica Status")
			desired := d.Spec.Replicas
			ready := d.Status.ReadyReplicas
			available := d.Status.AvailableReplicas
			updated := d.Status.UpdatedReplicas
			unavail := d.Status.UnavailableReplicas

			healthColor := ansiGreen
			if unavail > 0 || ready < desired {
				healthColor = ansiYellow
			}
			if ready == 0 && desired > 0 {
				healthColor = ansiRed
			}
			dw.fieldColor("Health",
				fmt.Sprintf("%d/%d ready, %d available, %d updated, %d unavailable",
					ready, desired, available, updated, unavail),
				healthColor)
			dw.field("Desired Replicas", fmt.Sprintf("%d", desired))
			dw.field("Ready Replicas", colorizeCount(ready, desired))
			dw.field("Available Replicas", fmt.Sprintf("%d", available))
			dw.field("Updated Replicas", fmt.Sprintf("%d", updated))
			if unavail > 0 {
				dw.fieldColor("Unavailable Replicas", fmt.Sprintf("%d", unavail), ansiRed)
			}

			dw.section("Rollout Strategy")
			dw.field("Strategy", d.Spec.Strategy.Type)
			if d.Spec.Strategy.RollingUpdate != nil {
				ru := d.Spec.Strategy.RollingUpdate
				dw.field("Max Surge", fmt.Sprintf("%v", ru.MaxSurge))
				dw.field("Max Unavailable", fmt.Sprintf("%v", ru.MaxUnavailable))
			}
			if d.Spec.MinReadySeconds > 0 {
				dw.field("Min Ready Seconds", fmt.Sprintf("%d", d.Spec.MinReadySeconds))
			}

			dw.section("Selector")
			if len(d.Spec.Selector.MatchLabels) > 0 {
				for k, v := range d.Spec.Selector.MatchLabels {
					fmt.Fprintf(a.stdout, "  %s%s%s=%s\n", ansiGray, k, ansiReset, v)
				}
			}

			dw.section("Containers")
			for _, c := range d.Spec.Template.Spec.Containers {
				fmt.Fprintf(a.stdout, "  %s%s%s — %s\n", ansiYellow, c.Name, ansiReset, c.Image)
				if len(c.Resources.Requests) > 0 {
					fmt.Fprintf(a.stdout, "    Requests: CPU=%s  Memory=%s\n",
						orDash(c.Resources.Requests["cpu"]),
						orDash(c.Resources.Requests["memory"]))
				}
				if len(c.Resources.Limits) > 0 {
					fmt.Fprintf(a.stdout, "    Limits:   CPU=%s  Memory=%s\n",
						orDash(c.Resources.Limits["cpu"]),
						orDash(c.Resources.Limits["memory"]))
				}
				// Cost estimate
				cpuCost := parseCPUCores(c.Resources.Requests["cpu"]) * defaultCPUPricePerCoreHour * hoursPerMonth
				memCost := parseMemGiB(c.Resources.Requests["memory"]) * defaultMemPricePerGiBHour * hoursPerMonth
				totalCost := (cpuCost + memCost) * float64(desired)
				if totalCost > 0 {
					fmt.Fprintf(a.stdout, "    Est. Cost: %s/month (for %d replicas)\n",
						colorCost(totalCost), desired)
				}
			}

			dw.section("Conditions")
			if len(d.Status.Conditions) > 0 {
				rows := make([][]string, 0, len(d.Status.Conditions))
				for _, c := range d.Status.Conditions {
					msg := truncate(c.Message, 50)
					rows = append(rows, []string{c.Type, conditionIcon(c.Status), c.Reason, msg})
				}
				dw.table([]string{"TYPE", "STATUS", "REASON", "MESSAGE"}, rows)
			}

			fmt.Fprintf(a.stdout, "\n%sQuick Actions:%s\n", ansiBold, ansiReset)
			fmt.Fprintf(a.stdout, "  kcli rollout status deployment/%s -n %s\n", d.Metadata.Name, d.Metadata.Namespace)
			fmt.Fprintf(a.stdout, "  kcli rollout history deployment/%s -n %s\n", d.Metadata.Name, d.Metadata.Namespace)
			fmt.Fprintf(a.stdout, "  kcli scale deployment/%s --replicas=3 -n %s\n\n", d.Metadata.Name, d.Metadata.Namespace)
			return nil
		},
	}
}

// ─── kcli service details ─────────────────────────────────────────────────────

func newServiceDetailsCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:     "details <service-name>",
		Short:   "Rich service details — type, ports, selectors, endpoints",
		Aliases: []string{"detail", "info", "show"},
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]
			getArgs := []string{"get", "service", name, "-o", "json"}
			if a.namespace != "" {
				getArgs = append([]string{"-n", a.namespace}, getArgs...)
			}
			out, err := a.captureKubectl(getArgs)
			if err != nil {
				return fmt.Errorf("service %q not found: %w", name, err)
			}
			var svc fullService
			if err := json.Unmarshal([]byte(out), &svc); err != nil {
				return fmt.Errorf("failed to parse service: %w", err)
			}

			dw := &detailWriter{a: a}
			dw.header("Service", svc.Metadata.Name, svc.Metadata.Namespace)

			dw.section("Identity")
			dw.field("Name", svc.Metadata.Name)
			dw.field("Namespace", svc.Metadata.Namespace)
			dw.badge("Type", svc.Spec.Type)
			dw.field("Cluster IP", svc.Spec.ClusterIP)
			dw.field("Created", fmtAge(svc.Metadata.CreationTimestamp))
			if len(svc.Spec.ExternalIPs) > 0 {
				dw.field("External IPs", strings.Join(svc.Spec.ExternalIPs, ", "))
			}
			if len(svc.Status.LoadBalancer.Ingress) > 0 {
				addrs := make([]string, 0)
				for _, i := range svc.Status.LoadBalancer.Ingress {
					if i.IP != "" {
						addrs = append(addrs, i.IP)
					}
					if i.Hostname != "" {
						addrs = append(addrs, i.Hostname)
					}
				}
				dw.fieldColor("LoadBalancer", strings.Join(addrs, ", "), ansiGreen)
			}
			dw.field("Session Affinity", orNone(svc.Spec.SessionAffinity))

			if len(svc.Spec.Ports) > 0 {
				dw.section("Ports")
				rows := make([][]string, 0, len(svc.Spec.Ports))
				for _, p := range svc.Spec.Ports {
					proto := p.Protocol
					if proto == "" {
						proto = "TCP"
					}
					np := ""
					if p.NodePort > 0 {
						np = fmt.Sprintf("%d", p.NodePort)
					}
					rows = append(rows, []string{orDash(p.Name), proto, fmt.Sprintf("%d", p.Port), fmt.Sprintf("%v", p.TargetPort), orDash(np)})
				}
				dw.table([]string{"NAME", "PROTOCOL", "PORT", "TARGET PORT", "NODE PORT"}, rows)
			}

			if len(svc.Spec.Selector) > 0 {
				dw.section("Selector")
				for k, v := range svc.Spec.Selector {
					fmt.Fprintf(a.stdout, "  %s%s%s=%s\n", ansiGray, k, ansiReset, v)
				}
			}

			// Fetch endpoints
			epArgs := []string{"get", "endpoints", name, "-o", "json"}
			if a.namespace != "" {
				epArgs = append([]string{"-n", a.namespace}, epArgs...)
			}
			if epOut, err := a.captureKubectl(epArgs); err == nil {
				var ep struct {
					Subsets []struct {
						Addresses []struct {
							IP        string `json:"ip"`
							NodeName  string `json:"nodeName"`
							TargetRef *struct {
								Name string `json:"name"`
							} `json:"targetRef"`
						} `json:"addresses"`
						Ports []struct {
							Port     int    `json:"port"`
							Protocol string `json:"protocol"`
						} `json:"ports"`
					} `json:"subsets"`
				}
				if json.Unmarshal([]byte(epOut), &ep) == nil && len(ep.Subsets) > 0 {
					dw.section("Endpoints")
					for _, sub := range ep.Subsets {
						for _, addr := range sub.Addresses {
							pod := ""
							if addr.TargetRef != nil {
								pod = " → " + addr.TargetRef.Name
							}
							for _, p := range sub.Ports {
								fmt.Fprintf(a.stdout, "  %s:%d%s\n", addr.IP, p.Port, pod)
							}
						}
					}
				} else {
					dw.section("Endpoints")
					fmt.Fprintf(a.stdout, "  %sNo endpoints — check selector matches pod labels%s\n", ansiYellow, ansiReset)
				}
			}

			if len(svc.Metadata.Labels) > 0 {
				dw.section("Labels")
				for k, v := range svc.Metadata.Labels {
					fmt.Fprintf(a.stdout, "  %s%s%s=%s\n", ansiGray, k, ansiReset, v)
				}
			}

			fmt.Fprintf(a.stdout, "\n%sQuick Actions:%s\n", ansiBold, ansiReset)
			fmt.Fprintf(a.stdout, "  kcli port-forward svc/%s <local>:%d -n %s\n\n",
				svc.Metadata.Name, func() int {
					if len(svc.Spec.Ports) > 0 {
						return svc.Spec.Ports[0].Port
					}
					return 80
				}(), svc.Metadata.Namespace)
			return nil
		},
	}
}

// ─── kcli node details ────────────────────────────────────────────────────────

func newNodeDetailsCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:     "details <node-name>",
		Short:   "Rich node details — capacity, allocatable, taints, conditions, pods",
		Aliases: []string{"detail", "info", "show"},
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]
			out, err := a.captureKubectl([]string{"get", "node", name, "-o", "json"})
			if err != nil {
				return fmt.Errorf("node %q not found: %w", name, err)
			}
			var n fullNode
			if err := json.Unmarshal([]byte(out), &n); err != nil {
				return fmt.Errorf("failed to parse node: %w", err)
			}

			dw := &detailWriter{a: a}
			dw.header("Node", n.Metadata.Name, "")

			dw.section("Identity")
			dw.field("Name", n.Metadata.Name)
			dw.field("Created", fmtAge(n.Metadata.CreationTimestamp))
			dw.field("OS", n.Status.NodeInfo.OSImage)
			dw.field("Kernel", n.Status.NodeInfo.KernelVersion)
			dw.field("Architecture", n.Status.NodeInfo.Architecture)
			dw.field("Container Runtime", n.Status.NodeInfo.ContainerRuntimeVersion)
			dw.field("Kubelet", n.Status.NodeInfo.KubeletVersion)
			if n.Spec.Unschedulable {
				dw.fieldColor("Schedulable", "No (cordoned)", ansiRed)
			} else {
				dw.fieldColor("Schedulable", "Yes", ansiGreen)
			}

			// Addresses
			if len(n.Status.Addresses) > 0 {
				dw.section("Addresses")
				for _, addr := range n.Status.Addresses {
					fmt.Fprintf(dw.a.stdout, "  %-20s %s\n", addr.Type+":", addr.Address)
				}
			}

			// Capacity vs Allocatable
			if len(n.Status.Capacity) > 0 || len(n.Status.Allocatable) > 0 {
				dw.section("Resources")
				rows := [][]string{}
				for _, key := range []string{"cpu", "memory", "pods", "ephemeral-storage", "hugepages-1Gi", "hugepages-2Mi"} {
					cap := n.Status.Capacity[key]
					alloc := n.Status.Allocatable[key]
					if cap == "" && alloc == "" {
						continue
					}
					// GPU resources
					for rk := range n.Status.Capacity {
						if strings.Contains(rk, "gpu") && rk == key {
							rows = append(rows, []string{ansiYellow + rk + ansiReset, cap, alloc})
						}
					}
					rows = append(rows, []string{key, cap, alloc})
				}
				// Add any GPU-like resources not in the fixed list
				for rk, rv := range n.Status.Capacity {
					if strings.Contains(rk, "gpu") || strings.Contains(rk, "nvidia") || strings.Contains(rk, "amd") {
						rows = append(rows, []string{ansiYellow + rk + ansiReset, rv, n.Status.Allocatable[rk]})
					}
				}
				dw.table([]string{"RESOURCE", "CAPACITY", "ALLOCATABLE"}, rows)
			}

			// Conditions
			if len(n.Status.Conditions) > 0 {
				dw.section("Conditions")
				rows := make([][]string, 0, len(n.Status.Conditions))
				for _, c := range n.Status.Conditions {
					statusDisplay := conditionIcon(c.Status)
					// For pressure conditions, True is bad
					if c.Type != "Ready" && strings.EqualFold(c.Status, "true") {
						statusDisplay = ansiRed + "True (PROBLEM)" + ansiReset
					}
					rows = append(rows, []string{c.Type, statusDisplay, c.Reason, fmtAge(c.LastTransitionTime)})
				}
				dw.table([]string{"CONDITION", "STATUS", "REASON", "SINCE"}, rows)
			}

			// Taints
			if len(n.Spec.Taints) > 0 {
				dw.section("Taints")
				for _, t := range n.Spec.Taints {
					val := t.Key
					if t.Value != "" {
						val += "=" + t.Value
					}
					fmt.Fprintf(a.stdout, "  %s:%s\n", val, t.Effect)
				}
			}

			// Key labels
			if len(n.Metadata.Labels) > 0 {
				dw.section("Key Labels")
				keyLabels := []string{
					"kubernetes.io/hostname",
					"node.kubernetes.io/instance-type",
					"topology.kubernetes.io/zone",
					"topology.kubernetes.io/region",
					"kubernetes.io/arch",
					"kubernetes.io/os",
					"node-role.kubernetes.io/control-plane",
					"node-role.kubernetes.io/master",
					"beta.kubernetes.io/instance-type",
				}
				for _, lk := range keyLabels {
					if v, ok := n.Metadata.Labels[lk]; ok {
						fmt.Fprintf(a.stdout, "  %s%-50s%s %s\n", ansiGray, lk, ansiReset, v)
					}
				}
			}

			// Pods on this node
			podsOut, err := a.captureKubectl([]string{
				"get", "pods", "-A",
				"--field-selector", fmt.Sprintf("spec.nodeName=%s", n.Metadata.Name),
				"-o", "json",
			})
			if err == nil {
				var pl k8sPodList
				if json.Unmarshal([]byte(podsOut), &pl) == nil && len(pl.Items) > 0 {
					dw.section(fmt.Sprintf("Pods (%d)", len(pl.Items)))
					rows := make([][]string, 0, len(pl.Items))
					for _, p := range pl.Items {
						restarts := 0
						for _, cs := range p.Status.ContainerStatuses {
							restarts += cs.RestartCount
						}
						restartStr := fmt.Sprintf("%d", restarts)
						if restarts >= 10 {
							restartStr = ansiRed + restartStr + ansiReset
						} else if restarts >= 3 {
							restartStr = ansiYellow + restartStr + ansiReset
						}
						rows = append(rows, []string{
							p.Metadata.Namespace,
							p.Metadata.Name,
							stateColor(p.Status.Phase),
							restartStr,
						})
					}
					sort.Slice(rows, func(i, j int) bool {
						return rows[i][0] < rows[j][0]
					})
					dw.table([]string{"NAMESPACE", "POD", "PHASE", "RESTARTS"}, rows)
				}
			}

			fmt.Fprintf(a.stdout, "\n%sQuick Actions:%s\n", ansiBold, ansiReset)
			fmt.Fprintf(a.stdout, "  kcli drain %s --ignore-daemonsets\n", n.Metadata.Name)
			fmt.Fprintf(a.stdout, "  kcli cordon %s\n", n.Metadata.Name)
			fmt.Fprintf(a.stdout, "  kcli top node %s\n\n", n.Metadata.Name)
			return nil
		},
	}
}

// ─── kcli statefulset details ─────────────────────────────────────────────────

func newStatefulSetDetailsCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:     "details <name>",
		Short:   "Rich StatefulSet details — replicas, storage, pods",
		Aliases: []string{"detail", "info", "show"},
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]
			getArgs := []string{"get", "statefulset", name, "-o", "json"}
			if a.namespace != "" {
				getArgs = append([]string{"-n", a.namespace}, getArgs...)
			}
			out, err := a.captureKubectl(getArgs)
			if err != nil {
				return fmt.Errorf("statefulset %q not found: %w", name, err)
			}
			var ss fullStatefulSet
			if err := json.Unmarshal([]byte(out), &ss); err != nil {
				return fmt.Errorf("failed to parse statefulset: %w", err)
			}

			dw := &detailWriter{a: a}
			dw.header("StatefulSet", ss.Metadata.Name, ss.Metadata.Namespace)

			dw.section("Identity")
			dw.field("Name", ss.Metadata.Name)
			dw.field("Namespace", ss.Metadata.Namespace)
			dw.field("Service Name", ss.Spec.ServiceName)
			dw.field("Pod Management", ss.Spec.PodManagementPolicy)
			dw.field("Update Strategy", ss.Spec.UpdateStrategy.Type)
			dw.field("Created", fmtAge(ss.Metadata.CreationTimestamp))

			dw.section("Replica Status")
			dw.field("Desired", fmt.Sprintf("%d", ss.Spec.Replicas))
			dw.field("Ready", colorizeCount(ss.Status.ReadyReplicas, ss.Spec.Replicas))
			dw.field("Current", fmt.Sprintf("%d", ss.Status.CurrentReplicas))
			dw.field("Updated", fmt.Sprintf("%d", ss.Status.UpdatedReplicas))

			dw.section("Containers")
			for _, c := range ss.Spec.Template.Spec.Containers {
				fmt.Fprintf(a.stdout, "  %s%s%s — %s\n", ansiYellow, c.Name, ansiReset, c.Image)
				if len(c.Resources.Requests) > 0 {
					fmt.Fprintf(a.stdout, "    Requests: CPU=%s  Memory=%s\n",
						orDash(c.Resources.Requests["cpu"]),
						orDash(c.Resources.Requests["memory"]))
				}
				if len(c.Resources.Limits) > 0 {
					fmt.Fprintf(a.stdout, "    Limits:   CPU=%s  Memory=%s\n",
						orDash(c.Resources.Limits["cpu"]),
						orDash(c.Resources.Limits["memory"]))
				}
			}

			if len(ss.Spec.VolumeClaimTemplates) > 0 {
				dw.section("Volume Claim Templates")
				for _, vct := range ss.Spec.VolumeClaimTemplates {
					sc := "default"
					if vct.Spec.StorageClassName != nil {
						sc = *vct.Spec.StorageClassName
					}
					storage := vct.Spec.Resources.Requests["storage"]
					fmt.Fprintf(a.stdout, "  %s%s%s — %s (%s) access=%s\n",
						ansiYellow, vct.Metadata.Name, ansiReset,
						storage, sc, strings.Join(vct.Spec.AccessModes, ","))
				}
			}

			fmt.Fprintf(a.stdout, "\n%sQuick Actions:%s\n", ansiBold, ansiReset)
			fmt.Fprintf(a.stdout, "  kcli scale statefulset/%s --replicas=3 -n %s\n", ss.Metadata.Name, ss.Metadata.Namespace)
			fmt.Fprintf(a.stdout, "  kcli rollout status statefulset/%s -n %s\n\n", ss.Metadata.Name, ss.Metadata.Namespace)
			return nil
		},
	}
}

// ─── kcli daemonset details ───────────────────────────────────────────────────

func newDaemonSetDetailsCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:     "details <name>",
		Short:   "Rich DaemonSet details — per-node rollout, readiness",
		Aliases: []string{"detail", "info", "show"},
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]
			getArgs := []string{"get", "daemonset", name, "-o", "json"}
			if a.namespace != "" {
				getArgs = append([]string{"-n", a.namespace}, getArgs...)
			}
			out, err := a.captureKubectl(getArgs)
			if err != nil {
				return fmt.Errorf("daemonset %q not found: %w", name, err)
			}
			var ds fullDaemonSet
			if err := json.Unmarshal([]byte(out), &ds); err != nil {
				return fmt.Errorf("failed to parse daemonset: %w", err)
			}

			dw := &detailWriter{a: a}
			dw.header("DaemonSet", ds.Metadata.Name, ds.Metadata.Namespace)

			dw.section("Identity")
			dw.field("Name", ds.Metadata.Name)
			dw.field("Namespace", ds.Metadata.Namespace)
			dw.field("Created", fmtAge(ds.Metadata.CreationTimestamp))

			dw.section("Rollout Status")
			healthColor := ansiGreen
			if ds.Status.NumberUnavailable > 0 {
				healthColor = ansiYellow
			}
			if ds.Status.NumberReady == 0 && ds.Status.DesiredNumberScheduled > 0 {
				healthColor = ansiRed
			}
			dw.fieldColor("Health",
				fmt.Sprintf("%d/%d ready, %d available, %d unavailable",
					ds.Status.NumberReady, ds.Status.DesiredNumberScheduled,
					ds.Status.NumberAvailable, ds.Status.NumberUnavailable),
				healthColor)
			dw.field("Desired", fmt.Sprintf("%d", ds.Status.DesiredNumberScheduled))
			dw.field("Current", fmt.Sprintf("%d", ds.Status.CurrentNumberScheduled))
			dw.field("Ready", fmt.Sprintf("%d", ds.Status.NumberReady))
			dw.field("Updated", fmt.Sprintf("%d", ds.Status.UpdatedNumberScheduled))
			dw.field("Available", fmt.Sprintf("%d", ds.Status.NumberAvailable))
			if ds.Status.NumberUnavailable > 0 {
				dw.fieldColor("Unavailable", fmt.Sprintf("%d", ds.Status.NumberUnavailable), ansiRed)
			}
			if ds.Status.NumberMisscheduled > 0 {
				dw.fieldColor("Misscheduled", fmt.Sprintf("%d", ds.Status.NumberMisscheduled), ansiYellow)
			}

			dw.section("Containers")
			for _, c := range ds.Spec.Template.Spec.Containers {
				fmt.Fprintf(a.stdout, "  %s%s%s — %s\n", ansiYellow, c.Name, ansiReset, c.Image)
				if len(c.Resources.Requests) > 0 {
					fmt.Fprintf(a.stdout, "    Requests: CPU=%s  Memory=%s\n",
						orDash(c.Resources.Requests["cpu"]),
						orDash(c.Resources.Requests["memory"]))
				}
				if len(c.Resources.Limits) > 0 {
					fmt.Fprintf(a.stdout, "    Limits:   CPU=%s  Memory=%s\n",
						orDash(c.Resources.Limits["cpu"]),
						orDash(c.Resources.Limits["memory"]))
				}
			}

			fmt.Fprintf(a.stdout, "\n%sQuick Actions:%s\n", ansiBold, ansiReset)
			fmt.Fprintf(a.stdout, "  kcli rollout status daemonset/%s -n %s\n\n", ds.Metadata.Name, ds.Metadata.Namespace)
			return nil
		},
	}
}

// ─── kcli job details ─────────────────────────────────────────────────────────

func newJobDetailsCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:     "details <name>",
		Short:   "Rich Job details — completion status, duration, pod hints",
		Aliases: []string{"detail", "info", "show"},
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]
			getArgs := []string{"get", "job", name, "-o", "json"}
			if a.namespace != "" {
				getArgs = append([]string{"-n", a.namespace}, getArgs...)
			}
			out, err := a.captureKubectl(getArgs)
			if err != nil {
				return fmt.Errorf("job %q not found: %w", name, err)
			}
			var j fullJob
			if err := json.Unmarshal([]byte(out), &j); err != nil {
				return fmt.Errorf("failed to parse job: %w", err)
			}

			dw := &detailWriter{a: a}
			dw.header("Job", j.Metadata.Name, j.Metadata.Namespace)

			dw.section("Identity")
			dw.field("Name", j.Metadata.Name)
			dw.field("Namespace", j.Metadata.Namespace)
			dw.field("Created", fmtAge(j.Metadata.CreationTimestamp))
			if j.Spec.Completions != nil {
				dw.field("Completions", fmt.Sprintf("%d", *j.Spec.Completions))
			}
			if j.Spec.Parallelism != nil {
				dw.field("Parallelism", fmt.Sprintf("%d", *j.Spec.Parallelism))
			}
			if j.Spec.BackoffLimit != nil {
				dw.field("Backoff Limit", fmt.Sprintf("%d", *j.Spec.BackoffLimit))
			}

			dw.section("Status")
			if j.Status.Succeeded > 0 {
				dw.fieldColor("Succeeded", fmt.Sprintf("%d", j.Status.Succeeded), ansiGreen)
			}
			if j.Status.Active > 0 {
				dw.fieldColor("Active", fmt.Sprintf("%d", j.Status.Active), ansiYellow)
			}
			if j.Status.Failed > 0 {
				dw.fieldColor("Failed", fmt.Sprintf("%d", j.Status.Failed), ansiRed)
			}
			if j.Status.StartTime != "" {
				dw.field("Started", fmtAge(j.Status.StartTime))
			}
			if j.Status.CompletionTime != "" {
				dw.field("Completed", fmtAge(j.Status.CompletionTime))
				// Duration
				start, err1 := time.Parse(time.RFC3339, j.Status.StartTime)
				end, err2 := time.Parse(time.RFC3339, j.Status.CompletionTime)
				if err1 == nil && err2 == nil {
					dw.field("Duration", end.Sub(start).Round(time.Second).String())
				}
			}

			if len(j.Status.Conditions) > 0 {
				dw.section("Conditions")
				for _, c := range j.Status.Conditions {
					msg := truncate(c.Message, 60)
					fmt.Fprintf(a.stdout, "  %s: %s — %s\n", c.Type, conditionIcon(c.Status), msg)
				}
			}

			dw.section("Container")
			for _, c := range j.Spec.Template.Spec.Containers {
				fmt.Fprintf(a.stdout, "  %s%s%s — %s\n", ansiYellow, c.Name, ansiReset, c.Image)
			}

			fmt.Fprintf(a.stdout, "\n%sQuick Actions:%s\n", ansiBold, ansiReset)
			fmt.Fprintf(a.stdout, "  kcli logs -l job-name=%s -n %s\n", j.Metadata.Name, j.Metadata.Namespace)
			fmt.Fprintf(a.stdout, "  kcli get pods -l job-name=%s -n %s\n\n", j.Metadata.Name, j.Metadata.Namespace)
			return nil
		},
	}
}

// ─── kcli cronjob details ─────────────────────────────────────────────────────

func newCronJobDetailsCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:     "details <name>",
		Short:   "Rich CronJob details — schedule, history, next run",
		Aliases: []string{"detail", "info", "show"},
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]
			getArgs := []string{"get", "cronjob", name, "-o", "json"}
			if a.namespace != "" {
				getArgs = append([]string{"-n", a.namespace}, getArgs...)
			}
			out, err := a.captureKubectl(getArgs)
			if err != nil {
				return fmt.Errorf("cronjob %q not found: %w", name, err)
			}
			var cj fullCronJob
			if err := json.Unmarshal([]byte(out), &cj); err != nil {
				return fmt.Errorf("failed to parse cronjob: %w", err)
			}

			dw := &detailWriter{a: a}
			dw.header("CronJob", cj.Metadata.Name, cj.Metadata.Namespace)

			dw.section("Schedule")
			dw.field("Name", cj.Metadata.Name)
			dw.field("Namespace", cj.Metadata.Namespace)
			dw.fieldColor("Schedule (cron)", cj.Spec.Schedule, ansiYellow)
			if cj.Spec.Suspend != nil && *cj.Spec.Suspend {
				dw.fieldColor("Suspended", "Yes", ansiRed)
			} else {
				dw.fieldColor("Suspended", "No", ansiGreen)
			}
			dw.field("Concurrency Policy", cj.Spec.ConcurrencyPolicy)
			if cj.Spec.SuccessfulJobsHistory != nil {
				dw.field("Success History Limit", fmt.Sprintf("%d", *cj.Spec.SuccessfulJobsHistory))
			}
			if cj.Spec.FailedJobsHistoryLimit != nil {
				dw.field("Failed History Limit", fmt.Sprintf("%d", *cj.Spec.FailedJobsHistoryLimit))
			}
			dw.field("Created", fmtAge(cj.Metadata.CreationTimestamp))

			dw.section("Execution History")
			if cj.Status.LastScheduleTime != "" {
				dw.field("Last Scheduled", fmtAge(cj.Status.LastScheduleTime))
			}
			if cj.Status.LastSuccessfulTime != "" {
				dw.fieldColor("Last Successful", fmtAge(cj.Status.LastSuccessfulTime), ansiGreen)
			}
			if len(cj.Status.Active) > 0 {
				dw.fieldColor("Active Jobs", fmt.Sprintf("%d running", len(cj.Status.Active)), ansiYellow)
				for _, aj := range cj.Status.Active {
					fmt.Fprintf(a.stdout, "    - %s/%s\n", aj.Namespace, aj.Name)
				}
			}

			fmt.Fprintf(a.stdout, "\n%sQuick Actions:%s\n", ansiBold, ansiReset)
			fmt.Fprintf(a.stdout, "  kcli create job %s-manual --from=cronjob/%s -n %s\n",
				cj.Metadata.Name, cj.Metadata.Name, cj.Metadata.Namespace)
			fmt.Fprintf(a.stdout, "  kcli get jobs -l app=%s -n %s\n\n", cj.Metadata.Name, cj.Metadata.Namespace)
			return nil
		},
	}
}

// ─── kcli hpa details ─────────────────────────────────────────────────────────

func newHPADetailsCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:     "details <name>",
		Short:   "Rich HPA details — current/desired replicas, metrics, conditions",
		Aliases: []string{"detail", "info", "show"},
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]
			getArgs := []string{"get", "hpa", name, "-o", "json"}
			if a.namespace != "" {
				getArgs = append([]string{"-n", a.namespace}, getArgs...)
			}
			out, err := a.captureKubectl(getArgs)
			if err != nil {
				return fmt.Errorf("hpa %q not found: %w", name, err)
			}
			var hpa fullHPA
			if err := json.Unmarshal([]byte(out), &hpa); err != nil {
				return fmt.Errorf("failed to parse hpa: %w", err)
			}

			dw := &detailWriter{a: a}
			dw.header("HorizontalPodAutoscaler", hpa.Metadata.Name, hpa.Metadata.Namespace)

			dw.section("Target")
			dw.field("Name", hpa.Metadata.Name)
			dw.field("Namespace", hpa.Metadata.Namespace)
			dw.field("Scale Target", fmt.Sprintf("%s/%s", hpa.Spec.ScaleTargetRef.Kind, hpa.Spec.ScaleTargetRef.Name))
			dw.field("Created", fmtAge(hpa.Metadata.CreationTimestamp))

			dw.section("Replica Bounds")
			minR := 1
			if hpa.Spec.MinReplicas != nil {
				minR = *hpa.Spec.MinReplicas
			}
			dw.field("Min Replicas", fmt.Sprintf("%d", minR))
			dw.field("Max Replicas", fmt.Sprintf("%d", hpa.Spec.MaxReplicas))
			dw.field("Current Replicas", fmt.Sprintf("%d", hpa.Status.CurrentReplicas))

			desired := hpa.Status.DesiredReplicas
			desiredColor := ansiGreen
			if desired >= hpa.Spec.MaxReplicas {
				desiredColor = ansiRed // hitting the ceiling
			} else if desired > (hpa.Spec.MaxReplicas*3/4) {
				desiredColor = ansiYellow
			}
			dw.fieldColor("Desired Replicas", fmt.Sprintf("%d", desired), desiredColor)
			if hpa.Status.LastScaleTime != "" {
				dw.field("Last Scaled", fmtAge(hpa.Status.LastScaleTime))
			}

			dw.section("Metrics")
			if hpa.Spec.TargetCPUUtilizationPercentage != nil {
				target := *hpa.Spec.TargetCPUUtilizationPercentage
				line := fmt.Sprintf("Target: %d%%", target)
				if hpa.Status.CurrentCPUUtilizationPercentage != nil {
					cur := *hpa.Status.CurrentCPUUtilizationPercentage
					color := ansiGreen
					if cur > target {
						color = ansiRed
					} else if cur > target*80/100 {
						color = ansiYellow
					}
					line += fmt.Sprintf(" / Current: %s%d%%%s", color, cur, ansiReset)
				}
				dw.field("CPU Utilization", line)
			}
			for _, m := range hpa.Spec.Metrics {
				if m.Resource != nil {
					t := m.Resource.Target
					dw.field("Metric: "+m.Resource.Name,
						fmt.Sprintf("type=%s target=%v", t.Type, func() interface{} {
							if t.AverageUtilization != nil {
								return fmt.Sprintf("%d%%", *t.AverageUtilization)
							}
							return t.AverageValue
						}()))
				}
			}

			if len(hpa.Status.Conditions) > 0 {
				dw.section("Conditions")
				rows := make([][]string, 0)
				for _, c := range hpa.Status.Conditions {
					rows = append(rows, []string{c.Type, conditionIcon(c.Status), truncate(c.Reason, 25), truncate(c.Message, 40)})
				}
				dw.table([]string{"TYPE", "STATUS", "REASON", "MESSAGE"}, rows)
			}

			fmt.Fprintf(a.stdout, "\n%sQuick Actions:%s\n", ansiBold, ansiReset)
			fmt.Fprintf(a.stdout, "  kcli describe hpa/%s -n %s\n\n", hpa.Metadata.Name, hpa.Metadata.Namespace)
			return nil
		},
	}
}

// ─── kcli pvc details ─────────────────────────────────────────────────────────

func newPVCDetailsCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:     "details <name>",
		Short:   "Rich PVC details — phase, capacity, access modes, storage class",
		Aliases: []string{"detail", "info", "show"},
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]
			getArgs := []string{"get", "pvc", name, "-o", "json"}
			if a.namespace != "" {
				getArgs = append([]string{"-n", a.namespace}, getArgs...)
			}
			out, err := a.captureKubectl(getArgs)
			if err != nil {
				return fmt.Errorf("pvc %q not found: %w", name, err)
			}
			var pvc fullPVC
			if err := json.Unmarshal([]byte(out), &pvc); err != nil {
				return fmt.Errorf("failed to parse pvc: %w", err)
			}

			dw := &detailWriter{a: a}
			dw.header("PersistentVolumeClaim", pvc.Metadata.Name, pvc.Metadata.Namespace)

			dw.section("Identity")
			dw.field("Name", pvc.Metadata.Name)
			dw.field("Namespace", pvc.Metadata.Namespace)
			dw.badge("Phase", pvc.Status.Phase)
			dw.field("Volume Mode", orDefault(pvc.Spec.VolumeMode, "Filesystem"))
			if pvc.Spec.VolumeName != "" {
				dw.field("Bound Volume", pvc.Spec.VolumeName)
			}
			dw.field("Created", fmtAge(pvc.Metadata.CreationTimestamp))

			dw.section("Storage")
			sc := "default"
			if pvc.Spec.StorageClassName != nil && *pvc.Spec.StorageClassName != "" {
				sc = *pvc.Spec.StorageClassName
			}
			dw.field("Storage Class", sc)
			if req := pvc.Spec.Resources.Requests["storage"]; req != "" {
				dw.field("Requested Storage", req)
			}
			if cap := pvc.Status.Capacity["storage"]; cap != "" {
				dw.fieldColor("Actual Capacity", cap, ansiGreen)
			}
			dw.field("Access Modes", strings.Join(pvc.Spec.AccessModes, ", "))

			fmt.Fprintf(a.stdout, "\n%sQuick Actions:%s\n", ansiBold, ansiReset)
			fmt.Fprintf(a.stdout, "  kcli describe pvc/%s -n %s\n\n", pvc.Metadata.Name, pvc.Metadata.Namespace)
			return nil
		},
	}
}

// ─── kcli ingress details ─────────────────────────────────────────────────────

func newIngressDetailsCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:     "details <name>",
		Short:   "Rich Ingress details — rules, TLS, backends, load balancer",
		Aliases: []string{"detail", "info", "show"},
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]
			getArgs := []string{"get", "ingress", name, "-o", "json"}
			if a.namespace != "" {
				getArgs = append([]string{"-n", a.namespace}, getArgs...)
			}
			out, err := a.captureKubectl(getArgs)
			if err != nil {
				return fmt.Errorf("ingress %q not found: %w", name, err)
			}
			var ing fullIngress
			if err := json.Unmarshal([]byte(out), &ing); err != nil {
				return fmt.Errorf("failed to parse ingress: %w", err)
			}

			dw := &detailWriter{a: a}
			dw.header("Ingress", ing.Metadata.Name, ing.Metadata.Namespace)

			dw.section("Identity")
			dw.field("Name", ing.Metadata.Name)
			dw.field("Namespace", ing.Metadata.Namespace)
			if ing.Spec.IngressClassName != nil {
				dw.field("Ingress Class", *ing.Spec.IngressClassName)
			}
			dw.field("Created", fmtAge(ing.Metadata.CreationTimestamp))
			if len(ing.Status.LoadBalancer.Ingress) > 0 {
				addrs := make([]string, 0)
				for _, i := range ing.Status.LoadBalancer.Ingress {
					if i.IP != "" {
						addrs = append(addrs, i.IP)
					}
					if i.Hostname != "" {
						addrs = append(addrs, i.Hostname)
					}
				}
				dw.fieldColor("LoadBalancer", strings.Join(addrs, ", "), ansiGreen)
			}

			if len(ing.Spec.TLS) > 0 {
				dw.section("TLS")
				for _, tls := range ing.Spec.TLS {
					fmt.Fprintf(a.stdout, "  Secret: %s%s%s\n", ansiYellow, tls.SecretName, ansiReset)
					fmt.Fprintf(a.stdout, "  Hosts:  %s\n", strings.Join(tls.Hosts, ", "))
				}
			}

			if len(ing.Spec.Rules) > 0 {
				dw.section("Routing Rules")
				for _, rule := range ing.Spec.Rules {
					host := rule.Host
					if host == "" {
						host = "*"
					}
					fmt.Fprintf(a.stdout, "  %sHost: %s%s\n", ansiCyan, host, ansiReset)
					if rule.HTTP != nil {
						for _, path := range rule.HTTP.Paths {
							svc := path.Backend.Service.Name
							port := path.Backend.Service.Port.Number
							if port == 0 {
								port = 80
							}
							pathType := path.PathType
							if pathType == "" {
								pathType = "Prefix"
							}
							fmt.Fprintf(a.stdout, "  %-10s %-30s → %s:%d\n",
								pathType, path.Path, svc, port)
						}
					}
				}
			}

			if ing.Spec.DefaultBackend != nil {
				dw.section("Default Backend")
				svc := ing.Spec.DefaultBackend.Service
				fmt.Fprintf(a.stdout, "  %s:%d\n", svc.Name, svc.Port.Number)
			}

			if len(ing.Metadata.Annotations) > 0 {
				dw.section("Annotations")
				keys := sortedKeys(ing.Metadata.Annotations)
				for _, k := range keys {
					fmt.Fprintf(a.stdout, "  %s%s%s: %s\n", ansiGray, k, ansiReset, truncate(ing.Metadata.Annotations[k], 60))
				}
			}

			fmt.Fprintf(a.stdout, "\n%sQuick Actions:%s\n", ansiBold, ansiReset)
			fmt.Fprintf(a.stdout, "  kcli describe ingress/%s -n %s\n\n", ing.Metadata.Name, ing.Metadata.Namespace)
			return nil
		},
	}
}

// ─── kcli configmap details ───────────────────────────────────────────────────

func newConfigMapDetailsCmd(a *app) *cobra.Command {
	var showValues bool
	cmd := &cobra.Command{
		Use:     "details <name>",
		Short:   "ConfigMap details — keys and sizes",
		Aliases: []string{"detail", "info", "show"},
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]
			getArgs := []string{"get", "configmap", name, "-o", "json"}
			if a.namespace != "" {
				getArgs = append([]string{"-n", a.namespace}, getArgs...)
			}
			out, err := a.captureKubectl(getArgs)
			if err != nil {
				return fmt.Errorf("configmap %q not found: %w", name, err)
			}
			var cm fullConfigMap
			if err := json.Unmarshal([]byte(out), &cm); err != nil {
				return fmt.Errorf("failed to parse configmap: %w", err)
			}

			dw := &detailWriter{a: a}
			dw.header("ConfigMap", cm.Metadata.Name, cm.Metadata.Namespace)

			dw.section("Identity")
			dw.field("Name", cm.Metadata.Name)
			dw.field("Namespace", cm.Metadata.Namespace)
			dw.field("Created", fmtAge(cm.Metadata.CreationTimestamp))
			dw.field("Keys", fmt.Sprintf("%d", len(cm.Data)+len(cm.BinaryData)))

			if len(cm.Data) > 0 {
				dw.section(fmt.Sprintf("Data Keys (%d)", len(cm.Data)))
				keys := sortedKeys(cm.Data)
				for _, k := range keys {
					v := cm.Data[k]
					if showValues {
						preview := strings.ReplaceAll(v, "\n", "↵")
						if len(preview) > 80 {
							preview = preview[:80] + "…"
						}
						fmt.Fprintf(a.stdout, "  %s%-30s%s = %s\n", ansiYellow, k, ansiReset, preview)
					} else {
						fmt.Fprintf(a.stdout, "  %s%-30s%s %s(%d bytes)%s\n",
							ansiYellow, k, ansiReset, ansiGray, len(v), ansiReset)
					}
				}
			}
			if len(cm.BinaryData) > 0 {
				dw.section(fmt.Sprintf("Binary Data Keys (%d)", len(cm.BinaryData)))
				for k, v := range cm.BinaryData {
					fmt.Fprintf(a.stdout, "  %s%-30s%s %s(%d bytes, base64)%s\n",
						ansiYellow, k, ansiReset, ansiGray, len(v), ansiReset)
				}
			}

			if !showValues {
				fmt.Fprintf(a.stdout, "\n%sUse --values to show key contents%s\n", ansiGray, ansiReset)
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&showValues, "values", false, "show key values (truncated at 80 chars)")
	return cmd
}

// ─── kcli secret details ──────────────────────────────────────────────────────

func newSecretDetailsCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:     "details <name>",
		Short:   "Secret details — type and key names (values always redacted)",
		Aliases: []string{"detail", "info", "show"},
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]
			getArgs := []string{"get", "secret", name, "-o", "json"}
			if a.namespace != "" {
				getArgs = append([]string{"-n", a.namespace}, getArgs...)
			}
			out, err := a.captureKubectl(getArgs)
			if err != nil {
				return fmt.Errorf("secret %q not found: %w", name, err)
			}
			var sec fullSecret
			if err := json.Unmarshal([]byte(out), &sec); err != nil {
				return fmt.Errorf("failed to parse secret: %w", err)
			}

			dw := &detailWriter{a: a}
			dw.header("Secret", sec.Metadata.Name, sec.Metadata.Namespace)

			dw.section("Identity")
			dw.field("Name", sec.Metadata.Name)
			dw.field("Namespace", sec.Metadata.Namespace)
			dw.field("Type", sec.Type)
			dw.field("Created", fmtAge(sec.Metadata.CreationTimestamp))
			dw.field("Keys", fmt.Sprintf("%d", len(sec.Data)))

			if len(sec.Data) > 0 {
				dw.section(fmt.Sprintf("Keys (%d) — values always redacted", len(sec.Data)))
				keys := sortedKeys(sec.Data)
				for _, k := range keys {
					fmt.Fprintf(a.stdout, "  %s%-30s%s %s(redacted, %d bytes base64-encoded)%s\n",
						ansiYellow, k, ansiReset, ansiGray, len(sec.Data[k]), ansiReset)
				}
			}

			fmt.Fprintf(a.stdout, "\n%sSecurity note: Secret values are never displayed by kcli.%s\n",
				ansiGray, ansiReset)
			fmt.Fprintf(a.stdout, "%sTo rotate: kubectl create secret ... --dry-run=client -o yaml | kubectl apply -f -%s\n\n",
				ansiGray, ansiReset)
			return nil
		},
	}
}

// ─── Resource parent commands ──────────────────────────────────────────────────

func newPodCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:                "pod",
		Short:              "Pod operations — get, details, logs",
		GroupID:            "core",
		DisableFlagParsing: false,
		RunE: func(cmd *cobra.Command, args []string) error {
			// Default: pass through to kubectl get pod
			return a.runKubectl(append([]string{"get", "pod"}, args...))
		},
	}
	cmd.AddCommand(newPodDetailsCmd(a))
	return cmd
}

func newDeploymentCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "deployment",
		Short:   "Deployment operations — get, details, scale",
		GroupID: "core",
		RunE: func(cmd *cobra.Command, args []string) error {
			return a.runKubectl(append([]string{"get", "deployment"}, args...))
		},
	}
	cmd.AddCommand(newDeploymentDetailsCmd(a))
	return cmd
}

func newServiceCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "service",
		Short:   "Service operations — get, details, port-forward",
		GroupID: "core",
		RunE: func(cmd *cobra.Command, args []string) error {
			return a.runKubectl(append([]string{"get", "service"}, args...))
		},
	}
	cmd.AddCommand(newServiceDetailsCmd(a))
	return cmd
}

func newNodeCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "node",
		Short:   "Node operations — get, details, drain, cordon",
		GroupID: "core",
		RunE: func(cmd *cobra.Command, args []string) error {
			return a.runKubectl(append([]string{"get", "node"}, args...))
		},
	}
	cmd.AddCommand(newNodeDetailsCmd(a))
	return cmd
}

func newStatefulSetCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "statefulset",
		Short:   "StatefulSet operations",
		GroupID: "core",
		RunE: func(cmd *cobra.Command, args []string) error {
			return a.runKubectl(append([]string{"get", "statefulset"}, args...))
		},
	}
	cmd.AddCommand(newStatefulSetDetailsCmd(a))
	return cmd
}

func newDaemonSetCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "daemonset",
		Short:   "DaemonSet operations",
		GroupID: "core",
		RunE: func(cmd *cobra.Command, args []string) error {
			return a.runKubectl(append([]string{"get", "daemonset"}, args...))
		},
	}
	cmd.AddCommand(newDaemonSetDetailsCmd(a))
	return cmd
}

func newJobCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "job",
		Short:   "Job operations",
		GroupID: "core",
		RunE: func(cmd *cobra.Command, args []string) error {
			return a.runKubectl(append([]string{"get", "job"}, args...))
		},
	}
	cmd.AddCommand(newJobDetailsCmd(a))
	return cmd
}

func newCronJobCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "cronjob",
		Short:   "CronJob operations",
		GroupID: "core",
		RunE: func(cmd *cobra.Command, args []string) error {
			return a.runKubectl(append([]string{"get", "cronjob"}, args...))
		},
	}
	cmd.AddCommand(newCronJobDetailsCmd(a))
	return cmd
}

func newHPACmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "hpa",
		Short:   "HorizontalPodAutoscaler operations",
		GroupID: "core",
		RunE: func(cmd *cobra.Command, args []string) error {
			return a.runKubectl(append([]string{"get", "hpa"}, args...))
		},
	}
	cmd.AddCommand(newHPADetailsCmd(a))
	return cmd
}

func newPVCCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "pvc",
		Short:   "PersistentVolumeClaim operations",
		GroupID: "core",
		RunE: func(cmd *cobra.Command, args []string) error {
			return a.runKubectl(append([]string{"get", "pvc"}, args...))
		},
	}
	cmd.AddCommand(newPVCDetailsCmd(a))
	return cmd
}

func newIngressCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "ingress",
		Short:   "Ingress operations",
		GroupID: "core",
		RunE: func(cmd *cobra.Command, args []string) error {
			return a.runKubectl(append([]string{"get", "ingress"}, args...))
		},
	}
	cmd.AddCommand(newIngressDetailsCmd(a))
	return cmd
}

func newConfigMapCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "configmap",
		Short:   "ConfigMap operations",
		GroupID: "core",
		RunE: func(cmd *cobra.Command, args []string) error {
			return a.runKubectl(append([]string{"get", "configmap"}, args...))
		},
	}
	cmd.AddCommand(newConfigMapDetailsCmd(a))
	return cmd
}

func newSecretCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "secret",
		Short:   "Secret operations",
		GroupID: "core",
		RunE: func(cmd *cobra.Command, args []string) error {
			return a.runKubectl(append([]string{"get", "secret"}, args...))
		},
	}
	cmd.AddCommand(newSecretDetailsCmd(a))
	return cmd
}

// ─── Formatting helpers ────────────────────────────────────────────────────────

// fmtAge formats a k8s timestamp as "X ago (YYYY-MM-DD HH:MM)".
func fmtAge(ts string) string {
	if ts == "" {
		return "—"
	}
	t, err := time.Parse(time.RFC3339, ts)
	if err != nil {
		return ts
	}
	age := time.Since(t)
	var ageStr string
	switch {
	case age < time.Minute:
		ageStr = fmt.Sprintf("%ds ago", int(age.Seconds()))
	case age < time.Hour:
		ageStr = fmt.Sprintf("%dm ago", int(age.Minutes()))
	case age < 24*time.Hour:
		ageStr = fmt.Sprintf("%dh%dm ago", int(age.Hours()), int(age.Minutes())%60)
	default:
		ageStr = fmt.Sprintf("%dd ago", int(age.Hours()/24))
	}
	return fmt.Sprintf("%s (%s)", ageStr, t.Local().Format("2006-01-02 15:04"))
}

func formatProbe(hasHTTP, hasTCP, hasExec bool, initialDelay, period, failThreshold int) string {
	kind := "exec"
	if hasHTTP {
		kind = "httpGet"
	} else if hasTCP {
		kind = "tcpSocket"
	}
	s := fmt.Sprintf("%s (delay=%ds, period=%ds", kind, initialDelay, period)
	if failThreshold > 0 {
		s += fmt.Sprintf(", failThreshold=%d", failThreshold)
	}
	s += ")"
	return s
}

func labelsStr(labels map[string]string) string {
	parts := make([]string, 0, len(labels))
	for k, v := range labels {
		parts = append(parts, k+"="+v)
	}
	sort.Strings(parts)
	if len(parts) > 4 {
		return strings.Join(parts[:4], " ") + fmt.Sprintf(" +%d more", len(parts)-4)
	}
	return strings.Join(parts, " ")
}

func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func orDash(s string) string {
	if s == "" {
		return "—"
	}
	return s
}

func orNone(s string) string {
	if s == "" || strings.EqualFold(s, "None") {
		return "None"
	}
	return s
}

func orDefault(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

func colorizeCount(current, desired int) string {
	if desired == 0 {
		return fmt.Sprintf("%d", current)
	}
	if current == desired {
		return fmt.Sprintf("%s%d%s", ansiGreen, current, ansiReset)
	}
	if current == 0 {
		return fmt.Sprintf("%s%d%s", ansiRed, current, ansiReset)
	}
	return fmt.Sprintf("%s%d%s", ansiYellow, current, ansiReset)
}
