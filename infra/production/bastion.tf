resource "oci_bastion_bastion" "grocery" {
  count                        = var.enable_bastion ? 1 : 0
  bastion_type                 = "STANDARD"
  compartment_id               = var.compartment_ocid
  target_subnet_id             = oci_core_subnet.bastion.id
  name                         = "family-grocery-bastion"
  client_cidr_block_allow_list = sort(tolist(var.admin_cidrs))
  freeform_tags                = local.common_tags
}
