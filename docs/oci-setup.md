# Set up an OCI deployment

This guide provisions a standalone installation of the app. It uses one Basic OKE cluster, one ARM64 A1 worker with 2 OCPUs / 12 GB RAM, a 50 GB boot disk, one shared 50 GiB PostgreSQL/Caddy disk and one flexible load balancer fixed at 10/10 Mbps. Review [architecture and availability limits](oci-architecture.md) before setup.

## Account and resource prerequisites

Use an OCI account whose current entitlements permit this footprint in its home region. The checked-in implementation restricts the region to `us-ashburn-1`; do not bypass that restriction for an unreviewed region. Verify account mode, OKE/gateway access, available A1 capacity, eligible volume performance, Object Storage usage, Vault/key eligibility and all other tenancy workloads. Free-tier resource sizes are limits, not a guarantee of billing eligibility or available capacity. Check [Oracle's current Always Free terms](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

Configure quotas to allow at most one flexible load balancer and 10 Mbps total bandwidth, with no fixed-shape load balancer allowance. Any network load balancer allowance is separate; this app deploys none. Account upgrades, quota changes and additional workloads need their own review. Budget alerts notify; they do not enforce a spending cap.

Prepare an existing application compartment and a human administrator profile. Install OCI CLI, Terraform, Python 3, kubectl, GitHub CLI, PostgreSQL 16 client tools and age. Read the [four-root responsibilities](../infra/README.md). Initial setup is administrator work; normal CI receives no tenancy-wide IAM write permission.

## Private target configuration

Copy [the target template](oci-target.example.json) to an ignored private file, set its permissions to `0600` and fill every placeholder from your own inventory. Never commit the populated file, profile, public IP, hostname, identity-domain URL or recovery key.

```bash
umask 077
mkdir -p .always-free
cp docs/oci-target.example.json .always-free/target.json
chmod 600 .always-free/target.json
export OCI_TARGET_CONFIG_FILE="$PWD/.always-free/target.json"
```

The template keys are the loader's exact schema. `node_image_id` and `node_availability_domain` come from regional OKE/availability-domain APIs; choose an offered ARM64 image matching the supported Kubernetes version. Pin that version separately with `OCI_OKE_KUBERNETES_VERSION` in GitHub and `TF_VAR_oke_kubernetes_version` locally. The application hostname, ACME contact, bucket names and public age recipient are private configuration too.

On initial provisioning, `cluster_ocid` is `null` because the cluster does not exist. Only the administrator/bootstrap/platform provisioning paths explicitly accept this. After creating the cluster, record its actual OCID in the private file and replace the GitHub secret. Foundation deployment, application releases, federation verification and monitoring require an exact cluster identity and reject `null`.

The loader provides identity-related `TF_VAR_*` values and compares them independently with Terraform plan inputs. Other root-specific inputs use an ignored variables file (`ALWAYS_FREE_VARS_FILE`) or `TF_VAR_*`. The root `terraform.tfvars.example` files are templates, not runnable configuration. Do not fill them with deployed values in tracked source.

## GitHub-to-OCI federation

Create the GitHub environment `always-free` and permit protected `master` for deployment. Require branch CI before merge. Do not permit feature branches to deploy production.

Use the OCI `Default` identity domain. The checked-in worker-tag grant targets `'Default'/'grocery-github-deployers'`; using another domain requires a reviewed IAM template change. In that domain:

1. Create a service user with the SCIM extension `serviceUser=true` at creation. An ordinary user cannot be converted afterward. Add it to `grocery-github-deployers`; never add it to Administrators or create a permanent CI API key.
2. As a tenancy administrator, create a policy attached at tenancy level with the following statements, replacing the compartment placeholder privately:

   ```text
   Allow group 'Default'/'grocery-github-deployers' to manage all-resources in compartment id REPLACE_COMPARTMENT_OCID
   Allow group 'Default'/'grocery-github-deployers' to read all-resources in tenancy
   ```

   This CI role can manage the application compartment and discover tenancy resources, but cannot write tenancy-wide IAM. This policy is an administrator prerequisite; the Terraform identity root creates backup/tag grants only. Review the combined effective grants and ensure the service user belongs to no broader groups.
3. Create and activate a runtime Confidential Application with the client-credentials grant and no administrator app role. Store its client ID, the service-user OCID, domain URL and chosen audience in private target configuration.
4. Create a temporary administrator Confidential Application for trust bootstrap. Its administrator secret stays local and must never enter GitHub.
5. Load the private configuration and run the target-bound helper with your exact repository and environment:

```bash
target_exports="$(python3 scripts/oci_target.py --shell --allow-unprovisioned-cluster)"
eval "$target_exports"
python3 scripts/bootstrap-always-free-wif.py \
  --repository OWNER/REPOSITORY --environment always-free \
  --runtime-client-id "$OCI_WIF_CLIENT_ID" \
  --service-user-ocid "$OCI_WIF_SERVICE_USER_OCID" \
  --admin-client-id "$BOOTSTRAP_ADMIN_CLIENT_ID"
```

The helper prompts for the administrator secret with hidden input, validates the operator profile/compartment and service-user type, and refuses duplicate trust creation. An unknown result must be reconciled before retrying.

The accepted subject is exactly `repo:OWNER/REPOSITORY:environment:always-free`, with the GitHub OIDC issuer and the privately configured audience. An offline preview uses `--dry-run --service-user-id` and synthetic values. See [Oracle's identity-domain token exchange procedure](https://docs.oracle.com/en-us/iaas/Content/Identity/api-getstarted/json_web_token_exchange.htm).

Store `OCI_TARGET_CONFIG` and runtime `OCI_WIF_CLIENT_SECRET` as **environment secrets**. From the repository, the target file can be passed on standard input:

```bash
gh secret set OCI_TARGET_CONFIG --env always-free < "$OCI_TARGET_CONFIG_FILE"
gh secret set OCI_WIF_CLIENT_SECRET --env always-free
```

The runtime-secret command prompts for the value. GitHub workflows mask each target value before authentication and use ephemeral tokens. Deactivate the temporary administrator application after verifying token exchange with the completed cluster identity. Never deactivate the runtime application used by CI.

## Provision the infrastructure roots

Keep the private target record, reviewed commit and state together. Do not run these commands against an existing deployment with a new backend.

1. Plan/review/apply `tenancy-identity` with the local administrator. This creates the worker backup tag/dynamic group and bucket-scoped IAM. The helper permits private local state before the bucket exists.
2. Plan/review/apply `bootstrap`. It creates the state/backup buckets and Vault/software key, then moves bootstrap state into its remote key. Run the identity helper again after bootstrap to move its state into its own remote key.
3. Read the bootstrap Vault/key outputs privately and supply `TF_VAR_vault_id` and `TF_VAR_vault_key_id` for the platform root. CI reads these outputs privately from the state bucket.
4. Plan/review/apply `production`. Verify exactly one Basic cluster and one Ready ARM64 A1 worker, shape 2/12, 50 GB boot, backup eligibility tag and `instance-options.are-legacy-imds-endpoints-disabled=true`. Never launch a VM with IMDSv1 enabled.
5. Record `cluster_id` from the platform output in private target configuration and update `OCI_TARGET_CONFIG`. Generate the operator kubeconfig as described in [operations](oci-operations.md#target-identity-and-access). Verify federation with `oci-wif-verify.yml` on `master` and then deactivate the temporary administrator application.
6. Publish the backup tool with application workflow operation `build-backup-only`. Make the GHCR package public, verify ARM64 pull access and set `OCI_BACKUP_IMAGE` to its immutable digest. Keep the private age key outside OCI/GitHub; only its public recipient goes in target configuration.
7. Plan/review/apply `cluster-foundation`, supplying the kubeconfig, versioned state location, backup image and recipient. It creates the retained shared disk, PostgreSQL/TLS/role secrets, Caddy, load balancer and initially suspended backup CronJob.

Local review/apply pattern:

```bash
./scripts/always-free-terraform.sh ROOT plan
# Inspect the private plan, then select the exact reviewed commit.
export CONFIRM_APPLY_SHA="$(git rev-parse HEAD)"
./scripts/always-free-terraform.sh ROOT apply
```

Replace `ROOT` with one root name above. Apply requires a clean checkout and regenerates/checks the plan. Plans and state contain secrets; keep them private. The GitHub infrastructure workflow supports platform/foundation plan/apply with full `confirm_apply_sha`. Do not use force-unlock, `-target`, shape substitutions or state deletion to bypass checks.

If A1 capacity fails, preserve partial state and wait for OCI cleanup. Retry only when no relevant workflow, Compute/node-pool request or Terraform lock is active. `retry_nodepool_only=true` accepts only creation of the missing single node pool. A retained disk constrains later replacement to its availability domain. No automated capacity loop is installed.

## DNS, OAuth and application initialization

At your external DNS provider, point the chosen application's A record to the reserved load-balancer address obtained privately from Terraform. Ensure ports 80/443 reach Caddy and verify its certificate. Do not commit the DNS name or address. Terraform creates no public DNS record.

Configure a dedicated production Google OAuth client using the exact `https://YOUR_HOSTNAME/api/auth/callback/google` URI. Replace the hostname with your configured value; never enter the placeholder in Google. Store OAuth/session values plus `INITIAL_ADMIN_EMAIL` and `INITIAL_HOUSEHOLD_NAME` as GitHub environment secrets. Follow [application delivery](../deploy/README.md#production-google-oauth-setup).

For an explicitly empty installation, dispatch the application workflow on `master` with `deployment_mode=initialize` and public readiness. It checks the empty public schema, applies Prisma schema migrations, initializes one household/admin and creates `grocery-bootstrap-state` only after success. Ordinary master releases default to `restore-existing`, which preserves initialized data and refuses a missing marker. Never run development seeding against production.

Verify fresh sign-in, membership permissions, request additions, a complete shopping run and history. Check that the shopping-timeout schedule is enabled after public readiness.

## Backup acceptance and monitoring

Coordinate a manual backup with deployments and active Jobs. Verify its encrypted archive and manifest, operator checksum/decryption, a scratch restore and worker denial of backup/state content reads. The backup image's configured namespace/bucket must equal its expected values. Do not test restore against the live database.

After acceptance, enable the foundation backup schedule with `OCI_BACKUPS_ENABLED=true` and matching local `backups_enabled=true`; review/apply the foundation plan and verify the daily 09:00 UTC CronJob is unsuspended. Keep both settings on updates. Enable `OCI_BACKUP_MONITOR_ENABLED=true`, run a healthy manual check and verify failed-workflow notification delivery. Check the first naturally scheduled backup too. See [backup alerts](backup-alerts.md) and [restore drills](oci-operations.md#backups-and-restore-drills).
