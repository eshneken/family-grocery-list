variable "tenancy_ocid" {
  validation {
    condition     = var.tenancy_ocid == "ocid1.tenancy.oc1..aaaaaaaaxr2zj2tokqai2vyetuiinhzdr2i6yupriqasl5im3jwv7yjfa2ua"
    error_message = "This migration root is bound to EDFREETIER / grocery / Ashburn; do not reuse legacy state."
  }
  type      = string
  sensitive = true
}

variable "compartment_ocid" {
  validation {
    condition     = var.compartment_ocid == "ocid1.compartment.oc1..aaaaaaaayhvqxmlrywosn7ef2jtruuvatnovwluou2bhwzbtstg5sq2gtppa"
    error_message = "This migration root is bound to EDFREETIER / grocery / Ashburn; do not reuse legacy state."
  }
  type      = string
  sensitive = true
}

variable "region" {
  validation {
    condition     = var.region == "us-ashburn-1"
    error_message = "This migration root is bound to EDFREETIER / grocery / Ashburn; do not reuse legacy state."
  }
  type = string
}

variable "oci_auth" {
  description = "OCI provider authentication mode. GitHub Actions uses SecurityToken; local runs default to ApiKey."
  type        = string
  default     = "ApiKey"
}

variable "app_hostname" {
  description = "Public application hostname managed by an external DNS provider, such as GoDaddy."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]+[a-z0-9]$", var.app_hostname))
    error_message = "app_hostname must be a lowercase DNS hostname."
  }
}

variable "vcn_cidr" { default = "10.40.0.0/16" }
variable "lb_subnet_cidr" { default = "10.40.0.0/24" }
variable "oke_endpoint_subnet_cidr" { default = "10.40.1.0/28" }
variable "worker_subnet_cidr" { default = "10.40.10.0/24" }
variable "pod_subnet_cidr" { default = "10.40.20.0/22" }
variable "bastion_subnet_cidr" { default = "10.40.40.0/28" }

variable "oke_kubernetes_version" {
  description = "A Kubernetes version currently supported by OKE in Ashburn. Set after verifying service availability."
  type        = string
}

variable "node_count" {
  type    = number
  default = 1

  validation {
    condition     = var.node_count == 1
    error_message = "Exactly one worker is allowed in this Always Free deployment."
  }
}

variable "node_availability_domain" {
  description = "Tenancy-specific availability domain name for the managed OKE worker, for example cGkv:US-ASHBURN-AD-1."
  type        = string

  validation {
    condition     = length(trimspace(var.node_availability_domain)) > 0
    error_message = "node_availability_domain must not be empty."
  }
}

variable "node_ssh_public_key" {
  type     = string
  default  = null
  nullable = true
}

variable "bastion_client_cidr" {
  default     = "127.0.0.1/32"
  description = "Client CIDR allowed to create Bastion sessions, for example 203.0.113.0/24."
  type        = string

  validation {
    condition     = can(cidrhost(var.bastion_client_cidr, 0))
    error_message = "bastion_client_cidr must be a valid IPv4 or IPv6 CIDR."
  }
}

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
    Environment = "always-free"
  }
}

variable "oci_config_profile" {
  type    = string
  default = "EDFREETIER"
  validation {
    condition     = contains(["EDFREETIER", "DEFAULT"], var.oci_config_profile)
    error_message = "Use EDFREETIER locally or DEFAULT for short-lived GitHub federation."
  }
}

variable "node_shape" {
  default = "VM.Standard.A1.Flex"
  validation {
    condition     = var.node_shape == "VM.Standard.A1.Flex"
    error_message = "Always Free node_shape must equal VM.Standard.A1.Flex."
  }
}

variable "node_ocpus" {
  default = 2
  validation {
    condition     = var.node_ocpus == 2
    error_message = "Always Free node_ocpus must equal 2."
  }
}

variable "node_memory_gb" {
  default = 12
  validation {
    condition     = var.node_memory_gb == 12
    error_message = "Always Free node_memory_gb must equal 12."
  }
}

variable "node_boot_volume_gb" {
  default = 50
  validation {
    condition     = var.node_boot_volume_gb == 50
    error_message = "Always Free node_boot_volume_gb must equal 50."
  }
}

variable "node_image_id" {
  description = "Reviewed OKE ARM64 image matching the selected Kubernetes version."
  type        = string
}
variable "operator_api_cidrs" {
  description = "API source CIDRs. Operator approved public access while traveling; revisit after build."
  type        = set(string)
  default     = ["0.0.0.0/0"]
  validation {
    condition     = length(var.operator_api_cidrs) > 0 && alltrue([for cidr in var.operator_api_cidrs : can(cidrhost(cidr, 0))])
    error_message = "Supply valid API source CIDRs."
  }
}

variable "enable_bastion" {
  type    = bool
  default = false
}
