# Cluster Foundation

This root configures long-lived Kubernetes infrastructure after the OCI `production` root has created OKE and PostgreSQL. It does not deploy the application image or run migrations.

Documentation: [infrastructure overview](../README.md) | [production OCI environment](../production/README.md) | [project README](../../README.md)

It creates the `grocery` namespace, a PostgreSQL CA ConfigMap and database Secret, Caddy with persistent ACME state, and the public `LoadBalancer` Service bound to the pre-reserved OCI public IP.

## Local setup

First create a short-lived kubeconfig with the OCI CLI after the OKE cluster is active:

```sh
oci ce cluster create-kubeconfig \
  --cluster-id "$(cd ../production && terraform output -raw cluster_id)" \
  --file "$HOME/.kube/family-grocery" \
  --region "<oci-region>" \
  --token-version 2.0.0 \
  --kube-endpoint PUBLIC_ENDPOINT
```

Copy `terraform.tfvars.example`, fill in the state bucket/namespace, compartment OCID, and ACME email, then initialize this root with a separate state key:

```sh
cd infra/cluster-foundation
terraform init \
  -backend-config="bucket=<bootstrap state_bucket_name>" \
  -backend-config="namespace=<bootstrap state_namespace>" \
  -backend-config="key=cluster-foundation/terraform.tfstate" \
  -backend-config="region=<oci-region>"
terraform plan
terraform apply
```

The production state is read-only input to this root. The OCI identity running it needs permission to read the PostgreSQL connection detail and Vault secret bundle, as well as permission to manage OKE resources in the application compartment. OKE authorizes that OCI identity through IAM; this root intentionally does not try to bootstrap Kubernetes Roles, because a new non-tenancy-administrator cannot create its own Role grant. The OCI CLI must also be installed and authenticated as that identity: Terraform renames the CCM-created public load balancer in place after the Service obtains its reserved public IP.

## Safety notes

- Caddy uses one replica and a 50 GiB `ReadWriteOnce` OCI Block Volume. Its Deployment uses `Recreate` so two pods cannot contend for the volume. The `oci-bv` StorageClass binds only after Caddy is scheduled, so Terraform intentionally does not wait for the PVC before creating that Deployment.
- The Caddy PVC and its OCI Block Volume are intentionally destroyable so this non-production environment can be reset and recreated end to end. A reset discards Caddy's ACME account and certificate cache.
- The public service must be applied only after the application Service named `grocery-app` exists; Caddy will otherwise return upstream errors, though it can still obtain and retain certificates.
- The service annotations are intentionally centralized in `load-balancer-service.tf`. Confirm them against the installed OCI cloud-controller-manager version during the first live apply.
- `load_balancer_display_name` defaults to `lb-grocery`. The post-provision reconciler updates only the display name; listeners, backends, and security configuration remain owned by OKE's cloud-controller-manager. On `terraform destroy`, it removes any CCM LB still attached to the reserved IP before deleting the Kubernetes Service, so the foundation root resets cleanly.

Next: follow the [application deployment guide](../../deploy/README.md).
