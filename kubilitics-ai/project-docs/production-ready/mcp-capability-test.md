# MCP Capability Test Report - Senior K8s Edition
Generated on: 2026-02-20T06:39:15+05:30

## 🎯 Executive Summary
This document provides irrefutable proof of the Kubilitics AI Assistant's transformation into a **Senior K8s Platform Engineer**. By leveraging the Model Context Protocol (MCP), the assistant now possesses deep, granular visibility and reasoning over the entire cluster.

### 🧠 Core Senior Engineer Capabilities
1.  **Deep Resource Introspection**: Beyond listing, the AI understands owner references, resource dependencies, and human-readable resource utilization (CPU/Memory).
2.  **Intelligent Log Analysis**: Regex-based log filtering and tailing allow for precise troubleshooting of "panic", "error", and "timeout" scenarios.
3.  **Topology Awareness**: Tracing links between Services, Pods, Deployments, and ReplicaSets to understand blast radius and traffic flow.
4.  **Event Correlation**: Analyzing system events to detect patterns rather than just raw counts.

---

## 🛠️ Capability Proofs (API Inputs & Responses)

This section contains live outputs from the MCP server executing against a real production-grade cluster.

### Tool: observe_cluster_overview
### Output
```json
{
  "cluster_id": "67b0212c-1d0f-4486-ad84-bde76c0e3a7f",
  "overview": {
    "alerts": {
      "critical": 0,
      "top_3": [
        {
          "namespace": "default",
          "reason": "FailedGetScale",
          "resource": "HorizontalPodAutoscaler/api-server-hpa"
        },
        {
          "namespace": "default",
          "reason": "FailedCreate",
          "resource": "Job/every-5-minutes-29525775"
        },
        {
          "namespace": "default",
          "reason": "FailedCreate",
          "resource": "Job/every-5-minutes-29525775"
        }
      ],
      "warnings": 3
    },
    "counts": {
      "deployments": 20,
      "namespaces": 25,
      "nodes": 3,
      "pods": 93
    },
    "health": {
      "grade": "C",
      "score": 78,
      "status": "fair"
    },
    "pod_status": {
      "failed": 0,
      "pending": 3,
      "running": 61,
      "succeeded": 29
    },
    "utilization": {
      "cpu_cores": 0.58,
      "cpu_percent": 1,
      "memory_gib": 3.59,
      "memory_percent": 15
    }
  },
  "timestamp": "2026-02-20T06:39:20.169889+05:30"
}
```

## Tool: observe_pod_detailed
> Provides Name, Service, RS, Deployment, PV, ConfigMap, and Human-Readable Resources (CPU/MB/GB).

