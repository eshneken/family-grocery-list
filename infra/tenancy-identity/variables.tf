variable "approved_target" {
  description = "Reviewed target identity from private operator/environment configuration."
  type        = object({ tenancy_ocid = string, compartment_ocid = string, region = string })
  sensitive   = true
}

variable "tenancy_ocid" {
  type      = string
  sensitive = true
  validation {
    condition     = var.tenancy_ocid == var.approved_target.tenancy_ocid
    error_message = "Tenancy must match the approved private target."
  }
}
variable "compartment_ocid" {
  type      = string
  sensitive = true
  validation {
    condition     = var.compartment_ocid == var.approved_target.compartment_ocid
    error_message = "Compartment must match the approved private target."
  }
}
variable "oci_config_profile" { type = string }
variable "backup_bucket_name" { type = string }
