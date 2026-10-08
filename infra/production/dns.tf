# DNS is hosted externally. Forget the former OCI record without attempting to
# delete it: the zone may already have been removed outside Terraform.
removed {
  from = oci_dns_rrset.grocery

  lifecycle {
    destroy = false
  }
}
