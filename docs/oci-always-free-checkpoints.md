# OCI Always Free execution checkpoints

Implementation began October 5, 2026. Checkpoint **1 — GitHub-to-OCI federation — passed**; temporary administrator OAuth application cleanup remains a manual operator step. Next checkpoint: **2 — infrastructure implementation/review**. Replacement Terraform and workflow implementation is underway; no infrastructure has been applied. Follow the [operator runbook](oci-always-free-operations.md) for new manual prerequisites and staged plan review.

## Recorded baseline and completed preparation

- Implementation branch: `codex/oci-always-free`.
- Legacy configuration: local master commit `813968f6f46a152ed355b9dfcf7492cf03130080`; separate detached checkout at `/private/tmp/grocery-legacy-813968f`. The SHA is the durable reference; the temporary checkout can be recreated if removed. Never point it at the new backend.
- Remote master remains at `072092b6d724401177f56fdc1e1d09ebe5fa22e7`; the DNS-removal commit is included in the new branch, not pushed to master. Publish/reconcile the legacy DNS-removal configuration before eventual old teardown as described in the design. No old deployment was triggered by pushing master.
- Last successful master application workflow: [run 37017249003](https://github.com/eshneken/family-grocery-list/actions/runs/37017249003), October 2, source `072092b6d724401177f56fdc1e1d09ebe5fa22e7`.
- Registry image for that release: `ghcr.io/eshneken/family-grocery-list@sha256:b4273f744ba1320af6091c830a93a3544e859b06e1fa0cebceafd1980ee2ed99`; ARM64 manifest `sha256:b73d5e702fdec3888f1170aa09d20ea26ad52ad166c16c4133c943356225f3d8`. This identifies the registry release; verify the actual running deployment and capture old Terraform state securely before cutover.
- New GitHub environment `always-free` created, deployment branch restriction set to exactly `codex/oci-always-free`.
- Eight non-secret environment variables set: tenancy OCID, compartment OCID, region, WIF domain URL, WIF audience, Kubernetes version, new state bucket name, rehearsal hostname. Old `production` settings retain their existing values.
- Branch federation workflow now validates the expected new tenancy/compartment/domain and namespace. This test does not create cloud infrastructure or deploy the app.
- Bootstrap helper target/secret-handling tests and workflow isolation checks passed locally. Initial live verification identified a regular user instead of a service user; the correction and verification outcome are recorded below.

## Checkpoint 1 — manual operator steps

### 1. Confirm account status

Sign into tenancy **edfreetier**, region **Ashburn**. The dismissed banner is not needed: check **Billing & Cost Management → Upgrade and Manage Payment**, and the Console billing/account widget for any trial balance/days remaining. Record whether it is active Free Trial, Always Free only, or PAYG, plus the displayed trial end date if present. Do not perform an account upgrade as part of this checkpoint. Operator confirmation: plan **Free Tier**, created October 5, no expiration displayed. The expected initial trial transition is approximately one month after creation; the exact date remains unverified. [Oracle payment/account page](https://docs.oracle.com/en-us/iaas/Content/Billing/Tasks/changingpaymentmethod.htm), [billing widget](https://docs.oracle.com/en-us/iaas/Content/GSG/Concepts/console_topic-AccountCenter-Billing.htm)

### 2. Create the deployment user, group, and policy

In **Identity & Security → Domains → Default**, verify the domain URL is:

```text
https://idcs-a17d6a11db0544fa99f7562f8c569990.identity.oraclecloud.com:443
```

Create a true identity-domain service user named `grocery-github-service` with the SCIM extension `serviceUser: true` **at creation**. A regular Console-created user is insufficient, and this immutable flag cannot be changed afterward. Use the identity-domain administrator API described in [Oracle's service-user procedure](https://docs.oracle.com/en-us/iaas/Content/Identity/api-getstarted/json_web_token_exchange.htm#step-3-optional-use-a-service-user), or an administrator-authenticated signed request with local `EDFREETIER` credentials:

```bash
cat > /private/tmp/grocery-service-user-rest.json <<'JSON'
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "grocery-github-service",
  "urn:ietf:params:scim:schemas:oracle:idcs:extension:user:User": {
    "serviceUser": true
  }
}
JSON
oci raw-request --profile EDFREETIER --http-method POST \
  --target-uri 'https://idcs-a17d6a11db0544fa99f7562f8c569990.identity.oraclecloud.com:443/admin/v1/Users' \
  --request-body file:///private/tmp/grocery-service-user-rest.json
```

Require HTTP 201 and verify the resulting identity's `serviceUser` flag is true. On an unknown result, look up the username before retrying creation. Record its **OCI user OCID**, which starts with `ocid1.user.`. Create group `grocery-github-deployers` and add this user. It needs no API key and should not be an Administrators-group member.

Create an IAM policy named `grocery-github-deployment` in the **root compartment** with:

```text
Allow group 'Default'/'grocery-github-deployers' to manage all-resources in compartment grocery
Allow group 'Default'/'grocery-github-deployers' to read all-resources in tenancy
```

This follows the existing deployment model: writes within the application compartment, tenancy reads for discovery. Tenancy-level backup dynamic groups/tag setup will be handled as a separate administrator prerequisite. No OCI DNS permission is needed. [Oracle domain/group policy syntax](https://docs.oracle.com/en-us/iaas/Content/Identity/policysyntax/subject.htm)

Verify the user is in the group, the policy belongs to the new tenancy, and its writable compartment is `grocery`.

### 3. Create the runtime OAuth application

In the same Default domain, create a **Confidential Application** under **Integrated applications**, named `grocery-github-actions`:

1. Configure it as a client now.
2. Enable the **Client credentials** grant.
3. Leave administrator app roles disabled.
4. Finish and activate it.
5. Save its client ID and client secret securely. This is the **runtime** client used by GitHub.

### 4. Create the temporary administrator application and trust

Create a second Confidential Application named `grocery-wif-bootstrap-admin`. Enable **Client credentials**, assign **Identity Domain Administrator** using **Add app roles** and the **Me** setting described in [Oracle's identity-domain token-exchange setup](https://docs.oracle.com/en-us/iaas/Content/Identity/api-getstarted/json_web_token_exchange.htm), finish, and activate. Save its client ID/secret locally. Its secret must never be a GitHub secret.

From the migration checkout, run this helper using the three non-secret identifiers you recorded:

```bash
python3 scripts/bootstrap-always-free-wif.py \
  --runtime-client-id '<runtime-client-id>' \
  --service-user-ocid '<new-service-user-OCI-OCID>' \
  --admin-client-id '<temporary-admin-client-id>'
```

It verifies `EDFREETIER` and the compartment before looking up the service user's identity-domain ID. It prompts for the temporary admin secret with hidden terminal input and creates one trust. No passwords or tokens are printed or passed as command-line arguments. It refuses to overwrite an existing trust; after a timeout/unknown result, rerun to detect an existing trust and inspect it before proceeding.

Expected result: a nonempty trust ID, name `grocery-always-free-github-actions`, and `active: true`. The accepted issuer is GitHub, audience `grocery-always-free-github`, and subject exactly:

```text
repo:eshneken/family-grocery-list:environment:always-free
```

The helper does not provision OKE or a database. It creates an OCI identity-domain trust under the administrator credentials you enter. An optional offline preview uses `--dry-run --service-user-id '<identity-domain-ID>'` instead of the administrator client argument.

### 5. Complete the three missing GitHub settings

Open [Settings → Environments → always-free](https://github.com/eshneken/family-grocery-list/settings/environments). Confirm the permitted deployment branch is `codex/oci-always-free`. Add:

| Type | Name | Value |
|---|---|---|
| Environment variable | `OCI_WIF_CLIENT_ID` | Runtime OAuth client ID |
| Environment variable | `OCI_WIF_SERVICE_USER_OCID` | New service user's OCI OCID |
| Environment secret | `OCI_WIF_CLIENT_SECRET` | **Runtime** OAuth client secret |

The domain URL, audience, tenancy, compartment, and region are already set. Enter the runtime secret directly into GitHub or with `gh secret set OCI_WIF_CLIENT_SECRET --env always-free` using its interactive prompt. Do not paste either client secret into chat. No Google OAuth settings are needed at this checkpoint.

### 6. Verify federation

Tell Codex when steps 1–5 are complete; it can dispatch and inspect the verification. You can also run:

```bash
gh workflow run oci-wif-verify.yml --ref codex/oci-always-free
gh run list --workflow oci-wif-verify.yml --branch codex/oci-always-free --limit 1
```

Or select the existing federation verification workflow under Actions, **Run workflow**, and choose the migration branch. Default-branch UI may still display the old workflow name; select the file `oci-wif-verify.yml`.

Pass criteria: summary **Always-free OCI federation verification passed**, target `EDFREETIER / grocery / us-ashburn-1`, namespace `iddiywf0v4j6`, and green verification job. This proves token exchange and read-only namespace access; it does not yet prove Terraform write permissions, Basic OKE access, free billing, or backup node identity.

After the verification passes, deactivate/delete the temporary administrator application. Keep the runtime application active. Record account status and successful workflow URL in this document; never record secret values.

## Federation verification record

- Initial [run 37396881112](https://github.com/eshneken/family-grocery-list/actions/runs/37396881112) failed HTTP 401, `unauthorized_client`: “User requesting is not a service user.” The supplied `grocery-github-deployer` account had no `serviceUser` flag. OCI rejected conversion because the flag is immutable.
- Created `grocery-github-service` with `serviceUser=true`, identity-domain ID `ed094f835ebf427fb32a38671d57027a`, OCI OCID `ocid1.user.oc1..aaaaaaaa3h3zbyyvhskidzw7jlptdqak6sx5vqtisepe2n2o4t4u72lkod5q`.
- Added the service user to `grocery-github-deployers`, replaced the existing trust's impersonation mapping, and updated the `always-free` GitHub variable `OCI_WIF_SERVICE_USER_OCID`. Removed the regular user from the deployment group; the regular account remains available for manual deletion.
- Bootstrap helper now rejects a regular user before requesting the administrator token. Seven helper tests pass. Initial branch application CI [run 37381389786](https://github.com/eshneken/family-grocery-list/actions/runs/37381389786) passed unit/coverage and browser checks.
- Retry [run 37397391548](https://github.com/eshneken/family-grocery-list/actions/runs/37397391548): **passed**. Token exchange succeeded, namespace matched `iddiywf0v4j6`, and the new-tenancy guard and verification record steps passed. No infrastructure or application was deployed. Terraform write permissions and backup instance-principal permissions remain for subsequent checkpoints.
- **Manual cleanup:** deactivate/delete `grocery-wif-bootstrap-admin`; keep `grocery-github-actions` active. The unused regular account `grocery-github-deployer` may be deleted manually; it has been removed from the deployment group.

## Following checkpoints

1. **Passed:** identity setup and federation verification; temporary administrator app cleanup pending.
2. **Infrastructure implementation/review:** target-bound bootstrap and Basic OKE Terraform; shared PVC/PostgreSQL; private networking and public API restrictions; backup instance-principal IAM; review plans before apply.
3. **Provision target:** verify one A1, IMDSv1 disabled at launch, version/image, eligible disk/LB allocation, Lens access; manually point rehearsal DNS and configure rehearsal Google OAuth.
4. **Rehearsal restore:** restore source data, prove app/auth/shopping, shared storage, backups and recovery.
5. **Cutover:** operator scheduling, frozen final transfer, manual GoDaddy production DNS update, production verification.
6. **Acceptance/retirement:** shopping run and rollback hold, approved old Terraform destruction, then merge and verify master against the new environment.

Use the [full design/runbook](oci-always-free-design.md) for the exact data-transfer, rollback, and destruction hold points. At checkpoint 2, use the staged infrastructure workflow in **plan** mode only after administrator bootstrap. An apply requires the full reviewed commit SHA and a passing plan guard.

## Checkpoint 2 implementation record

- Basic OKE, one 2-OCPU/12 GB ARM worker, explicit matching image/version, IMDSv1 disabled at launch; managed OCI PostgreSQL removed.
- Target-bound roots and isolated working copies/state; administrator backup tag/dynamic-group/policy is separate from compartment-scoped GitHub deployment.
- One shared retained 50 GiB claim, PostgreSQL TLS/role separation, Caddy subdirectories, fixed 10/10 Mbps TCP LB, daily encrypted backup/last-five retention (initially suspended).
- October 6 operator steering: leave public Kubernetes API open during build/travel, retain OCI IAM/RBAC/TLS. IP allowlisting is deferred. No operator CIDR is needed to proceed; optional Bastion is disabled.
- GitHub `always-free` stage plan/apply workflow and branch application deployment; restored environments require an explicit marker and never run household seeding. Old master remains untouched.
- Read-only administrator/bootstrap plans, CI/integration outcomes and next manual prerequisites are recorded as they complete. No cloud resources created at this checkpoint.

### October 6 review evidence

- Target-bound administrator plan: **4 create, 0 change, 0 destroy** (backup tag namespace/key, dynamic group, narrow policy).
- Target-bound bootstrap plan: **4 create, 0 change, 0 destroy** (state bucket, backup bucket, DEFAULT Vault, SOFTWARE key). Both passed the plan guard; neither was applied.
- All four Terraform roots validated in isolated source-only working directories; shell/YAML checks and 12 Python checks passed.
- [CI run 37507131234](https://github.com/eshneken/family-grocery-list/actions/runs/37507131234) passed actual pinned PostgreSQL TLS/role/dump/restore integration and backup-tool image build. Existing deployment scheduling mocks needed updating for the new backup/active-job checks; final application CI is being rerun after that correction.
- ACME contact set to `eshneken@gmail.com`; public backup recipient set to `age1gqkvgjanavu7usylugw39sqcdsf970k696c9y9e42jl0wmjvrp7sx5v08e`. The private recovery key was generated/stored by the operator and was never read by Codex or uploaded to OCI/GitHub.
- Reviewed initial ARM image and AD-1 recorded in GitHub variables; requery service options before actual provisioning. A1 physical capacity remains untested.
