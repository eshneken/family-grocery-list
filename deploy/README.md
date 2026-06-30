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

Set the Google OAuth authorized redirect URI to:

```text
https://<OCI_APP_HOSTNAME>/api/auth/callback/google
```

The initialization values are GitHub secrets because they may contain personal information. They are copied into a temporary Kubernetes Secret only when initialization is required, and that Secret is deleted after the bootstrap Job finishes.

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
