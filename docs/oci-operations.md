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

Use a separate MFA/security-token human profile when configured; its exec authentication must match that profile. Keep kubeconfig private and keep contexts distinct. API ingress on TCP 6443 is restricted to `OCI_ADMIN_CIDRS`. TLS, IAM and RBAC remain required. Database, worker, SSH and kubelet ports are private.

## Administrative network access

In GitHub, open **Settings → Environments → always-free → Environment variables** and edit **`OCI_ADMIN_CIDRS`**. Its value is a JSON array, for example `["203.0.113.14/32", "198.51.100.0/24"]`. Use `/32` for one home IP and retain approved VPN ranges. No deployed addresses are hardcoded in Terraform or workflows. The same setting is required on initial production builds.

After an IP change, run **OCI Always Free infrastructure** on `master`, with **stage `network-access`** and **operation `plan`**. Review the rule changes, then run **operation `apply`** with the full reviewed commit SHA. Editing the variable alone does not change OCI. The restricted plan uses production state but targets only administrative API rules and the existing Terraform-managed Bastion client allowlist. Its guard rejects VM, cluster, storage, application, and unrelated network changes. Removing an obsolete administrative rule is permitted; replacements and deletion of other infrastructure remain rejected. No image build, VM recreation or application rollout is required. This works even when your new IP cannot reach Kubernetes because it uses the OCI management API.

Public ports 80 (HTTPS redirects) and 443 remain available. The worker has no public IP or internet SSH rule. Terraform creates a persistent OCI Bastion service by default and populates its client allowlist from `OCI_ADMIN_CIDRS`. Only its sessions expire; reuse the service for each login.

The Bastion subnet is preconfigured for private worker SSH: its dedicated security list permits stateful outbound TCP 22 to the worker subnet, and the worker NSG permits inbound TCP 22 from the Bastion subnet CIDR. No subnet ingress rule is needed for reply traffic. Terraform creates the Bastion in that dedicated subnet with the required network path. Resources placed in the Bastion subnet share this SSH trust; reserve it for Bastion endpoints. A manually created Bastion still needs the approved client CIDRs entered in its own allowlist; Terraform's `admin_cidrs` applies only to the Bastion it manages.

