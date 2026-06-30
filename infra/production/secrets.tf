resource "random_password" "postgres_admin" {
  length  = 32
  special = true
}

resource "oci_vault_secret" "postgres_admin" {
  compartment_id = var.compartment_ocid
  vault_id       = var.vault_id
  key_id         = var.vault_key_id
  secret_name    = "family-grocery-postgres-admin"
  description    = "Administrator password for the Family Grocery OCI PostgreSQL system."
  freeform_tags  = local.common_tags

  secret_content {
    content_type = "BASE64"
    content      = base64encode(random_password.postgres_admin.result)
    name         = "postgres-admin-password"
  }
}
