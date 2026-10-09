# OCI operator runbook

Operate one configured deployment of the app: Basic OKE, a single ARM64 A1 worker, Kubernetes PostgreSQL, Caddy, durable shared storage and encrypted daily backups. See the [architecture](oci-architecture.md), [setup guide](oci-setup.md) and [application delivery guide](../deploy/README.md). All endpoint and identity values are supplied privately.

## Target identity and access

The scripts require `OCI_TARGET_CONFIG_FILE` pointing to a mode-0600 JSON file outside tracked source. CI reads the same approved values from the `always-free` environment secret `OCI_TARGET_CONFIG`, masks each value before authentication and writes a private runner file. Missing configuration stops the operation; it never discovers a replacement target or falls back to another profile. Terraform provider inputs are compared with `approved_target`, and the plan guard independently compares the plan with this private record.

For a local operator session:

```bash
export OCI_TARGET_CONFIG_FILE="/private/path/to/target.json"
target_exports="$(python3 scripts/oci_target.py --shell)"
eval "$target_exports"
export OCI_CLI_PROFILE="$OCI_OPERATOR_PROFILE"
export OPERATOR_KUBECONFIG="/private/path/to/operator-kubeconfig"
export OPERATOR_KUBE_CONTEXT="operator-context"
```

Required configuration keys: `tenancy_ocid`, `compartment_ocid`, `region`, `namespace`, `cluster_ocid`, `state_bucket`, `backup_bucket`, `operator_profile`, `wif_domain_url`, `wif_client_id`, `wif_service_user_ocid`, `wif_audience`, `node_image_id`, `node_availability_domain`, `app_hostname`, `caddy_acme_email`, and `backup_age_recipient`. Obtain these from the operator's private inventory; do not populate a tracked example with live values.

The backup image also requires explicit `EXPECTED_OCI_NAMESPACE` and `EXPECTED_BACKUP_BUCKET`. The foundation supplies these from private configuration. Update the backup image and its matching CronJob configuration together through a reviewed foundation plan.

Public examples use placeholders. Load the approved target from an ignored local configuration file (mode 0600), or the protected `always-free` environment configuration in GitHub. Never paste real OCI identifiers, profile details or kubeconfigs into tracked documentation. Set `OPERATOR_KUBECONFIG` and `OPERATOR_KUBE_CONTEXT` locally before running the examples; example hostnames are not production endpoints.

| Setting | Value |
|---|---|
| OCI profile / region | `${OCI_CLI_PROFILE}` / `us-ashburn-1` |
| Tenancy / compartment | `${OCI_TENANCY_OCID}` / `${OCI_COMPARTMENT_OCID}` |
| Object namespace | `${OCI_OBJECT_NAMESPACE}` |
| Terraform state bucket | `${OCI_STATE_BUCKET}` |
| Backup bucket | `${OCI_BACKUP_BUCKET}` |
| Kubernetes namespace | `grocery` |
| Operator kubeconfig / context | `${OPERATOR_KUBECONFIG}` / `${OPERATOR_KUBE_CONTEXT}` |
| Cluster | `${OCI_CLUSTER_OCID}` |

The kubeconfig's OCI exec command uses the absolute OCI CLI path and explicitly selects `${OCI_CLI_PROFILE}`, Ashburn and API-key authentication. This avoids Lens inheriting another profile or token mode. Import the distinct context into Lens. If Lens shows 401 while cached node views work, test fresh namespace/pod listing with this file, verify its exec arguments/profile and restart the connection after correcting them. Never copy CI service credentials into Lens.

Generate a fresh operator config only with the intended identity:

```bash
oci --profile "${OCI_CLI_PROFILE}" ce cluster create-kubeconfig \
  --cluster-id "${OCI_CLUSTER_OCID}" \
  --file "${OPERATOR_KUBECONFIG}" --region us-ashburn-1 --auth api_key \
  --token-version 2.0.0 --kube-endpoint PUBLIC_ENDPOINT --with-auth-context
```

OCI generates its own context name. For a fresh file, rename that generated context before using the commands below:

```bash
kubectl --kubeconfig "${OPERATOR_KUBECONFIG}" config rename-context \
  "$(kubectl --kubeconfig "${OPERATOR_KUBECONFIG}" config current-context)" "${OPERATOR_KUBE_CONTEXT}"
command -v oci
```

In that file's `users[].user.exec`, set `command` to the absolute path reported by `command -v oci`, and verify the arguments include `--profile "${OCI_CLI_PROFILE}"`, `--region us-ashburn-1`, and `--auth api_key`. Inspect only the exec settings; do not dump kubeconfigs containing credentials into logs. Verify a fresh pod list before importing the file into Lens. If updating an existing operator file, preserve its distinct context name and avoid creating duplicate contexts.

Use a separate MFA/security-token human profile when configured; its exec authentication must match that profile. Keep kubeconfig private and keep contexts distinct. The default API source rule allows IPv4 TCP 6443; configure `operator_api_cidrs` for your access requirements. TLS, IAM and RBAC remain required. Database, worker and kubelet ports are private.

