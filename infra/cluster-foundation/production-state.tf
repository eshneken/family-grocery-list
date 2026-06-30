data "terraform_remote_state" "production" {
  backend = "oci"

  config = {
    bucket    = var.state_bucket_name
    namespace = var.state_namespace
    key       = var.production_state_key
    region    = var.region
    auth      = var.oci_auth
  }
}

data "oci_psql_db_system_connection_detail" "grocery" {
  db_system_id = data.terraform_remote_state.production.outputs.postgres_db_system_id
}

data "oci_secrets_secretbundle" "postgres_admin" {
  secret_id = data.terraform_remote_state.production.outputs.postgres_admin_secret_id
}

locals {
  postgres_endpoint = data.oci_psql_db_system_connection_detail.grocery.primary_db_endpoint[0]
  postgres_password = base64decode(data.oci_secrets_secretbundle.postgres_admin.secret_bundle_content[0].content)
  database_url = format(
    "postgresql://%s:%s@%s:%s/postgres?sslmode=verify-full&sslrootcert=/var/run/postgres-ca/ca.crt",
    urlencode(data.terraform_remote_state.production.outputs.postgres_admin_username),
    urlencode(local.postgres_password),
    local.postgres_endpoint.fqdn,
    local.postgres_endpoint.port,
  )
}
