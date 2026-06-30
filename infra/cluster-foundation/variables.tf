variable "tenancy_ocid" {
  type      = string
  sensitive = true
}

variable "region" {
  type = string
}

variable "oci_auth" {
  description = "OCI provider and remote-state authentication mode. GitHub Actions uses SecurityToken; local runs default to ApiKey."
  type        = string
  default     = "ApiKey"
}

variable "compartment_ocid" {
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
  default     = "docker.io/library/caddy:2.10.2-alpine"
}

variable "caddy_acme_email" {
  description = "Email address registered with Let's Encrypt."
  type        = string
}

variable "caddy_storage_class" {
  description = "OKE block-volume StorageClass used for durable Caddy ACME state."
  type        = string
  default     = "oci-bv"
}

variable "caddy_pvc_size_gb" {
  type    = number
  default = 50

  validation {
    condition     = var.caddy_pvc_size_gb >= 50
    error_message = "OCI block-volume claims for this deployment must be at least 50 GiB."
  }
}

variable "load_balancer_min_mbps" {
  type    = number
  default = 10
}

variable "load_balancer_max_mbps" {
  type    = number
  default = 10
}

variable "load_balancer_display_name" {
  description = "Friendly OCI display name assigned to the CCM-created public load balancer."
  type        = string
  default     = "lb-grocery"
}
