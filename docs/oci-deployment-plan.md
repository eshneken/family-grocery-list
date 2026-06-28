# OCI Deployment and Delivery Plan

Status: Draft for review

This plan defines the infrastructure-as-code and delivery pipelines for deploying the Family Grocery List application to Oracle Cloud Infrastructure (OCI). It is intentionally sized for personal use, but its network, state, identity, and deployment boundaries leave a clear path to higher availability later.

## 1. Decisions Locked for This Plan

| Decision | Selected approach |
|---|---|
| OCI region | US East (Ashburn), `us-ashburn-1` / IAD |
| Compartment | Existing application compartment supplied as an input |
| Production URL | `https://grocery.shnekendorf.com` |
| DNS | Existing `shnekendorf.com` OCI DNS zone in the tenancy root compartment |
| Environments | Production only; development and staging remain local |
| Application authentication | Google OAuth with an explicit user allowlist; mock authentication cannot be deployed publicly |
| OKE control plane | Public API endpoint secured with GitHub OIDC claims and Kubernetes RBAC |
| OKE cluster and data plane | Enhanced, VCN-native OKE cluster with one managed `VM.Standard.A1.Flex` worker; Enhanced is required for external OIDC authentication |
| Public traffic | OCI Flexible Load Balancer directly fronting a Kubernetes `LoadBalancer` Service |
| HTTP routing | No Kubernetes ingress controller and no OCI WAF |
| Public TLS | Caddy manages Let's Encrypt issuance and renewal using durable filesystem storage |
| Container registry | Public GitHub Container Registry (GHCR), deployed by immutable image digest |
| PostgreSQL | OCI Database with PostgreSQL, one E5 Flex node, private endpoint, TLS required |
| Administrative DB access | OCI Bastion port-forwarding session for pgAdmin and `psql` |
| OCI authentication from GitHub | OCI IAM Workload Identity Federation (WIF), manually bootstrapped once |
| Terraform state | Private, versioned OCI Object Storage bucket with state locking and customer-managed encryption |

## 2. What Already Exists

- A Next.js 15 application with a production `start` script that listens on `0.0.0.0`.
- Prisma configured for PostgreSQL through `DATABASE_URL`.
- Two checked-in Prisma migrations and database generation/migration scripts.
- Vitest and Playwright test infrastructure.
- Local PostgreSQL development through Docker Compose.
- A public GitHub repository at `eshneken/family-grocery-list`; its default branch is `master`.

The implementation should reuse these flows. It should not introduce a second ORM, migration system, application server, or source repository.

Missing deployment prerequisites are a production Dockerfile, health endpoints, Google OAuth, Kubernetes manifests, Terraform, and GitHub Actions workflows.

The existing `prisma` package is a development dependency and there is no production migration script. Implementation must add a `db:migrate:deploy` script for `prisma migrate deploy` and deliberately include the Prisma CLI, schema, and checked-in migration files in the release image. The migration Job must never rely on `npx` downloading a package at runtime.

## 3. Target Architecture

```text
                                      OCI tenancy
                              existing app compartment

 Internet
    |
    | HTTPS grocery.shnekendorf.com
    v
 OCI DNS A record
    |
    v
 Reserved public IPv4
    |
    v
 OCI Flexible Load Balancer (TCP 80/443, Kubernetes-managed backends)
    |
    v
 Kubernetes Service type LoadBalancer
    |
    v
 Caddy edge Deployment (1 replica)
    |  - HTTP -> HTTPS redirect
    |  - Let's Encrypt issuance/renewal
    |  - ACME state on 50 GiB Block Volume PVC
    |  - reverse proxy to grocery-app:3000
    v
 Internal ClusterIP Service
    |
    v
 Next.js Deployment (1 replica initially)
    |
    | PostgreSQL TLS, sslmode=verify-full
    v
 OCI Database with PostgreSQL private endpoint


 Administrator Mac                        GitHub Actions
    |                                         |
    | OCI Bastion session                     | GitHub OIDC
    | local port 5432                          +----> OCI WIF -> Terraform/OCI APIs
    v                                         |
 pgAdmin / psql ------------------------------+----> OKE external OIDC -> Kubernetes RBAC
                                              |
                                              +----> GHCR -> immutable ARM64/AMD64 image
```

