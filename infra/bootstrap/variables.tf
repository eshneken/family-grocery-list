variable "tenancy_ocid" {
  validation {
    condition     = var.tenancy_ocid == "ocid1.tenancy.oc1..aaaaaaaaxr2zj2tokqai2vyetuiinhzdr2i6yupriqasl5im3jwv7yjfa2ua"
    error_message = "This migration root is bound to EDFREETIER / grocery / Ashburn; do not reuse legacy state."
  }
  description = "OCID of the OCI tenancy that owns the Object Storage namespace."
  type        = string
  sensitive   = true
}

variable "compartment_ocid" {
  validation {
    condition     = var.compartment_ocid == "ocid1.compartment.oc1..aaaaaaaayhvqxmlrywosn7ef2jtruuvatnovwluou2bhwzbtstg5sq2gtppa"
    error_message = "This migration root is bound to EDFREETIER / grocery / Ashburn; do not reuse legacy state."
  }
  description = "OCID of the application compartment that owns the state resources."
  type        = string
  sensitive   = true
}

variable "region" {
  validation {
    condition     = var.region == "us-ashburn-1"
    error_message = "This migration root is bound to EDFREETIER / grocery / Ashburn; do not reuse legacy state."
  }
  description = "OCI region for the state resources."
  type        = string
}

variable "oci_auth" {
  description = "OCI provider authentication mode. GitHub Actions uses SecurityToken; local runs default to ApiKey."
  type        = string
  default     = "ApiKey"
}

variable "state_bucket_name" {
  description = "Globally unique Object Storage bucket name for Terraform state."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9._-]{1,254}$", var.state_bucket_name))
    error_message = "state_bucket_name must be 2-255 lowercase characters using letters, digits, dot, underscore, or hyphen."
  }
}

variable "state_namespace" {
  description = "Optional Object Storage namespace. Leave null to discover the tenancy namespace."
  type        = string
  default     = null
  nullable    = true
}

variable "tags" {
  description = "Freeform tags applied to bootstrap resources."
  type        = map(string)
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
