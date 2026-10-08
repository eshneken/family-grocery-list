terraform {
  required_version = ">= 1.8.0, < 2.0.0"
  required_providers {
    oci = { source = "oracle/oci", version = "~> 8.0" }
  }
}
provider "oci" {
  region              = "us-ashburn-1"
  tenancy_ocid        = var.tenancy_ocid
  config_file_profile = var.oci_config_profile
}
resource "oci_identity_tag_namespace" "backup" {
  compartment_id = var.tenancy_ocid
  name           = "grocery-backup"
  description    = "Eligibility tag for single worker backup instance principal"
}
resource "oci_identity_tag" "eligible" {
  tag_namespace_id = oci_identity_tag_namespace.backup.id
  name             = "eligible"
  description      = "Only tagged grocery workers may upload/prune encrypted backups"
}
resource "oci_identity_dynamic_group" "backup" {
  compartment_id = var.tenancy_ocid
  name           = "grocery-backup-workers"
  description    = "Tagged grocery Compute worker identities"
  matching_rule  = "ALL {instance.compartment.id = '${var.compartment_ocid}', tag.grocery-backup.eligible.value = 'true'}"
}
resource "oci_identity_policy" "backup" {
  compartment_id = var.tenancy_ocid
  name           = "grocery-backup-objects"
  description    = "Backup upload, listing and pruning; no content reads or state access"
  statements = ["Allow dynamic-group grocery-backup-workers to manage objects in compartment id ${var.compartment_ocid} where all {target.bucket.name='${var.backup_bucket_name}', any {request.permission='OBJECT_CREATE', request.permission='OBJECT_INSPECT', request.permission='OBJECT_DELETE'}}",
    "Allow group 'Default'/'grocery-github-deployers' to use tag-namespaces in tenancy where target.tag-namespace.name='grocery-backup'",
  ]
}
