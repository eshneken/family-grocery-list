provider "oci" {
  tenancy_ocid = var.tenancy_ocid
  region       = var.region
  auth         = var.oci_auth
}
