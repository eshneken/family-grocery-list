resource "oci_core_network_security_group" "load_balancer" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.grocery.id
  display_name   = "family-grocery-lb"
  freeform_tags  = local.common_tags
}

resource "oci_core_network_security_group" "workers" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.grocery.id
  display_name   = "family-grocery-workers"
  freeform_tags  = local.common_tags
}

resource "oci_core_network_security_group" "oke_api" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.grocery.id
  display_name   = "family-grocery-oke-api"
  freeform_tags  = local.common_tags
}

resource "oci_core_network_security_group" "pods" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.grocery.id
  display_name   = "family-grocery-pods"
  freeform_tags  = local.common_tags
}

resource "oci_core_network_security_group" "postgres" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.grocery.id
  display_name   = "family-grocery-postgres"
  freeform_tags  = local.common_tags
}

resource "oci_core_network_security_group_security_rule" "lb_http" {
  network_security_group_id = oci_core_network_security_group.load_balancer.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = "0.0.0.0/0"
  source_type               = "CIDR_BLOCK"
  description               = "Public HTTP for Caddy redirect"
  tcp_options {
    destination_port_range {
      min = 80
      max = 80
    }
  }
}
resource "oci_core_network_security_group_security_rule" "lb_https" {
  network_security_group_id = oci_core_network_security_group.load_balancer.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = "0.0.0.0/0"
  source_type               = "CIDR_BLOCK"
  description               = "Public HTTPS for Caddy"
  tcp_options {
    destination_port_range {
      min = 443
      max = 443
    }
  }
}

resource "oci_core_network_security_group_security_rule" "lb_egress_to_workers" {
  network_security_group_id = oci_core_network_security_group.load_balancer.id
  direction                 = "EGRESS"
  protocol                  = "6"
  destination               = oci_core_network_security_group.workers.id
  destination_type          = "NETWORK_SECURITY_GROUP"
  description               = "Load balancer to Kubernetes NodePorts"

  tcp_options {
    destination_port_range {
      min = 30000
      max = 32767
    }
  }
}

resource "oci_core_network_security_group_security_rule" "lb_to_workers" {
  network_security_group_id = oci_core_network_security_group.workers.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = oci_core_network_security_group.load_balancer.id
  source_type               = "NETWORK_SECURITY_GROUP"
  description               = "Flexible LB to Kubernetes service backends"
  tcp_options {
    destination_port_range {
      min = 30000
      max = 32767
    }
  }
}

resource "oci_core_network_security_group_security_rule" "lb_health_egress_to_workers" {
  network_security_group_id = oci_core_network_security_group.load_balancer.id
  direction                 = "EGRESS"
  protocol                  = "6"
  destination               = oci_core_network_security_group.workers.id
  destination_type          = "NETWORK_SECURITY_GROUP"
  description               = "Load balancer kube-proxy health checks."

  tcp_options {
    destination_port_range {
      min = 10256
      max = 10256
    }
  }
}

resource "oci_core_network_security_group_security_rule" "lb_health_to_workers" {
  network_security_group_id = oci_core_network_security_group.workers.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = oci_core_network_security_group.load_balancer.id
  source_type               = "NETWORK_SECURITY_GROUP"
  description               = "Load balancer kube-proxy health checks."

  tcp_options {
    destination_port_range {
      min = 10256
      max = 10256
    }
  }
}

resource "oci_core_network_security_group_security_rule" "api_public_ingress" {
  network_security_group_id = oci_core_network_security_group.oke_api.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = "0.0.0.0/0"
  source_type               = "CIDR_BLOCK"
  description               = "Public Kubernetes API access; OIDC and RBAC enforce identity."

  tcp_options {
    destination_port_range {
      min = 6443
      max = 6443
    }
  }
}

resource "oci_core_network_security_group_security_rule" "api_oidc_egress" {
  network_security_group_id = oci_core_network_security_group.oke_api.id
  direction                 = "EGRESS"
  protocol                  = "6"
  destination               = "0.0.0.0/0"
  destination_type          = "CIDR_BLOCK"
  description               = "OIDC discovery and signing-key retrieval."

  tcp_options {
    destination_port_range {
      min = 443
      max = 443
    }
  }
}

resource "oci_core_network_security_group_security_rule" "api_to_workers" {
  network_security_group_id = oci_core_network_security_group.workers.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = oci_core_network_security_group.oke_api.id
  source_type               = "NETWORK_SECURITY_GROUP"
  description               = "OKE API endpoint to worker nodes."
}

