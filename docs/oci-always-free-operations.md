# Always Free operator runbook

**Current state, October 8, 2026:** canonical production is live at https://grocery.shnekendorf.com, reserved IP `129.159.189.16`. The operator completed a production shopping run. PostgreSQL runs inside Kubernetes; there is no managed PostgreSQL service in the target tenancy. Both daily backups and shopping-timeout jobs are enabled. The old environment remains frozen during the rollback hold. Application delivery is temporarily disabled until retirement and default-branch handoff; hourly backup alerts are active from `master`.

See [architecture and tool choices](oci-deployment-plan.md), [execution record](oci-always-free-checkpoints.md), and [historical migration design](oci-always-free-design.md).

## Target identity and access

| Setting | Value |
|---|---|
| OCI profile / region | `EDFREETIER` / `us-ashburn-1` |
| Tenancy / compartment | `edfreetier` / `grocery` |
| Object namespace | `iddiywf0v4j6` |
| Terraform state bucket | `grocery-always-free-tfstate` |
| Backup bucket | `grocery-always-free-backups` |
| Kubernetes namespace | `grocery` |
| Operator kubeconfig / context | `.always-free/edfreetier-kubeconfig` / `edfreetier-grocery` |
| Cluster | `ocid1.cluster.oc1.iad.aaaaaaaaaoqtmkxk4i6pgk33uwpsd2h7jqwrxgisp5izvndkdc6gjbeaaqbq` |

The kubeconfig's OCI exec command uses the absolute OCI CLI path and explicitly selects `EDFREETIER`, Ashburn and API-key authentication. This avoids Lens inheriting another profile or token mode. Import the distinct context into Lens. If Lens shows 401 while cached node views work, test fresh namespace/pod listing with this file, verify its exec arguments/profile and restart the connection after correcting them. Never copy CI service credentials into Lens.

Generate a fresh operator config only with the intended identity:

```bash
oci --profile EDFREETIER ce cluster create-kubeconfig \
  --cluster-id 'ocid1.cluster.oc1.iad.aaaaaaaaaoqtmkxk4i6pgk33uwpsd2h7jqwrxgisp5izvndkdc6gjbeaaqbq' \
  --file .always-free/edfreetier-kubeconfig --region us-ashburn-1 --auth api_key \
  --token-version 2.0.0 --kube-endpoint PUBLIC_ENDPOINT --with-auth-context
```

OCI generates its own context name. For a fresh file, rename that generated context before using the commands below:

```bash
kubectl --kubeconfig .always-free/edfreetier-kubeconfig config rename-context \
  "$(kubectl --kubeconfig .always-free/edfreetier-kubeconfig config current-context)" edfreetier-grocery
command -v oci
```

In that file's `users[].user.exec`, set `command` to the absolute path reported by `command -v oci`, and verify the arguments include `--profile EDFREETIER`, `--region us-ashburn-1`, and `--auth api_key`. Inspect only the exec settings; do not dump kubeconfigs containing credentials into logs. Verify a fresh pod list before importing the file into Lens. If updating an existing operator file, preserve its distinct context name and avoid creating duplicate contexts.

Use a separate MFA/security-token human profile when configured; its exec authentication must match that profile. Keep kubeconfig private and keep contexts distinct. API source access is currently public IPv4 TCP 6443 by explicit operator decision; TLS, IAM and RBAC remain required. Database, worker and kubelet ports are private.

## Routine health checks

```bash
kubectl --kubeconfig .always-free/edfreetier-kubeconfig --context edfreetier-grocery get nodes -L kubernetes.io/arch
kubectl --kubeconfig .always-free/edfreetier-kubeconfig --context edfreetier-grocery -n grocery get deployments,statefulsets,pods,cronjobs,jobs,pvc
curl --fail --show-error https://grocery.shnekendorf.com/api/health/ready
python3 -B scripts/check-backup-health.py \
  --kubeconfig .always-free/edfreetier-kubeconfig --context edfreetier-grocery --oci-profile EDFREETIER
```

Expect exactly one Ready ARM64 worker, one app and Caddy replica, `postgres-0` Ready, Bound `platform-data`, and both CronJobs unsuspended. Check disk space inside PostgreSQL and Caddy, Node Allocatable and actual memory/disk use. Backup alerts do not cover disk, app uptime, node health or certificate expiry. The last five complete backups are recovery copies, not an unlimited historical archive.

## Infrastructure updates

Run from the reviewed migration/default-branch checkout:

```bash
./scripts/always-free-terraform.sh production plan
./scripts/always-free-terraform.sh cluster-foundation plan
```

Provide current target-only inputs through `TF_VAR_*` or `ALWAYS_FREE_VARS_FILE` pointing to an absolute ignored file. The helper stages tracked sources and lockfiles in private `.always-free/terraform/ROOT`, ignores legacy root-local files, verifies the authenticated namespace and rejects unsupported resource changes. Plans/state contain generated credentials; never commit, print, or publish them as Actions artifacts.

