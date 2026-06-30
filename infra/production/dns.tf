data "oci_dns_zones" "grocery" {
  compartment_id = local.dns_zone_compartment_ocid
  name           = var.dns_zone_name
  scope          = "GLOBAL"
  state          = "ACTIVE"
  zone_type      = "PRIMARY"
}

resource "oci_core_public_ip" "grocery" {
  compartment_id = var.compartment_ocid
  display_name   = "family-grocery-lb"
  lifetime       = "RESERVED"
  freeform_tags  = local.common_tags

  lifecycle {
    # OCI CCM attaches this reserved address to its load balancer.
    ignore_changes = [private_ip_id]
  }
}

resource "oci_dns_rrset" "grocery" {
  zone_name_or_id = one(data.oci_dns_zones.grocery.zones).id
  domain          = "${var.app_hostname}."
  rtype           = "A"
  items {
    domain = var.app_hostname
    rdata  = oci_core_public_ip.grocery.ip_address
    rtype  = "A"
    ttl    = var.dns_ttl
  }

  lifecycle {
    precondition {
      condition     = var.app_hostname == var.dns_zone_name || endswith(var.app_hostname, ".${var.dns_zone_name}")
      error_message = "app_hostname must be the DNS zone apex or a hostname within dns_zone_name."
    }
  }
}
