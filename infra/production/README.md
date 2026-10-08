# Always Free OCI platform

Creates Basic OKE with one managed ARM A1 node (2 OCPU/12 GB, 50 GB boot), private worker/pod subnets, NAT/Service Gateway, public API/LB subnets, NSGs, reserved LB address, optional Bastion and Vault-backed PostgreSQL credentials/private TLS. Bastion is disabled in the live target. There is no OCI managed PostgreSQL resource or database subnet.

The node image and version are explicitly pinned after checking Ashburn options. Terraform validates the image is offered for the selected ARM64 version. IMDSv1 is disabled in the node launch metadata. The defined backup tag is applied to actual worker Compute instances through node-config tags; confirm it after launch.

Initial API source CIDR is `0.0.0.0/0`, explicitly approved by the operator during build/travel. Authentication/RBAC/TLS remain required. Use `operator_api_cidrs` later to restrict sources; this is independent of Bastion's client CIDR. Subnet security lists have no broad default SSH/API ingress; NSGs own the rules.

Copy only this branch's example into an ignored new-environment variables file. Use the isolated helper and review plans before apply. See the [operator runbook](../../docs/oci-always-free-operations.md).

## External DNS setup (GoDaddy)

After foundation creates the fixed 10/10 Mbps load balancer, read `reserved_public_ip` from the **new** production state. The canonical `grocery.example.com` A record now points to `${PRODUCTION_IPV4}`; it has no AAAA record. Manually update it only after a reviewed reserved-IP change. The rehearsal hostname is not the production route. Terraform creates no DNS zone/record.

For a future separate rehearsal, do not change the canonical production record during initial provisioning. The final cutover runbook explicitly freezes writes and transfers the final database before changing that record. Caddy handles certificate issuance and renewal using port 80/443 validation; no GoDaddy API key is needed.
