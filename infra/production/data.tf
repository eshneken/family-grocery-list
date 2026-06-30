data "oci_core_services" "all" {}

locals {
  dns_zone_compartment_ocid = coalesce(var.dns_zone_compartment_ocid, var.tenancy_ocid)
  object_storage_service = one([
    for service in data.oci_core_services.all.services : service
    if can(regex("Object Storage", service.name))
  ])
  common_tags = merge(var.tags, { Stack = "production" })
}