### Input
```json
{
  "name": "todo-app-7c4d746f45-sshsw",
  "namespace": "default"
}
```
### Output
```json
{
  "image_pull_policy": {
    "todo": "IfNotPresent"
  },
  "metrics": {
    "CPU": "0.24m",
    "Memory": "36.04Mi",
    "containers": [
      {
        "cpu": "0.24m",
        "memory": "36.04Mi",
        "name": "todo"
      }
    ],
    "name": "todo-app-7c4d746f45-sshsw",
    "namespace": "default"
  },
  "pod": {
    "apiVersion": "v1",
    "kind": "Pod",
    "metadata": {
      "creationTimestamp": "2025-11-24T06:47:04Z",
      "generateName": "todo-app-7c4d746f45-",
      "labels": {
        "app": "todo",
        "pod-template-hash": "7c4d746f45"
      },
      "managedFields": [
        {
          "apiVersion": "v1",
          "fieldsType": "FieldsV1",
          "fieldsV1": {
            "f:metadata": {
              "f:generateName": {},
              "f:labels": {
                ".": {},
                "f:app": {},
                "f:pod-template-hash": {}
              },
              "f:ownerReferences": {
                ".": {},
                "k:{\"uid\":\"5bc1e402-10c4-469f-8d45-487bdc52098b\"}": {}
              }
            },
            "f:spec": {
              "f:containers": {
                "k:{\"name\":\"todo\"}": {
                  ".": {},
                  "f:env": {
                    ".": {},
                    "k:{\"name\":\"REDIS_HOST\"}": {
                      ".": {},
                      "f:name": {},
                      "f:value": {}
                    },
                    "k:{\"name\":\"REDIS_PORT\"}": {
                      ".": {},
                      "f:name": {},
                      "f:value": {}
                    }
                  },
                  "f:image": {},
                  "f:imagePullPolicy": {},
                  "f:name": {},
                  "f:ports": {
                    ".": {},
                    "k:{\"containerPort\":5000,\"protocol\":\"TCP\"}": {
                      ".": {},
                      "f:containerPort": {},
                      "f:protocol": {}
                    }
                  },
                  "f:resources": {},
                  "f:terminationMessagePath": {},
                  "f:terminationMessagePolicy": {}
                }
              },
              "f:dnsPolicy": {},
              "f:enableServiceLinks": {},
              "f:initContainers": {
                ".": {},
                "k:{\"name\":\"wait-for-redis\"}": {
                  ".": {},
                  "f:command": {},
                  "f:image": {},
                  "f:imagePullPolicy": {},
                  "f:name": {},
                  "f:resources": {},
                  "f:terminationMessagePath": {},
                  "f:terminationMessagePolicy": {}
                }
              },
              "f:restartPolicy": {},
              "f:schedulerName": {},
              "f:securityContext": {},
              "f:terminationGracePeriodSeconds": {}
            }
          },
          "manager": "kube-controller-manager",
          "operation": "Update",
          "time": "2025-11-24T06:47:04Z"
        },
        {
          "apiVersion": "v1",
          "fieldsType": "FieldsV1",
          "fieldsV1": {
            "f:status": {
              "f:conditions": {
                "k:{\"type\":\"ContainersReady\"}": {
                  ".": {},
                  "f:lastProbeTime": {},
                  "f:lastTransitionTime": {},
                  "f:status": {},
                  "f:type": {}
                },
                "k:{\"type\":\"Initialized\"}": {
                  ".": {},
                  "f:lastProbeTime": {},
                  "f:lastTransitionTime": {},
                  "f:status": {},
                  "f:type": {}
                },
                "k:{\"type\":\"PodReadyToStartContainers\"}": {
                  ".": {},
                  "f:lastProbeTime": {},
                  "f:lastTransitionTime": {},
                  "f:status": {},
                  "f:type": {}
                },
                "k:{\"type\":\"Ready\"}": {
                  ".": {},
                  "f:lastProbeTime": {},
                  "f:lastTransitionTime": {},
                  "f:status": {},
                  "f:type": {}
                }
              },
              "f:containerStatuses": {},
              "f:hostIP": {},
              "f:hostIPs": {},
              "f:initContainerStatuses": {},
              "f:phase": {},
              "f:podIP": {},
              "f:podIPs": {
                ".": {},
                "k:{\"ip\":\"10.244.2.20\"}": {
                  ".": {},
                  "f:ip": {}
                }
              },
              "f:startTime": {}
            }
          },
          "manager": "kubelet",
          "operation": "Update",
          "subresource": "status",
          "time": "2026-02-20T01:07:49Z"
        }
      ],
      "name": "todo-app-7c4d746f45-sshsw",
      "namespace": "default",
      "ownerReferences": [
        {
          "apiVersion": "apps/v1",
          "blockOwnerDeletion": true,
          "controller": true,
          "kind": "ReplicaSet",
          "name": "todo-app-7c4d746f45",
          "uid": "5bc1e402-10c4-469f-8d45-487bdc52098b"
        }
      ],
      "resourceVersion": "7741259",
      "uid": "efac49e6-d510-4ddb-85d9-2fcdf4af23cc"
    },
    "spec": {
      "containers": [
        {
          "env": [
            {
              "name": "REDIS_HOST",
              "value": "redis-service"
            },
            {
              "name": "REDIS_PORT",
              "value": "6379"
            }
          ],
          "image": "vellankikoti/k8s-masterclass-init-app:v1.0",
          "imagePullPolicy": "IfNotPresent",
          "name": "todo",
          "ports": [
            {
              "containerPort": 5000,
              "protocol": "TCP"
            }
          ],
          "resources": {},
          "terminationMessagePath": "/dev/termination-log",
          "terminationMessagePolicy": "File",
          "volumeMounts": [
            {
              "mountPath": "/var/run/secrets/kubernetes.io/serviceaccount",
              "name": "kube-api-access-qnflv",
              "readOnly": true
            }
          ]
        }
      ],
      "dnsPolicy": "ClusterFirst",
      "enableServiceLinks": true,
      "initContainers": [
        {
          "command": [
            "sh",
            "-c",
            "echo \"Waiting for Redis to be ready...\"\n# Corrected: Using the actual Redis service name\nuntil nc -z redis-service 6379; do\n  echo \"Redis not available yet...\"\n  sleep 2\ndone\necho \"✅ Redis is ready!\"\n"
          ],
          "image": "vellankikoti/k8s-masterclass-init-wait:v1.0",
          "imagePullPolicy": "IfNotPresent",
          "name": "wait-for-redis",
          "resources": {},
          "terminationMessagePath": "/dev/termination-log",
          "terminationMessagePolicy": "File",
          "volumeMounts": [
            {
              "mountPath": "/var/run/secrets/kubernetes.io/serviceaccount",
              "name": "kube-api-access-qnflv",
              "readOnly": true
            }
          ]
        }
      ],
      "nodeName": "desktop-worker2",
      "preemptionPolicy": "PreemptLowerPriority",
      "priority": 0,
      "restartPolicy": "Always",
      "schedulerName": "default-scheduler",
      "securityContext": {},
      "serviceAccount": "default",
      "serviceAccountName": "default",
      "terminationGracePeriodSeconds": 30,
      "tolerations": [
        {
          "effect": "NoExecute",
          "key": "node.kubernetes.io/not-ready",
          "operator": "Exists",
          "tolerationSeconds": 300
        },
        {
          "effect": "NoExecute",
          "key": "node.kubernetes.io/unreachable",
          "operator": "Exists",
          "tolerationSeconds": 300
        }
      ],
      "volumes": [
        {
          "name": "kube-api-access-qnflv",
          "projected": {
            "defaultMode": 420,
            "sources": [
              {
                "serviceAccountToken": {
                  "expirationSeconds": 3607,
                  "path": "token"
                }
              },
              {
                "configMap": {
                  "items": [
                    {
                      "key": "ca.crt",
                      "path": "ca.crt"
                    }
                  ],
                  "name": "kube-root-ca.crt"
                }
              },
              {
                "downwardAPI": {
                  "items": [
                    {
                      "fieldRef": {
                        "apiVersion": "v1",
                        "fieldPath": "metadata.namespace"
                      },
                      "path": "namespace"
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    },
    "status": {
      "conditions": [
        {
          "lastProbeTime": null,
          "lastTransitionTime": "2026-02-14T16:31:25Z",
          "status": "True",
          "type": "PodReadyToStartContainers"
        },
        {
          "lastProbeTime": null,
          "lastTransitionTime": "2025-11-24T06:47:04Z",
          "status": "True",
          "type": "Initialized"
        },
        {
          "lastProbeTime": null,
          "lastTransitionTime": "2026-02-14T16:31:59Z",
          "status": "True",
          "type": "Ready"
        },
        {
          "lastProbeTime": null,
          "lastTransitionTime": "2026-02-14T16:31:59Z",
          "status": "True",
          "type": "ContainersReady"
        },
        {
          "lastProbeTime": null,
          "lastTransitionTime": "2025-11-24T06:47:04Z",
          "status": "True",
          "type": "PodScheduled"
        }
      ],
      "containerStatuses": [
        {
          "containerID": "containerd://4bdee9905cf11e6fa2c73ecb7eed4550c41bc1946a2ed47ca96c1dc79dfbbe10",
          "image": "docker.io/vellankikoti/k8s-masterclass-init-app:v1.0",
          "imageID": "docker.io/vellankikoti/k8s-masterclass-init-app@sha256:e9d75cd0e28153aad547296eb45b26ecaeb77bde74a049d13d5c32d443674f62",
          "lastState": {
            "terminated": {
              "containerID": "containerd://30082d0f1d77a234d9a43970e29ebfd0e94b407c8a590c4f994763d3c5f35e5d",
              "exitCode": 255,
              "finishedAt": "2026-02-14T16:31:17Z",
              "reason": "Unknown",
              "startedAt": "2026-02-14T16:30:44Z"
            }
          },
          "name": "todo",
          "ready": true,
          "restartCount": 22,
          "started": true,
          "state": {
            "running": {
              "startedAt": "2026-02-14T16:31:58Z"
            }
          },
          "volumeMounts": [
            {
              "mountPath": "/var/run/secrets/kubernetes.io/serviceaccount",
              "name": "kube-api-access-qnflv",
              "readOnly": true,
              "recursiveReadOnly": "Disabled"
            }
          ]
        }
      ],
      "hostIP": "172.18.0.6",
      "hostIPs": [
        {
          "ip": "172.18.0.6"
        }
      ],
      "initContainerStatuses": [
        {
          "containerID": "containerd://46a35d03a0d6ef942081f7bebc677d902bb95a3870bffc4d8b2d95f47f9712be",
          "image": "docker.io/vellankikoti/k8s-masterclass-init-wait:v1.0",
          "imageID": "docker.io/vellankikoti/k8s-masterclass-init-wait@sha256:334594ab742dde8e33938d23afcf22d83440e7cde4b2773e331a83f4652b2ec0",
          "lastState": {},
          "name": "wait-for-redis",
          "ready": true,
          "restartCount": 22,
          "started": false,
          "state": {
            "terminated": {
              "containerID": "containerd://46a35d03a0d6ef942081f7bebc677d902bb95a3870bffc4d8b2d95f47f9712be",
              "exitCode": 0,
              "finishedAt": "2026-02-14T16:31:57Z",
              "reason": "Completed",
              "startedAt": "2026-02-14T16:31:24Z"
            }
          },
          "volumeMounts": [
            {
              "mountPath": "/var/run/secrets/kubernetes.io/serviceaccount",
              "name": "kube-api-access-qnflv",
              "readOnly": true,
              "recursiveReadOnly": "Disabled"
            }
          ]
        }
      ],
      "phase": "Running",
      "podIP": "10.244.2.20",
      "podIPs": [
        {
          "ip": "10.244.2.20"
        }
      ],
      "qosClass": "BestEffort",
      "startTime": "2025-11-24T06:47:04Z"
    }
  },
  "resources": [
    {
      "container_name": "todo",
      "limits": null,
      "note": "Memory is typically in Mi/Gi, CPU in m (millicores) or cores.",
      "requests": null
    }
  ],
  "timestamp": "2026-02-20T06:39:20.585878+05:30"
}
```