Caddy is a separate edge Deployment rather than an application sidecar. This lets normal application releases roll the Next.js pod without restarting Caddy, remounting its certificate volume, or interrupting certificate renewal.

## 4. Availability and Recovery Posture

This initial configuration is durable but not highly available:

- One OKE worker is a single point of failure.
- One Caddy replica is a single point of failure.
- One PostgreSQL node has durable regional storage but no compute failover target.
- OKE control-plane availability remains managed by Oracle.

Expected recovery is automated node replacement plus pod rescheduling, not uninterrupted service. The managed node pool will use one availability domain so its ReadWriteOnce block volume can reattach after worker replacement. This is a deliberate personal-use tradeoff.

Future HA expansion requires at least two workers, two application replicas, at least two PostgreSQL nodes, and moving edge TLS state to a supported shared store or managed certificate/gateway design. Those changes are not silently implied by increasing `node_count`.

## 5. Network Design

Default CIDRs are inputs and can be changed before the first apply:

| Network | Default CIDR | Exposure |
|---|---:|---|
| VCN | `10.40.0.0/16` | Private address space |
| Public LB subnet | `10.40.0.0/24` | Internet gateway |
| OKE API endpoint subnet | `10.40.1.0/28` | Public API endpoint |
| Worker subnet | `10.40.10.0/24` | Private, NAT and service gateway egress |
| Pod subnet | `10.40.20.0/22` | Private, NAT and service gateway egress |
| PostgreSQL subnet | `10.40.30.0/24` | Private, no direct internet route |

Use VCN-native pod networking. Use Network Security Groups (NSGs) as the primary policy boundary and keep subnet security lists minimal.

Required traffic policy:

- Internet to load balancer: TCP 80 and 443 only.
- Load balancer to Caddy service backends: only the Kubernetes-assigned backend ports.
- Pods to PostgreSQL: TCP 5432 from the pod subnet only.
- OCI Bastion to PostgreSQL: TCP 5432 only.
- Workers and pods to internet: outbound through NAT for GHCR, Google OAuth, Let's Encrypt, and package/runtime endpoints.
- Workers and pods to OCI services: service gateway where supported.
- PostgreSQL: no public IP and no internet ingress.
- OKE API: public because GitHub-hosted runners must reach it; authentication is OIDC and authorization is least-privilege RBAC.
- OKE API endpoint egress: HTTPS to GitHub's OIDC discovery and signing-key endpoints so the API server can validate workflow tokens.

The application connection string must include `sslmode=verify-full` and the CA certificate returned by the Terraform `oci_psql_db_system_connection_detail` data source.

## 6. Resource Defaults and Variables

