terraform {
  # The initial bootstrap apply uses `terraform init -backend=false` because
  # this bucket does not exist until that apply completes. Reinitialize with
  # `-migrate-state -backend-config=backend.hcl` immediately afterward.
  backend "oci" {}
}