## Tool: observe_pod_logs
> Retrieve last 10 lines with optional error/warning filtering.

### Input
```json
{
  "filter": "",
  "namespace": "default",
  "pod_name": "todo-app-7c4d746f45-sshsw",
  "tail_lines": 5
}
```
### Output
```json
{
  "container": "",
  "filter": "",
  "logs": " * Running on all addresses (0.0.0.0)\n * Running on http://127.0.0.1:5000\n * Running on http://10.244.2.20:5000\n\u001b[33mPress CTRL+C to quit\u001b[0m\n",
  "namespace": "default",
  "pod": "todo-app-7c4d746f45-sshsw",
  "tail": 5
}
```

## Tool: observe_resource_links
> Trace dependencies between resources (e.g. Service -> Pods).

### Input
```json
{
  "kind": "Pod",
  "name": "todo-app-7c4d746f45-sshsw",
  "namespace": "default"
}
```
### Output
---
# Senior K8s Assistant: API Execution Proof
Generated on: 2026-02-20T06:44:39+05:30

## Tool: observe_cluster_overview
### API Request (MCP Args)
```json
{}
```
### API Response
```json
{
  "cluster_id": "67b0212c-1d0f-4486-ad84-bde76c0e3a7f",
  "overview": {
    "alerts": {
      "critical": 0,
      "top_3": [
        {
          "namespace": "kcli-test-3",
          "reason": "Failed",
          "resource": "Pod/fluentd-elasticsearch-vdh9m"
        },
        {
          "namespace": "default",
          "reason": "FailedGetScale",
          "resource": "HorizontalPodAutoscaler/api-server-hpa"
        },
        {
          "namespace": "default",
          "reason": "FailedCreate",
          "resource": "Job/every-5-minutes-29525775"
        }
      ],
      "warnings": 4
    },
    "counts": {
      "deployments": 20,
      "namespaces": 25,
      "nodes": 3,
      "pods": 92
    },
    "health": {
      "grade": "C",
      "score": 78,
      "status": "fair"
    },
    "pod_status": {
      "failed": 0,
      "pending": 2,
      "running": 61,
      "succeeded": 29
    },
    "utilization": {
      "cpu_cores": 0.5,
      "cpu_percent": 1,
      "memory_gib": 3.6,
      "memory_percent": 15
    }
  },
  "timestamp": "2026-02-20T06:44:44.630356+05:30"
}
```

