output "cluster_id" { value = oci_containerengine_cluster.grocery.id }
output "cluster_endpoint" { value = oci_containerengine_cluster.grocery.endpoints[0].public_endpoint }
output "node_pool_id" { value = oci_containerengine_node_pool.grocery.id }
output "reserved_public_ip" {
  description = "Reserved load balancer IPv4 address. Set the external DNS A record for app_hostname to this value."
  value       = oci_core_public_ip.grocery.ip_address
}
output "app_hostname" {
  description = "Hostname whose external DNS A record must point to reserved_public_ip."
  value       = var.app_hostname
}
output "load_balancer_nsg_id" { value = oci_core_network_security_group.load_balancer.id }
output "worker_nsg_id" { value = oci_core_network_security_group.workers.id }
output "bastion_id" { value = try(oci_bastion_bastion.grocery[0].id, null) }

output "api_nsg_id" { value = oci_core_network_security_group.oke_api.id }
output "postgres_secret_ids" {
  value     = { for role, secret in oci_vault_secret.postgres_roles : role => secret.id }
  sensitive = true
}
output "postgres_tls_secret_id" { value = oci_vault_secret.postgres_tls.id }