| Variable | Default | Notes |
|---|---:|---|
| `region` | `us-ashburn-1` | IAD |
| `tenancy_ocid` | required | Also identifies the root compartment for DNS lookup |
| `compartment_ocid` | required | Existing app compartment |
| `dns_zone_name` | `shnekendorf.com` | Existing zone; Terraform does not create or replace it |
| `app_hostname` | `grocery.shnekendorf.com` | Production URL and Google OAuth callback base |
| `acme_email` | required | Let's Encrypt account notifications |
| `github_repository` | `eshneken/family-grocery-list` | Used in OIDC claim restrictions |
| `github_default_branch` | `master` | Used in OIDC claim restrictions |
| `oke_cluster_type` | `ENHANCED_CLUSTER` | Required for external GitHub OIDC authentication |
| `oke_kubernetes_version` | pinned during implementation | Select a currently supported IAD version and update deliberately |
| `node_shape` | `VM.Standard.A1.Flex` | ARM worker |
| `node_count` | `1` | Personal-use default |
| `node_ocpus` | `2` | Enough headroom for system, Caddy, migration, and app pods |
| `node_memory_gb` | `12` | A1 Flex |
| `node_boot_volume_gb` | `50` | Parameterized |
| `node_availability_domain_index` | `0` | One AD so the Caddy volume remains attachable |
| `caddy_pvc_size_gb` | `50` | OCI dynamic block-volume minimum |
| `lb_shape` | `flexible` | OCI Flexible Load Balancer |
| `lb_min_mbps` / `lb_max_mbps` | `10` / `10` | Raise without rebuilding the application |
| `postgres_shape` | `PostgreSQL.VM.Standard.E5.Flex` | Smallest supported flexible shape |
| `postgres_instance_count` | `1` | No automatic compute failover |
| `postgres_ocpus` | `1` | Service minimum for E5 Flex |
| `postgres_memory_gb` | `16` | Service minimum for E5 Flex |
| `postgres_iops` | `75000` | Lowest storage performance tier |
| `postgres_db_version` | `16` | Matches local PostgreSQL; confirm availability in IAD before apply |
| `postgres_backup_retention_days` | `14` | Daily automated backup |
| `postgres_regionally_durable` | `true` | Regional storage durability |
| `enable_waf` | `false` | Explicitly excluded |

OCI Database with PostgreSQL does not expose a provisioned database-size input. Its shared storage automatically grows and shrinks with data usage, up to the service limit. The plan therefore parameterizes OCPUs, memory, node count, IOPS, and backup retention rather than a fictitious disk-size setting.

Add Terraform variable validation for CIDRs, positive sizes, supported node counts, hostname format, database memory/OCPU minimums, and allowed IOPS tiers.

## 7. Terraform Layout and Ownership

Use three root configurations. This avoids the common failure where the Kubernetes provider is initialized before Terraform has created the cluster it needs to contact.

```text
infra/
  bootstrap/
    versions.tf
    providers.tf
    state.tf
    variables.tf
    outputs.tf
    README.md

  production/
    versions.tf
    providers.tf
    backend.tf
    variables.tf
    network.tf
    security.tf
    secrets.tf
    postgresql.tf
    oke.tf
    bastion.tf
    dns.tf
    outputs.tf
    terraform.tfvars.example

  cluster-foundation/
    versions.tf
    providers.tf
    backend.tf
    variables.tf
    namespace.tf
    rbac.tf
    database-config.tf
    caddy.tf
    storage.tf
    load-balancer-service.tf
    outputs.tf
```

Ownership boundaries:

- `bootstrap`: remote state bucket, bucket versioning, KMS vault/key, and narrowly scoped state access policy.
- `production`: OCI network, NSGs, OKE, managed node pool, PostgreSQL, Vault secret, Bastion, reserved public IP, and DNS record.
- `cluster-foundation`: long-lived Kubernetes resources that are infrastructure rather than application releases: namespace, deploy RBAC, PostgreSQL CA ConfigMap, database Secret, Caddy Deployment/configuration/PVC, and external LoadBalancer Service.
- `deploy/`: application Deployment, internal Service, migration Job template, and production Kustomize overlay. These are promoted by the application pipeline.

Do not create a Terraform `oci_load_balancer` with static node or pod backends. Terraform creates the reserved IP and the Kubernetes Service; OCI Cloud Controller Manager creates and reconciles the Flexible Load Balancer and backend membership. Static backend IPs would break when OKE replaces the worker or reschedules a pod.

All provider versions must be constrained and `.terraform.lock.hcl` files committed. Destructive resources must use `prevent_destroy` where Terraform supports it, especially PostgreSQL, the state bucket, the KMS key, and the Caddy PVC boundary.

## 8. Secrets and Runtime Configuration

### Database secret

1. Terraform generates a high-entropy PostgreSQL administrator password.
2. Terraform stores it in OCI Vault as a secret encrypted with the project KMS key.
3. `oci_psql_db_system` references the Vault secret and version rather than receiving a plain-text password argument.
4. The cluster-foundation stack reads the current secret bundle and constructs the application `DATABASE_URL` Kubernetes Secret.
5. Terraform state still contains sensitive derived values. Both production and cluster state must therefore remain KMS-encrypted, private, versioned, and available only to the infrastructure identity and bootstrap administrator.
6. pgAdmin users retrieve the password from Vault with their own OCI identity; the password is never printed as a normal Terraform output.

