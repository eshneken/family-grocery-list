# OCI platform

Creates Basic OKE with one managed ARM64 A1 worker (2 OCPUs / 12 GB, 50 GB boot), private worker/pod subnets, NAT/Service Gateway, public API/LB subnets, NSGs, reserved LB address, optional Bastion and Vault-backed PostgreSQL credentials/private TLS. Bastion is disabled by default. PostgreSQL runs in Kubernetes.

Select the supported Kubernetes version and matching ARM64 image from regional OKE options and pin them in private configuration. IMDSv1 is disabled at launch. The backup defined tag applies to the actual worker; confirm its shape, instance options, tag and boot volume after creation.

The default API source CIDR is `0.0.0.0/0`. Configure `operator_api_cidrs` for your requirements and verify operator and CI reachability. TLS, IAM and RBAC remain required. Worker/kubelet, NodePorts and PostgreSQL have no public ingress.

Copy the safe example into an ignored variables file and use the isolated helper. Review every plan before applying. See [setup](../../docs/oci-setup.md) and [operations](../../docs/oci-operations.md).

## External DNS setup

After foundation creates the flexible load balancer, read the `reserved_public_ip` output privately. At your external DNS provider, point the configured application hostname's A record to that address. Avoid an AAAA record unless IPv6 delivery is configured and verified. Terraform manages no public DNS zone or record.

Caddy issues/renews certificates through TCP 80/443 validation. No DNS-provider API credential is needed. Verify DNS, TLS and the application's public readiness endpoint after initial setup or a reviewed reserved-IP change.
