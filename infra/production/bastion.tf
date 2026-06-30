resource "oci_bastion_bastion" "grocery" {
  bastion_type                 = "STANDARD"
  compartment_id               = var.compartment_ocid
  target_subnet_id             = oci_core_subnet.bastion.id
  name                         = "family-grocery-bastion"
  client_cidr_block_allow_list = [var.bastion_client_cidr]
  freeform_tags                = local.common_tags
}