resource "oci_core_network_security_group_security_rule" "api_to_pods" {
  network_security_group_id = oci_core_network_security_group.pods.id
  direction                 = "INGRESS"
  protocol                  = "all"
  source                    = oci_core_network_security_group.oke_api.id
  source_type               = "NETWORK_SECURITY_GROUP"
  description               = "OKE API endpoint to VCN-native pods."
}

resource "oci_core_network_security_group_security_rule" "api_egress_to_workers" {
  network_security_group_id = oci_core_network_security_group.oke_api.id
  direction                 = "EGRESS"
  protocol                  = "6"
  destination               = oci_core_network_security_group.workers.id
  destination_type          = "NETWORK_SECURITY_GROUP"
  description               = "OKE API endpoint to worker nodes."
}

resource "oci_core_network_security_group_security_rule" "api_path_mtu_to_workers" {
  network_security_group_id = oci_core_network_security_group.oke_api.id
  direction                 = "EGRESS"
  protocol                  = "1"
  destination               = oci_core_network_security_group.workers.id
  destination_type          = "NETWORK_SECURITY_GROUP"
  description               = "Path MTU discovery between the OKE API endpoint and workers."

  icmp_options {
    type = 3
    code = 4
  }
}

resource "oci_core_network_security_group_security_rule" "workers_path_mtu_from_api" {
  network_security_group_id = oci_core_network_security_group.workers.id
  direction                 = "INGRESS"
  protocol                  = "1"
  source                    = oci_core_network_security_group.oke_api.id
  source_type               = "NETWORK_SECURITY_GROUP"
  description               = "Path MTU discovery from the OKE API endpoint to workers."

  icmp_options {
    type = 3
    code = 4
  }
}

resource "oci_core_network_security_group_security_rule" "api_egress_to_pods" {
  network_security_group_id = oci_core_network_security_group.oke_api.id
  direction                 = "EGRESS"
  protocol                  = "all"
  destination               = oci_core_network_security_group.pods.id
  destination_type          = "NETWORK_SECURITY_GROUP"
  description               = "OKE API endpoint to VCN-native pods."
}

resource "oci_core_network_security_group_security_rule" "workers_egress_to_api_6443" {
  network_security_group_id = oci_core_network_security_group.workers.id
  direction                 = "EGRESS"
  protocol                  = "6"
  destination               = oci_core_network_security_group.oke_api.id
  destination_type          = "NETWORK_SECURITY_GROUP"
  description               = "Workers to the Kubernetes API endpoint."

  tcp_options {
    destination_port_range {
      min = 6443
      max = 6443
    }
  }
}

resource "oci_core_network_security_group_security_rule" "workers_egress_to_api_12250" {
  network_security_group_id = oci_core_network_security_group.workers.id
  direction                 = "EGRESS"
  protocol                  = "6"
  destination               = oci_core_network_security_group.oke_api.id
  destination_type          = "NETWORK_SECURITY_GROUP"
  description               = "Workers to the OKE control-plane service endpoint."

  tcp_options {
    destination_port_range {
      min = 12250
      max = 12250
    }
  }
}

resource "oci_core_network_security_group_security_rule" "pods_egress_to_api_6443" {
  network_security_group_id = oci_core_network_security_group.pods.id
  direction                 = "EGRESS"
  protocol                  = "6"
  destination               = oci_core_network_security_group.oke_api.id
  destination_type          = "NETWORK_SECURITY_GROUP"
  description               = "VCN-native pods to the Kubernetes API endpoint."

  tcp_options {
    destination_port_range {
      min = 6443
      max = 6443
    }
  }
}

resource "oci_core_network_security_group_security_rule" "pods_egress_to_api_12250" {
  network_security_group_id = oci_core_network_security_group.pods.id
  direction                 = "EGRESS"
  protocol                  = "6"
  destination               = oci_core_network_security_group.oke_api.id
  destination_type          = "NETWORK_SECURITY_GROUP"
  description               = "VCN-native pods to the OKE control-plane service endpoint."

  tcp_options {
    destination_port_range {
      min = 12250
      max = 12250
    }
  }
}

resource "oci_core_network_security_group_security_rule" "workers_to_api_6443" {
  network_security_group_id = oci_core_network_security_group.oke_api.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = oci_core_network_security_group.workers.id
  source_type               = "NETWORK_SECURITY_GROUP"
  description               = "Workers to the Kubernetes API endpoint."

  tcp_options {
    destination_port_range {
      min = 6443
      max = 6443
    }
  }
}

