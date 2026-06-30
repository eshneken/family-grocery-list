data "oci_objectstorage_namespace" "current" {
  compartment_id = var.tenancy_ocid
}

locals {
  namespace = coalesce(var.state_namespace, data.oci_objectstorage_namespace.current.namespace)
}

resource "oci_kms_vault" "terraform" {
  compartment_id = var.compartment_ocid
  display_name   = "family-grocery-terraform"
  vault_type     = "DEFAULT"
  freeform_tags  = var.tags

  lifecycle {
    prevent_destroy = false
  }
}

resource "oci_kms_key" "vault" {
  compartment_id      = var.compartment_ocid
  display_name        = "family-grocery-vault"
  management_endpoint = oci_kms_vault.terraform.management_endpoint
  protection_mode     = "SOFTWARE"
  freeform_tags       = var.tags

  key_shape {
    algorithm = "AES"
    length    = 32
  }

  lifecycle {
    prevent_destroy = false
  }
}

resource "oci_objectstorage_bucket" "terraform_state" {
  compartment_id = var.compartment_ocid
  namespace      = local.namespace
  name           = var.state_bucket_name
  access_type    = "NoPublicAccess"
  storage_tier   = "Standard"
  versioning     = "Enabled"
  freeform_tags  = var.tags

}
