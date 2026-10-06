# Always Free operator runbook

Current stage: IAM and state/bootstrap prerequisites provisioned October 6; **no OKE/Compute/LB provisioning yet**. Federation passed. The migration branch uses only `EDFREETIER / grocery / us-ashburn-1`; the old environment/master remain intact.

## Recovery key and contact settings (completed for this migration)

1. Deactivate/delete the temporary `grocery-wif-bootstrap-admin` integrated application. Keep `grocery-github-actions` active. The unused regular `grocery-github-deployer` user can be deleted; federation uses `grocery-github-service`.
2. Supply the ACME contact email to set `CADDY_ACME_EMAIL` in GitHub `always-free`.
3. Generate a backup encryption/recovery key on your own machine. If needed, install the age tools (`brew install age` on macOS). For example:

   ```bash
   mkdir -p .always-free/recovery
   chmod 700 .always-free .always-free/recovery
   age-keygen -o .always-free/recovery/postgres.agekey
   chmod 600 .always-free/recovery/postgres.agekey
   age-keygen -y .always-free/recovery/postgres.agekey
   ```

   Send/store only the public `age1…` recipient as `OCI_BACKUP_AGE_RECIPIENT`. Store the private recovery key in your secure password manager or encrypted offline backup, outside OCI and GitHub. Losing it makes these backups unrecoverable. Never paste it into chat.
4. The administrator prerequisite and bootstrap plans must be reviewed before apply. Codex can run read-only plans; there is no need to select an account upgrade or create a VM manually.

No home/travel public IP is required for Lens now. The operator explicitly approved public API access during the build. Bastion/SSH is optional and disabled by default, so no SSH key or Bastion CIDR is required for initial provisioning.

## Administrator prerequisites and state bootstrap

From the migration checkout:

```bash
./scripts/always-free-terraform.sh tenancy-identity plan
./scripts/always-free-terraform.sh bootstrap plan
```

The helper stages only tracked Terraform source and lockfiles into ignored private `.always-free/terraform/ROOT` directories. It never reads old root-local ignored tfvars, backend configuration or state. It verifies the authenticated new namespace before planning. Plans contain generated secret material and stay private; do not upload them as Actions artifacts.

Expected administrator plan: one defined tag namespace/key, one worker dynamic group and one narrow IAM policy for backup objects and deployer use of the backup tag namespace. Expected bootstrap plan: two private buckets (state versioned, backups non-versioned), DEFAULT Vault and SOFTWARE key. No OKE/Compute/LB is created at this stage.

After review and with a clean committed checkout, set `CONFIRM_APPLY_SHA` to the full reviewed migration commit and run the same root with `apply`. The apply command regenerates/checks the plan; stop if it differs materially from what was reviewed. Initial bootstrap uses private local state, then migrates itself to `grocery-always-free-tfstate`. Retain the local recovery copy until remote state is verified. After bootstrap, rerun `./scripts/always-free-terraform.sh tenancy-identity plan`; the helper migrates its initial local state to `tenancy-identity/terraform.tfstate` in the same private bucket. IAM operations still require the local `EDFREETIER` administrator profile. Verify the remote object before discarding recovery copies; no external tfstate backup is required after migration.

If initial bootstrap apply succeeded but migration failed, preserve `.always-free/terraform/bootstrap/terraform.tfstate`. Do not discard it or initialize a fresh copy. Inspect the existing bucket/object and recover/migrate that state; the helper refuses to treat a preexisting bucket without bootstrap state as a fresh setup.

## Platform plan and apply

Requery OKE version/image options immediately before provisioning. Initially reviewed: `v1.36.4`, Oracle Linux 9 ARM image `ocid1.image.oc1.iad.aaaaaaaaq45fqvrmfngvzptbuis2lrinuc4kawc5z5roalcuvlgcptc3fu7q`. Set the exact reviewed `OCI_NODE_IMAGE_ID` and `OCI_NODE_AVAILABILITY_DOMAIN` in GitHub `always-free`. Keep exactly one worker; retry an eligible AD if A1 capacity is unavailable, never substitute a paid shape.

Run **OCI Always Free infrastructure** on `codex/oci-always-free`, stage `production`, operation `plan`. Review Basic cluster, one A1 2/12 node, 50 GB boot disk, IMDSv1 disabled, no managed PostgreSQL, expected gateways/subnets, and one reserved IP. Operator API ingress is public IPv4 TCP 6443; PostgreSQL/kubelet/NodePorts have no public ingress. The helper plan guard rejects unsupported OCI resource types, unexpected tenancy/compartment IDs, deletions/replacements and resource-envelope violations.

After accepting the plan, select `apply` with the full reviewed commit SHA. Verify the actual Compute instance option `areLegacyImdsEndpointsDisabled=true` and metadata v1 denied; verify actual defined tag, shape/count, private IP, disk size, Basic OKE type and version. Check OCI usage/billing after provisioning and after the trial transition; trial credit alone cannot prove $0 steady state.

## Backup image and foundation

