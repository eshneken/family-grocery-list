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

## One-Time WIF Bootstrap

GitHub Actions authenticates without a stored OCI API key. A workflow requests a short-lived GitHub OIDC token, the default OCI identity domain validates it through an identity propagation trust, and OCI returns a short-lived UPST security token for a dedicated service user.

This setup has a one-time manual bootstrap boundary. Creating the trust requires an identity-domain administrator token, but routine workflows must use a separate, non-privileged OAuth client. Do not put the administrator client credentials in GitHub.

### 1. Create The OCI Deployment Identity

In **Identity & Security** > **Domains** > **Default domain**:

1. Create a user for GitHub Terraform deployments. This is a non-human service user; it does not need console access.
2. Create the group `family-grocery-github-deployers` and add the service user to it.
3. Record both the user's OCI user OCID and its identity-domain user ID. The ID is the final component of the user's identity-domain URL. It can also be queried with a locally authenticated OCI CLI:

```bash
export DOMAIN_URL='https://<default-domain-url>'
export WIF_SERVICE_USER_OCID='ocid1.user.oc1..<service-user-ocid>'

export SERVICE_USER_ID="$(
  oci identity-domains users list \
    --endpoint "$DOMAIN_URL" \
    --filter "ocid eq \"$WIF_SERVICE_USER_OCID\"" \
    --query 'data.resources[0].id' \
    --raw-output
)"
test -n "$SERVICE_USER_ID" && test "$SERVICE_USER_ID" != null
```

Create the deployment policy in the root compartment. Replace `hm` if the application compartment has a different name:

```text
Allow group family-grocery-github-deployers to manage all-resources in compartment hm
Allow group family-grocery-github-deployers to manage dns in tenancy
Allow group family-grocery-github-deployers to read all-resources in tenancy
```

The tenancy-wide permissions support the existing root-compartment DNS zone and discovery APIs such as OKE worker images. Resource creation remains limited to the application compartment.

### 2. Create The Runtime OAuth Client

In the default domain, open **Integrated applications** and create a **Confidential Application** named `family-grocery-github-actions`:

1. Select **Configure this application as a client now**.
2. Enable the **Client credentials** grant.
3. Leave **Add app roles** disabled. This runtime client must not have Identity Domain Administrator or other administrative roles.
4. Finish and activate the application.
5. Record its client ID and client secret. The secret will be stored only in the GitHub `production` environment.

This is the non-privileged client referenced by `OCI_WIF_CLIENT_ID` and `OCI_WIF_CLIENT_SECRET`.

### 3. Create A Temporary Administrator Client

Create a second confidential application named `family-grocery-wif-bootstrap-admin`:

1. Configure it as a client and enable **Client credentials**.
2. Enable **Add app roles**, select **Identity Domain Administrator** and **Me**, and finish the application.
3. Activate it and record its client ID and secret.

This client exists only to call the identity-domain administration API and create the trust. It is not the client used by GitHub Actions.

### 4. Create The GitHub Identity Propagation Trust

Install `curl` and `jq`, then export the values below. `WIF_CLIENT_ID` is the runtime client's ID; `ADMIN_CLIENT_ID` is the temporary administrator client's ID. `SERVICE_USER_ID` is the identity-domain ID, not the OCI user OCID.

```bash
export DOMAIN_URL='https://<default-domain-url>'
export ADMIN_CLIENT_ID='<temporary-admin-client-id>'
read -rsp 'Temporary admin client secret: ' ADMIN_CLIENT_SECRET && echo
export ADMIN_CLIENT_SECRET

export WIF_CLIENT_ID='<runtime-client-id>'
export WIF_AUDIENCE='<unique-audience>'
export WIF_SERVICE_USER_OCID='ocid1.user.oc1..<service-user-ocid>'
export SERVICE_USER_ID='<identity-domain-service-user-id>'
export GITHUB_SUBJECT='repo:<owner>/<repository>:environment:production'
```

Obtain a temporary identity-domain administrator access token:

```bash
export IDA_ACCESS_TOKEN="$(
  curl --fail-with-body --silent --show-error \
    --user "${ADMIN_CLIENT_ID}:${ADMIN_CLIENT_SECRET}" \
    --header 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode 'grant_type=client_credentials' \
    --data-urlencode 'scope=urn:opc:idm:__myscopes__' \
    "${DOMAIN_URL%/}/oauth2/v1/token" |
    jq -er '.access_token'
)"
```

