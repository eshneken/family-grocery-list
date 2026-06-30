# Application Deployment

The **Application CI and deployment** workflow in `.github/workflows/application.yml` is the delivery path for the Next.js application. Terraform owns OCI and the durable cluster foundation; this workflow owns the application image, database migration Jobs, initial household bootstrap, Deployment, and internal `grocery-app` Service.

## Branch And Test Flow

Every push to every branch runs two independent jobs:

- **Unit tests and coverage** starts PostgreSQL 16, applies migrations, runs linting and type checks, and enforces the repository's coverage floors.
- **Browser E2E tests** starts a separate PostgreSQL 16 service, applies migrations, and runs the mock-auth desktop/mobile journeys plus the production Google-auth shell test.

The databases are disposable GitHub service containers. No branch or test job receives OCI credentials or production secrets. Coverage reports are retained for 30 days, and failed Playwright diagnostics are retained for 14 days.

Only a successful `master` commit proceeds to image publication and production deployment. Configure `master` branch protection to require **Unit tests and coverage** and **Browser E2E tests** before merge.

## Production Environment Settings

The existing GitHub `production` environment supplies the OCI WIF values documented in `infra/README.md`. Add these application secrets:

| Secret | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Google OAuth web client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth web client secret |
| `NEXTAUTH_SECRET` | At least 32 random bytes used to sign sessions |
| `INITIAL_ADMIN_EMAIL` | Approved Google email for the first household administrator |
| `INITIAL_HOUSEHOLD_NAME` | Name assigned to the first production household |

Generate a session secret locally with:

```bash
openssl rand -base64 32
```

The initialization values are GitHub secrets because they may contain personal information. They are copied into a temporary Kubernetes Secret only when initialization is required, and that Secret is deleted after the bootstrap Job finishes.

## Production Google OAuth Setup

Use a dedicated production OAuth client. Do not reuse the local client or add the production callback to it; separating the clients keeps localhost credentials and production credentials independently rotatable.

Google Auth Platform settings have two scopes:

- **Branding**, **Audience**, and **Data Access** belong to the Google Cloud project and are shared by every OAuth client in that project.
- Client IDs, client secrets, authorized origins, and redirect URIs belong to an individual OAuth client.

The local and production clients represent the same application, so they can and normally should share the existing Google Cloud project. Create a second project only when the environments need different branding, audiences, data scopes, owners, or administrative boundaries.

