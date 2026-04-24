{{- define "kubilitics-ai.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "kubilitics-ai.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "kubilitics-ai.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "kubilitics-ai.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "kubilitics-ai.selectorLabels" -}}
app.kubernetes.io/name: {{ include "kubilitics-ai.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "kubilitics-ai.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "kubilitics-ai.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "kubilitics-ai.imageRef" -}}
{{- $tag := .Values.image.tag | default .Chart.AppVersion -}}
{{- printf "%s:%s" .Values.image.repository $tag -}}
{{- end -}}

{{- /*
Resolve which Secret holds an LLM API key for the active provider, and
which key inside that Secret. Returns "" if neither inline apiKey nor
apiKeySecretRef is configured (provider doesn't need a key, e.g. ollama).
Output format: "<secret-name>|<secret-key>" — split with `splitList "|"`.
*/ -}}
{{- define "kubilitics-ai.llmSecret" -}}
{{- $p := .Values.llm.provider -}}
{{- $name := "" -}}
{{- $key := "api-key" -}}
{{- if eq $p "openai" -}}
  {{- if .Values.llm.openai.apiKeySecretRef.name -}}
    {{- $name = .Values.llm.openai.apiKeySecretRef.name -}}
    {{- $key = .Values.llm.openai.apiKeySecretRef.key | default "api-key" -}}
  {{- else if .Values.llm.openai.apiKey -}}
    {{- $name = printf "%s-llm" (include "kubilitics-ai.fullname" .) -}}
  {{- end -}}
{{- else if eq $p "anthropic" -}}
  {{- if .Values.llm.anthropic.apiKeySecretRef.name -}}
    {{- $name = .Values.llm.anthropic.apiKeySecretRef.name -}}
    {{- $key = .Values.llm.anthropic.apiKeySecretRef.key | default "api-key" -}}
  {{- else if .Values.llm.anthropic.apiKey -}}
    {{- $name = printf "%s-llm" (include "kubilitics-ai.fullname" .) -}}
  {{- end -}}
{{- else if eq $p "custom" -}}
  {{- if .Values.llm.custom.apiKeySecretRef.name -}}
    {{- $name = .Values.llm.custom.apiKeySecretRef.name -}}
    {{- $key = .Values.llm.custom.apiKeySecretRef.key | default "api-key" -}}
  {{- else if .Values.llm.custom.apiKey -}}
    {{- $name = printf "%s-llm" (include "kubilitics-ai.fullname" .) -}}
  {{- end -}}
{{- end -}}
{{- printf "%s|%s" $name $key -}}
{{- end -}}

{{- /*
Env var name the active provider's SDK reads its API key from.
Aligns with kubilitics-ai/internal/config defaults (OPENAI_API_KEY,
ANTHROPIC_API_KEY) and a CUSTOM_API_KEY fallback for OpenAI-compat.
*/ -}}
{{- define "kubilitics-ai.llmEnvVarName" -}}
{{- $p := .Values.llm.provider -}}
{{- if eq $p "openai" -}}OPENAI_API_KEY{{- end -}}
{{- if eq $p "anthropic" -}}ANTHROPIC_API_KEY{{- end -}}
{{- if eq $p "custom" -}}CUSTOM_API_KEY{{- end -}}
{{- end -}}