## Routine health checks

```bash
kubectl --kubeconfig "${OPERATOR_KUBECONFIG}" --context "${OPERATOR_KUBE_CONTEXT}" get nodes -L kubernetes.io/arch
kubectl --kubeconfig "${OPERATOR_KUBECONFIG}" --context "${OPERATOR_KUBE_CONTEXT}" -n grocery get deployments,statefulsets,pods,cronjobs,jobs,pvc
curl --fail --show-error "https://${APP_HOSTNAME}/api/health/ready"
python3 -B scripts/check-backup-health.py \
  --kubeconfig "${OPERATOR_KUBECONFIG}" --context "${OPERATOR_KUBE_CONTEXT}" --oci-profile "${OCI_CLI_PROFILE}"
```

Expect exactly one Ready ARM64 worker, one app and Caddy replica, `postgres-0` Ready, Bound `platform-data`, and both CronJobs unsuspended. Check disk space inside PostgreSQL and Caddy, Node Allocatable and actual memory/disk use. Backup alerts do not cover disk, app uptime, node health or certificate expiry. The last five complete backups are recovery copies, not an unlimited historical archive.

## Infrastructure updates

Run from a clean checkout of the reviewed commit:

```bash
./scripts/always-free-terraform.sh production plan
./scripts/always-free-terraform.sh cluster-foundation plan
```

Provide current target-only inputs through `TF_VAR_*` or `ALWAYS_FREE_VARS_FILE` pointing to an absolute ignored file. The helper stages tracked sources and lockfiles in private `.always-free/terraform/ROOT`, does not read root-local tfvars or state files, verifies the authenticated namespace and rejects unsupported resource changes. Plans/state contain generated credentials; never commit, print, or publish them as Actions artifacts.

After reviewing a plan, set `CONFIRM_APPLY_SHA` to the full reviewed commit and use the same root with `apply`; it regenerates/checks the plan before applying. The GitHub **OCI Always Free infrastructure** workflow supports `production` or `cluster-foundation` with `plan`/`apply` and the full `confirm_apply_sha`. It authenticates through `always-free`. Local `${OCI_CLI_PROFILE}` administrator operations own the `tenancy-identity` and initial `bootstrap` roots.

Preserve `OCI_BACKUPS_ENABLED=true` in `always-free` and the corresponding `backups_enabled=true` local input. Foundation's source default is false for a new installation; omitting the live setting would pause production backups. Verify the plan leaves schedules enabled. Do not replace/destroy the retained shared PVC or remove its lifecycle guard to make a plan pass.

## Worker capacity and replacement

The worker configuration is `VM.Standard.A1.Flex`, 2 OCPUs / 12 GB RAM, 50 GB boot disk and ARM64. The availability domain, supported Kubernetes version and matching ARM image are selected privately during setup. IMDSv1 must be disabled and the instance must have `grocery-backup.eligible=true`. Verify these properties after provisioning or replacement. Never substitute a paid shape or enable legacy metadata endpoints.

There is no automatic VM-launch loop. `retry_nodepool_only=true` permits only creation of the missing node pool, after checking existing workers, Actions overlap, OCI create/delete cleanup and Terraform locks. It is not a replacement mechanism for a running node pool. Preserve existing state, cluster and volume; never force-unlock or use `-target` to bypass guards. A retained RWO volume constrains replacement to its availability domain.

## Database administration

PostgreSQL 16 Bookworm uses database `postgres`, `UTF8` and `C.UTF-8`. Verify encoding, collation and extensions before restoring any backup. Owner/migration role: `grocery_owner`; app/shopping role: `grocery_app`; read-only dump role: `grocery_backup`. Do not import global roles/passwords from a dump or give the runtime owner privileges.

Use authenticated Kubernetes port-forwarding, not OCI Bastion or a public database IP:

```bash
kubectl --kubeconfig "${OPERATOR_KUBECONFIG}" --context "${OPERATOR_KUBE_CONTEXT}" \
  -n grocery port-forward service/postgres 5433:5432
```

In a second terminal, export the public database CA privately from `postgres-ca` (`ca.crt`). Retrieve the owner credential securely from the configured Kubernetes Secret/Vault; keep it out of terminal output/history and use a mode-0600 password file. For libpq use `PGHOST=postgres.grocery.svc.cluster.local`, `PGHOSTADDR=127.0.0.1`, `PGPORT=5433`, `PGDATABASE=postgres`, `PGUSER=grocery_owner`, `PGSSLMODE=verify-full` and `PGSSLROOTCERT` pointing to that CA. pgAdmin must likewise verify the certificate name; use the DNS name resolving locally through the port-forward rather than weakening TLS validation. Close the forward and remove temporary credentials afterward.

## Backups and restore drills

`grocery-postgres-backup` runs daily at **09:00 UTC**, encrypts a PostgreSQL custom dump with age, uploads `postgres/ID.dump.age` and a completion manifest `postgres/ID.json`, then retains the last five complete pairs. Failed dump/upload does not prune successful backups. The backup image includes PostgreSQL 16 tools, age and OCI SDK; its SDK interpreter is `/opt/backup/bin/python`.

