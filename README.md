# Family Grocery List

Family Grocery List is a responsive web app for collecting, organizing, shopping, and reviewing a household grocery list. It is built for a shared family workflow where requestors add items, shoppers run store-specific trips, and admins manage household access and store configuration.

Production authentication federates with Google and authorizes only active household memberships whose stored Gmail address matches Google's verified email claim. Local development and E2E can explicitly enable the retained mock provider.

## What It Does

- Maintains one household grocery workflow.
- Lets approved household members add requests to a shared collecting list.
- Supports mock user switching between family members during local development.
- Lets admins add, edit, enable, and disable household members.
- Lets admins assign per-member capabilities: request, shop, and administer.
- Lets admins add and enable/disable stores.
- Lets requestors tag items for a specific store or leave them available at any store.
- Categorizes requests into grocery sections such as Produce, Dairy, Meat/Deli, Pantry, Frozen, Household, Bakery, and Other.
- Lets requestors correct an item's category and mark it as a recurring staple.
- Prevents duplicate pending items in a case-insensitive way.
- Locks the current list when a shopping run starts and opens a new collecting list for later requests.
- Allows one active shopper at a time.
- Filters the shopping view to the selected store plus any-store items.
- Lets shoppers mark items purchased, substituted, or rejected.
- Carries unresolved pending items forward when a shopping run is completed.
- Keeps completed shopping history in expandable runs.
- Generates common suggestions from the last 10 completed runs, weighted toward recent trips.

## Tech Stack

- Next.js App Router
- React
- TypeScript
- Prisma
- PostgreSQL
- Vitest for unit/service tests
- Playwright for browser E2E tests
- Docker Compose for the local PostgreSQL database

## Project Layout

- `src/app/` - Next.js routes and server actions.
- `src/components/` - Shared UI components.
- `src/features/auth/` - Google/mock identity providers and stored-membership authorization.
- `src/features/household/` - Household, member, and store services.
- `src/features/parser/` - Grocery request parsing and category inference.
- `src/features/shopping/` - List, trip, history, outcome, and suggestion services.
- `src/test/` - Test factories and fixtures.
- `e2e/` - Playwright browser tests.
- `prisma/` - Prisma schema, migrations, and seed data.
- `infra/` - Terraform for OCI bootstrap resources, the production environment, and the OKE cluster foundation.
- `deploy/` - Kubernetes application, migration, and one-time production-bootstrap resources.

## Development Workflow

All application, infrastructure, and documentation changes use a branch and pull request. Do not commit or push directly to `master`, including from Codex threads.

1. Update local `master`, then create a focused branch. Codex-created branches use the `codex/` prefix:

```bash
git switch master
git pull --ff-only
git switch -c codex/<short-change-name>
```

2. Make the change and run the checks appropriate to it. Application changes should run the complete local quality suite before opening a pull request:

```bash
npm ci
npm run db:generate
npm run lint
npm run typecheck
npm run test:coverage
npm run e2e
npm run e2e:google-shell
```

Terraform changes should additionally run `terraform fmt -check` and `terraform validate` in every affected Terraform root. Documentation-only changes may omit application tests when they cannot affect executable behavior.

3. Commit the focused change, push the branch, and open a pull request targeting `master`:

```bash
git add <changed-files>
git commit -m "<type>: <summary>"
git push -u origin HEAD
gh pr create --base master --fill
```

4. Wait for the required **Unit tests and coverage** and **Browser E2E tests** checks. Resolve any review conversations, review the diff, and merge the pull request only after both checks pass. Delete the feature branch after merge.

The unit job runs linting, type checks, migrations, and Vitest with enforced minimum coverage of 93.5% statements, 89.5% branches, 93.5% functions, and 94.5% lines. The browser job runs the mock-auth journeys and production Google-auth shell journey against disposable PostgreSQL. GitHub protects `master`, applies these requirements to administrators, blocks direct pushes and force pushes, and requires changes to arrive through a pull request. A second-person approval is not required because this is currently a single-owner repository.

Every non-`master` branch push runs CI without production credentials. GitHub records those required results on the pull request. Because protected `master` accepts only up-to-date pull requests with both checks passing, the merge commit does not rerun the suites; it proceeds directly to the production build and deployment. Infrastructure changes require a separate manual **OCI infrastructure** deployment after merge, as described below.

