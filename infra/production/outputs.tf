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
output "postgres_db_system_id" { value = oci_psql_db_system.grocery.id }
output "postgres_admin_username" { value = var.postgres_admin_username }
output "postgres_admin_secret_id" {
  value     = oci_vault_secret.postgres_admin.id
  sensitive = true
}
output "postgres_private_ip" { value = oci_psql_db_system.grocery.network_details[0].primary_db_endpoint_private_ip }
output "bastion_id" { value = oci_bastion_bastion.grocery.id }
