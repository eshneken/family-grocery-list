# OCI infrastructure

These Terraform roots provision one configured deployment in a free-tier eligible footprint. All tenancy/resource IDs, profile details, public hostnames and contact information come from private target configuration. Follow the [setup guide](../docs/oci-setup.md), [architecture](../docs/oci-architecture.md) and [operator runbook](../docs/oci-operations.md).

| Root | Resources | State key |
|---|---|---|
| `tenancy-identity` | Backup tag, worker dynamic group and bucket-scoped IAM; local administrator only | `tenancy-identity/terraform.tfstate` |
| `bootstrap` | Private versioned state bucket, private backup bucket, DEFAULT Vault and SOFTWARE key | `bootstrap/terraform.tfstate` |
| `production` | Basic OKE, one A1 2/12 worker, 50 GB boot, private networking, public API, reserved LB IP, optional Bastion and database secrets/TLS | `production/terraform.tfstate` |
| `cluster-foundation` | PostgreSQL 16, Caddy, one retained shared 50 GiB PVC, one 10/10 Mbps flexible LB and daily backup CronJob | `cluster-foundation/terraform.tfstate` |

Identity and bootstrap start with private local state before the state bucket exists. The helper moves that state to separate keys in the private bucket. Preserve existing state on updates; do not initialize a second state for resources that already exist.

## Federation

GitHub jobs select `environment: always-free`, with exact subject `repo:<owner>/<repository>:environment:always-free`. The operator creates a service user (`serviceUser=true` at creation), compartment-scoped deployment group/policy, runtime OAuth application and identity propagation trust. The [setup guide](../docs/oci-setup.md#github-to-oci-federation) covers this administrator bootstrap. Workers use an instance principal for backups; humans use their own configured OCI profile. CI does not use either identity.

The environment secret `OCI_TARGET_CONFIG` holds the approved target record and `OCI_WIF_CLIENT_SECRET` holds the runtime OAuth secret. The loader masks values before authentication. The temporary administrator application/secret is never installed in GitHub and should be deactivated after verification.

## Changes and updates

Use `scripts/always-free-terraform.sh ROOT plan` to stage source into a private working directory, verify the authenticated namespace, initialize the backend and review changes. Root-local tfvars/state are not consumed. `ALWAYS_FREE_VARS_FILE` supplies an absolute ignored variables file; `TF_VAR_*` values supply other non-identity inputs.

An apply requires a clean checkout, `CONFIRM_APPLY_SHA` equal to the full reviewed commit SHA and a passing plan guard. The helper regenerates/checks its plan immediately before applying. Deletion and replacement require a separate reviewed recovery procedure. State/plan files contain credentials and must never be committed or uploaded as workflow artifacts.

The manual **OCI Always Free infrastructure** workflow supports `production` and `cluster-foundation` with `plan` or `apply`. Administrator IAM and initial bootstrap run locally. Application releases run from protected `master`; the hourly [backup monitor](../docs/backup-alerts.md) runs on the same default branch.

## Storage and recovery

The worker boot disk and shared data disk allocate approximately 100 GB, subject to OCI rounding and GiB/GB conversion. PostgreSQL mounts `postgres`; Caddy mounts `caddy`. Neither recursively changes ownership of the shared root. The claim has `prevent_destroy` and a Retain storage policy; removing configuration can bypass lifecycle protection, so review both plans and retained disks.

Backups start suspended in a fresh installation. Enable them only after verifying encryption, upload, scratch restore and worker permission boundaries; preserve `OCI_BACKUPS_ENABLED=true` on subsequent updates. Keep the private age key outside OCI and GitHub. See [operations](../docs/oci-operations.md#backups-and-restore-drills).
