# Bootstrap State Backend

Run this root locally once using an administrator OCI CLI session. It intentionally has no configured backend until the bucket exists.

```sh
cd infra/bootstrap
cp terraform.tfvars.example terraform.tfvars
terraform init -backend=false
terraform apply
```

After the apply, migrate state with a generated backend configuration file that is **not** committed:

```hcl
# backend.hcl
bucket    = "<state_bucket_name output>"
namespace = "<state_namespace output>"
key       = "bootstrap/terraform.tfstate"
region    = "<oci-region>"
```

```sh
terraform init -migrate-state -backend-config=backend.hcl
```

The OCI provider uses its standard local authentication chain. Use an OCI CLI session token or profile locally; do not put an OCI API private key in this repository. Object Storage uses OCI-managed encryption for Terraform state. The software-protected Vault key exists only to encrypt application secrets such as the PostgreSQL administrator password.

Before enabling the GitHub workflow, create an OCI IAM workload identity provider for `https://token.actions.githubusercontent.com` and restrict its claims to the repository, `master`, and the `production-infra` environment. The final policy must be limited to the application compartment, the state bucket, the Vault key, and the root-compartment DNS zone.