After reviewing a plan, set `CONFIRM_APPLY_SHA` to the full reviewed commit and use the same root with `apply`; it regenerates/checks the plan before applying. The GitHub **OCI Always Free infrastructure** workflow supports `production` or `cluster-foundation` with `plan`/`apply` and the full `confirm_apply_sha`. It authenticates through `always-free`. Local `EDFREETIER` administrator operations own the `tenancy-identity` and initial `bootstrap` roots.

Preserve `OCI_BACKUPS_ENABLED=true` in `always-free` and the corresponding `backups_enabled=true` local input. Foundation's source default is false for a new installation; omitting the live setting would pause production backups. Verify the plan leaves schedules enabled. Do not replace/destroy the retained shared PVC or remove its lifecycle guard to make a plan pass.

## Worker capacity and replacement

The deployed worker is Ashburn AD-3, `VM.Standard.A1.Flex`, 2 OCPUs / 12 GB RAM, 50 GB boot disk, OKE v1.36.4 and ARM64. IMDSv1 is disabled and the actual instance has `grocery-backup.eligible=true`. Verify these properties on replacements. Never substitute a paid shape or enable legacy metadata endpoints.

The temporary capacity-retry automation was deleted at the operator's request. There is no scheduled VM-launch loop. `retry_nodepool_only=true` permits only creation of the missing node pool, after checking existing workers, Actions overlap, OCI create/delete cleanup and Terraform locks. It is not a replacement mechanism for a running node pool. Preserve existing state, cluster and volume; never force-unlock or use `-target` to bypass guards. A retained RWO volume constrains replacement to its availability domain.

## Database administration

PostgreSQL 16 Bookworm uses database `postgres`, `UTF8` and `C.UTF-8`. The source `en_US.UTF-8` difference was accepted after rehearsal. Owner/migration role: `grocery_owner`; app/shopping role: `grocery_app`; read-only dump role: `grocery_backup`. Do not import old global roles/passwords or give the runtime owner privileges.

Use authenticated Kubernetes port-forwarding, not OCI Bastion or a public database IP:

```bash
kubectl --kubeconfig .always-free/edfreetier-kubeconfig --context edfreetier-grocery \
  -n grocery port-forward service/postgres 5433:5432
```

In a second terminal, export the public database CA privately from `postgres-ca` (`ca.crt`). Retrieve the owner credential securely from the destination secret/Vault; keep it out of terminal output/history and use a mode-0600 password file. For libpq use `PGHOST=postgres.grocery.svc.cluster.local`, `PGHOSTADDR=127.0.0.1`, `PGPORT=5433`, `PGDATABASE=postgres`, `PGUSER=grocery_owner`, `PGSSLMODE=verify-full` and `PGSSLROOTCERT` pointing to that CA. pgAdmin must likewise verify the certificate name; use the DNS name resolving locally through the port-forward rather than weakening TLS validation. Close the forward and remove temporary credentials afterward.

## Backups and restore drills

`grocery-postgres-backup` runs daily at **09:00 UTC**, encrypts a PostgreSQL custom dump with age, uploads `postgres/ID.dump.age` and a completion manifest `postgres/ID.json`, then retains the last five complete pairs. Failed dump/upload does not prune successful backups. The backup image includes PostgreSQL 16 tools, age and OCI SDK; its SDK interpreter is `/opt/backup/bin/python`.

To create an extra recovery point, verify no application/foundation deployment or restore is running or queued, no backup Job is active, and the scheduled backup will not overlap. A manual Kubernetes Job bypasses GitHub Actions concurrency; do not start a deployment/restore while it runs. Then run:

```bash
kubectl --kubeconfig .always-free/edfreetier-kubeconfig --context edfreetier-grocery -n grocery \
  create job "grocery-backup-manual-$(date -u +%Y%m%d%H%M%S)" --from=cronjob/grocery-postgres-backup
```

Inspect completion and verify the matching pair before relying on it. Extra successful jobs also participate in five-backup retention. Upload-only worker IAM cannot read archive contents or Terraform state. Download as an authorized operator, verify manifest ID/database/major version, archive bytes and SHA-256, and decrypt using the off-cloud private age key. A GitHub health success alone does not prove restorability.

Keep `.always-free/recovery/postgres.agekey` private (mode 0600) and a recoverable copy in your password manager/offline store outside OCI and GitHub. Store only its public recipient in `OCI_BACKUP_AGE_RECIPIENT`. Losing the private key makes backups unrecoverable.

Restore drills use a newly created **scratch** database with owner `grocery_owner`, `template0`, and `C.UTF-8`. Restore with PostgreSQL 16 `pg_restore --no-owner --no-acl --single-transaction --exit-on-error`, excluding the archive's already-existing public-schema creation entry when needed. Validate all application tables, migrations, constraints, indexes and recent shopping data; remove the scratch database and decrypted archive afterward. Never use a live database as a restore test.

