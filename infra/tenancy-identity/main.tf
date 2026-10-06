terraform {
  required_version = ">= 1.8.0, < 2.0.0"
  required_providers {
    oci = { source = "oracle/oci", version = "~> 8.0" }
  }
}
provider "oci" {
  region              = "us-ashburn-1"
  tenancy_ocid        = "ocid1.tenancy.oc1..aaaaaaaaxr2zj2tokqai2vyetuiinhzdr2i6yupriqasl5im3jwv7yjfa2ua"
  config_file_profile = "EDFREETIER"
}
resource "oci_identity_tag_namespace" "backup" {
  compartment_id = "ocid1.tenancy.oc1..aaaaaaaaxr2zj2tokqai2vyetuiinhzdr2i6yupriqasl5im3jwv7yjfa2ua"
  name           = "grocery-backup"
  description    = "Eligibility tag for single worker backup instance principal"
}
resource "oci_identity_tag" "eligible" {
  tag_namespace_id = oci_identity_tag_namespace.backup.id
  name             = "eligible"
  description      = "Only tagged grocery workers may upload/prune encrypted backups"
}
resource "oci_identity_dynamic_group" "backup" {
  compartment_id = "ocid1.tenancy.oc1..aaaaaaaaxr2zj2tokqai2vyetuiinhzdr2i6yupriqasl5im3jwv7yjfa2ua"
  name           = "grocery-backup-workers"
  description    = "Tagged grocery Compute worker identities"
  matching_rule  = "ALL {instance.compartment.id = 'ocid1.compartment.oc1..aaaaaaaayhvqxmlrywosn7ef2jtruuvatnovwluou2bhwzbtstg5sq2gtppa', tag.grocery-backup.eligible.value = 'true'}"
}
resource "oci_identity_policy" "backup" {
  compartment_id = "ocid1.tenancy.oc1..aaaaaaaaxr2zj2tokqai2vyetuiinhzdr2i6yupriqasl5im3jwv7yjfa2ua"
  name           = "grocery-backup-objects"
  description    = "Backup upload, listing and pruning; no content reads or state access"
  statements     = ["Allow dynamic-group grocery-backup-workers to manage objects in compartment grocery where all {target.bucket.name='grocery-always-free-backups', any {request.permission='OBJECT_CREATE', request.permission='OBJECT_INSPECT', request.permission='OBJECT_DELETE'}}"]
}
