output "namespace" { value = kubernetes_namespace_v1.grocery.metadata[0].name }
output "caddy_service_name" { value = kubernetes_service_v1.caddy.metadata[0].name }
output "postgres_fqdn" { value = local.postgres_host }
output "postgres_port" { value = 5432 }
output "shared_pvc" { value = kubernetes_persistent_volume_claim_v1.platform.metadata[0].name }
