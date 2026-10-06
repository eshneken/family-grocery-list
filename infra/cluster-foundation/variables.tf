variable "tenancy_ocid" {
  validation {
    condition     = var.tenancy_ocid == "ocid1.tenancy.oc1..aaaaaaaaxr2zj2tokqai2vyetuiinhzdr2i6yupriqasl5im3jwv7yjfa2ua"
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
  description = "OCI provider and remote-state authentication mode. GitHub Actions uses SecurityToken; local runs default to ApiKey."
  type        = string
  default     = "ApiKey"
}

variable "compartment_ocid" {
  validation {
    condition     = var.compartment_ocid == "ocid1.compartment.oc1..aaaaaaaayhvqxmlrywosn7ef2jtruuvatnovwluou2bhwzbtstg5sq2gtppa"
    error_message = "This migration root is bound to EDFREETIER / grocery / Ashburn; do not reuse legacy state."
  }
  description = "Compartment containing the CCM-created public load balancer."
  type        = string
  sensitive   = true
}

variable "state_bucket_name" {
  description = "Object Storage bucket created by infra/bootstrap."
  type        = string
}

variable "state_namespace" {
  description = "Object Storage namespace created by infra/bootstrap."
  type        = string
}

variable "production_state_key" {
  description = "OCI backend key for the production root state."
  type        = string
  default     = "production/terraform.tfstate"
}

variable "kubeconfig_path" {
  description = "Path to a short-lived OKE kubeconfig generated locally or by CI."
  type        = string
  default     = null
  nullable    = true
}

variable "namespace" {
  type    = string
  default = "grocery"
}

variable "app_hostname" {
  type = string
}

variable "caddy_image" {
  description = "Pinned multi-architecture official Caddy image."
  type        = string
  default     = "docker.io/library/caddy@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d"
}

variable "caddy_acme_email" {
  description = "Email address registered with Let's Encrypt."
  type        = string
}

variable "load_balancer_display_name" {
  description = "Friendly OCI display name assigned to the CCM-created public load balancer."
  type        = string
  default     = "lb-grocery"
}

variable "oci_config_profile" {
  type    = string
  default = "EDFREETIER"
  validation {
    condition     = contains(["EDFREETIER", "DEFAULT"], var.oci_config_profile)
    error_message = "Use EDFREETIER locally or DEFAULT for short-lived GitHub federation."
  }
}

variable "load_balancer_min_mbps" {
  type    = number
  default = 10
  validation {
    condition     = var.load_balancer_min_mbps == 10
    error_message = "Always Free load balancer bandwidth must be fixed at 10 Mbps."
  }
}

variable "load_balancer_max_mbps" {
  type    = number
  default = 10
  validation {
    condition     = var.load_balancer_max_mbps == 10
    error_message = "Always Free load balancer bandwidth must be fixed at 10 Mbps."
  }
}

variable "postgres_image" {
  type    = string
  default = "docker.io/library/postgres@sha256:0ea6700a3b4f0ae6ce746519073558aed4d88a79d8d07622a9a644946c7319c4"
}
variable "backup_image" {
  description = "Immutable ARM-capable GHCR backup image; build before foundation apply."
  type        = string
  validation {
    condition     = can(regex("^ghcr.io/.+@sha256:[a-f0-9]{64}$", var.backup_image))
    error_message = "Supply a verified immutable backup image digest."
  }
}
variable "backup_age_recipient" {
  description = "Public age recipient only; private recovery key stays outside OCI."
  type        = string
  validation {
    condition     = can(regex("^age1[a-z0-9]+$", var.backup_age_recipient))
    error_message = "An age public recipient is required."
  }
}
variable "backups_enabled" {
  type    = bool
  default = false
}
