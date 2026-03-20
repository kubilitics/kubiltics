# Log Collection Runbook

This runbook covers how to collect, ship, and query Kubilitics backend logs in
production. The backend emits structured JSON logs to stdout/stderr by default,
making it compatible with every major log aggregation stack.

---

## Log Format

Every log line is a single JSON object:

```json
{
  "timestamp": "2026-03-16T12:00:00.123456789Z",
  "level": "INFO",
  "msg": "http request",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": "admin",
  "cluster_id": "kind-cluster",
  "method": "GET",
  "path": "/api/v1/clusters",
  "status": 200,
  "duration_ms": 12
}
```

Standard fields: `timestamp`, `level`, `msg`, `request_id`, `user_id`,
`cluster_id`, `resource`.

---

## 1. ELK Stack (Elasticsearch + Filebeat)

### Filebeat Configuration

Deploy Filebeat as a DaemonSet. Use the following `filebeat.yml` to parse
container logs from the Kubilitics backend pods:

```yaml
filebeat.inputs:
  - type: container
    paths:
      - /var/log/containers/kubilitics-backend-*.log
    processors:
      - decode_json_fields:
          fields: ["message"]
          target: ""
          overwrite_keys: true
      - drop_fields:
          fields: ["message"]  # original unparsed line

output.elasticsearch:
  hosts: ["http://elasticsearch:9200"]
  index: "kubilitics-logs-%{+yyyy.MM.dd}"

setup.template:
  name: "kubilitics-logs"
  pattern: "kubilitics-logs-*"
  settings:
    index:
      number_of_shards: 2
      number_of_replicas: 1
```

### Index Lifecycle Policy (ILM)

```json
PUT _ilm/policy/kubilitics-logs
{
  "policy": {
    "phases": {
      "hot":    { "actions": { "rollover": { "max_size": "10gb", "max_age": "1d" } } },
      "warm":   { "min_age": "7d",  "actions": { "shrink": { "number_of_shards": 1 } } },
      "delete": { "min_age": "30d", "actions": { "delete": {} } }
    }
  }
}
```

### Kibana Query Examples

```
# All errors in the last hour
level: "ERROR" AND @timestamp >= now-1h

# Slow requests (>500ms)
duration_ms > 500

# Trace a single request
request_id: "550e8400-e29b-41d4-a716-446655440000"

# All actions for a specific user
user_id: "admin" AND cluster_id: "production"
```

---

## 2. Loki + Grafana

### Option A: Direct Push (Built-in)

The backend has a built-in Loki push client. Enable it by setting:

```bash
export KUBILITICS_LOKI_URL=http://loki:3100
```

Or in `config.yaml`:

```yaml
loki_url: http://loki:3100
```

The client:
- Batches logs (flush every 1 second or 100 entries, whichever comes first)
- Labels every stream with `app=kubilitics`, `level=<INFO|WARN|ERROR>`, and
  optionally `cluster_id`
- Falls back gracefully if Loki is unreachable (logs a warning, does not block)

### Option B: Promtail Sidecar / DaemonSet

If you prefer agent-based collection, deploy Promtail:

```yaml
# promtail-config.yaml
server:
  http_listen_port: 9080

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  - job_name: kubilitics
    pipeline_stages:
      - json:
          expressions:
            level: level
            request_id: request_id
            user_id: user_id
            cluster_id: cluster_id
      - labels:
          level:
          cluster_id:
      - timestamp:
          source: timestamp
          format: RFC3339Nano
    kubernetes_sd_configs:
      - role: pod
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_label_app]
        regex: kubilitics-backend
        action: keep
      - source_labels: [__meta_kubernetes_namespace]
        target_label: namespace
```

### Grafana LogQL Queries

```logql
# All error logs
{app="kubilitics", level="ERROR"}

# Slow requests
{app="kubilitics"} | json | duration_ms > 500

# Specific request trace
{app="kubilitics"} |= "550e8400-e29b-41d4-a716-446655440000"

# Rate of 5xx errors per minute
rate({app="kubilitics", level="ERROR"}[1m])
```

---

## 3. AWS CloudWatch Logs

### Container Insights (EKS)

If running on EKS with Container Insights enabled, logs are collected
automatically. Create a log group and subscription filter:

```bash
# Create dedicated log group
aws logs create-log-group --log-group-name /kubilitics/backend

# Install Fluent Bit via EKS add-on
aws eks create-addon \
  --cluster-name my-cluster \
  --addon-name aws-for-fluent-bit \
  --addon-version v2.31.12-eksbuild.1
```

### Fluent Bit ConfigMap (EKS)

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: fluent-bit-config
  namespace: amazon-cloudwatch
