locals {
  postgres_roles = toset(["postgres", "grocery_owner", "grocery_app", "grocery_backup"])
}
resource "random_password" "postgres_roles" {
  for_each = local.postgres_roles
  length   = 40
  special  = false
}
resource "oci_vault_secret" "postgres_roles" {
  for_each       = local.postgres_roles
  compartment_id = var.compartment_ocid
  vault_id       = var.vault_id
  key_id         = var.vault_key_id
  secret_name    = "grocery-${replace(each.key, "_", "-")}-password"
  secret_content {
    content_type = "BASE64"
    content      = base64encode(random_password.postgres_roles[each.key].result)
  }
}
resource "tls_private_key" "postgres_ca" { algorithm = "RSA" }
resource "tls_self_signed_cert" "postgres_ca" {
  private_key_pem       = tls_private_key.postgres_ca.private_key_pem
  is_ca_certificate     = true
  validity_period_hours = 87600
  allowed_uses          = ["cert_signing", "crl_signing"]
  subject { common_name = "grocery internal PostgreSQL CA" }
}
resource "tls_private_key" "postgres" { algorithm = "RSA" }
resource "tls_cert_request" "postgres" {
  private_key_pem = tls_private_key.postgres.private_key_pem
  dns_names       = ["postgres.grocery.svc.cluster.local"]
  subject { common_name = "postgres.grocery.svc.cluster.local" }
}
resource "tls_locally_signed_cert" "postgres" {
  cert_request_pem      = tls_cert_request.postgres.cert_request_pem
  ca_private_key_pem    = tls_private_key.postgres_ca.private_key_pem
  ca_cert_pem           = tls_self_signed_cert.postgres_ca.cert_pem
  validity_period_hours = 17520
  early_renewal_hours   = 2160
  allowed_uses          = ["server_auth", "digital_signature", "key_encipherment"]
}
resource "oci_vault_secret" "postgres_tls" {
  compartment_id = var.compartment_ocid
  vault_id       = var.vault_id
  key_id         = var.vault_key_id
  secret_name    = "grocery-postgres-tls"
  secret_content {
    content_type = "BASE64"
    content = base64encode(jsonencode({
      ca   = tls_self_signed_cert.postgres_ca.cert_pem
      cert = tls_locally_signed_cert.postgres.cert_pem
      key  = tls_private_key.postgres.private_key_pem
    }))
  }
}
