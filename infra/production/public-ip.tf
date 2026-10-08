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