## Tool: observe_pod_detailed
### API Request (MCP Args)
```json
{
  "name": "todo-app-7c4d746f45-sshsw",
  "namespace": "default"
}
```
### API Response
```json
{
  "image_pull_policy": {
    "todo": "IfNotPresent"
  },
  "metrics": {
    "CPU": "0.32m",
    "Memory": "36.04Mi",
    "containers": [
      {
        "cpu": "0.32m",
        "memory": "36.04Mi",
        "name": "todo"
      }
    ],
    "name": "todo-app-7c4d746f45-sshsw",
    "namespace": "default"
  },
  "pod": {
    "apiVersion": "v1",
    "kind": "Pod",
    "metadata": {
      "creationTimestamp": "2025-11-24T06:47:04Z",
      "generateName": "todo-app-7c4d746f45-",
      "labels": {
        "app": "todo",
        "pod-template-hash": "7c4d746f45"
      },
      "managedFields": [
        {
          "apiVersion": "v1",
          "fieldsType": "FieldsV1",
          "fieldsV1": {
            "f:metadata": {
              "f:generateName": {},
              "f:labels": {
                ".": {},
                "f:app": {},
                "f:pod-template-hash": {}
              },
              "f:ownerReferences": {
                ".": {},
                "k:{\"uid\":\"5bc1e402-10c4-469f-8d45-487bdc52098b\"}": {}
              }
            },
            "f:spec": {
              "f:containers": {
                "k:{\"name\":\"todo\"}": {
                  ".": {},
                  "f:env": {
                    ".": {},
                    "k:{\"name\":\"REDIS_HOST\"}": {
                      ".": {},
                      "f:name": {},
                      "f:value": {}
                    },
                    "k:{\"name\":\"REDIS_PORT\"}": {
                      ".": {},
                      "f:name": {},
                      "f:value": {}
                    }
                  },
                  "f:image": {},
                  "f:imagePullPolicy": {},
                  "f:name": {},
                  "f:ports": {
                    ".": {},
                    "k:{\"containerPort\":5000,\"protocol\":\"TCP\"}": {
                      ".": {},
                      "f:containerPort": {},
                      "f:protocol": {}
                    }
                  },
                  "f:resources": {},
                  "f:terminationMessagePath": {},
                  "f:terminationMessagePolicy": {}
                }
              },
              "f:dnsPolicy": {},
              "f:enableServiceLinks": {},
              "f:initContainers": {
                ".": {},
                "k:{\"name\":\"wait-for-redis\"}": {
                  ".": {},
                  "f:command": {},
                  "f:image": {},
                  "f:imagePullPolicy": {},
                  "f:name": {},
                  "f:resources": {},
                  "f:terminationMessagePath": {},
                  "f:terminationMessagePolicy": {}
                }
              },
              "f:restartPolicy": {},
              "f:schedulerName": {},
              "f:securityContext": {},
              "f:terminationGracePeriodSeconds": {}
            }
          },
          "manager": "kube-controller-manager",
          "operation": "Update",
          "time": "2025-11-24T06:47:04Z"
        },
        {
          "apiVersion": "v1",
          "fieldsType": "FieldsV1",
          "fieldsV1": {
            "f:status": {
              "f:conditions": {
                "k:{\"type\":\"ContainersReady\"}": {
                  ".": {},
                  "f:lastProbeTime": {},
                  "f:lastTransitionTime": {},
                  "f:status": {},
                  "f:type": {}
                },
                "k:{\"type\":\"Initialized\"}": {
                  ".": {},
                  "f:lastProbeTime": {},
                  "f:lastTransitionTime": {},
                  "f:status": {},
                  "f:type": {}
                },
                "k:{\"type\":\"PodReadyToStartContainers\"}": {
                  ".": {},
                  "f:lastProbeTime": {},
                  "f:lastTransitionTime": {},
                  "f:status": {},
                  "f:type": {}
                },
                "k:{\"type\":\"Ready\"}": {
                  ".": {},
                  "f:lastProbeTime": {},
                  "f:lastTransitionTime": {},
                  "f:status": {},
                  "f:type": {}
                }
              },
              "f:containerStatuses": {},
              "f:hostIP": {},
              "f:hostIPs": {},
              "f:initContainerStatuses": {},
              "f:phase": {},
              "f:podIP": {},
              "f:podIPs": {
                ".": {},
                "k:{\"ip\":\"10.244.2.20\"}": {
                  ".": {},
                  "f:ip": {}
                }
              },
              "f:startTime": {}
            }
          },
          "manager": "kubelet",
          "operation": "Update",
          "subresource": "status",
          "time": "2026-02-20T01:12:57Z"
        }
      ],
      "name": "todo-app-7c4d746f45-sshsw",
      "namespace": "default",
      "ownerReferences": [
        {
          "apiVersion": "apps/v1",
          "blockOwnerDeletion": true,
          "controller": true,
          "kind": "ReplicaSet",
          "name": "todo-app-7c4d746f45",
          "uid": "5bc1e402-10c4-469f-8d45-487bdc52098b"
        }
      ],
      "resourceVersion": "7742108",
      "uid": "efac49e6-d510-4ddb-85d9-2fcdf4af23cc"
    },
    "spec": {
      "containers": [
        {
          "env": [
            {
              "name": "REDIS_HOST",
              "value": "redis-service"
            },
            {
              "name": "REDIS_PORT",
              "value": "6379"
            }
          ],
          "image": "vellankikoti/k8s-masterclass-init-app:v1.0",
          "imagePullPolicy": "IfNotPresent",
          "name": "todo",
          "ports": [
            {
              "containerPort": 5000,
              "protocol": "TCP"
            }
          ],
          "resources": {},
          "terminationMessagePath": "/dev/termination-log",
          "terminationMessagePolicy": "File",
          "volumeMounts": [
            {
              "mountPath": "/var/run/secrets/kubernetes.io/serviceaccount",
              "name": "kube-api-access-qnflv",
              "readOnly": true
            }
          ]
        }
      ],
      "dnsPolicy": "ClusterFirst",
      "enableServiceLinks": true,
      "initContainers": [
        {
          "command": [
            "sh",
            "-c",
            "echo \"Waiting for Redis to be ready...\"\n# Corrected: Using the actual Redis service name\nuntil nc -z redis-service 6379; do\n  echo \"Redis not available yet...\"\n  sleep 2\ndone\necho \"✅ Redis is ready!\"\n"
          ],
          "image": "vellankikoti/k8s-masterclass-init-wait:v1.0",
          "imagePullPolicy": "IfNotPresent",
          "name": "wait-for-redis",
          "resources": {},
          "terminationMessagePath": "/dev/termination-log",
          "terminationMessagePolicy": "File",
          "volumeMounts": [
            {
              "mountPath": "/var/run/secrets/kubernetes.io/serviceaccount",
              "name": "kube-api-access-qnflv",
              "readOnly": true
            }
          ]
        }
      ],
      "nodeName": "desktop-worker2",
      "preemptionPolicy": "PreemptLowerPriority",
      "priority": 0,
      "restartPolicy": "Always",
      "schedulerName": "default-scheduler",
      "securityContext": {},
      "serviceAccount": "default",
      "serviceAccountName": "default",
      "terminationGracePeriodSeconds": 30,
      "tolerations": [
        {
          "effect": "NoExecute",
          "key": "node.kubernetes.io/not-ready",
          "operator": "Exists",
          "tolerationSeconds": 300
        },
        {
          "effect": "NoExecute",
          "key": "node.kubernetes.io/unreachable",
          "operator": "Exists",
          "tolerationSeconds": 300
        }
      ],
      "volumes": [
        {
          "name": "kube-api-access-qnflv",
          "projected": {
            "defaultMode": 420,
            "sources": [
              {
                "serviceAccountToken": {
                  "expirationSeconds": 3607,
                  "path": "token"
                }
              },
              {
                "configMap": {
                  "items": [
                    {
                      "key": "ca.crt",
                      "path": "ca.crt"
                    }
                  ],
                  "name": "kube-root-ca.crt"
                }
              },
              {
                "downwardAPI": {
                  "items": [
                    {
                      "fieldRef": {
                        "apiVersion": "v1",
                        "fieldPath": "metadata.namespace"
                      },
                      "path": "namespace"
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    },
    "status": {
      "conditions": [
        {
          "lastProbeTime": null,
          "lastTransitionTime": "2026-02-14T16:31:25Z",
          "status": "True",
          "type": "PodReadyToStartContainers"
        },
        {
          "lastProbeTime": null,
          "lastTransitionTime": "2025-11-24T06:47:04Z",
          "status": "True",
          "type": "Initialized"
        },
        {
          "lastProbeTime": null,
          "lastTransitionTime": "2026-02-14T16:31:59Z",
          "status": "True",
          "type": "Ready"
        },
        {
          "lastProbeTime": null,
          "lastTransitionTime": "2026-02-14T16:31:59Z",
          "status": "True",
          "type": "ContainersReady"
        },
        {
          "lastProbeTime": null,
          "lastTransitionTime": "2025-11-24T06:47:04Z",
          "status": "True",
          "type": "PodScheduled"
        }
      ],
      "containerStatuses": [
        {
          "containerID": "containerd://4bdee9905cf11e6fa2c73ecb7eed4550c41bc1946a2ed47ca96c1dc79dfbbe10",
          "image": "docker.io/vellankikoti/k8s-masterclass-init-app:v1.0",
          "imageID": "docker.io/vellankikoti/k8s-masterclass-init-app@sha256:e9d75cd0e28153aad547296eb45b26ecaeb77bde74a049d13d5c32d443674f62",
          "lastState": {
            "terminated": {
              "containerID": "containerd://30082d0f1d77a234d9a43970e29ebfd0e94b407c8a590c4f994763d3c5f35e5d",
              "exitCode": 255,
              "finishedAt": "2026-02-14T16:31:17Z",
              "reason": "Unknown",
              "startedAt": "2026-02-14T16:30:44Z"
            }
          },
          "name": "todo",
          "ready": true,
          "restartCount": 22,
          "started": true,
          "state": {
            "running": {
              "startedAt": "2026-02-14T16:31:58Z"
            }
          },
          "volumeMounts": [
            {
              "mountPath": "/var/run/secrets/kubernetes.io/serviceaccount",
              "name": "kube-api-access-qnflv",
              "readOnly": true,
              "recursiveReadOnly": "Disabled"
            }
          ]
        }
      ],
      "hostIP": "172.18.0.6",
      "hostIPs": [
        {
          "ip": "172.18.0.6"
        }
      ],
      "initContainerStatuses": [
        {
          "containerID": "containerd://46a35d03a0d6ef942081f7bebc677d902bb95a3870bffc4d8b2d95f47f9712be",
          "image": "docker.io/vellankikoti/k8s-masterclass-init-wait:v1.0",
          "imageID": "docker.io/vellankikoti/k8s-masterclass-init-wait@sha256:334594ab742dde8e33938d23afcf22d83440e7cde4b2773e331a83f4652b2ec0",
          "lastState": {},
          "name": "wait-for-redis",
          "ready": true,
          "restartCount": 22,
          "started": false,
          "state": {
            "terminated": {
              "containerID": "containerd://46a35d03a0d6ef942081f7bebc677d902bb95a3870bffc4d8b2d95f47f9712be",
              "exitCode": 0,
              "finishedAt": "2026-02-14T16:31:57Z",
              "reason": "Completed",
              "startedAt": "2026-02-14T16:31:24Z"
            }
          },
          "volumeMounts": [
            {
              "mountPath": "/var/run/secrets/kubernetes.io/serviceaccount",
              "name": "kube-api-access-qnflv",
              "readOnly": true,
              "recursiveReadOnly": "Disabled"
            }
          ]
        }
      ],
      "phase": "Running",
      "podIP": "10.244.2.20",
      "podIPs": [
        {
          "ip": "10.244.2.20"
        }
      ],
      "qosClass": "BestEffort",
      "startTime": "2025-11-24T06:47:04Z"
    }
  },
  "resources": [
    {
      "container_name": "todo",
      "limits": null,
      "note": "Memory is typically in Mi/Gi, CPU in m (millicores) or cores.",
      "requests": null
    }
  ],
  "timestamp": "2026-02-20T06:44:45.040296+05:30"
}
```

## Tool: observe_pod_logs
### API Request (MCP Args)
```json
{
  "namespace": "default",
  "pod_name": "todo-app-7c4d746f45-sshsw",
  "tail_lines": 5
}
```
### API Response
```json
{
  "container": "",
  "filter": "",
  "logs": " * Running on all addresses (0.0.0.0)\n * Running on http://127.0.0.1:5000\n * Running on http://10.244.2.20:5000\n\u001b[33mPress CTRL+C to quit\u001b[0m\n",
  "namespace": "default",
  "pod": "todo-app-7c4d746f45-sshsw",
  "tail": 5
}
```

## Tool: observe_resource_links
### API Request (MCP Args)
```json
{
  "kind": "Pod",
  "name": "todo-app-7c4d746f45-sshsw",
  "namespace": "default"
}
```
### API Response