Create the trust. The subject rule is significant: it accepts only OIDC tokens issued to jobs in this repository that declare the GitHub `production` environment.

```bash
export TRUST_PAYLOAD="$(
  jq -n \
    --arg client_id "$WIF_CLIENT_ID" \
    --arg audience "$WIF_AUDIENCE" \
    --arg service_user_id "$SERVICE_USER_ID" \
    --arg subject "$GITHUB_SUBJECT" \
    '{
      schemas: ["urn:ietf:params:scim:schemas:oracle:idcs:IdentityPropagationTrust"],
      name: "family-grocery-github-actions",
      type: "JWT",
      issuer: "https://token.actions.githubusercontent.com",
      publicKeyEndpoint: "https://token.actions.githubusercontent.com/.well-known/jwks",
      subjectType: "User",
      clientClaimName: "aud",
      clientClaimValues: [$audience],
      oauthClients: [$client_id],
      allowImpersonation: true,
      impersonationServiceUsers: [{
        rule: ("sub eq " + $subject),
        value: $service_user_id
      }],
      active: true
    }'
)"

export TRUST_RESPONSE="$(
  curl --fail-with-body --silent --show-error \
    --request POST \
    --header "Authorization: Bearer ${IDA_ACCESS_TOKEN}" \
    --header 'Content-Type: application/json' \
    --data "$TRUST_PAYLOAD" \
    "${DOMAIN_URL%/}/admin/v1/IdentityPropagationTrusts"
)"

jq '{id, name, active, issuer, clientClaimName, clientClaimValues, oauthClients}' \
  <<<"$TRUST_RESPONSE"
```

The response must contain a non-empty `id`, `active: true`, the GitHub issuer, the selected audience, and the runtime OAuth client ID. Keep the audience stable; changing it requires updating both the trust and GitHub variable.

### 5. Configure And Verify GitHub

Create or update the GitHub `production` environment, restrict it to `master`, and set these WIF-specific values:

| GitHub setting | Source |
| --- | --- |
| Variable `OCI_WIF_DOMAIN_URL` | Default identity-domain URL |
| Variable `OCI_WIF_CLIENT_ID` | Non-privileged runtime application client ID |
| Secret `OCI_WIF_CLIENT_SECRET` | Non-privileged runtime application client secret |
| Variable `OCI_WIF_AUDIENCE` | `WIF_AUDIENCE` used in the trust |
| Variable `OCI_WIF_SERVICE_USER_OCID` | OCI OCID of the deployment service user |

They can be set with the GitHub CLI after `gh auth login`:

```bash
gh variable set OCI_WIF_DOMAIN_URL --env production --body "$DOMAIN_URL"
gh variable set OCI_WIF_CLIENT_ID --env production --body "$WIF_CLIENT_ID"
gh variable set OCI_WIF_AUDIENCE --env production --body "$WIF_AUDIENCE"
gh variable set OCI_WIF_SERVICE_USER_OCID --env production --body "$WIF_SERVICE_USER_OCID"

read -rsp 'Runtime WIF client secret: ' WIF_CLIENT_SECRET && echo
printf '%s' "$WIF_CLIENT_SECRET" |
  gh secret set OCI_WIF_CLIENT_SECRET --env production
unset WIF_CLIENT_SECRET
```

Run the read-only verification workflow before running Terraform:

```bash
gh workflow run oci-wif-verify.yml --ref master
gh run list --workflow oci-wif-verify.yml --limit 1
```

The run must report **OCI WIF verification passed** after exchanging the GitHub token and reading the Object Storage namespace. A subject mismatch usually means the workflow does not declare `environment: production`, the repository name differs from `GITHUB_SUBJECT`, or the workflow was run from a branch disallowed by the GitHub environment.

After verification, deactivate or delete `family-grocery-wif-bootstrap-admin` and clear its credentials. Keep the runtime application active and rotate its client secret through OCI and the GitHub environment when required.

Oracle references: [Adding a Confidential Application](https://docs.oracle.com/en-us/iaas/Content/Identity/applications/add-confidential-application.htm), [identity-domain OAuth scopes](https://docs.oracle.com/en-us/iaas/Content/Identity/api-getstarted/Scopes.htm), and [JWT-to-UPST token exchange](https://docs.oracle.com/en-us/iaas/Content/Identity/api-getstarted/json_web_token_exchange.htm).

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
