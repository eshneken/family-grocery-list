# Production OCI Environment

This root creates the OCI environment only. It does not create Kubernetes application resources. Apply it after the `bootstrap` root has completed and OCI Workload Identity Federation has been manually configured for GitHub Actions.

Documentation: [infrastructure overview](../README.md) | [bootstrap state backend](../bootstrap/README.md) | [project README](../../README.md)

## Initial local plan

Copy the example variables and fill in the OKE version, tenancy-specific worker availability domain, SSH public key, and outputs from the bootstrap run:

```sh
cd infra/production
cp terraform.tfvars.example terraform.tfvars
terraform init \
  -backend-config="bucket=<bootstrap state_bucket_name>" \
  -backend-config="namespace=<bootstrap state_namespace>" \
  -backend-config="key=production/terraform.tfstate" \
  -backend-config="region=<oci-region>"
terraform plan
```

The `terraform.tfvars` file is ignored. Do not place a PostgreSQL password, GitHub token, Google OAuth credential, or OCI API private key in it.

`dns_zone_compartment_ocid` identifies the compartment that owns the public OCI DNS zone. Set it explicitly in `terraform.tfvars`, even when it is the tenancy root compartment, to make that ownership boundary visible in reviews.

## Important operational constraints

- This personal test environment is intentionally destroyable end to end, including PostgreSQL and the remote-state bucket. Preserve data outside Terraform before running the destroy workflow.
- The PostgreSQL system has no public IP. Administrative access is through a time-limited OCI Bastion port-forwarding session added in the operations workstream.
- `oci_core_public_ip.grocery` is reserved now. The later Kubernetes `LoadBalancer` Service must attach this address with OCI CCM annotations; Terraform must not create static load-balancer backends.
- `bastion_client_cidr` is required and accepts any valid IPv4 or IPv6 CIDR. Choose the scope deliberately because it controls which clients may create Bastion sessions.
- `node_availability_domain` is supplied explicitly so CI does not require a tenancy-level Availability Domains lookup. The compatible ARM worker image is discovered from OKE for the selected Kubernetes version.
- The selected Kubernetes version and PostgreSQL service shape/version must be confirmed in Ashburn immediately before the first plan/apply.

Next: configure the [OKE cluster foundation](../cluster-foundation/README.md).
