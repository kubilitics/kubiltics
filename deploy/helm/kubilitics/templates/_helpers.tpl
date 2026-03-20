{{/*
Expand the name of the chart.
*/}}
{{- define "kubilitics.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "kubilitics.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- printf "%s" $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "kubilitics.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "kubilitics.labels" -}}
helm.sh/chart: {{ include "kubilitics.chart" . }}
app.kubernetes.io/name: {{ include "kubilitics.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "kubilitics.selectorLabels" -}}
app.kubernetes.io/name: {{ include "kubilitics.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "kubilitics.serviceAccountName" -}}
{{- if .Values.serviceAccount.name }}
{{- .Values.serviceAccount.name }}
{{- else }}
{{- include "kubilitics.fullname" . }}
{{- end }}
{{- end }}

{{/*
Create the name of the ConfigMap
*/}}
{{- define "kubilitics.configMapName" -}}
{{- if .Values.configMap.name }}
{{- .Values.configMap.name }}
{{- else }}
{{- include "kubilitics.fullname" . }}-config
{{- end }}
{{- end }}

{{/*
Create the name of the Secret
*/}}
{{- define "kubilitics.secretName" -}}
{{- if .Values.secret.name }}
{{- .Values.secret.name }}
{{- else }}
{{- include "kubilitics.fullname" . }}-secret
{{- end }}
{{- end }}

{{/*
Create image pull secrets if specified
*/}}
{{- define "kubilitics.imagePullSecrets" -}}
{{- if .Values.imagePullSecrets }}
imagePullSecrets:
{{- range .Values.imagePullSecrets }}
  - name: {{ . }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create security context for pod
*/}}
{{- define "kubilitics.podSecurityContext" -}}
{{- if .Values.podSecurityContext }}
{{- toYaml .Values.podSecurityContext }}
{{- else }}
runAsNonRoot: true
runAsUser: 1000
fsGroup: 1000
{{- end }}
{{- end }}

{{/*
Create security context for container
*/}}
{{- define "kubilitics.containerSecurityContext" -}}
{{- if .Values.containerSecurityContext }}
{{- toYaml .Values.containerSecurityContext }}
{{- else }}
allowPrivilegeEscalation: false
capabilities:
  drop:
    - ALL
readOnlyRootFilesystem: false
{{- end }}
{{- end }}

{{/*
Create the name of the AI Secret
*/}}
{{- define "kubilitics.aiSecretName" -}}
{{- if .Values.ai.secret.name }}
{{- .Values.ai.secret.name }}
{{- else }}
{{- include "kubilitics.fullname" . }}-ai-secret
{{- end }}
{{- end }}

{{/*
Create the name of the Frontend ConfigMap
*/}}
{{- define "kubilitics.frontendConfigMapName" -}}
{{- if .Values.frontend.configMap.name }}
{{- .Values.frontend.configMap.name }}
{{- else }}
{{- include "kubilitics.fullname" . }}-frontend-config
{{- end }}
{{- end }}

{{/*
Create the name of the PostgreSQL Secret
*/}}
{{- define "kubilitics.postgresqlSecretName" -}}
{{- if .Values.database.postgresql.secretName }}
{{- .Values.database.postgresql.secretName }}
{{- else }}
{{- include "kubilitics.fullname" . }}-postgresql
{{- end }}
{{- end }}
