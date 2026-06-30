provider "oci" {
  tenancy_ocid = var.tenancy_ocid
  region       = var.region
  auth         = var.oci_auth
}

provider "kubernetes" {
  config_path = var.kubeconfig_path
}