## Production Infrastructure

Production runs in OCI and is managed by the manual **OCI infrastructure** GitHub Actions workflow. Terraform is split into three ordered roots:

1. `infra/bootstrap` creates the versioned Object Storage state bucket plus the Vault and software key used for application secrets.
2. `infra/production` creates networking, OKE with an A1 ARM worker, private PostgreSQL, Bastion, DNS, and the reserved public IP.
3. `infra/cluster-foundation` creates the Kubernetes namespace, database connection material, Caddy, its persistent certificate volume, and the public OCI load balancer.

To add or update OCI infrastructure:

1. Change the appropriate Terraform root on a branch.
2. Run `terraform fmt -check` and `terraform validate` locally for every affected root.
3. Open and review a pull request. Terraform changes do not deploy from pull requests.
4. Merge to `master`.
5. In GitHub Actions, run **OCI infrastructure** with operation `deploy`.
6. Review all three jobs. The workflow always applies the roots in dependency order and passes bootstrap/OKE outputs between them.

The `deploy` operation is idempotent and is also the normal path for later updates, such as adding an OCI service. Do not use `destroy` to roll out changes or recover from an apply failure; fix the configuration and rerun `deploy`.

Destroy is intentionally difficult to trigger. It requires selecting `destroy`, typing `DESTROY`, and approving the protected `production-destroy-approval` environment. A successful destroy permanently removes PostgreSQL data, the Caddy volume/certificate cache, OKE, networking, and the Terraform state bucket.

See [infra/README.md](infra/README.md) for variables, IAM/WIF policy, state handling, detailed update steps, verification, and disaster warnings.

## Application Delivery

Every commit pushed to a non-`master` branch runs the **Application CI** workflow. Unit tests, linting, type checks, coverage, and browser E2E tests use an ephemeral PostgreSQL service on the GitHub runner; they never connect to production. Coverage HTML and JSON reports are retained as workflow artifacts.

Successful commits on feature branches stop after CI. Branch protection requires those results before merge. A merged commit on `master` starts the separate **Application production deployment** workflow, which:

1. Builds and attests `linux/amd64` and `linux/arm64` images in GHCR.
2. Selects the immutable image digest rather than a mutable tag.
3. Runs checked-in Prisma migrations from an OKE Job against private PostgreSQL.
4. On the first release only, creates the household and initial administrator through the idempotent bootstrap Job.
5. Rolls out the application, waits for database-aware readiness, and tests the public HTTPS endpoint.

Later releases retain production data, skip bootstrap, apply only pending migrations, and deploy the new image. Failed migrations stop before rollout. Failed readiness or smoke tests restore the previous application image; database migrations are never automatically reversed.

See [deploy/README.md](deploy/README.md) for required GitHub secrets, the one-time GHCR visibility step, initialization behavior, and operating procedures.

## Administrative Tasks