### Google OAuth and session secret

Store these in the protected public-repository GitHub `production` environment:

- `AUTH_GOOGLE_ID`
- `AUTH_GOOGLE_SECRET`
- `AUTH_SECRET`

The deploy job creates or updates a namespace-scoped Kubernetes Secret without writing values to logs. The deployment identity receives Secret write access only inside the `grocery` namespace.

### Non-secret configuration

Store endpoint, namespace, and cluster CA values as GitHub repository or environment variables:

- `OKE_API_SERVER`
- `OKE_CA_CERT_B64`
- `OKE_OIDC_AUDIENCE`
- `APP_HOSTNAME`

The PostgreSQL service CA is placed in a ConfigMap and mounted read-only into migration and application containers. Prisma uses the mounted path in the connection parameters.

## 9. One-Time Bootstrap

There is an unavoidable bootstrap boundary: GitHub cannot use WIF until OCI trusts GitHub, and Terraform cannot use an OCI backend until the bucket exists.

The implementation must include exact commands and screenshots/field names in `infra/bootstrap/README.md` for these manual steps:

1. Authenticate locally to OCI with an administrator session token.
2. Configure OCI IAM WIF for issuer `https://token.actions.githubusercontent.com`.
3. Restrict the trust to repository `eshneken/family-grocery-list`, the infrastructure workflow on `master`, and the `production-infra` GitHub environment.
4. Map the federated principal to a least-privilege OCI policy set.
5. Run the bootstrap Terraform root locally with local state to create the state bucket and KMS resources.
6. Run `terraform init -migrate-state` to move bootstrap state into the new OCI backend.
7. Configure the GitHub `production-infra` environment and its required reviewer.
8. Verify WIF with a read-only GitHub workflow call before allowing any apply.

Required WIF permissions:

- Manage resources only in the existing app compartment.
- Read the tenancy and availability domains required by Terraform data sources.
- Read the existing root-compartment DNS zone and manage records only for the selected zone.
- Read/write/delete objects only in the Terraform state bucket.
- Use only the project KMS key.
- No tenancy administrator policy and no persistent OCI API signing key in GitHub.

The exact OCI token-exchange and identity-domain steps must be validated against the current OCI WIF documentation during implementation because this service is newer than the rest of the stack.

## 10. Infrastructure Pipeline

Create `.github/workflows/infra.yml` with three paths.

### Pull requests

Run without cloud credentials, including on forked pull requests:

1. Checkout by pinned commit SHA.
2. Install the pinned Terraform version.
3. Run `terraform fmt -check -recursive`.
4. Run `terraform init -backend=false` and `terraform validate` for every root.
5. Run TFLint with OCI rules where available.
6. Run a pinned IaC security scanner.
7. Run native `terraform test` assertions for variable validation and critical policy invariants.

Do not give untrusted pull-request code an OCI token.

### Changes merged to `master`

For paths under `infra/**`:

1. Authenticate to OCI through GitHub OIDC and OCI WIF.
2. Initialize the encrypted OCI backend.
3. Run a refreshed plan for `production`, then `cluster-foundation` when the cluster exists.
4. Publish a redacted resource-change summary to the GitHub job summary; do not upload a human-readable plan containing sensitive values.
5. Enter the protected `production-infra` environment and wait for manual approval.
6. Re-run the plan after approval to avoid applying a stale artifact.
7. Apply `production` first.
8. Wait for OKE nodes and PostgreSQL to reach active state.
9. Generate an administrator kubeconfig using the short-lived WIF session.
10. Apply `cluster-foundation`.
11. Validate Caddy, PVC binding, the LoadBalancer Service, DNS, and PostgreSQL private connectivity.

Use workflow concurrency group `terraform-production` with `cancel-in-progress: false` so two applies cannot overlap. Terraform's OCI backend lock remains the second line of defense.

