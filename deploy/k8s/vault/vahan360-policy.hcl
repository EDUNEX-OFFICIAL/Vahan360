# =============================================================================
# Vault policy for Vahan360 services (Option B in values.yaml `secrets` block).
# Apply with:  vault policy write vahan360 deploy/k8s/vault/vahan360-policy.hcl
# =============================================================================

# Database credentials
path "secret/data/vahan360/db" {
  capabilities = ["read"]
}

# Ingest database credentials
path "secret/data/vahan360/ingest-db" {
  capabilities = ["read"]
}

# Redis credentials
path "secret/data/vahan360/redis" {
  capabilities = ["read"]
}

# JWT secret
path "secret/data/vahan360/jwt" {
  capabilities = ["read"]
}

# OTEL exporter headers (optional)
path "secret/data/vahan360/otel" {
  capabilities = ["read"]
}

# Browser manager token (optional)
path "secret/data/vahan360/browser-manager" {
  capabilities = ["read"]
}