1. Open the [Google Cloud console](https://console.cloud.google.com/) and select the project that already owns the local OAuth client.
2. Open **Google Auth Platform** > **Branding** and review the shared consent screen:
   - App name: `Family Grocery List`
   - User support email: an address you monitor
   - Authorized domain: `shnekendorf.com`
   - Developer contact email: an address you monitor
   - If publishing the app, add the public application home page and the policy URLs Google requires. Do not enter placeholder or login-protected URLs.

   Adding `shnekendorf.com` permits the project's clients to use that domain and its subdomains. It does not remove or invalidate the local client's `localhost` redirect; localhost is a special development exception and is not entered as an authorized domain.

3. Open **Audience** and select **External** for consumer Gmail accounts. If every intended user belongs to the same managed Google Workspace organization, **Internal** is also valid but blocks all accounts outside that organization.
4. The application requests only the standard `openid`, `email`, and `profile` sign-in scopes. Google exempts this scope set from Testing mode's test-user restriction, warning, and seven-day authorization expiration. For this personal deployment, leaving the shared project in **Testing** is acceptable. Publishing it is optional; if you choose **Publish app**, complete the branding, domain-ownership, and policy-page requirements shown by the console.
5. Open **Data Access** and confirm the configured scopes are limited to `openid`, the Google account email address, and basic profile information. Do not add Google API scopes that the application does not use.
6. Open **Clients**, choose **Create client**, and select **Web application**. Name it `Family Grocery List Production`.
7. Leave **Authorized JavaScript origins** empty. Auth.js performs this OAuth exchange on the server and does not use Google's browser JavaScript client.
8. Add this **Authorized redirect URI** exactly, with no trailing slash:

   ```text
   https://grocery.shnekendorf.com/api/auth/callback/google
   ```

   Google compares the scheme, hostname, port, path, case, and trailing slash exactly. Production redirect URIs must use HTTPS. Do not add `localhost`, an IP address, a wildcard, or a preview hostname to this client.
9. Create the client and immediately store its client ID and newly issued client secret in the GitHub `production` environment:

   - Repository **Settings** > **Environments** > **production** > **Environment secrets**
   - Replace `GOOGLE_CLIENT_ID` with the production web client ID.
   - Replace `GOOGLE_CLIENT_SECRET` with the matching production client secret.

   With GitHub CLI, run the following from the repository and enter each value only when prompted:

   ```bash
   gh secret set GOOGLE_CLIENT_ID --env production
   gh secret set GOOGLE_CLIENT_SECRET --env production
   ```

   Never commit the client secret or place it in a GitHub variable. GitHub does not expose an existing secret value, so updating these names safely replaces the prior local-client credentials.
10. Confirm `INITIAL_ADMIN_EMAIL` in the same GitHub environment is the exact Gmail address that will sign in. The application's database allowlist remains the authorization boundary even though Google's basic sign-in scopes do not require the account to be listed as an OAuth test user.

Before starting or rerunning a production deployment, verify DNS and TLS reach Caddy rather than a localhost service:

```bash
curl --show-error --head https://grocery.shnekendorf.com/
```

Before the first application deployment, an HTTP `502` with `server: Caddy` is expected because Caddy has no application upstream yet. A DNS error, certificate error, or response from an unrelated server is not expected.

After deployment, open `https://grocery.shnekendorf.com`, select **Sign in with Google**, and complete one login with `INITIAL_ADMIN_EMAIL`. A `redirect_uri_mismatch` response means the URI in step 8 or the deployed client ID does not match. An `org_internal` response means the project is restricted to a Google Workspace organization that does not contain the signing-in account.

Google's [web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server) documents exact redirect URI matching, and [Manage App Audience](https://support.google.com/cloud/answer/15549945) describes Testing and In production behavior.

## GHCR Publication

The workflow publishes `ghcr.io/<owner>/<repository>:<git-sha>` with the repository `GITHUB_TOKEN`, produces both ARM64 and AMD64 images, records build provenance, and deploys the manifest-list digest.

OKE pulls the image anonymously so the cluster does not retain a long-lived GitHub token. The first package version is private by default. On the first `master` run:

1. Let the image publication finish. The anonymous-access check will stop deployment while the package remains private.
2. Open the package on GitHub, choose **Package settings**, change its visibility to **Public**, and confirm the change.
3. Rerun the failed workflow. The digest will be rebuilt or reused, anonymous access will pass, and deployment will continue.

Do not replace this with a short-lived workflow token stored as an OKE image-pull Secret; pods must remain pullable after the workflow token expires or a node restarts.

## Initial Deployment

The first successful deployment runs in this order:

1. Create or update the `grocery-app-config` Secret containing Google OAuth and session settings.
2. Run `npm run db:migrate:deploy` in the `grocery-migrate` OKE Job.
3. Confirm that the `grocery-bootstrap-state` ConfigMap does not exist.
4. Run `npm run db:bootstrap` with `INITIAL_ADMIN_EMAIL` and `INITIAL_HOUSEHOLD_NAME` in the `grocery-bootstrap` Job.
5. Create `grocery-bootstrap-state` only after the bootstrap succeeds.
6. Apply the digest-pinned Deployment and `grocery-app` Service.
7. Wait for Kubernetes readiness and call the public `/api/health/ready` endpoint through Caddy.

The production bootstrap is non-destructive. It creates the household, initial Google-backed administrator membership, default stores, and first collecting list. An identical rerun is a no-op; conflicting existing data fails closed.

Inspect the marker with:

```bash
kubectl --kubeconfig "$HOME/.kube/family-grocery" \
  --namespace grocery get configmap grocery-bootstrap-state --output=yaml
```

Do not create the marker manually. If PostgreSQL is deliberately replaced while the Kubernetes namespace survives, delete the stale marker only after confirming the new database is empty so the next deployment can initialize it.

## Routine Deployment

For every later `master` commit, the workflow:

1. Publishes and attests the immutable image.
2. Applies pending Prisma migrations through the in-cluster migration Job.
3. Detects `grocery-bootstrap-state` and skips all initialization.
4. Applies the Deployment with the new digest.
5. Waits for readiness and performs an HTTPS smoke test.

Migrations must follow expand/contract compatibility. A failed application rollout restores the previous image, but a successful database migration is not rolled back automatically. Destructive schema removal belongs in a later release after old application versions can no longer reference it.

## Local Validation

Run the same core checks before pushing:

```bash
docker compose up -d postgres
npm ci
npm run db:generate
npm run db:migrate:deploy
npm run lint
npm run typecheck
npm run test:coverage
npm run e2e
npm run e2e:google-shell
docker build --tag family-grocery:local .
```

The deployment resources can be rendered without a cluster:

```bash
kubectl kustomize deploy/k8s/migration
kubectl kustomize deploy/k8s/bootstrap
kubectl kustomize deploy/k8s/application
bash -n scripts/deploy-application.sh
```

Production uses `/api/health/live` for process liveness and `/api/health/ready` for PostgreSQL-aware readiness. Neither endpoint returns credentials or database error details.