data:
  fluent-bit.conf: |
    [SERVICE]
        Parsers_File  parsers.conf

    [INPUT]
        Name              tail
        Tag               kubilitics.*
        Path              /var/log/containers/kubilitics-backend-*.log
        Parser            docker
        Mem_Buf_Limit     5MB

    [FILTER]
        Name              parser
        Match             kubilitics.*
        Key_Name          log
        Parser            kubilitics_json
        Reserve_Data      On

    [OUTPUT]
        Name              cloudwatch_logs
        Match             kubilitics.*
        region            us-east-1
        log_group_name    /kubilitics/backend
        log_stream_prefix backend-
        auto_create_group true

  parsers.conf: |
    [PARSER]
        Name        kubilitics_json
        Format      json
        Time_Key    timestamp
        Time_Format %Y-%m-%dT%H:%M:%S.%LZ
```

### CloudWatch Insights Queries

```sql
-- Error rate by path
fields @timestamp, level, path, status
| filter level = "ERROR"
| stats count(*) as errors by path
| sort errors desc

-- P99 latency
fields @timestamp, duration_ms, path
| stats pctile(duration_ms, 99) as p99 by path
| sort p99 desc

-- Trace a request
fields @timestamp, level, msg, request_id, user_id
| filter request_id = "550e8400-e29b-41d4-a716-446655440000"
| sort @timestamp asc
```

---

## 4. Fluentd / Fluent Bit (Generic)

### Fluent Bit DaemonSet

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: fluent-bit
  namespace: logging
spec:
  selector:
    matchLabels:
      app: fluent-bit
  template:
    metadata:
      labels:
        app: fluent-bit
    spec:
      serviceAccountName: fluent-bit
      containers:
        - name: fluent-bit
          image: fluent/fluent-bit:3.1
          volumeMounts:
            - name: varlog
              mountPath: /var/log
            - name: config
              mountPath: /fluent-bit/etc/
      volumes:
        - name: varlog
          hostPath:
            path: /var/log
        - name: config
          configMap:
            name: fluent-bit-config
```

### Fluent Bit Config (Loki output)

```ini
[SERVICE]
    Flush        1
    Log_Level    info
    Parsers_File parsers.conf

[INPUT]
    Name              tail
    Tag               kube.*
    Path              /var/log/containers/kubilitics-backend-*.log
    Parser            docker
    DB                /var/log/flb_kube.db
    Mem_Buf_Limit     5MB
    Skip_Long_Lines   On

[FILTER]
    Name              kubernetes
    Match             kube.*
    Merge_Log         On
    Keep_Log          Off
    K8S-Logging.Parser On

[OUTPUT]
    Name              loki
    Match             kube.*
    Host              loki.logging.svc.cluster.local
    Port              3100
    Labels            job=kubilitics, app=kubilitics-backend
    Label_Keys        $level, $cluster_id
    Remove_Keys       logtag, stream
```

### Fluentd Config (Elasticsearch output)

```xml
<source>
  @type tail
  path /var/log/containers/kubilitics-backend-*.log
  pos_file /var/log/fluentd-kubilitics.pos
  tag kubilitics.backend
  <parse>
    @type json
    time_key timestamp
    time_format %Y-%m-%dT%H:%M:%S.%NZ
  </parse>
</source>

<filter kubilitics.backend>
  @type record_transformer
  <record>
    kubernetes_namespace ${record.dig("kubernetes", "namespace_name") || "default"}
  </record>
</filter>

<match kubilitics.backend>
  @type elasticsearch
  host elasticsearch.logging.svc.cluster.local
  port 9200
  index_name kubilitics-logs
  type_name _doc
  logstash_format true
  logstash_prefix kubilitics-logs
  <buffer>
    @type file
    path /var/log/fluentd-buffers/kubilitics
    flush_interval 5s
    chunk_limit_size 2M
    retry_max_interval 30
  </buffer>
</match>
```

---

## 5. Configuration Reference

| Environment Variable      | Default     | Description                              |
|---------------------------|-------------|------------------------------------------|
| `KUBILITICS_LOG_LEVEL`    | `info`      | Minimum log level: debug, info, warn, error |
| `KUBILITICS_LOG_FORMAT`   | `json`      | Output format: json or text              |
| `KUBILITICS_LOKI_URL`     | _(empty)_   | Loki push URL; empty disables direct push |

### Log Levels

| Level   | When to use                                    |
|---------|------------------------------------------------|
| `debug` | Verbose internal state (development only)      |
| `info`  | Normal operations, request logs, startup events |
| `warn`  | Degraded state, recoverable errors             |
| `error` | Failures that need operator attention           |

---

## 6. Alerting Recommendations

Set up alerts on these patterns:

```yaml
# Prometheus alerting rule (from log metrics)
groups:
  - name: kubilitics-logs
    rules:
      - alert: HighErrorRate
        expr: |
          rate(kubilitics_http_requests_total{status=~"5.."}[5m])
          / rate(kubilitics_http_requests_total[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Kubilitics backend error rate > 5%"

      - alert: SlowRequests
        expr: |
          histogram_quantile(0.99,
            rate(kubilitics_http_request_duration_seconds_bucket[5m])
          ) > 2
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Kubilitics P99 latency > 2s"
```