Follow [SSH into the worker from a laptop](#ssh-into-the-worker-from-a-laptop) below. Initial Bastion creation requires a reviewed `production` apply; `network-access` remains limited to existing administrative allowlists.

GitHub-hosted runners use changing egress addresses. Authenticated jobs that need Kubernetes therefore create one temporary runner `/32` rule for TCP 6443, bound to the approved cluster's API NSG. The action's post-job hook removes that exact rule on success or failure, including an unknown add outcome. It never adds SSH access or modifies the permanent CIDRs. All maintenance workflows share one concurrency group. If GitHub forcibly terminates a runner before cleanup can execute, its OCI rule has no native expiry: the next Kubernetes maintenance job removes same-repository orphan rules older than two hours. The hourly enabled backup monitor normally performs that recovery. For immediate recovery, inspect the approved API NSG and remove only the orphan rule marked `github-actions-api:OWNER/REPOSITORY:`; never remove active jobs' rules or internal cluster rules.

## SSH into the worker from a laptop

Use **Managed SSH** for a first connection: the Oracle Cloud Agent Bastion plugin propagates the session public key to the worker temporarily. You do not need a previously installed worker login key for this path. The alternative [port-forwarding procedure](#alternative-port-forwarding-with-an-existing-worker-key) requires one. Both paths keep the worker private and use a short-lived OCI Bastion session; neither requires rebuilding the app or worker.

### 1. Check your laptop and source address

Use Terminal on your Mac, with OpenSSH available:

```bash
ssh -V
curl --fail --show-error -4 https://api.ipify.org
printf '\n'
```

Check that the reported public IPv4 address belongs to an approved range in GitHub **Settings → Environments → always-free → Environment variables → `OCI_ADMIN_CIDRS`**. The value contains your home `/32` and the two work VPN ranges. Use your intended home or VPN connection throughout the session; changing networks can interrupt access. Your laptop must also permit outbound TCP 22 to OCI's Bastion service.

If your home IP has changed, update that variable and apply the `network-access` workflow as described above. This updates both API ingress and the Terraform-managed Bastion client allowlist without rebuilding the environment.

### 2. Identify the correct worker

Sign in to the OCI Console using your operator identity. Select **US East (Ashburn)** and the approved compartment from your private target inventory. Open **Kubernetes Clusters (OKE)**, select the approved cluster, then its node pool and **Nodes**. Open the running worker's Compute instance details.

Record its instance OCID and primary private IPv4 address in your private notes. Confirm it is the ARM64 A1 worker in `family-grocery-workers`, with no public IP. Use this worker address throughout this procedure, rather than the cluster API, load balancer or a pod address. The Oracle Linux login user is **`opc`**.

### 3. Prepare a session key on your laptop

Create a dedicated key pair once. Choose a passphrase when prompted. If the filename already exists, reuse your own known key or choose a different filename; do not overwrite an existing private key.

```bash
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
ssh-keygen -t rsa -b 4096 -f "$HOME/.ssh/grocery_bastion_session" -C "grocery-worker-access"
```

The private key is `$HOME/.ssh/grocery_bastion_session`; keep it on your laptop. Only upload or paste the **public** key, `$HOME/.ssh/grocery_bastion_session.pub`, when OCI asks for an SSH key. Do not put either file in this repository or paste a private key into the Console.

### 4. Select the existing Terraform-managed Bastion

Open **Identity & Security → Bastion** in the same region and compartment. Select **`familygrocerybastion`** and confirm it is **Active**, targets `family-grocery-vcn` / `family-grocery-bastion`, and has the approved client CIDRs from GitHub. Its maximum session lifetime is one hour. Reuse this service for every login; create only a new session in step 6.

If it is missing, the one-time infrastructure apply is still required. Run **OCI Always Free infrastructure** on `master`, select **stage `production`**, **operation `plan`**, and review the result. For an existing installation with the SSH network path already applied, expect only the Bastion service creation; stop if the plan includes unexpected changes. Apply with the full reviewed commit SHA, then return here. This does not require an application image build or worker recreation. Older private Terraform input files must have any explicit `enable_bastion=false` changed to `true`; the GitHub workflow explicitly enables it.

Do not manually create a duplicate. If a Bastion was previously created manually, have the infrastructure operator review its identity and configuration and import it into production state before applying; do not assume Terraform will adopt it automatically. A differently named existing Bastion may require retaining its immutable name in configuration.

OCI lists [Bastion as free for both free and paid accounts](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm). This is the managed service, not an additional VM. Sessions and SSH keys remain time-limited access controls even though the service persists.

For a network check, the Bastion subnet should reference security list `family-grocery-bastion-ssh`: no ingress rules, and stateful TCP 22 egress to the worker subnet. The worker NSG should have stateful TCP 22 ingress from the Bastion subnet CIDR. The empty shared `grocery-nsg-only` security list is not where this path is configured. Keep these existing restrictions; do not add public SSH ingress.

### 5. Enable the worker's Bastion plugin

On the worker's Compute instance page from step 2, open **Oracle Cloud Agent**. Enable the **Bastion** plugin and wait for its status to become **Running**; this can take up to ten minutes. Ensure agent plugins are allowed to run. This is a one-time prerequisite on that worker, and can be done through the Console before your first SSH login. A replacement worker needs its plugin checked again. Preserve IMDSv1 being disabled.

If the plugin is missing or will not run, stop here and investigate the agent rather than launching a replacement worker. Use the alternative below only if you already possess an authorized worker key.

### 6. Create a Managed SSH session

On the Bastion details page, open **Sessions → Create session**. Choose **Managed SSH session**, select the worker instance identified in step 2, set the username to **`opc`**, and leave the target SSH port at **22**. Verify the target private IP matches your notes. Upload the public key from step 3 and choose a session TTL of **30 minutes**. Create the session and wait for **Active**.

Use the session menu's **Copy SSH command** action. Paste the command into a local text editor first, replacing **every** private-key placeholder with the absolute path to your local private key. The generated command can reference the key both in the outer SSH command and inside `ProxyCommand`; update both. Quote paths containing spaces. Keep the generated session identifier, service hostname, target IP and `opc` username intact.

Run the completed command in your laptop Terminal. Enter your local key passphrase if prompted. Review the SSH host-key prompts; compare fingerprints with a previously verified record or a trusted instance console when available. Stop on an unexpected changed-key warning and verify the instance identity before changing any known-host entry. Do not disable host-key checking.

### 7. Verify the connection without changing the host

At the remote shell, run:

```bash
whoami
hostname
uname -m
uname -r
sudo -n true && printf 'sudo available\n'
```

Expect `opc`, the selected worker's hostname, `aarch64`, its running kernel version, and `sudo available`. Getting this shell and these results confirms end-to-end SSH access. Record the time, session expiry and result in private operator notes. Package updates and reboots are separate maintenance operations; this connection test does not run them.

Run `exit` to close the worker shell. Delete your test session from the Bastion's **Sessions** list when finished, or let its TTL expire. Keep the reusable Bastion service unless deliberately removing it; do not delete the worker or node pool. For another login after expiry, create a new session and copy its new command.

### Alternative: port forwarding with an existing worker key

Use this path when you already have a private key whose public key is authorized for the worker's `opc` account. A newly generated Bastion session key alone does not grant worker login through a port-forwarding session. This session type does not require the Bastion plugin.

1. Complete steps 1–4 above. On the Bastion, create an **SSH port forwarding session** targeting the worker's private IP and port **22**, upload the session public key from step 3, and select a 30-minute TTL. Wait for **Active**.
2. Copy the generated SSH command. In **Terminal A**, substitute your session private-key path and local port `2222`. Set the `-L` argument to `127.0.0.1:2222:<worker-private-IP>:22`, replacing the placeholder with the verified worker IP. This binds the tunnel only to your laptop's loopback interface. Add `-o ExitOnForwardFailure=yes` before the destination so a local bind failure is visible. Keep `-N` and the generated Bastion session destination. Run the command and leave it running; no shell prompt or output is normal.
3. In **Terminal B**, set the two values below before running SSH. Replace the key filename with your existing worker login key and the alias placeholder with the worker instance OCID recorded in step 2. The alias keeps each worker's host identity separate from other services using local port 2222.

```bash
WORKER_KEY="$HOME/.ssh/worker_key"
WORKER_HOST_ALIAS="replace-with-worker-instance-ocid"
ssh -i "$WORKER_KEY" -o IdentitiesOnly=yes \
  -o "HostKeyAlias=$WORKER_HOST_ALIAS" -p 2222 opc@127.0.0.1
```

4. Follow step 7 to verify the remote shell, then `exit` in Terminal B. Press **Ctrl-C** in Terminal A to close the tunnel and delete your test session. The session key and worker key have separate roles, even if you deliberately used the same key pair for both.

### Troubleshooting the connection test

| Symptom | Check |
|---|---|
| Bastion is missing or access is denied in the Console | Confirm region, compartment and operator identity. Have the tenancy administrator check scoped permissions to create/use Bastions and sessions, read the worker, and manage its agent plugin. |
| Managed SSH session creation fails | Confirm the Bastion plugin is Running on this exact worker and the username is `opc`. Allow up to ten minutes after enabling the plugin; inspect the session work-request error. |
| Connection to the Bastion times out | Compare your current public IPv4 with this Bastion's actual client allowlist; check outbound TCP 22 on your laptop/VPN and that the session remains Active. |
| Bastion reports `Permission denied (publickey)` | Match the session public key to the local private key, replace all key placeholders, and check file permissions. Use `chmod 600` on your private key if SSH reports it is too accessible. |
| Tunnel connects but worker connection times out or reports a channel-open failure | Recheck worker IP, port 22, the Bastion subnet security list and worker NSG rule. An operator with another trusted access path can inspect the worker's SSH service and host firewall. |
| Worker reports `Permission denied (publickey)` | For port forwarding, use the existing authorized worker key and `opc`, not just the Bastion session key. For Managed SSH, inspect the plugin/session error and the worker's SSH authorized-key configuration. |
| Local port 2222 is already in use | Inspect with `lsof -nP -iTCP:2222 -sTCP:LISTEN`. Choose another local port in both Terminal A's `-L` argument and Terminal B's `-p` argument; do not stop an unrelated process. |
| Session expired or connection dropped after a network change | Restore an allowed source network, create a fresh session and copy its new command. Reusing an expired session command cannot reconnect. |
| SSH reports a changed host key | Verify the selected worker and any replacement against trusted inventory/console fingerprints. Do not bypass the warning or blindly remove the old key. |

References: Oracle's [OKE Bastion setup](https://docs.oracle.com/en-us/iaas/Content/ContEng/Tasks/contengsettingupbastion.htm), [Managed SSH session creation](https://docs.oracle.com/en-us/iaas/Content/Bastion/Tasks/create-session-managed-ssh.htm), [Managed SSH connection](https://docs.oracle.com/en-us/iaas/Content/Bastion/Tasks/connect-managed-ssh.htm), [port-forwarding connection](https://docs.oracle.com/en-us/iaas/Content/Bastion/Tasks/connect-port-forwarding.htm), and Canonical's [Bastion key propagation explanation](https://ubuntu.com/docs/oracle/oracle-how-to/use-bastion-to-access-VM/). Use the `opc` user for this deployment's Oracle Linux worker; Canonical's Ubuntu examples use a different username.

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

## Certificate and host patch maintenance

Patch the approved worker with `sudo dnf update -y`, retain the transaction log,
and verify `ca-certificates`, OpenSSL, Python and `dnf needs-restarting -r`
afterward. A new kernel requires a separately scheduled reboot of this single
worker. Verify node readiness, public application readiness and backup health
after maintenance. Preserve IMDSv1 being disabled.

Host updates do not refresh existing container images, Node's built-in roots or
pip's vendored CA bundle. For the October 2026 eMudhra incident, use Node
22.23.4 or later on the 22.x line, pip 26.2.2 and certifi 2026.10.19 or later
where the Python version supports them. Inventory separate virtual environments,
including Node Doctor; do not replace Oracle Linux's system Python with an
upstream interpreter. An older package version may contain a distribution
backport, so inspect its effective CA bundle as well as its version.

Rebuild the application and backup images with fresh base images and package
layers. The image builds reject the affected G3 root by fingerprint. Release
the application image normally; update the backup digest and Caddy image through
a reviewed foundation plan. Keep backups enabled. CI's isolated OCI CLI
environment temporarily overrides Oracle's restrictive certifi upper bound
with the patched CA-data package; remove that exception once Oracle supports it.

The Node security update retains Next.js 15 and Prisma 6, with Next.js 15.5.28
and next-auth 4.24.15. Package overrides refresh PostCSS and Sharp, replace
Prisma's pinned deepmerge-ts with 8.0.2, and replace only the Next ESLint
plugin's fast-glob dependency with tinyglobby 0.2.17 to remove its unpatched
braces dependency. Compatibility tests exercise Next's actual directory
discovery; Prisma generation, migrations and application tests cover the other
overrides. Revisit these overrides when upstream dependency ranges include the
fixes. CI rejects high and critical npm advisories before the application tests.

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