### Manual execution

Support `workflow_dispatch` with a required `target` input of `plan` or `apply`. Initial deployment uses manual dispatch after bootstrap. Destruction is not a workflow input; it requires a reviewed code change that removes protection and a separate explicitly named break-glass procedure.

## 11. Application CI Pipeline

Create a reusable quality workflow called by pull requests and deployment:

1. Start a PostgreSQL 16 service container.
2. Run `npm ci`.
3. Run `prisma generate`.
4. Apply migrations to the CI database.
5. Run linting.
6. Run TypeScript checks.
7. Run Vitest.
8. Run the production Next.js build.
9. Run Playwright against the built application and CI PostgreSQL.
10. Build the container without pushing and run a container-level health check.

Add dependency caching keyed by `package-lock.json`, but never cache `.env` files or generated credentials.

## 12. Application Build and Deployment Pipeline

Create `.github/workflows/deploy.yml`, triggered by a successful merge to `master` for application, Prisma, container, or deployment-manifest paths.

### Build

1. Run the reusable quality workflow.
2. Authenticate to GHCR with the short-lived `GITHUB_TOKEN` and `packages: write` permission.
3. Build `linux/arm64` and `linux/amd64` images with Buildx.
4. Push immutable tags for the Git SHA and record the OCI image digest.
5. Generate an SBOM and run a vulnerability scan.
6. Sign or attest the image using GitHub's OIDC-backed artifact attestation mechanism.
7. Never put database or OAuth configuration into an image layer or build argument.

OKE always deploys the immutable digest, not `latest` or `master`.

### Production authorization

The deploy job uses the protected GitHub `production` environment. OKE external OIDC configuration must require these claims:

- Repository: `eshneken/family-grocery-list`
- Ref: `refs/heads/master`
- Environment: `production`
- Audience: a dedicated value such as `oke-family-grocery-production`

Kubernetes binds the resulting OIDC subject only to a namespace Role that can manage the application Deployment, migration Jobs, selected Services/ConfigMaps, and namespace Secrets. It receives no cluster-admin role.

### Database migration and rollout

GitHub-hosted runners cannot reach the PostgreSQL private endpoint. Migrations therefore run inside OKE:

```text
Build image and obtain digest
             |
             v
Create one-shot Prisma migration Job using that digest
             |
       +-----+------+
       |            |
    success       failure
       |            |
       v            v
Apply app        Stop deployment,
Deployment      preserve current app,
       |         publish Job logs
       v
Wait for rollout and readiness
       |
       v
HTTPS smoke test
       |
       +---- failure --> rollout undo application image
```

Migration Job requirements:

- Command: `npm run db:migrate:deploy`, implemented as `prisma migrate deploy`.
- The release image contains the pinned Prisma CLI and migration files even when unrelated development dependencies are pruned.
- The Job never downloads tooling or packages from the internet at runtime.
- Unique name derived from the commit SHA.
- Same database Secret and CA ConfigMap as the application.
- `backoffLimit: 1` and a finite active deadline.
- Wait for completion and print sanitized logs on failure.
- Automatic cleanup only after logs and status are captured.

Database migrations are not rolled back automatically. Schema changes must follow expand/contract rules so the previous image remains compatible after a failed rollout. Destructive column or table removal requires a later release after old code is gone.

### Application rollout

- Apply the production Kustomize overlay with the new image digest.
- Use one replica initially with resource requests/limits.
- Use a rolling strategy that can temporarily run a second app pod on the same worker.
- Add a non-database liveness endpoint and a database-aware readiness endpoint.
- Wait for `kubectl rollout status`.
- Test `https://grocery.shnekendorf.com` and its readiness endpoint.
- On smoke-test failure, roll back the application image and alert in the workflow summary.
- Caddy is not restarted during application releases.

Use concurrency group `production-deploy` with `cancel-in-progress: false`.

## 13. Google OAuth Release Gate

Implement and test Google OAuth locally before the first public deployment. The production pipeline must fail if the application is still configured for mock authentication.

