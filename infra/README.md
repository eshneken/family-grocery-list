# OCI Terraform

This directory contains OCI infrastructure for the Family Grocery List production environment. Deployment-specific values, including region and hostnames, are supplied only through ignored local Terraform variable files.

- `bootstrap/`: one-time state bucket, Vault, and software key for application secrets. Start with local state, then migrate it to the bucket it creates.
- `production/`: VCN, security groups, OKE managed A1 worker, private OCI PostgreSQL, Vault secret, Bastion, reserved public IP, and the public DNS record.

The Kubernetes foundation and release manifests are deliberately separate follow-on work. This root creates the OCI environment those workloads require; it does not create application pods or expose a load balancer before the Caddy service is ready.

## Prerequisites

- Terraform `>= 1.8.0`
- OCI CLI authenticated locally for the bootstrap run
- OCI IAM Workload Identity Federation configured before GitHub Actions can run `production`
- An SSH public key for the managed OKE worker

See [bootstrap/README.md](bootstrap/README.md) for the state-backend bootstrap and [production/README.md](production/README.md) for the normal plan/apply workflow.
