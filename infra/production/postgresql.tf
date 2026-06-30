resource "oci_psql_db_system" "grocery" {
  compartment_id              = var.compartment_ocid
  display_name                = "family-grocery-postgres"
  db_version                  = var.postgres_db_version
  shape                       = var.postgres_shape
  instance_count              = var.postgres_instance_count
  instance_ocpu_count         = var.postgres_ocpus
  instance_memory_size_in_gbs = var.postgres_memory_gb
  freeform_tags               = local.common_tags

  credentials {
    username = var.postgres_admin_username
    password_details {
      password_type  = "VAULT_SECRET"
      secret_id      = oci_vault_secret.postgres_admin.id
      secret_version = oci_vault_secret.postgres_admin.current_version_number
    }
  }

  network_details {
    subnet_id = oci_core_subnet.postgres.id
    nsg_ids   = [oci_core_network_security_group.postgres.id]
  }

  storage_details {
    is_regionally_durable = true
    system_type           = "OCI_OPTIMIZED_STORAGE"
    iops                  = var.postgres_iops
  }

  management_policy {
    backup_policy {
      backup_start   = var.postgres_backup_start
      kind           = "DAILY"
      retention_days = var.postgres_backup_retention_days
    }
  }
}
