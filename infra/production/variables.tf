variable "tenancy_ocid" {
  type      = string
  sensitive = true
}

variable "compartment_ocid" {
  type      = string
  sensitive = true
}

variable "region" {
  type = string
}

variable "oci_auth" {
  description = "OCI provider authentication mode. GitHub Actions uses SecurityToken; local runs default to ApiKey."
  type        = string
  default     = "ApiKey"
}

variable "dns_zone_name" {
  type = string
}

variable "dns_zone_compartment_ocid" {
  description = "Compartment that owns the public OCI DNS zone. Defaults to the tenancy root compartment."
  type        = string
  default     = null
  nullable    = true
}

variable "app_hostname" {
  type = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]+[a-z0-9]$", var.app_hostname))
    error_message = "app_hostname must be a lowercase DNS hostname."
  }
}

variable "dns_ttl" { default = 300 }
variable "vcn_cidr" { default = "10.40.0.0/16" }
variable "lb_subnet_cidr" { default = "10.40.0.0/24" }
variable "oke_endpoint_subnet_cidr" { default = "10.40.1.0/28" }
variable "worker_subnet_cidr" { default = "10.40.10.0/24" }
variable "pod_subnet_cidr" { default = "10.40.20.0/22" }
variable "postgres_subnet_cidr" { default = "10.40.30.0/24" }
variable "bastion_subnet_cidr" { default = "10.40.40.0/28" }

variable "oke_kubernetes_version" {
  description = "A Kubernetes version currently supported by OKE in Ashburn. Set after verifying service availability."
  type        = string
}

variable "node_shape" { default = "VM.Standard.A1.Flex" }

variable "node_count" {
  type    = number
  default = 1

  validation {
    condition     = var.node_count >= 1 && var.node_count <= 3
    error_message = "node_count must be between 1 and 3 for this personal deployment."
  }
}

variable "node_ocpus" { default = 2 }
variable "node_memory_gb" { default = 12 }
variable "node_boot_volume_gb" { default = 50 }

variable "node_availability_domain" {
  description = "Tenancy-specific availability domain name for the managed OKE worker, for example cGkv:US-ASHBURN-AD-1."
  type        = string

  validation {
    condition     = length(trimspace(var.node_availability_domain)) > 0
    error_message = "node_availability_domain must not be empty."
  }
}

variable "node_ssh_public_key" { type = string }

variable "bastion_client_cidr" {
  description = "Client CIDR allowed to create Bastion sessions, for example 203.0.113.0/24."
  type        = string

  validation {
    condition     = can(cidrhost(var.bastion_client_cidr, 0))
    error_message = "bastion_client_cidr must be a valid IPv4 or IPv6 CIDR."
  }
}

variable "postgres_shape" { default = "PostgreSQL.VM.Standard.E5.Flex" }
variable "postgres_db_version" { default = "16" }
variable "postgres_instance_count" { default = 1 }
variable "postgres_ocpus" { default = 1 }
variable "postgres_memory_gb" { default = 16 }
variable "postgres_iops" { default = 75000 }
variable "postgres_backup_retention_days" { default = 14 }

variable "postgres_backup_start" {
  description = "Daily PostgreSQL backup start time in 24-hour HH:MM format."
  type        = string
  default     = "02:00"

  validation {
    condition     = can(regex("^([01][0-9]|2[0-3]):[0-5][0-9]$", var.postgres_backup_start))
    error_message = "postgres_backup_start must use 24-hour HH:MM format, for example 02:00."
  }
}

variable "postgres_admin_username" { default = "grocery_admin" }

variable "vault_id" {
  description = "Vault ID created by bootstrap for database secrets."
  type        = string
  sensitive   = true
}

variable "vault_key_id" {
  description = "KMS key ID created by bootstrap for database secrets."
  type        = string
  sensitive   = true
}

variable "tags" {
  type = map(string)
  default = {
    Application = "family-grocery-list"
    ManagedBy   = "terraform"
    Environment = "production"
  }
}
