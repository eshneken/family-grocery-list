# OCI Always Free infrastructure

This migration branch targets **EDFREETIER / grocery / us-ashburn-1** exclusively. The old environment remains on `master` during migration. Do not run these roots against old state or copy old ignored `terraform.tfvars`/backend files. The legacy teardown must use pinned commit `813968f` as described in the [migration design](../docs/oci-always-free-design.md).

Follow the [execution checkpoints](../docs/oci-always-free-checkpoints.md) and [operator runbook](../docs/oci-always-free-operations.md). Provisioning and data cutover are separate checkpoints.

| Root | Owner and resources | State |
|---|---|---|
| `tenancy-identity` | Local administrator: defined backup tag, worker dynamic group, bucket-scoped IAM | Initially local; after bootstrap, private remote `tenancy-identity/terraform.tfstate` (local administrator operations only) |
| `bootstrap` | Private versioned state bucket, private backup bucket, DEFAULT Vault and SOFTWARE key | New bucket: `bootstrap/terraform.tfstate` after local bootstrap migration |
| `production` | Basic OKE, one A1 2 OCPU/12 GB worker, 50 GB boot disk, private networking/NAT/Service Gateway, public API, reserved LB IP, optional troubleshooting Bastion, DB secrets/TLS | New bucket: `production/terraform.tfstate` |
| `cluster-foundation` | PostgreSQL 16, Caddy, one retained shared 50 GiB PVC, one fixed 10/10 Mbps TCP LB, daily backup CronJob | New bucket: `cluster-foundation/terraform.tfstate` |

The API permits IPv4 sources during the build, as explicitly requested October 6 while the operator is traveling. OCI IAM authentication, Kubernetes RBAC and verified TLS remain required. PostgreSQL, worker/kubelet and NodePorts are private. API allowlisting is a separate follow-up, configured with `operator_api_cidrs`.

## Federation

GitHub uses the `always-free` environment and the identity-domain audience `grocery-always-free-github`. Its subject is exactly `repo:eshneken/family-grocery-list:environment:always-free`. The deployed principal is **grocery-github-service**, created with `serviceUser=true`. Regular users cannot be converted to service users. Setup/verification evidence is in [checkpoint 1](../docs/oci-always-free-checkpoints.md#federation-verification-record).

The temporary administrator OAuth application is deactivated/deleted after verification. The runtime application stays active. No OKE pod workload identity is needed: backup pods use the worker's instance principal, CI uses federation, and humans use their own local OCI profile.

## Changes and updates

Use `scripts/always-free-terraform.sh ROOT plan` to stage source into a private working directory, verify the authenticated target namespace, initialize the new backend and review changes. It does not use existing root-local tfvars/state. `ALWAYS_FREE_VARS_FILE` supplies an absolute path to an ignored new-environment file; environment `TF_VAR_*` values are also supported.

An apply requires a clean checkout, `CONFIRM_APPLY_SHA` equal to the full reviewed commit SHA, and the plan guard passing. No normal update command permits destroy/replacement. After reviewing the plan, run the same root with `apply`; it regenerates and checks the plan immediately before apply. State/plan files contain credentials and must not be uploaded as workflow artifacts or committed.

The manual **OCI Always Free infrastructure** workflow runs one selected stage (`production` or `cluster-foundation`) with `plan` or `apply`. It reads bootstrap outputs from the new state bucket and authenticates only through `always-free`. The local administrator handles initial tenancy prerequisites and bootstrap; the deployer is not granted tenancy-wide IAM writes.

The branch application workflow is manual; old `master` retains its original automatic deployment until merge. Do not merge until old-environment retirement has completed. Before merge, change the `always-free` environment branch restriction to permit `master`, set the production hostname/OAuth/session settings, and retain the same federation subject.

## Storage and recovery

The worker boot disk plus shared data disk initially allocate approximately 100 GB, subject to actual OCI rounding. Caddy mounts only `caddy`; PostgreSQL mounts only `postgres`. Neither consumer recursively changes the shared root's ownership. The claim has `prevent_destroy`, and the StorageClass retains its PV; removal of Terraform configuration can bypass lifecycle protection, so always review plans and actual retained disks.

Daily backups upload an age-encrypted custom dump and completion manifest, then retain the last five completed backups. A failed dump/upload never prunes completed backups. Upload-only instance IAM cannot read backup contents or Terraform state. Keep the age private recovery key outside OCI and GitHub. Backups start suspended and are enabled after an actual backup/restore and IAM-negative-access test.

Full data recovery, certificate renewal, maintenance suspension and old-environment destruction are in the [design/runbook](../docs/oci-always-free-design.md). Ordinary rollout is not a disaster restore or teardown.
