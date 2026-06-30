resource "kubernetes_service_v1" "caddy" {
  metadata {
    name      = "caddy-public"
    namespace = kubernetes_namespace_v1.grocery.metadata[0].name
    annotations = {
      "oci.oraclecloud.com/load-balancer-type"                      = "lb"
      "service.beta.kubernetes.io/oci-load-balancer-shape"          = "flexible"
      "service.beta.kubernetes.io/oci-load-balancer-shape-flex-min" = tostring(var.load_balancer_min_mbps)
      "service.beta.kubernetes.io/oci-load-balancer-shape-flex-max" = tostring(var.load_balancer_max_mbps)
      "oci.oraclecloud.com/oci-network-security-groups"             = data.terraform_remote_state.production.outputs.load_balancer_nsg_id
      "oci.oraclecloud.com/security-rule-management-mode"           = "None"
    }
  }

  spec {
    type             = "LoadBalancer"
    load_balancer_ip = data.terraform_remote_state.production.outputs.reserved_public_ip
    selector         = { app = "caddy" }
    port {
      name        = "http"
      port        = 80
      target_port = 80
      protocol    = "TCP"
    }
    port {
      name        = "https"
      port        = 443
      target_port = 443
      protocol    = "TCP"
    }
  }

  depends_on = [kubernetes_deployment_v1.caddy]
}
