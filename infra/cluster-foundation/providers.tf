provider "oci" {
  tenancy_ocid        = var.tenancy_ocid
  region              = var.region
  auth                = var.oci_auth
  config_file_profile = "DEFAULT"
}

provider "kubernetes" {
  config_path = var.kubeconfig_path
}
