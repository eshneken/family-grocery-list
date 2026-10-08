# OCI Always Free infrastructure

These roots target **EDFREETIER / grocery / us-ashburn-1** exclusively. Canonical production is live here; the old grocery environment has been retired after explicit waiver of the rollback hold. Master now contains the Always Free deployment implementation; application delivery is enabled. Do not run these roots against old state or copy old ignored `terraform.tfvars`/backend files. The legacy teardown must use pinned commit `813968f` as described in the [migration design](../docs/oci-always-free-design.md).

Follow the [execution checkpoints](../docs/oci-always-free-checkpoints.md) and [operator runbook](../docs/oci-always-free-operations.md). Provisioning and data cutover are separate checkpoints.

| Root | Owner and resources | State |
|---|---|---|
| `tenancy-identity` | Local administrator: defined backup tag, worker dynamic group, bucket-scoped IAM | Initially local; after bootstrap, private remote `tenancy-identity/terraform.tfstate` (local administrator operations only) |
| `bootstrap` | Private versioned state bucket, private backup bucket, DEFAULT Vault and SOFTWARE key | New bucket: `bootstrap/terraform.tfstate` after local bootstrap migration |
| `production` | Basic OKE, one A1 2 OCPU/12 GB worker, 50 GB boot disk, private networking/NAT/Service Gateway, public API, reserved LB IP, optional troubleshooting Bastion, DB secrets/TLS | New bucket: `production/terraform.tfstate` |
| `cluster-foundation` | PostgreSQL 16, Caddy, one retained shared 50 GiB PVC, one flexible TCP LB fixed at 10/10 Mbps, daily backup CronJob | New bucket: `cluster-foundation/terraform.tfstate` |

The API permits IPv4 sources during the build, as explicitly requested October 6 while the operator is traveling. OCI IAM authentication, Kubernetes RBAC and verified TLS remain required. PostgreSQL, worker/kubelet and NodePorts are private. API allowlisting is a separate follow-up, configured with `operator_api_cidrs`.

## Federation

GitHub uses the `always-free` environment and the identity-domain audience `grocery-always-free-github`. Its subject is exactly `repo:eshneken/family-grocery-list:environment:always-free`. The deployed principal is **grocery-github-service**, created with `serviceUser=true`. Regular users cannot be converted to service users. Setup/verification evidence is in [checkpoint 1](../docs/oci-always-free-checkpoints.md#federation-verification-record).

The temporary administrator OAuth application is deactivated/deleted after verification. The runtime application stays active. No OKE pod workload identity is needed: backup pods use the worker's instance principal, CI uses federation, and humans use their own local OCI profile.

## Changes and updates

Use `scripts/always-free-terraform.sh ROOT plan` to stage source into a private working directory, verify the authenticated target namespace, initialize the new backend and review changes. It does not use existing root-local tfvars/state. `ALWAYS_FREE_VARS_FILE` supplies an absolute path to an ignored new-environment file; environment `TF_VAR_*` values are also supported.

An apply requires a clean checkout, `CONFIRM_APPLY_SHA` equal to the full reviewed commit SHA, and the plan guard passing. No normal update command permits destroy/replacement. After reviewing the plan, run the same root with `apply`; it regenerates and checks the plan immediately before apply. State/plan files contain credentials and must not be uploaded as workflow artifacts or committed.

The manual **OCI Always Free infrastructure** workflow runs one selected stage (`production` or `cluster-foundation`) with `plan` or `apply`. It reads bootstrap outputs from the new state bucket and authenticates only through `always-free`. The local administrator handles initial tenancy prerequisites and bootstrap; the deployer is not granted tenancy-wide IAM writes.

Application delivery is enabled on `master`, supports manual dispatch and defaults to `restore-existing`. The hourly backup monitor is active on master. Old-environment retirement is complete; its Vault/key deletion waiting period ends November 7. `always-free` already permits `master` and the migration branch, and canonical hostname/OAuth/session values are installed. Retain those settings and the same federation subject on updates.

## Storage and recovery

The worker boot disk plus shared data disk initially allocate approximately 100 GB, subject to actual OCI rounding. Caddy mounts only `caddy`; PostgreSQL mounts only `postgres`. Neither consumer recursively changes the shared root's ownership. The claim has `prevent_destroy`, and the StorageClass retains its PV; removal of Terraform configuration can bypass lifecycle protection, so always review plans and actual retained disks.

Daily backups upload an age-encrypted custom dump and completion manifest, then retain the last five completed backups. A failed dump/upload never prunes completed backups. Upload-only instance IAM cannot read backup contents or Terraform state. Keep the age private recovery key outside OCI and GitHub. Backups start suspended in a new installation; production now has `OCI_BACKUPS_ENABLED=true` after successful backup/restore and IAM-negative-access tests. Preserve that setting on updates.

Current health checks, database access, backup drills, recovery and release procedures are in the [operator runbook](../docs/oci-always-free-operations.md). The [architecture/tool reference](../docs/oci-deployment-plan.md) describes current selections; legacy destruction remains only in the archived migration design. Ordinary rollout is not a disaster restore or teardown.