For actual disaster recovery, freeze writes and both schedules, wait for active jobs, preserve any surviving authoritative data, attach/recover the retained disk or restore the approved encrypted dump, and reapply owner/default privileges. The Kubernetes bootstrap marker is not in a logical dump. Recreate it only after reviewing a completed restore. Deploy with `restore-existing`; never initialize/seed restored data. Validate HTTPS, OAuth, memberships, shopping/history and a new backup before opening writes or resuming jobs. Infrastructure recreation and destructive database replacement require a separate reviewed recovery plan.

## Application releases and failed deployments

The `always-free` environment holds production Google/session secrets, canonical `OCI_APP_HOSTNAME=grocery.shnekendorf.com`, the backup image digest, `OCI_BACKUPS_ENABLED=true` and `OCI_BACKUP_MONITOR_ENABLED=true`. Keep secrets out of GitHub variables. [Deployment details](../deploy/README.md) cover restore-aware release behavior.

The application workflow uses immutable GHCR images, an owner migration Job, runtime app credentials and the existing `grocery-bootstrap-state`. It pauses backup/shopping jobs and waits for active maintenance jobs before migrations. Successful public readiness resumes shopping cleanup and restores the backup schedule's prior enabled state. A failed deployment leaves maintenance paused for inspection. Restore the previous application image only when schema compatibility is established; migrations are never automatically reversed.

A successful retry after failure can still leave backups paused: it sees the schedule was already suspended at the start. After reviewing the recovery, confirming public readiness and no active deployment/restore, explicitly resume `grocery-postgres-backup` and verify `grocery-shopping-timeout` is also enabled. For example:

```bash
kubectl --kubeconfig .always-free/edfreetier-kubeconfig --context edfreetier-grocery -n grocery \
  patch cronjob grocery-postgres-backup --type=merge --patch='{"spec":{"suspend":false}}'
```

Run a coordinated fresh backup/checker afterward; leave `OCI_BACKUPS_ENABLED=true` so the next foundation apply preserves activation.

## GitHub Actions backup alerts

`always-free-backup-health.yml` runs from `master` hourly at minute 17 with `OCI_BACKUP_MONITOR_ENABLED=true`, using `always-free` federation. The isolated monitor was merged before the main migration so alerts work during the rollback hold. The operator confirmed receipt of an actual failed-run notification; the first production check passed.

The checker queries object metadata and Kubernetes Jobs, without downloading manifests/archives or reading database contents. It fails for no complete pair, missing/empty archive, newest backup older than 30 hours or more than five minutes in the future, more than five complete pairs, a newer failed backup Job, a Job active over 40 minutes, a suspended daily schedule, failed access or incorrect target namespace/cluster. A later successful backup clears an older Job failure.

Keep GitHub Actions failed-workflow email notifications enabled and verify the scheduled actor's notification ownership. GitHub can delay/drop scheduled runs; a monitor that never runs cannot alert on itself. This is a backup checker, not an uptime/disk/TLS monitor. Restore drills remain necessary. [Actions notification behavior](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs) and [schedule limitations](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

To stop alerts, set `OCI_BACKUP_MONITOR_ENABLED=false`; this does not stop backup jobs. For local checker tests use `python3 -B scripts/test_backup_health.py`. `--allow-suspended` is only for deliberately paused rehearsal, never the production schedule.

## Rollback hold, retirement and handoff

Cutover was October 8, 2026. The agreed migration design retains the frozen old environment for **at least seven days** and a successful canonical shopping run, whichever is longer. Also require a successful **scheduled** backup, a post-cutover scratch restore, stable resource use and no unresolved errors. A manually triggered backup does not satisfy the scheduled-job checkpoint. Earliest ordinary retirement is October 15 after the full seven-day interval; use the private cutover timestamp for the exact time. Early retirement needs an explicit decision to shorten that hold.

Old data became stale as soon as target writes opened. Do not roll DNS back and reopen it. A rollback after writes requires freezing target writes, backing up the target and validated reverse restore into the old database before switching DNS/writers. Preserve final source and fresh target encrypted recovery copies outside the old tenancy.

Retirement uses pinned legacy commit `813968f6f46a152ed355b9dfcf7492cf03130080`, profile `DEFAULT`, old namespace `idhxczvodltq` and old bucket `family-grocery-terraform-state`. These new target-bound roots must never perform old teardown. Preview each old destroy plan and export encrypted old state before approved reverse-order foundation → production → bootstrap destruction. Inspect retained volumes, buckets and mandatory Vault/key deletion waiting periods. Remove old credentials/IAM only after confirming teardown; leave unrelated resources alone. The [archived migration plan](oci-always-free-design.md#phase-f--destroy-old-environment-then-merge) records the approval and cleanup procedure.

After old retirement, refresh the migration PR against `master`, pass required CI, merge, enable `application.yml`, and verify its first `restore-existing` deployment targets the existing new cluster and preserves data/marker/schedules. `always-free` already permits both `master` and the migration branch. Do not enable old default-branch application delivery during the hold.