Run **Application Always Free deployment** (`application.yml`) from `codex/oci-always-free`, selecting operation **build-backup-only**. This builds only the backup image and skips application deployment; using the existing workflow also permits dispatch before the migration branch is merged. If the new GHCR package initially defaults to private, make only `family-grocery-list-backup` public in Packages settings, then rerun anonymous-pull verification. Set its immutable index digest as `OCI_BACKUP_IMAGE` in `always-free`; verify ARM64 exists. The image contains PostgreSQL 16 tools, age and the OCI SDK, with instance-principal authentication.

Run the infrastructure workflow's `cluster-foundation` plan/apply after review. Expected: one retained `platform-data` 50 GiB ReadWriteOnce claim, PostgreSQL and Caddy on the same worker/subdirectories, internal verified DB TLS, one fixed 10/10 Mbps LB with TCP 80/443 listeners/backends, and a **suspended** daily backup CronJob. Verify actual volume size/performance and both simultaneous mounts, ownership separation, Pod readiness and Node Allocatable. No live application data has been transferred yet.

Manually point only `grocery-free.shnekendorf.com` at the **new** reserved LB IP in GoDaddy. Verify DNS externally, remove conflicting IPv6 records if needed, then confirm Caddy certificate issuance. Configure the separate rehearsal Google OAuth client with exact callback `https://grocery-free.shnekendorf.com/api/auth/callback/google`. Provide OAuth/session settings securely to the new GitHub environment; do not retrieve secrets through chat.

## Lens

Generate a distinct kubeconfig with your own operator identity, the new cluster OCID and public endpoint. For an API-key-backed `EDFREETIER` profile:

```bash
oci --profile EDFREETIER ce cluster create-kubeconfig \
  --cluster-id '<new-cluster-OCID>' \
  --file .always-free/edfreetier-kubeconfig \
  --region us-ashburn-1 --token-version 2.0.0 \
  --kube-endpoint PUBLIC_ENDPOINT --with-auth-context
```

For this migration, `.always-free/edfreetier-kubeconfig` has been generated with context `edfreetier-grocery` and an absolute OCI CLI exec path. Import that kubeconfig into Lens and label the context distinctly. Its exec command must use the absolute OCI CLI path if Lens cannot find `oci`. Prefer an MFA/security-token human session when configured; generate kubeconfig with that profile and `--auth security_token` instead. Never use CI/service-user credentials for Lens. Verify namespace listing, logs and authorized port-forwarding. Source restrictions remain a later discussion.

## Restore and application deployment checkpoint

Follow the detailed [migration design](oci-always-free-design.md#5-migration-runbook) for source inventory, encrypted dump transfer, restore, comparison and final cutover. Confirm source encoding/locale/collation/extensions before accepting the destination defaults (`UTF8`, `C.UTF-8`, PostgreSQL 16 Bookworm). Do not apply final data migration blindly against incompatible source settings.

Suspend backup/shopping jobs, stop app writes, wait for already-active Jobs, restore using `grocery_owner` with `--no-owner --no-acl`, and verify role/default privileges. PostgreSQL roles/passwords are destination credentials; do not import source global roles/passwords. PostgreSQL TLS is internal; use `PGHOST=postgres.grocery.svc.cluster.local`, `PGHOSTADDR=127.0.0.1`, CA verification and an authenticated port-forward for local tools. An app-only logical dump does not include the Kubernetes bootstrap marker.

After a reviewed successful restore, explicitly create `grocery-bootstrap-state` in the new namespace recording the source backup ID/time and that initialization is complete. Run **Application Always Free deployment** on the branch with `deployment_mode=restore-existing`. The deployment rejects missing markers, missing Household tables and zero-household restores; it never seeds a restored database. Migration/bootstrap Jobs use the owner credential, while app/shopping Jobs use runtime DML permissions.

Use `readiness_mode=internal` only before external DNS/TLS is ready; it verifies Deployment readiness and keeps maintenance Jobs suspended. Repeat with `public` after external validation. Failed deployments leave jobs paused for inspection. `initialize` is only for an explicitly empty disposable database and refuses a nonempty public schema. A failed initialization after migrations requires deliberate recovery; do not force fresh seeding over restored data.

Before enabling daily backups, run a one-off Job from `grocery-postgres-backup`, confirm encrypted object plus completion manifest, download as operator, verify checksum, decrypt and restore to a disposable database. Verify the worker's instance principal cannot read backup content or state-bucket objects. Audit combined worker/CSI/CCM policies and replacement tag inheritance. Then set `backups_enabled=true` in a reviewed foundation apply (daily at 09:00 UTC, last five completed backups). Monitor failure/age/disk usage at the acceptance checkpoint.

## Cutover, hold, retirement and merge

Canonical GoDaddy DNS, production OAuth/session settings and the final authoritative transfer happen only after rehearsal/shopping acceptance. Preserve source state and frozen old data, then run the hold/reverse-restore rollback process in the design. Destroy old resources using the pinned legacy checkout/backend after the accepted hold; do not use these new target-bound roots for old destruction.

Before merge, permit `master` in GitHub `always-free` branch restrictions, update hostname/production secrets and remove obsolete legacy instructions/artifacts. After merge, master uses the new workflows/environment and the same environment-based federation subject. Do not merge while the old environment still needs normal deployments.
