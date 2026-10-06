data "terraform_remote_state" "production" {
  backend = "oci"

  config = {
    bucket              = var.state_bucket_name
    namespace           = var.state_namespace
    key                 = var.production_state_key
    region              = var.region
    auth                = var.oci_auth
    config_file_profile = var.oci_config_profile
  }
}


data "oci_secrets_secretbundle" "postgres_roles" {
  for_each  = nonsensitive(data.terraform_remote_state.production.outputs.postgres_secret_ids)
  secret_id = each.value
}
data "oci_secrets_secretbundle" "postgres_tls" {
  secret_id = data.terraform_remote_state.production.outputs.postgres_tls_secret_id
}
locals {
  postgres_host      = "postgres.grocery.svc.cluster.local"
  postgres_passwords = { for role, bundle in data.oci_secrets_secretbundle.postgres_roles : role => base64decode(bundle.secret_bundle_content[0].content) }
  postgres_tls       = jsondecode(base64decode(data.oci_secrets_secretbundle.postgres_tls.secret_bundle_content[0].content))
  database_urls = { for role in ["grocery_app", "grocery_owner", "grocery_backup"] : role => format(
    "postgresql://%s:%s@%s:5432/postgres?sslmode=verify-full&sslrootcert=/var/run/postgres-ca/ca.crt",
    role, urlencode(local.postgres_passwords[role]), local.postgres_host
  ) }
}
