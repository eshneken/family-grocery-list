provider "oci" {
  tenancy_ocid = var.tenancy_ocid
  region       = var.region
}

provider "kubernetes" {
  config_path = var.kubeconfig_path
}
