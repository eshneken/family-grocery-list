output "state_bucket_name" {
  description = "Bucket name to pass to the OCI backend configuration."
  value       = oci_objectstorage_bucket.terraform_state.name
}

output "state_namespace" {
  description = "Object Storage namespace for the OCI backend configuration."
  value       = local.namespace
}

output "vault_key_id" {
  description = "Software-protected key used by OCI Vault to encrypt application secrets."
  value       = oci_kms_key.vault.id
}

output "vault_id" {
  description = "Vault ID used by the production root for application secrets."
  value       = oci_kms_vault.terraform.id
}
