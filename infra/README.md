# OCI Terraform

This directory contains OCI infrastructure for the Family Grocery List production environment. Deployment-specific values, including region and hostnames, are supplied only through ignored local Terraform variable files.

- `bootstrap/`: one-time state bucket, Vault, and software key for application secrets. Start with local state, then migrate it to the bucket it creates.
- `production/`: VCN, security groups, OKE managed A1 worker, private OCI PostgreSQL, Vault secret, Bastion, reserved public IP, and the public DNS record.
- `cluster-foundation/`: Kubernetes namespace, PostgreSQL connection material, Caddy, persistent certificate state, and the OCI load-balancer Service.

Application releases remain a separate follow-on workflow. These roots create the OCI environment and durable Kubernetes foundation but do not deploy the application image.

## Prerequisites

- Terraform `>= 1.8.0`
- OCI CLI authenticated locally for the bootstrap run
- OCI IAM Workload Identity Federation configured before GitHub Actions can run `production`
- An SSH public key for the managed OKE worker

See [bootstrap/README.md](bootstrap/README.md) for the state-backend bootstrap, [production/README.md](production/README.md) for OCI resources, and [cluster-foundation/README.md](cluster-foundation/README.md) for Kubernetes resources.

## GitHub Actions

The manual `OCI infrastructure` workflow accepts one operation:

- `deploy` applies `bootstrap`, `production`, and `cluster-foundation` in order. Dynamic state namespace, Vault IDs, and OKE cluster ID are passed between jobs.
- `destroy` destroys those stages in reverse order. The bootstrap job copies its remote state locally, empties every version from the state bucket, and then destroys the bucket, software key, and Vault.

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
OCI_NODE_IMAGE_OCID
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
