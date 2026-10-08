# Production architecture and tool selection

Production moved to the `EDFREETIER` tenancy in Ashburn on October 8, 2026. The canonical service is https://grocery.shnekendorf.com at reserved IPv4 `129.159.189.16`. The old grocery environment was retired October 8 after an explicit operator waiver of the hold; its Vault/key deletion is pending until November 7. It is not an application or database dependency. The [migration design](oci-always-free-design.md) retains the historical plan and retirement checkpoints. Use the [operator runbook](oci-always-free-operations.md) for current procedures.

## Selected tools and responsibilities

| Area | Production selection | Responsibility and limits |
|---|---|---|
| Application | Next.js, React, TypeScript | One application replica; Google authentication and household membership authorization |
| Database access | Prisma | Checked-in schema/migrations; migration Job uses owner permissions; runtime uses DML permissions |
| PostgreSQL | PostgreSQL 16 Bookworm StatefulSet in OKE | Self-operated database, `UTF8` / `C.UTF-8`, internal TLS; no OCI managed PostgreSQL service |
| Compute/orchestration | Basic OKE v1.36.4, one ARM64 A1 worker | 2 OCPUs / 12 GB RAM in Ashburn AD-3; 50 GB boot; IMDSv1 disabled |
| Data storage | Retained OCI Block Volume through CSI | One 50 GiB RWO `platform-data` claim shared by separate PostgreSQL and Caddy subdirectories |
| Public entry | One OCI flexible load balancer | TCP 80/443, minimum and maximum both 10 Mbps; Caddy terminates TLS |
| DNS | GoDaddy | Manual canonical A record; Terraform does not manage public DNS |
| Edge TLS | Caddy / Let's Encrypt | ACME state persists on the shared claim; app releases do not restart Caddy |
| Database backups | Kubernetes CronJob, PostgreSQL 16 tools, age, OCI SDK | Daily at 09:00 UTC; encrypted custom dump plus completion manifest; retain last five complete backups |
| Backup authentication | Worker instance principal | Defined-tag dynamic group; upload/list/delete permissions; backup and state content reads denied |
| Backup alerts | GitHub Actions | Hourly at minute 17; metadata and Kubernetes Job health; failed-run email notifications |
| CI and registry | GitHub Actions / GHCR | Branch tests use disposable databases; digest-pinned ARM64/AMD64 application and backup images |
| Deployment authentication | GitHub OIDC → OCI identity-domain federation | `always-free` environment; short-lived credentials, separate from worker/human identities |
| Infrastructure | Terraform | Target-bound staging helper, separate roots/state, plan guard and full-SHA apply confirmation |
| Credentials | OCI DEFAULT Vault / SOFTWARE key; Kubernetes Secrets | Deployment materializes database credentials and private TLS; application OAuth/session values come from GitHub environment secrets |
| Human access | OCI CLI `EDFREETIER`, kubectl, Lens, optional pgAdmin | Distinct operator kubeconfig; authenticated database port-forward; no database Bastion is provisioned |
| Local development | Docker Compose PostgreSQL | Separate disposable data; Vitest and Playwright validate application behavior |

The quota guard permits one flexible LB with 10 Mbps total bandwidth and one network LB, with no allowance for the old fixed LB shapes. **Only the flexible LB is deployed**; the network LB allowance is available for a separate future use. Other quota restrictions remain in place. Check actual tenancy usage and entitlement before a second app; do not infer unused tenancy capacity from this application's allocation alone.

## Diagrams

- [Production architecture](../diagrams/oci-logical-architecture.svg), with [Mermaid source](../diagrams/oci-logical-architecture.mmd) and [editable Excalidraw](../diagrams/oci-logical-architecture.excalidraw).
- [Backup and recovery flow](../diagrams/oci-backup-recovery.svg), with [Mermaid source](../diagrams/oci-backup-recovery.mmd) and [editable Excalidraw](../diagrams/oci-backup-recovery.excalidraw).
- [Logical data model](../diagrams/logical-data-model.svg), generated from the unchanged [Prisma schema](../prisma/schema.prisma). Infrastructure migration does not change household IDs, memberships, lists or shopping history.

## Network and identity boundaries

| Network | CIDR | Exposure |
|---|---|---|
| VCN | `10.40.0.0/16` | Application tenancy |
| LB subnet | `10.40.0.0/24` | Public TCP 80/443 |
| OKE API subnet | `10.40.1.0/28` | Public IPv4 TCP 6443; TLS, OCI identity and Kubernetes RBAC required |
| Worker subnet | `10.40.10.0/24` | Private A1 worker |
| Pod subnet | `10.40.20.0/22` | Private VCN-native pod networking |

NAT provides required internet egress; the Service Gateway provides OCI service access. PostgreSQL is a private ClusterIP service at `postgres.grocery.svc.cluster.local:5432`, not a separate OCI database subnet or public endpoint. Worker/kubelet and NodePorts have no public ingress. API source access remains `0.0.0.0/0` by the operator's travel/build decision; source allowlisting is a separate future change. No enforced Kubernetes NetworkPolicy layer is installed, so do not describe namespace placement as pod-level traffic isolation.

Backups use instance-principal authentication through IMDSv2. CI uses federation; operators use their own profile. Basic OKE pod workload identity is not part of this design. Never launch a replacement VM with IMDSv1 enabled; verify the actual instance option, shape, defined tag and boot volume after any worker replacement.

## State and availability

Terraform roots are `tenancy-identity`, `bootstrap`, `production`, and `cluster-foundation`. Their separate state keys live in the private versioned `grocery-always-free-tfstate` bucket in namespace `iddiywf0v4j6`. Administrator IAM changes remain local-operator operations; ordinary CI does not receive tenancy-wide IAM writes. Terraform plans/state contain secrets and must stay private.

The worker and shared data disk allocate about 100 GB combined. The 50 GiB claim is shared capacity, not 50 GiB independently for each pod. It has Terraform `prevent_destroy` and a Retain storage policy. Caddy mounts only `caddy`; PostgreSQL mounts only `postgres`. Keep PostgreSQL directory ownership at UID 999 and mode 0700; do not recursively change the shared volume's owner.

One worker, one database pod, one Caddy replica and one shared disk are deliberate single points of failure. Database patching, capacity, restore drills and certificate monitoring are operator responsibilities. Logical backups are daily recovery points, not continuous replication or managed point-in-time recovery. Reattach the retained volume in its availability domain after worker failure; do not initialize a replacement empty database over existing data.

## Delivery handoff status

The [migration PR #27](https://github.com/eshneken/family-grocery-list/pull/27) passed all three CI checks and is merged into `master`. Application delivery is enabled and defaults to `restore-existing`; all production deployment jobs select `always-free`. The hourly backup-health workflow is active. Existing database contents and the reviewed bootstrap marker are preserved across releases; initialization is reserved for an explicitly empty installation.