Production PostgreSQL has no public endpoint. To inspect or administer it with local pgAdmin, create a time-limited OCI Bastion port-forwarding session, retrieve the administrator password from OCI Vault, and require TLS for the database connection. Follow [Connect Local pgAdmin To Production PostgreSQL](infra/README.md#connect-local-pgadmin-to-production-postgresql) for the complete procedure and cleanup steps.

## Prerequisites

Install these before running the app locally:

- Node.js and npm
- Docker Desktop, or another Docker-compatible runtime

The app expects PostgreSQL to be available through Docker Compose on port `5432`.

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create your local environment file:

```bash
cp .env.example .env
```

3. Start PostgreSQL:

```bash
docker compose up -d postgres
```

4. Apply database migrations:

```bash
npm run db:migrate
```

5. Seed local development data:

```bash
npm run db:seed
```

6. Start the development server in local mock mode:

```bash
npm run dev -- --mock-auth
```

7. Open the app:

```text
http://localhost:3000
```

The dev server is configured to bind to `0.0.0.0`, so mock mode can also be tested from another device on your network. Real Google login over plain HTTP should use `http://localhost:3000`; Google's localhost exception does not apply to arbitrary LAN addresses.

To sign in with a real Google account locally, complete [Local Google Authentication Setup](#local-google-authentication-setup) after this initial setup.

## Seeded Local Data

The seed script creates a `Smith Family` household with these mock users:

- `ed@example.com` - request, shop, administer
- `gina@example.com` - request, shop, administer
- `ayelet@example.com` - request
- `wolf@example.com` - request

It also creates these default stores:

- Giant
- Whole Foods
- Trader Joe's

Seeded grocery data includes recurring staples and store-specific examples such as bananas, milk, Makoto Ginger Salad Dressing, peanut butter, and deli turkey.

## Mock Authentication

Mock authentication is enabled only by the local command-line flag:

```bash
npm run dev -- --mock-auth
```

The current mock user comes from this priority order:

1. The `mock_current_user` cookie.
2. `MOCK_CURRENT_USER_EMAIL` in `.env`.
3. The first built-in mock user.

Use the mock user switcher in the app header to switch users. Unknown cookie/action values cannot create arbitrary users. After switching users, the app returns to the shopping list page so local testing does not leave a non-admin user stranded on an admin-only route.

Mock mode is rejected when `APP_ENV=production`. It is never a production fallback.

## Google Authentication

Running without `--mock-auth` selects Google by default. The Google account proves a person's identity, but the app authorizes that identity only when its Gmail address is an active household membership. Google sign-in alone does not grant access.

### Local Google Authentication Setup

You can develop and test Google sign-in on `localhost` without TLS or a certificate. Use `http://localhost:3000` exactly. Do not substitute `127.0.0.1`, a LAN IP address, or a trailing slash: Google compares the redirect URL exactly.

1. Complete [Local Setup](#local-setup) first. It creates the local database and starts the PostgreSQL container.

2. Add the Gmail address you will use with Google to the local household allowlist. Start the app in mock mode:

```bash
npm run dev -- --mock-auth
```

Open `http://localhost:3000`, use the mock user switcher to select an administrator such as `gina@example.com`, then open **Admin** and add your real Gmail address as an active member. Give it the capabilities you want to exercise (normally Request, Shop, and Admin for the first local account). Stop the server when finished.

3. In the [Google Cloud console](https://console.cloud.google.com/), create a separate project for local development if you do not already have one. In **Google Auth Platform**, set up the OAuth consent screen:

   - Choose an external audience for personal Gmail accounts.
   - Leave the app in **Testing**. You do not need to publish it for local development.
   - On the Audience page, add the Gmail address from step 2 as a test user. Add any second Gmail address you want to use for a denial test as a test user too.

4. Create the OAuth client. In **Google Auth Platform** > **Clients**, create a client with application type **Web application**. Under **Authorized redirect URIs**, add exactly:

```text
http://localhost:3000/api/auth/callback/google
```

Copy the displayed client ID and client secret. Keep the secret private; do not commit it or paste it into chat.

5. Configure `.env`. If it does not yet exist, create it from the safe template with `cp .env.example .env`. Fill in the values you copied and generate a session secret:

```bash
openssl rand -base64 32
```

Then set the result as `NEXTAUTH_SECRET`:

```bash
APP_ENV="development"
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-client-secret"
NEXTAUTH_SECRET="the-random-value-from-openssl"
NEXTAUTH_URL="http://localhost:3000"
```

6. Start the app without the mock flag:

```bash
npm run dev
```

The launcher reads `.env` before checking the required Google settings. Open `http://localhost:3000`, select **Sign in with Google**, and choose the Gmail account added in step 2. A successful login opens the grocery list.

7. Test the authorization boundary. Sign out, then sign in with the second Google test user from step 3 that you did **not** add through the app's Admin page. Google may authenticate that account, but the app must show an access-denied result and must not grant a session.

Google must return a verified email that exactly matches an active `Membership.approvedEmail`; case and surrounding whitespace normalize, but Gmail dots and `+suffix` aliases remain distinct.

### Local Google Troubleshooting

| Symptom | What to check |
| --- | --- |
| `Google authentication requires: ...` when running `npm run dev` | Confirm the values are in `.env` at the repository root, not a differently named file. Stop and restart the server after changing `.env`. |
| Google says `redirect_uri_mismatch` | The Google client must contain exactly `http://localhost:3000/api/auth/callback/google`, including `localhost`, port `3000`, path, and no trailing slash. |
| Google blocks the account because the app is in testing | Add that Gmail address under the consent screen's **Audience** test users, then try again. |
| Google sign-in completes but the app denies access | In mock mode, add that exact Gmail address as an active local member. Gmail dot and `+suffix` variants are different app identities. |
| The wrong Google account is selected | Choose **Use another account** in Google’s account chooser, or use a private/incognito browser window. |

Production uses a separate Google OAuth web client and the HTTPS callback for `grocery.shnekendorf.com`; do not reuse the localhost client. Follow [Production Google OAuth Setup](deploy/README.md#production-google-oauth-setup) before the first application deployment or whenever rotating the production client secret.

For local HTTP, the session cookie is still `HttpOnly` and `SameSite=Lax`, but it is not marked `Secure`; that is expected because `Secure` cookies require HTTPS. Production uses HTTPS and therefore secure cookies.

## Running The App

For local mock development:

```bash
npm run dev -- --mock-auth
```

For local Google development, configure the Google variables above and run `npm run dev` without the flag.

For a production-style local mock run used by E2E:

```bash
npm run build
APP_ENV=test npm run start -- --mock-auth
```

`npm start` defaults to `APP_ENV=production` and Google auth. The `start` script also binds to `0.0.0.0`.

## Database Commands

Generate the Prisma client:

```bash
npm run db:generate
```

Create or apply local migrations:

```bash
npm run db:migrate
```

Seed the database:

```bash
npm run db:seed
```

Reset the local database and reseed from scratch:

```bash
npx prisma migrate reset --force
npm run db:seed
```

The seed script deletes existing app data before inserting the local fixture household.

For the first production household, run the non-destructive bootstrap after migrations:

```bash
npm run db:bootstrap -- --admin-email family-admin@gmail.com --household-name "Shneken Family"
```

An identical rerun is a no-op. A conflicting administrator or household fails without changing data.

## Testing

Run TypeScript checks:

```bash
npm run typecheck
```

Run unit and service tests:

```bash
npm test
```

Run unit and service tests with coverage:

```bash
npm run test:coverage
```

Run Playwright E2E tests:

```bash
npm run e2e
```

Run the production-default Google login shell test without contacting Google's hosted UI:

```bash
npm run e2e:google-shell
```

The E2E test runner:

- Builds the Next.js app.
- Starts a production Next server on `http://127.0.0.1:3100`.
- Enables mock auth explicitly with `APP_ENV=test` and `--mock-auth`.
- Runs tests serially against Desktop Chrome and Mobile Safari profiles.
- Resets and seeds the E2E database before each test.

Because the E2E tests reset the database, do not run them against data you care about.

## Test Coverage Areas

Unit and service tests cover:

- Request parsing and category inference.
- Member approval, updates, status changes, and store configuration.
- Google verified-email allowlisting, disabled memberships, auth modes, and bootstrap conflicts.
- Duplicate request prevention.
- Category correction and recurring staple learning.
- Recurring staple seeding.
- Shopping trip start, locking, and single-active-shopper behavior.
- Store-filtered shopper views.
- Purchased, substituted, rejected, and carried-forward outcomes.
- Completed shopping history.
- Common and catalog suggestions.

E2E tests cover:

- Opening the requestor list.
- Switching mock users.
- Rejecting unknown mock-user cookies.
- Adding an item and updating category/recurring status.
- Starting a shopping run.
- Purchasing an item.
- Completing a run.
- Viewing completed history.
- Desktop and mobile browser profiles.

## Useful Scripts

```bash
npm run dev
npm run build
npm run start
npm run typecheck
npm test
npm run test:coverage
npm run test:watch
npm run e2e
npm run e2e:google-shell
npm run db:generate
npm run db:migrate
npm run db:seed
npm run db:bootstrap -- --admin-email <email> --household-name <name>
```

## Git Hygiene

The repository ignores local and generated files such as:

- `.env` and other local env files
- `node_modules/`
- `.next/`
- `coverage/`
- `playwright-report/`
- `test-results/`
- local database files
- logs
- editor and OS metadata
- common private key, certificate, credential, and service-account files

Keep real credentials, tokens, client secrets, private keys, and production database URLs out of git. Use `.env.example` only for safe local examples and placeholder values.
