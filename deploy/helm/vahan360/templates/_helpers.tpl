{{- define "vahan360.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{- define "vahan360.fullname" -}}
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
{{- end }}

{{- define "vahan360.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{- define "vahan360.labels" -}}
helm.sh/chart: {{ include "vahan360.chart" . }}
{{ include "vahan360.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "vahan360.selectorLabels" -}}
app.kubernetes.io/name: {{ include "vahan360.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "vahan360.secretName" -}}
{{- default (printf "%s-secrets" (include "vahan360.fullname" .)) .Values.secrets.existingSecret -}}
{{- end }}

{{- define "vahan360.redisUrl" -}}
{{- if .Values.redis.enabled -}}
{{- $host := printf "%s-redis-master" .Release.Name -}}
redis://{{ $host }}.{{ .Release.Namespace }}.svc.cluster.local:6379
{{- end -}}
{{- end }}

{{/*
Which Secret key is mounted into container env `DATABASE_URL`.
`databaseUrlSource: pgbouncer` expects a pooled DSN stored under secrets.keys.databasePgbouncer (default key name DATABASE_URL_PGBOUNCER).
*/}}
{{- define "vahan360.dbUrlSecretKey" -}}
{{- $mode := .Values.databaseUrlSource | default "direct" -}}
{{- if eq $mode "pgbouncer" -}}
{{- .Values.secrets.keys.databasePgbouncer | default "DATABASE_URL_PGBOUNCER" -}}
{{- else -}}
{{- .Values.secrets.keys.databaseUrl -}}
{{- end -}}
{{- end }}
