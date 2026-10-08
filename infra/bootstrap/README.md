# Always Free bootstrap

Creates the new private versioned Terraform-state bucket, private non-versioned backup bucket, DEFAULT Vault and SOFTWARE AES key in the target `grocery` compartment. It creates no worker, load balancer or database.

Run the target-bound helper from the [operator runbook](../../docs/oci-always-free-operations.md), initially with local `${OCI_CLI_PROFILE}` administrator credentials. The helper retains initial local state under ignored `.always-free`, then migrates bootstrap state into `${OCI_STATE_BUCKET}`. Protect and retain private local files until remote-state recovery has been verified.

Do not run plain `terraform apply` inside this root: existing ignored configuration may belong to the legacy environment. Do not migrate legacy state into the new bucket. The backup bucket is protected against ordinary Terraform destruction.
