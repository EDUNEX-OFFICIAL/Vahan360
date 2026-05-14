#!/usr/bin/env bash
# =============================================================================
# Bootstrap Vault Kubernetes auth for Vahan360 (Option B in values.yaml).
#
# Prerequisites:
#   - vault CLI authenticated as an operator with permissions to configure auth
#   - kubectl access to the target cluster
#   - Vault Kubernetes auth method enabled: vault auth enable kubernetes
#
# Usage:
#   VAULT_ADDR=https://vault.example.com NAMESPACE=vahan360 ./vault-auth-k8s.sh
# =============================================================================
set -euo pipefail

NAMESPACE="${NAMESPACE:-vahan360}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-vahan360-api}"
VAULT_ROLE="${VAULT_ROLE:-vahan360}"
VAULT_POLICY="${VAULT_POLICY:-vahan360}"

# Retrieve Kubernetes API host and CA from within cluster (or set explicitly)
K8S_HOST="${K8S_HOST:-$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')}"
K8S_CA_CERT="${K8S_CA_CERT:-$(kubectl config view --raw --minify --flatten -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' | base64 --decode)}"

echo "Configuring Vault Kubernetes auth backend..."
vault write auth/kubernetes/config \
  kubernetes_host="${K8S_HOST}" \
  kubernetes_ca_cert="${K8S_CA_CERT}"

echo "Writing Vault policy (vahan360-policy.hcl)..."
vault policy write "${VAULT_POLICY}" "$(dirname "$0")/vahan360-policy.hcl"

echo "Creating Vault Kubernetes auth role '${VAULT_ROLE}'..."
vault write "auth/kubernetes/role/${VAULT_ROLE}" \
  bound_service_account_names="${SERVICE_ACCOUNT}" \
  bound_service_account_namespaces="${NAMESPACE}" \
  policies="${VAULT_POLICY}" \
  ttl=1h

echo "Done. Add Vault agent annotations to api.podAnnotations in values.yaml:"
cat <<'EOF'
  vault.hashicorp.com/agent-inject: "true"
  vault.hashicorp.com/role: "vahan360"
  vault.hashicorp.com/agent-inject-secret-db: "secret/vahan360/db"
  vault.hashicorp.com/agent-inject-secret-ingest-db: "secret/vahan360/ingest-db"
  vault.hashicorp.com/agent-inject-secret-redis: "secret/vahan360/redis"
  vault.hashicorp.com/agent-inject-secret-jwt: "secret/vahan360/jwt"
EOF
