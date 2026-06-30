resource "kubernetes_config_map_v1" "caddy" {
  metadata {
    name      = "caddy-config"
    namespace = kubernetes_namespace_v1.grocery.metadata[0].name
  }

  data = {
    "Caddyfile" = <<-CADDY
      {
        email ${var.caddy_acme_email}
      }

      ${var.app_hostname} {
        reverse_proxy grocery-app:3000
      }
    CADDY
  }
}

resource "kubernetes_persistent_volume_claim_v1" "caddy" {
  metadata {
    name      = "caddy-data"
    namespace = kubernetes_namespace_v1.grocery.metadata[0].name
  }

  spec {
    access_modes       = ["ReadWriteOnce"]
    storage_class_name = var.caddy_storage_class
    resources {
      requests = { storage = "${var.caddy_pvc_size_gb}Gi" }
    }
  }

  # The OKE oci-bv StorageClass uses WaitForFirstConsumer. Waiting here would
  # deadlock Terraform because Caddy is the consumer that triggers binding.
  wait_until_bound = false

}

resource "kubernetes_deployment_v1" "caddy" {
  metadata {
    name      = "caddy"
    namespace = kubernetes_namespace_v1.grocery.metadata[0].name
    labels    = { app = "caddy" }
  }

  spec {
    replicas = 1
    strategy {
      type = "Recreate"
    }
    selector {
      match_labels = { app = "caddy" }
    }

    template {
      metadata {
        labels = { app = "caddy" }
      }
      spec {
        container {
          name  = "caddy"
          image = var.caddy_image
          port {
            container_port = 80
          }
          port {
            container_port = 443
          }
          args = ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]

          volume_mount {
            name       = "config"
            mount_path = "/etc/caddy"
            read_only  = true
          }
          volume_mount {
            name       = "data"
            mount_path = "/data"
          }
          volume_mount {
            name       = "config-state"
            mount_path = "/config"
          }

          resources {
            requests = { cpu = "100m", memory = "128Mi" }
            limits   = { cpu = "500m", memory = "256Mi" }
          }
        }

        volume {
          name = "config"
          config_map {
            name = kubernetes_config_map_v1.caddy.metadata[0].name
          }
        }
        volume {
          name = "data"
          persistent_volume_claim {
            claim_name = kubernetes_persistent_volume_claim_v1.caddy.metadata[0].name
          }
        }
        volume {
          name = "config-state"
          empty_dir {}
        }
      }
    }
  }

  lifecycle {
    # Allows an operator to force an immediate ACME retry without Terraform
    # subsequently rolling the Deployment solely to remove the timestamp.
    ignore_changes = [
      spec[0].template[0].metadata[0].annotations["kubectl.kubernetes.io/restartedAt"],
    ]
  }
}
