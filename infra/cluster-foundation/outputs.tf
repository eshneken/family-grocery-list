output "namespace" { value = kubernetes_namespace_v1.grocery.metadata[0].name }
output "caddy_service_name" { value = kubernetes_service_v1.caddy.metadata[0].name }
output "postgres_fqdn" { value = local.postgres_endpoint.fqdn }
output "postgres_port" { value = local.postgres_endpoint.port }
