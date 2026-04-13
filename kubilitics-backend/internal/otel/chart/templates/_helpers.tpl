{{/*
Expand the name of the chart.
*/}}
{{- define "kubilitics-otel.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We use a fixed name "otel-collector" so it's predictable for users to find
("kubectl get deploy -n kubilitics-system otel-collector").
*/}}
{{- define "kubilitics-otel.fullname" -}}
{{- default "otel-collector" .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Standard labels applied to all resources in the chart.
*/}}
{{- define "kubilitics-otel.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "kubilitics-otel.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: kubilitics
{{- end }}

{{/*
Selector labels — the subset used by Service selector and Deployment matchLabels.
Must be IMMUTABLE — changing these on an existing release breaks the rolling update.
*/}}
{{- define "kubilitics-otel.selectorLabels" -}}
app.kubernetes.io/name: {{ include "kubilitics-otel.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
ServiceAccount name.
*/}}
{{- define "kubilitics-otel.serviceAccountName" -}}
{{- printf "%s" (include "kubilitics-otel.fullname" .) }}
{{- end }}

{{/*
Validation: required values.
*/}}
{{- define "kubilitics-otel.validate" -}}
{{- if not .Values.kubilitics.clusterId -}}
{{- fail "kubilitics.clusterId is REQUIRED. Get it from the Kubilitics setup page for your cluster." -}}
{{- end -}}
{{- if not .Values.kubilitics.backendUrl -}}
{{- fail "kubilitics.backendUrl is REQUIRED. Set it to your Kubilitics backend (e.g. https://kubilitics.example.com)." -}}
{{- end -}}
{{- end -}}
