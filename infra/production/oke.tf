data "oci_containerengine_node_pool_option" "a1" {
  node_pool_option_id   = "all"
  node_pool_k8s_version = var.oke_kubernetes_version
  node_pool_os_arch     = "aarch64"
}

resource "oci_containerengine_cluster" "grocery" {
  compartment_id     = var.compartment_ocid
  name               = "family-grocery-oke"
  kubernetes_version = var.oke_kubernetes_version
  type               = "ENHANCED_CLUSTER"
  vcn_id             = oci_core_vcn.grocery.id
  freeform_tags      = local.common_tags

  endpoint_config {
    is_public_ip_enabled = true
    subnet_id            = oci_core_subnet.oke_endpoint.id
    nsg_ids              = [oci_core_network_security_group.oke_api.id]
  }

  cluster_pod_network_options {
    cni_type = "OCI_VCN_IP_NATIVE"
  }

  options {
    service_lb_subnet_ids = [oci_core_subnet.load_balancer.id]
    add_ons {
      is_kubernetes_dashboard_enabled = false
      is_tiller_enabled               = false
    }
    kubernetes_network_config {
      pods_cidr     = var.pod_subnet_cidr
      services_cidr = "10.96.0.0/16"
    }
  }
}

resource "oci_containerengine_node_pool" "grocery" {
  cluster_id         = oci_containerengine_cluster.grocery.id
  compartment_id     = var.compartment_ocid
  name               = "family-grocery-a1"
  kubernetes_version = var.oke_kubernetes_version
  node_shape         = var.node_shape
  ssh_public_key     = var.node_ssh_public_key
  freeform_tags      = local.common_tags

  node_shape_config {
    ocpus         = var.node_ocpus
    memory_in_gbs = var.node_memory_gb
  }

  node_source_details {
    image_id                = data.oci_containerengine_node_pool_option.a1.sources[0].image_id
    source_type             = "IMAGE"
    boot_volume_size_in_gbs = var.node_boot_volume_gb
  }
  node_config_details {
    size    = var.node_count
    nsg_ids = [oci_core_network_security_group.workers.id]

    node_pool_pod_network_option_details {
      cni_type       = "OCI_VCN_IP_NATIVE"
      pod_subnet_ids = [oci_core_subnet.pods.id]
      pod_nsg_ids    = [oci_core_network_security_group.pods.id]
    }

    placement_configs {
      availability_domain = var.node_availability_domain
      subnet_id           = oci_core_subnet.workers.id
    }
  }
}