Required behavior:

- OAuth callback uses `https://grocery.shnekendorf.com`.
- Only explicitly approved email addresses can create a session.
- Session cookies are `Secure`, `HttpOnly`, and use an appropriate `SameSite` policy.
- Unapproved accounts receive a clear denial and no user row is created.
- The mock user switcher and `mock_current_user` cookie path are disabled in production.

## 14. pgAdmin and Administrative Access

Terraform creates OCI Bastion access to the PostgreSQL subnet but no public database endpoint and no bastion VM.

Document a helper command that:

1. Creates a time-limited Bastion port-forwarding session to the PostgreSQL private endpoint on 5432.
2. Binds a chosen local port, defaulting to 5433 to avoid the local Docker database.
3. Downloads the PostgreSQL CA certificate from the Terraform connection-detail output.
4. Retrieves the database password from OCI Vault using the administrator's local OCI session.
5. Configures pgAdmin with the database FQDN for hostname verification and `127.0.0.1` as the tunnel address.

Use `sslmode=verify-full`. Bastion sessions should have a short TTL and an allowed client CIDR limited to the administrator's current public IP.

## 15. Monitoring, Backups, and Maintenance

Initial operational controls:

- Daily PostgreSQL backups retained for 14 days.
- OCI alarms for PostgreSQL node health, CPU, memory, connection pressure, and backup failure where metrics exist.
- OCI alarms for OKE worker health and load balancer backend health.
- GitHub deployment smoke test on every release.
- Scheduled weekly HTTPS check that verifies status, certificate expiry, and readiness.
- OCI budget alert for the app compartment even though OCI cost is not a project constraint.
- Dependabot for npm and GitHub Actions.
- A monthly maintenance workflow or checklist for supported OKE/Kubernetes and worker-image versions.

Quarterly recovery verification should restore the latest PostgreSQL backup to a temporary database system, run migrations/read checks, and delete it. A backup that has never been restored is not a verified recovery path.

## 16. Failure Modes and Controls

| Failure | Expected behavior | Test/control |
|---|---|---|
| GitHub WIF claim does not match | OCI denies Terraform credentials | Read-only bootstrap verification workflow |
| Concurrent Terraform runs | Second run waits or fails safely | GitHub concurrency plus OCI backend lock |
| Terraform plan is stale after approval | Apply job re-plans | Never apply the pre-approval artifact |
| ARM image is missing | OKE reports image architecture failure | Multi-architecture image inspection before deploy |
| PostgreSQL is unreachable | App readiness fails; liveness remains healthy | Readiness integration test and alert |
| PostgreSQL certificate is invalid | Prisma refuses connection | `verify-full` connection test from OKE |
| Migration fails | Existing application remains deployed | Migration Job gates rollout |
| New image fails readiness | Kubernetes keeps old ready pod where capacity allows | Rollout status plus automatic image rollback |
| Caddy pod restarts | Certificate state reloads from PVC | Delete-pod recovery test |
| Caddy volume cannot attach | HTTPS remains unavailable until same-AD worker is ready | Fixed-AD node placement and PVC alert |
| Let's Encrypt renewal fails | Existing certificate remains active while Caddy retries | Weekly expiry monitor with warning threshold |
| Single OKE worker fails | Temporary outage during node replacement | Accepted risk; node health alarm |
| Single PostgreSQL node fails | Database outage until service recovers node | Accepted risk; backup and restore drill |
| Bastion session expires | pgAdmin connection closes without exposing DB | Expected short-lived administrative access |
| DNS record points to wrong IP | HTTPS and OAuth fail | Terraform DNS assertion and post-apply lookup |

## 17. Test Plan for the Infrastructure and Pipelines