To create an extra recovery point, verify no application/foundation deployment or restore is running or queued, no backup Job is active, and the scheduled backup will not overlap. A manual Kubernetes Job bypasses GitHub Actions concurrency; do not start a deployment/restore while it runs. Then run:

```bash
kubectl --kubeconfig "${OPERATOR_KUBECONFIG}" --context "${OPERATOR_KUBE_CONTEXT}" -n grocery \
  create job "grocery-backup-manual-$(date -u +%Y%m%d%H%M%S)" --from=cronjob/grocery-postgres-backup
```

Inspect completion and verify the matching pair before relying on it. Extra successful jobs also participate in five-backup retention. Upload-only worker IAM cannot read archive contents or Terraform state. Download as an authorized operator, verify manifest ID/database/major version, archive bytes and SHA-256, and decrypt using the off-cloud private age key. A GitHub health success alone does not prove restorability.

Keep the operator-selected recovery-key file private (mode 0600) and a recoverable copy in your password manager/offline store outside OCI and GitHub. Store only its public recipient in private target configuration (`backup_age_recipient`). Losing the private key makes backups unrecoverable.

Restore drills use a newly created **scratch** database with owner `grocery_owner`, `template0`, and `C.UTF-8`. Restore with PostgreSQL 16 `pg_restore --no-owner --no-acl --single-transaction --exit-on-error`, excluding the archive's already-existing public-schema creation entry when needed. Validate all application tables, migrations, constraints, indexes and recent shopping data; remove the scratch database and decrypted archive afterward. Never use a live database as a restore test.

For actual disaster recovery, freeze writes and both schedules, wait for active jobs, preserve any surviving authoritative data, attach/recover the retained disk or restore the approved encrypted dump, and reapply owner/default privileges. The Kubernetes bootstrap marker is not in a logical dump. Recreate it only after reviewing a completed restore. Deploy with `restore-existing`; never initialize/seed restored data. Validate HTTPS, OAuth, memberships, shopping/history and a new backup before opening writes or resuming jobs. Infrastructure recreation and destructive database replacement require a separate reviewed recovery plan.

## Application releases and failed deployments

The `always-free` environment holds `OCI_TARGET_CONFIG`, production Google/session secrets and the pinned backup image digest. For an accepted installation, keep `OCI_BACKUPS_ENABLED=true` and `OCI_BACKUP_MONITOR_ENABLED=true`. Keep secrets out of GitHub variables. [Deployment details](../deploy/README.md) cover installation and routine releases.

The application workflow uses immutable GHCR images, an owner migration Job, runtime app credentials and the existing `grocery-bootstrap-state`. It pauses backup/shopping jobs and waits for active maintenance jobs before migrations. Successful public readiness resumes shopping cleanup and restores the backup schedule's prior enabled state. A failed deployment leaves maintenance paused for inspection. Restore the previous application image only when schema compatibility is established; migrations are never automatically reversed.

A successful retry after failure can still leave backups paused: it sees the schedule was already suspended at the start. After reviewing the recovery, confirming public readiness and no active deployment/restore, explicitly resume `grocery-postgres-backup` and verify `grocery-shopping-timeout` is also enabled. For example:

```bash
kubectl --kubeconfig "${OPERATOR_KUBECONFIG}" --context "${OPERATOR_KUBE_CONTEXT}" -n grocery \
  patch cronjob grocery-postgres-backup --type=merge --patch='{"spec":{"suspend":false}}'
```

Run a coordinated fresh backup/checker afterward; leave `OCI_BACKUPS_ENABLED=true` so the next foundation apply preserves activation.

## GitHub Actions backup alerts

`always-free-backup-health.yml` runs from `master` hourly at minute 17 with `OCI_BACKUP_MONITOR_ENABLED=true`, using `always-free` federation. Verify a manual healthy run and delivery of a controlled failed-workflow notification before relying on alerts.

The checker queries object metadata and Kubernetes Jobs, without downloading manifests/archives or reading database contents. It fails for no complete pair, missing/empty archive, newest backup older than 30 hours or more than five minutes in the future, more than five complete pairs, a newer failed backup Job, a Job active over 40 minutes, a suspended daily schedule, failed access or incorrect target namespace/cluster. A later successful backup clears an older Job failure.

Keep GitHub Actions failed-workflow email notifications enabled and verify the scheduled actor's notification ownership. GitHub can delay/drop scheduled runs; a monitor that never runs cannot alert on itself. This is a backup checker, not an uptime/disk/TLS monitor. Restore drills remain necessary. [Actions notification behavior](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs) and [schedule limitations](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

To stop alerts, set `OCI_BACKUP_MONITOR_ENABLED=false`; this does not stop backup jobs. For local checker tests use `python3 -B scripts/test_backup_health.py`. `--allow-suspended` is only for a deliberately paused installation or recovery check; never use it to ignore a suspended production schedule.

