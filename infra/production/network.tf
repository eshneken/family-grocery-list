resource "oci_core_vcn" "grocery" {
  compartment_id = var.compartment_ocid
  cidr_blocks    = [var.vcn_cidr]
  display_name   = "family-grocery-vcn"
  dns_label      = "grocery"
  freeform_tags  = local.common_tags
}

resource "oci_core_internet_gateway" "grocery" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.grocery.id
  display_name   = "family-grocery-igw"
  enabled        = true
  freeform_tags  = local.common_tags
}

resource "oci_core_nat_gateway" "grocery" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.grocery.id
  display_name   = "family-grocery-nat"
  freeform_tags  = local.common_tags
}

resource "oci_core_service_gateway" "grocery" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.grocery.id
  display_name   = "family-grocery-sgw"
  freeform_tags  = local.common_tags

  services { service_id = local.object_storage_service.id }
}

resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.grocery.id
  display_name   = "family-grocery-public-rt"
  freeform_tags  = local.common_tags
  route_rules {
    network_entity_id = oci_core_internet_gateway.grocery.id
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
  }
}

resource "oci_core_route_table" "private" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.grocery.id
  display_name   = "family-grocery-private-rt"
  freeform_tags  = local.common_tags
  route_rules {
    network_entity_id = oci_core_nat_gateway.grocery.id
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
  }
  route_rules {
    network_entity_id = oci_core_service_gateway.grocery.id
    destination       = local.object_storage_service.cidr_block
    destination_type  = "SERVICE_CIDR_BLOCK"
  }
}

resource "oci_core_subnet" "load_balancer" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.grocery.id
  cidr_block                 = var.lb_subnet_cidr
  display_name               = "family-grocery-lb"
  route_table_id             = oci_core_route_table.public.id
  prohibit_public_ip_on_vnic = false
  dns_label                  = "lb"
  freeform_tags              = local.common_tags
}

resource "oci_core_subnet" "oke_endpoint" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.grocery.id
  cidr_block                 = var.oke_endpoint_subnet_cidr
  display_name               = "family-grocery-oke-api"
  route_table_id             = oci_core_route_table.public.id
  prohibit_public_ip_on_vnic = false
  dns_label                  = "okeapi"
  freeform_tags              = local.common_tags
}

resource "oci_core_subnet" "workers" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.grocery.id
  cidr_block                 = var.worker_subnet_cidr
  display_name               = "family-grocery-workers"
  route_table_id             = oci_core_route_table.private.id
  prohibit_public_ip_on_vnic = true
  dns_label                  = "workers"
  freeform_tags              = local.common_tags
}

resource "oci_core_subnet" "pods" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.grocery.id
  cidr_block                 = var.pod_subnet_cidr
  display_name               = "family-grocery-pods"
  route_table_id             = oci_core_route_table.private.id
  prohibit_public_ip_on_vnic = true
  dns_label                  = "pods"
  freeform_tags              = local.common_tags
}

resource "oci_core_subnet" "postgres" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.grocery.id
  cidr_block                 = var.postgres_subnet_cidr
  display_name               = "family-grocery-postgres"
  route_table_id             = oci_core_route_table.private.id
  prohibit_public_ip_on_vnic = true
  dns_label                  = "postgres"
  freeform_tags              = local.common_tags
}

resource "oci_core_subnet" "bastion" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.grocery.id
  cidr_block                 = var.bastion_subnet_cidr
  display_name               = "family-grocery-bastion"
  route_table_id             = oci_core_route_table.public.id
  prohibit_public_ip_on_vnic = false
  dns_label                  = "bastion"
  freeform_tags              = local.common_tags
}