```text
STATIC AND PLAN TESTS                              LIVE ACCEPTANCE TESTS
[ ] terraform fmt/validate for all roots          [ ] WIF read-only authentication succeeds
[ ] Terraform variable validation tests           [ ] State lock rejects concurrent apply
[ ] IaC security scan                              [ ] OKE node Ready on A1 ARM
[ ] IAM policy/claim assertions                    [ ] PostgreSQL has no public endpoint
[ ] Docker ARM64/AMD64 manifest inspection         [ ] DB TLS verify-full succeeds from pod
[ ] Kubernetes schema validation                   [ ] Bastion pgAdmin tunnel succeeds
[ ] Migration Job manifest tests                   [ ] DNS resolves reserved LB IP
[ ] Mock-auth production guard test                [ ] HTTP redirects to HTTPS
                                                    [ ] Valid public certificate is served
                                                    [ ] Caddy survives pod recreation
                                                    [ ] Migration gates application rollout
                                                    [ ] Failed readiness rolls image back
```

The implementation is not complete until each live acceptance test has a recorded command and expected result in the runbook.

## 18. Initial Deployment Sequence

1. Implement Google OAuth and health endpoints locally; run the full local test suite.
2. Create the Google OAuth production client and callback URL.
3. Complete the documented OCI WIF manual bootstrap.
4. Run the Terraform bootstrap root locally and migrate its state to Object Storage.
5. Configure GitHub `production-infra` and `production` environments, reviewers, secrets, and non-secret variables.
6. Dispatch the infrastructure workflow for a production plan.
7. Review and approve the production OCI apply.
8. Review and approve the cluster-foundation apply.
9. Confirm node, PVC, load balancer, DNS, Caddy certificate, PostgreSQL, backup policy, and Bastion.
10. Merge or dispatch the first application deployment.
11. Confirm the migration Job, app rollout, Google login, allowlist denial, HTTPS, and pgAdmin access.
12. Record outputs and recovery commands in the operations runbook.

## 19. Implementation Workstreams

| Lane | Scope | Depends on |
|---|---|---|
| A | Google OAuth, production auth guard, health endpoints | None |
| B | Terraform bootstrap and production OCI resources | WIF manual design |
| C | Dockerfile, GHCR build, Kubernetes application manifests | None |
| D | Cluster-foundation Terraform, Caddy, Service, PVC, RBAC | Production OKE outputs |
| E | GitHub infrastructure and deployment workflows | A, B, C, D contracts |
| F | Runbooks, pgAdmin helper, recovery verification | B and D outputs |

Lanes A, B, and C can begin in parallel. Lane D starts after the OKE/network output contract is fixed. Lane E should be assembled after the commands it automates have been proven manually or in a sandboxed plan. Lane F finishes after real output shapes are known.

## 20. Implementation Tasks

- [ ] **T1 (P1)** Implement and locally verify Google OAuth, allowlisting, secure cookies, and production mock-auth rejection.
- [ ] **T2 (P1)** Add live and ready health endpoints with tests.
- [ ] **T3 (P1)** Add a multi-stage, non-root, multi-architecture production Dockerfile, package the pinned Prisma migration tooling, add `db:migrate:deploy`, and add a container health test.
- [ ] **T4 (P1)** Implement Terraform bootstrap with encrypted, versioned, locking OCI remote state.
- [ ] **T5 (P1)** Implement production Terraform for network, NSGs, OKE managed A1 node, PostgreSQL, Vault, DNS, Bastion, and reserved IP.
- [ ] **T6 (P1)** Implement cluster-foundation Terraform for RBAC, Caddy, PVC, DB configuration, and LoadBalancer Service.
- [ ] **T7 (P1)** Add application manifests and a one-shot Prisma migration Job.
- [ ] **T8 (P1)** Add static infrastructure CI and manually approved WIF-backed Terraform apply.
- [ ] **T9 (P1)** Add application quality, GHCR build/attestation, OKE OIDC deployment, migration gate, rollout, smoke test, and rollback.
- [ ] **T10 (P2)** Add pgAdmin/Bastion and operational runbooks.
- [ ] **T11 (P2)** Add monitoring, certificate-expiry check, dependency updates, and backup-restore verification.
- [ ] **T12 (P2)** Execute and record every live acceptance test before declaring production ready.

## 21. Not in Scope

