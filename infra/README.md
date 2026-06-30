# OCI Terraform

This directory contains OCI infrastructure for the Family Grocery List production environment. Deployment-specific values, including region and hostnames, are supplied only through ignored local Terraform variable files.

- `bootstrap/`: one-time state bucket, Vault, and software key for application secrets. Start with local state, then migrate it to the bucket it creates.
- `production/`: VCN, security groups, OKE managed A1 worker, private OCI PostgreSQL, Vault secret, Bastion, reserved public IP, and the public DNS record.
- `cluster-foundation/`: Kubernetes namespace, PostgreSQL connection material, Caddy, persistent certificate state, and the OCI load-balancer Service.

Application releases remain a separate follow-on workflow. These roots create the OCI environment and durable Kubernetes foundation but do not deploy the application image.

## Architecture And Ownership

Terraform is split because each stage depends on outputs or APIs created by the previous stage:

| Root | Owns | State key |
| --- | --- | --- |
| `bootstrap` | Object Storage state bucket, Vault, software key | `bootstrap/terraform.tfstate` |
| `production` | VCN, gateways, subnets, NSGs, OKE, A1 node pool, PostgreSQL, Bastion, DNS, reserved public IP | `production/terraform.tfstate` |
| `cluster-foundation` | `grocery` namespace, database Secret/CA, Caddy, PVC, `LoadBalancer` Service, LB display name | `cluster-foundation/terraform.tfstate` |

The state bucket is private and versioned. GitHub passes its namespace, the Vault/key OCIDs, and the OKE cluster OCID between jobs rather than storing those dynamic values as repository variables. Terraform state contains sensitive generated values, including the PostgreSQL password; never commit, upload, or print state.

The application image, Prisma migrations, and application Deployment/Service are deliberately outside these roots. They belong to the application release pipeline.

## Prerequisites

- Terraform `>= 1.8.0`
- OCI CLI authenticated locally for validation and emergency administration
- OCI IAM Workload Identity Federation configured for GitHub Actions
- An SSH public key for the managed OKE worker

See [bootstrap/README.md](bootstrap/README.md) for the state-backend bootstrap, [production/README.md](production/README.md) for OCI resources, and [cluster-foundation/README.md](cluster-foundation/README.md) for Kubernetes resources.

## GitHub Configuration

The manual **OCI infrastructure** workflow accepts one operation:

- `deploy` applies `bootstrap`, `production`, and `cluster-foundation` in order. Dynamic state namespace, Vault IDs, and OKE cluster ID are passed between jobs.
- `destroy` destroys those stages in reverse order. It requires the exact confirmation `DESTROY` and approval through the protected `production-destroy-approval` environment.

Every job obtains a fresh short-lived OCI security token through the `production` GitHub environment. The environment must contain these variables:

```text
OCI_TENANCY_OCID
OCI_COMPARTMENT_OCID
OCI_REGION
OCI_STATE_BUCKET_NAME
OCI_DNS_ZONE_NAME
OCI_DNS_ZONE_COMPARTMENT_OCID
OCI_APP_HOSTNAME
OCI_OKE_KUBERNETES_VERSION
OCI_NODE_AVAILABILITY_DOMAIN
OCI_NODE_SSH_PUBLIC_KEY
OCI_BASTION_CLIENT_CIDR
OCI_POSTGRES_BACKUP_START
CADDY_ACME_EMAIL
OCI_WIF_DOMAIN_URL
OCI_WIF_CLIENT_ID
OCI_WIF_SERVICE_USER_OCID
OCI_WIF_AUDIENCE
```

Store `OCI_WIF_CLIENT_SECRET` as an environment secret. Restrict the `production` environment to the protected deployment branch. `OCI_BASTION_CLIENT_CIDR` must be a valid IPv4 or IPv6 CIDR, and the OKE version must include its leading `v`.

The `production-destroy-approval` environment must:

- Have `eshneken` configured as a required reviewer.
- Allow deployments only from `master`.
- Set **Prevent self-review** to off for this single-owner repository; approval is still an explicit manual action.
- Contain no OCI variables or secrets. It gates the workflow only. Destroy jobs authenticate through the existing `production` environment after approval.

Automatic OKE worker-image discovery calls the tenancy-scoped node-pool options endpoint. Add this read-only statement to the root-compartment policy for the GitHub deployment group:

```text
Allow group family-grocery-github-deployers to read all-resources in tenancy
```

The deployment group also needs these existing statements:

```text
Allow group family-grocery-github-deployers to manage all-resources in compartment hm
Allow group family-grocery-github-deployers to manage dns in tenancy
```

## Applying Infrastructure Updates

Use `deploy` for both initial creation and every later infrastructure update.

1. Create a branch and edit the root that owns the resource. New OCI services normally belong in `production`; Kubernetes platform resources belong in `cluster-foundation`. Bootstrap should remain limited to state and secret-encryption prerequisites.
2. Add variables for values that differ by tenancy or environment. Put non-sensitive values in the GitHub `production` environment and secrets in GitHub environment secrets. Do not commit real `terraform.tfvars` files.
3. Add outputs only when a later stage or application deployment needs them. Pass dynamic IDs through job outputs or remote state rather than copying OCIDs into GitHub variables.
4. Review IAM requirements. Extend the WIF deployment policy only with permissions required by the new service.
5. Run local checks:

```bash
terraform fmt -check -recursive infra
terraform -chdir=infra/bootstrap validate
terraform -chdir=infra/production validate
terraform -chdir=infra/cluster-foundation validate
```

6. Open a pull request and review the Terraform changes, especially replacements and deletes. Merge to `master` only after review.
7. Open **Actions** > **OCI infrastructure** > **Run workflow**, select `deploy`, and leave `confirm_destroy` blank.
8. Watch all three jobs. If a stage fails, fix the configuration and rerun `deploy`; completed resources and remote state are reused.
9. Confirm the run succeeds and perform relevant service checks. For the current stack:

```bash
kubectl --kubeconfig "$HOME/.kube/family-grocery" get nodes
kubectl --kubeconfig "$HOME/.kube/family-grocery" -n grocery get pods,pvc,svc
curl -I https://grocery.shnekendorf.com/
```

Before the application Service exists, Caddy returning HTTPS `502` is expected. TLS, DNS, load balancer, and Caddy are working; only the upstream application is absent.

For an idempotence check, refresh local bootstrap outputs in the ignored production `terraform.tfvars`, then run `terraform plan` in all three roots. Each should report no changes.

## Destroy Protection

Destroy is for deliberate full-environment resets, not routine deployments. It permanently removes:

- The PostgreSQL system and all application data.
- OKE and the managed worker.
- The Caddy block volume, ACME account, and certificate cache.
- VCN resources, Bastion, DNS record, reserved public IP, and load balancer.
- The versioned Terraform state bucket, Vault, and software key.

Before approving destroy, take any required database backup and confirm that recreating TLS state will not cause ACME rate-limit problems. Then:

1. Run **OCI infrastructure** with operation `destroy`.
2. Type `DESTROY` exactly in `confirm_destroy`.
3. Review the pending `production-destroy-approval` deployment and approve it manually.
4. Verify cluster foundation, production, and bootstrap are removed in that order.

The final bootstrap job first pulls state to runner-local storage, empties every object version from the state bucket, and then destroys the bucket, software key, and Vault. This is what makes a complete reset possible, and it also means remote state cannot be recovered from that bucket afterward.
