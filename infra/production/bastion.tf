resource "oci_core_security_list" "bastion" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.grocery.id
  display_name   = "family-grocery-bastion-ssh"
  freeform_tags  = local.common_tags

  # Managed Bastion accepts clients through its service endpoint and CIDR
  # allowlist. Its private endpoint initiates SSH to the private worker.
  egress_security_rules {
    protocol         = "6"
    destination      = var.worker_subnet_cidr
    destination_type = "CIDR_BLOCK"
    stateless        = false
    description      = "Bastion subnet to private worker SSH only."

    tcp_options {
      min = 22
      max = 22
    }
  }
}

resource "oci_core_network_security_group_security_rule" "workers_ssh_from_bastion" {
  network_security_group_id = oci_core_network_security_group.workers.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = var.bastion_subnet_cidr
  source_type               = "CIDR_BLOCK"
  stateless                 = false
  description               = "SSH from the dedicated Bastion subnet; workers remain private."

  tcp_options {
    destination_port_range {
      min = 22
      max = 22
    }
  }
}

resource "oci_bastion_bastion" "grocery" {
  count                        = var.enable_bastion ? 1 : 0
  bastion_type                 = "STANDARD"
  compartment_id               = var.compartment_ocid
  target_subnet_id             = oci_core_subnet.bastion.id
  name                         = "familygrocerybastion"
  client_cidr_block_allow_list = sort(tolist(var.admin_cidrs))
  max_session_ttl_in_seconds   = 3600
  freeform_tags                = local.common_tags
}