- Multi-node or multi-region high availability; the accepted initial target is one worker and one PostgreSQL node.
- Staging or preview infrastructure; all non-production testing remains local or inside ephemeral CI services.
- OCI WAF; explicitly excluded.
- Kubernetes ingress controller or Gateway API; one public service does not need host/path routing.
- OCIR; GHCR avoids an additional long-lived registry token.
- Automatic Terraform destroy.
- Cross-region PostgreSQL backup copy or disaster recovery.
- Autoscaling; a one-node personal deployment does not benefit from it yet.
- Moving Caddy state to a community S3/PostgreSQL plugin; stock Caddy plus an OCI PVC is the lower-risk design.

## 22. Review Checklist

Before implementation, verify:

- The selected app compartment has quota for one A1 instance, one flexible LB, one PostgreSQL E5 Flex node, a Bastion, KMS/Vault, and block volumes in IAD.
- `PostgreSQL.VM.Standard.E5.Flex`, PostgreSQL 16, 1 OCPU/16 GB, and 75K IOPS are available in IAD.
- The existing DNS zone can be managed by the WIF principal without granting broad root-compartment administration.
- GitHub environment protection and required reviewers are enabled for this public repository.
- The WIF token exchange works with the Terraform OCI provider version selected during implementation.
- The Service annotations for reserved IP, Flexible LB bandwidth, NSGs, and TCP backend protocol are validated against the current OKE cloud-controller-manager version.
- Caddy's official ARM64 image digest is pinned and its PVC recovery has been tested.

## 23. Primary References

- [OCI Database with PostgreSQL overview](https://docs.oracle.com/en-us/iaas/Content/postgresql/overview.htm)
- [OCI PostgreSQL supported shapes](https://docs.oracle.com/en-us/iaas/Content/postgresql/supported-shapes.htm)
- [OCI PostgreSQL Terraform resource](https://registry.terraform.io/providers/oracle/oci/latest/docs/resources/psql_db_system)
- [OCI PostgreSQL connection-detail data source](https://registry.terraform.io/providers/oracle/oci/latest/docs/data-sources/psql_db_system_connection_detail)
- [Connecting to OCI PostgreSQL through Bastion](https://docs.oracle.com/en-us/iaas/Content/postgresql/connect-to-db.htm)
- [OKE ARM managed nodes](https://docs.oracle.com/en-us/iaas/Content/ContEng/Tasks/contengrunningarmnodes.htm)
- [OKE external OIDC authentication requirements](https://docs.oracle.com/en-us/iaas/Content/ContEng/Tasks/contengOpenIDConnect-Authentication.htm)
- [OKE persistent storage limitations](https://docs.oracle.com/en-us/iaas/Content/ContEng/Tasks/contengcreatingpersistentvolumeclaim.htm)
- [OKE LoadBalancer Service annotations](https://docs.oracle.com/en-us/iaas/Content/ContEng/Tasks/contengcreatingloadbalancer_topic-Summaryofannotations.htm)
- [Terraform OCI backend and state locking](https://developer.hashicorp.com/terraform/language/backend/oci)
- [OCI IAM Workload Identity Federation](https://blogs.oracle.com/cloud-infrastructure/oci-iam-workload-identity-federation)
- [GitHub Actions OIDC](https://docs.github.com/en/actions/concepts/security/openid-connect)
- [Caddy storage modules](https://caddyserver.com/docs/json/storage/)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---:|---|---|
| CEO Review | `/plan-ceo-review` | Scope and strategy | 0 | Not run | Infrastructure-only change |
| Outside Voice | `/codex review` | Independent second opinion | 0 | Not run | Optional |
| Eng Review | `/plan-eng-review` | Architecture and tests | 1 | Clear for implementation | Single-node risks accepted; auth, migration, state, TLS, and private DB paths addressed |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | Not applicable | No UI design scope |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | Not run | Pipeline runbooks included in implementation scope |

**VERDICT:** Engineering plan is ready for user review before implementation.

NO UNRESOLVED DECISIONS
