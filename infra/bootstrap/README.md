# OCI bootstrap

Creates private state and backup buckets, a DEFAULT Vault and SOFTWARE AES key in the configured application compartment. It creates no worker, load balancer or database.

Use the target-bound helper from the [setup guide](../../docs/oci-setup.md) with the explicit administrator profile. Initial state is private local state under ignored `.always-free`; after bucket creation the helper moves bootstrap state into the configured state bucket. Retain recovery copies until remote state is verified.

Use the same backend/state on later updates. Do not run plain `terraform apply` with unreviewed root-local configuration. The backup bucket is protected against ordinary Terraform destruction.
