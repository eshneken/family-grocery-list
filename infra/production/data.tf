data "oci_core_services" "all" {}

locals {
  object_storage_service = one([
    for service in data.oci_core_services.all.services : service
    if can(regex("Object Storage", service.name))
  ])
  common_tags = merge(var.tags, { Stack = "production" })
}
