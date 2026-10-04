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

Public DNS is hosted outside this OCI tenancy, currently at GoDaddy. Set `app_hostname` to the public hostname; Terraform does not look up or modify an OCI DNS zone.

## External DNS setup (GoDaddy)

After applying this root, retrieve the reserved address and configured hostname from its initialized backend:

```sh
terraform output -raw reserved_public_ip
terraform output -raw app_hostname
```

In GoDaddy, open the domain's **DNS** records and add or edit an **A** record for that hostname. For `grocery.shnekendorf.com` in the `shnekendorf.com` zone, use **Name** `grocery`; for the zone apex, use `@`. Set **Value** to the `reserved_public_ip` output and choose a supported TTL (for example, 600 seconds). Replace old address values so traffic resolves to the intended load balancer. Retain an AAAA record only if it reaches the same service over working IPv6.

The record points to the reserved **load balancer** IP, not the worker or Kubernetes API IP. Complete this step before Caddy attempts certificate issuance, or update DNS and let Caddy retry if cluster foundation is already deployed. The infrastructure workflow does not update GoDaddy automatically.

Verify publicly after DNS caches expire:

```sh
dig +short grocery.shnekendorf.com A
curl -I https://grocery.shnekendorf.com/
```

Substitute your configured hostname. Before the app is deployed, an HTTPS `502` from Caddy is expected. Caddy's HTTP/TLS ACME challenges require the hostname to reach it on ports 80/443; no GoDaddy API credentials are needed. Keep the Caddy PVC for certificate and ACME state.

Update the A record again if the reserved IP changes, especially after destroy/recreation or a move to another tenancy. Destroying OCI infrastructure does not remove external DNS records. GoDaddy reference: [Manage DNS records](https://www.godaddy.com/help/manage-dns-records-680).

## Migrating existing Terraform state from OCI DNS

The OCI zone has already been removed and DNS has been verified at GoDaddy. `dns.tf` now contains a `removed` block with `destroy = false` for the old `oci_dns_rrset.grocery` resource. The next plan/apply forgets that record without attempting deletion; the old zone data source and `dns_zone_id` output are also removed. The reserved IP retains its exact Terraform resource address (`oci_core_public_ip.grocery`) despite moving its configuration to `public-ip.tf`, so no IP replacement is required.

Remove obsolete `dns_zone_name`, `dns_zone_compartment_ocid`, and `dns_ttl` entries from ignored local variable files. Remove unused `OCI_DNS_ZONE_NAME` and `OCI_DNS_ZONE_COMPARTMENT_OCID` GitHub environment variables. Remove any old tenancy-wide DNS management grant dedicated to this deployment.

Review the plan before applying: it should forget the former DNS record and preserve the reserved IP, load balancer, and other existing infrastructure unless independent changes are present. This change does not require running destroy or recreating the environment.

## Important operational constraints

- This personal test environment is intentionally destroyable end to end, including PostgreSQL and the remote-state bucket. Preserve data outside Terraform before running the destroy workflow.
- The PostgreSQL system has no public IP. Administrative access is through a time-limited OCI Bastion port-forwarding session added in the operations workstream.
- `oci_core_public_ip.grocery` is reserved now. The later Kubernetes `LoadBalancer` Service must attach this address with OCI CCM annotations; Terraform must not create static load-balancer backends.
- `bastion_client_cidr` is required and accepts any valid IPv4 or IPv6 CIDR. Choose the scope deliberately because it controls which clients may create Bastion sessions.
- `node_availability_domain` is supplied explicitly so CI does not require a tenancy-level Availability Domains lookup. The compatible ARM worker image is discovered from OKE for the selected Kubernetes version.
- The selected Kubernetes version and PostgreSQL service shape/version must be confirmed in Ashburn immediately before the first plan/apply.

Next: configure the [OKE cluster foundation](../cluster-foundation/README.md).