resource "oci_core_network_security_group_security_rule" "workers_path_mtu_to_api" {
  network_security_group_id = oci_core_network_security_group.oke_api.id
  direction                 = "INGRESS"
  protocol                  = "1"
  source                    = oci_core_network_security_group.workers.id
  source_type               = "NETWORK_SECURITY_GROUP"
  description               = "Path MTU discovery from workers to the OKE API endpoint."

  icmp_options {
    type = 3
    code = 4
  }
}

resource "oci_core_network_security_group_security_rule" "workers_to_api_12250" {
  network_security_group_id = oci_core_network_security_group.oke_api.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = oci_core_network_security_group.workers.id
  source_type               = "NETWORK_SECURITY_GROUP"
  description               = "Workers to the OKE control-plane service endpoint."

  tcp_options {
    destination_port_range {
      min = 12250
      max = 12250
    }
  }
}

resource "oci_core_network_security_group_security_rule" "pods_to_api_6443" {
  network_security_group_id = oci_core_network_security_group.oke_api.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = oci_core_network_security_group.pods.id
  source_type               = "NETWORK_SECURITY_GROUP"
  description               = "VCN-native pods to the Kubernetes API endpoint."

  tcp_options {
    destination_port_range {
      min = 6443
      max = 6443
    }
  }
}

resource "oci_core_network_security_group_security_rule" "pods_to_api_12250" {
  network_security_group_id = oci_core_network_security_group.oke_api.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = oci_core_network_security_group.pods.id
  source_type               = "NETWORK_SECURITY_GROUP"
  description               = "VCN-native pods to the OKE control-plane service endpoint."

  tcp_options {
    destination_port_range {
      min = 12250
      max = 12250
    }
  }
}

resource "oci_core_network_security_group_security_rule" "workers_internal_ingress" {
  network_security_group_id = oci_core_network_security_group.workers.id
  direction                 = "INGRESS"
  protocol                  = "all"
  source                    = oci_core_network_security_group.workers.id
  source_type               = "NETWORK_SECURITY_GROUP"
  description               = "Required worker-to-worker cluster traffic."
}

resource "oci_core_network_security_group_security_rule" "pods_from_workers" {
  network_security_group_id = oci_core_network_security_group.pods.id
  direction                 = "INGRESS"
  protocol                  = "all"
  source                    = oci_core_network_security_group.workers.id
  source_type               = "NETWORK_SECURITY_GROUP"
  description               = "Worker-to-pod traffic for VCN-native networking."
}

resource "oci_core_network_security_group_security_rule" "pods_internal_ingress" {
  network_security_group_id = oci_core_network_security_group.pods.id
  direction                 = "INGRESS"
  protocol                  = "all"
  source                    = oci_core_network_security_group.pods.id
  source_type               = "NETWORK_SECURITY_GROUP"
  description               = "Pod-to-pod traffic for VCN-native networking."
}

resource "oci_core_network_security_group_security_rule" "workers_from_pods" {
  network_security_group_id = oci_core_network_security_group.workers.id
  direction                 = "INGRESS"
  protocol                  = "all"
  source                    = oci_core_network_security_group.pods.id
  source_type               = "NETWORK_SECURITY_GROUP"
  description               = "Pod-to-worker traffic for VCN-native networking."
}

resource "oci_core_network_security_group_security_rule" "pods_to_postgres" {
  network_security_group_id = oci_core_network_security_group.postgres.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = oci_core_network_security_group.pods.id
  source_type               = "NETWORK_SECURITY_GROUP"
  description               = "Only pods reach PostgreSQL"
  tcp_options {
    destination_port_range {
      min = 5432
      max = 5432
    }
  }
}
resource "oci_core_network_security_group_security_rule" "bastion_to_postgres" {
  network_security_group_id = oci_core_network_security_group.postgres.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = var.bastion_subnet_cidr
  source_type               = "CIDR_BLOCK"
  description               = "Bastion port forwarding to PostgreSQL"
  tcp_options {
    destination_port_range {
      min = 5432
      max = 5432
    }
  }
}
resource "oci_core_network_security_group_security_rule" "private_egress" {
  for_each = {
    workers = oci_core_network_security_group.workers.id
    pods    = oci_core_network_security_group.pods.id
  }

  network_security_group_id = each.value
  direction                 = "EGRESS"
  protocol                  = "all"
  destination               = "0.0.0.0/0"
  destination_type          = "CIDR_BLOCK"
  description               = "NAT egress for image pulls, OAuth, and ACME"
}
