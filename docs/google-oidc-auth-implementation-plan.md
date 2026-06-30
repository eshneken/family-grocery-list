# Google OIDC Authentication Implementation Plan

Status: implemented on `codex/google-oidc-auth`; real Google-account smoke test remains before merge
Target: Next.js 15 App Router, NextAuth.js 4.24.14, Prisma/PostgreSQL
Scope: replace production mock identity with Google OIDC while preserving explicit local mock mode

## Outcome

Production starts in Google mode by default. A user receives a session only when Google returns a verified email address that exactly matches an active `Membership.approvedEmail`. The app continues to authorize every protected operation from the stored membership and capability list, not from Google claims.

Local development and all browser E2E tests can start the existing mock provider explicitly:

```bash
npm run dev -- --mock-auth
APP_ENV=test PORT=3100 npm run start -- --mock-auth
```

`npm start` defaults to Google mode. `APP_ENV=production npm start -- --mock-auth` must exit before starting Next.js.

## Settled Decisions

1. Pin stable `next-auth@4.24.14`; do not use the v5 beta or add an auth adapter.
2. Use encrypted JWT sessions with a seven-day maximum age. Keep Google's stable `sub` claim inside the encrypted session; do not persist it in the application database.
3. Continue identifying and authorizing application records by normalized, verified Gmail address.
4. Require an active email allowlist match both during Google sign-in and during every protected request/action.
5. Use layered protection: NextAuth middleware redirects unauthenticated requests, while `requireMembership()` and `requireCapability()` remain the authoritative data-boundary checks.
6. Enable mock mode only through the local CLI flag. Production rejects mock mode even if the flag or environment is supplied.
7. Add a separate, idempotent production bootstrap command for the first household administrator. Do not bootstrap production data during a web request.
8. Test application-owned Google policy deterministically; do not automate Google's login UI in CI.

## What Already Exists

| Existing code | Reuse | Required change |
|---|---|---|
| `src/features/auth/authorization.ts` | Keep as the authoritative membership/capability boundary | Replace its direct import of `mock-auth.ts` with provider-neutral identity resolution; add typed authentication/authorization errors |
| `Membership.approvedEmail`, `status`, and `capabilities` | Keep unchanged as the allowlist and authorization source | Normalize with one shared helper and recheck on every protected operation |
| `User.authProvider` with `mock` and `google` enum values | Reuse; no schema migration | Set to `google` only after an approved Google sign-in, and to `mock` only in mock mode |
| `src/features/auth/mock-auth.ts` and `MockUserSwitcher` | Preserve for local development and E2E | Hide and disable them outside mock mode; validate all selected mock emails |
| `/unauthorized` page | Reuse for verified but unapproved/disabled identities | Add a clear retry-with-another-account/sign-out action and keep it distinct from `/login` |
| Playwright full user journeys | Preserve | Start the test server with `APP_ENV=test ... --mock-auth` |
| OCI deployment plan | Reuse its Google release gate | Update v5-style secret names to the selected NextAuth.js v4 names and add bootstrap/default-mode checks |

The existing implementation already separates identity from capabilities reasonably well. This change should replace the identity source, not redesign shopping or household authorization.

## Authentication and Authorization Flow

OIDC (OpenID Connect) is the identity layer on top of OAuth that lets the app verify who Google authenticated.

```text
PROCESS START
    |
    +-- `--mock-auth` present?
    |      |
    |      +-- yes + APP_ENV=production --> EXIT NONZERO
    |      |
    |      +-- yes + development/test ----> AUTH_MODE=mock
    |      |
    |      +-- no ------------------------> AUTH_MODE=google (default)
    |
    +-- Google mode validates required runtime configuration before serving


GOOGLE SIGN-IN
Browser -> /login -> NextAuth Google provider -> Google callback
                                                   |
                                                   v
                                      signed OIDC profile from Google
                                                   |
                          +------------------------+------------------------+
                          |                                                 |
                  email_verified !== true                         verified email
                          |                                                 |
                    deny session                                  normalize email
                                                                            |
                                                     active Membership.approvedEmail?
                                                       |                  |
                                                      no                 yes
                                                       |                  |
                                                deny session       update/link approved
                                                no User write       User profile/provider
                                                                          |
                                                                  issue 7-day JWT session


PROTECTED REQUEST OR SERVER ACTION
Request -> middleware checks encrypted JWT -> provider-neutral identity
                                                     |
                                                     v
                                      requireMembership(email)
                                                     |
                           active stored membership + linked user?
                                      |                         |
                                     no                        yes
                                      |                         |
                              authorization denial      requireCapability(...)
                                                                |
                                                        application operation
```

The Google callback is an early denial gate, not the final authorization check. A household administrator can disable a membership while a JWT is still valid; the next protected request must deny access immediately because it rereads the membership.

## Identity Rules

- Request only the standard `openid`, `email`, and `profile` scopes. Do not request offline access or store Google access/refresh tokens.
- Accept only `account.provider === "google"`, `profile.email_verified === true`, and a syntactically valid profile email.
- Normalize email with `trim().toLowerCase()` in one shared helper.
- Do not remove dots, strip `+suffix` values, or otherwise apply Gmail-specific alias rewriting. Authorization is against the exact stored address after case/whitespace normalization.
- Query `Membership` for the normalized email with `status: "active"` before creating or updating a user.
- For an approved sign-in, update the linked user's display name/image and `authProvider: "google"` without overwriting administrator-managed first/last names.
- If an approved legacy membership has no `userId`, create/link the user within the approved path. An unapproved email must never create a `User` row.
- Keep the provider subject inside the encrypted NextAuth JWT. Never expose it to the browser because the application does not need it.
- Preserve NextAuth's same-origin redirect behavior. Do not add a permissive custom redirect callback.

Google documents that email can change and recommends `sub` as the provider identity key. This design deliberately uses `sub` for the live Google session but rechecks the current verified email because the product requirement makes the stored Gmail address the authorization key.

## Runtime Mode and Configuration

### CLI wrapper

Add `scripts/run-next.mjs` and route `npm run dev`/`npm start` through it.

The wrapper must:

1. Parse and remove only the custom `--mock-auth` flag before forwarding arguments to the Next.js CLI.
2. Default `APP_ENV` to `development` for `dev` and `production` for `start`; preserve an explicit `APP_ENV=test` for E2E.
3. Set `AUTH_MODE=mock` only when the flag is present; otherwise set `AUTH_MODE=google`.
4. Reject mock mode when `APP_ENV=production`, including an externally supplied `AUTH_MODE=mock`.
5. In Google mode, fail before spawning Next.js if required runtime variables are absent.
6. Forward exit codes and signals to the child Next.js process.

Do not treat `NODE_ENV` as the authorization for mock mode because Playwright intentionally runs a production build under `next start`. `APP_ENV=test` is the explicit local-test escape hatch.

### Environment contract

| Variable | Development mock | Development Google | Production |
|---|---:|---:|---:|
| `DATABASE_URL` | required | required | required |
| `APP_ENV` | defaults `development` | defaults `development` | required/defaulted `production` |
| `AUTH_MODE` | set internally by wrapper | set internally by wrapper | must resolve to `google` |
| `GOOGLE_CLIENT_ID` | not required | required | required secret |
| `GOOGLE_CLIENT_SECRET` | not required | required | required secret |
| `NEXTAUTH_SECRET` | not required | required | required secret |
| `NEXTAUTH_URL` | not required | `http://localhost:3000` | `https://<app-hostname>` |
| `MOCK_CURRENT_USER_EMAIL` | optional | ignored | forbidden/ignored |

Generate `NEXTAUTH_SECRET` from at least 32 random bytes. Let NextAuth own its cookie names and defaults rather than overriding advanced cookie options. HTTPS production URLs cause secure cookies; verify `HttpOnly`, `Secure`, and `SameSite=Lax` in the release smoke test.

## Implementation Sequence

### 1. Pin the dependency and add runtime-mode parsing

Files:

- `package.json`, `package-lock.json`
- `scripts/run-next.mjs` (new)
- `src/features/auth/mode.ts` (new)
- `src/features/auth/mode.test.ts` (new)
- `.env.example`

Actions:

- Install exact `next-auth@4.24.14`.
- Add `resolveAuthMode()` and configuration validation with explicit `mock | google` output.
- Update `dev` and `start` scripts to use the wrapper without changing existing host/port behavior.
- Unit-test default Google mode, explicit mock mode, production rejection, E2E allowance, unknown arguments, missing Google configuration, and child argument forwarding.
- Keep configuration checks callable without spawning a server so tests remain deterministic.

Exit criteria:

- `npm run dev -- --mock-auth` launches mock mode.
- `APP_ENV=production npm run start -- --mock-auth` exits nonzero with a clear message.
- No flag means Google mode in both development and production.

### 2. Centralize email normalization and define provider-neutral identity

Files:

- `src/features/auth/email.ts` (new)
- `src/features/auth/email.test.ts` (new)
- `src/features/auth/types.ts`
- `src/features/household/household.service.ts`
- `src/features/household/household.service.test.ts`
- `src/app/actions.ts`

Actions:

- Move `normalizeEmail()` out of the household service.
- Add an `AuthenticatedIdentity` type containing normalized email, display/profile fields, and `provider` without pretending a provider ID is the Prisma `User.id`.
- Use the helper in member approval/update, membership lookup, Google callbacks, mock-cookie handling, and mock user selection.
- Add table-driven cases for whitespace/case normalization and non-normalization of dots/plus aliases.

Exit criteria:

- Every security-relevant email comparison imports the same helper.
- Existing household tests pass after their import changes.

### 3. Configure NextAuth.js v4 and Google sign-in policy

Files:

- `src/features/auth/google-auth.ts` (new)
- `src/features/auth/google-auth.test.ts` (new)
- `src/app/api/auth/[...nextauth]/route.ts` (new)

Actions:

- Export one `authOptions` object and `getGoogleSession()` wrapper around `getServerSession(authOptions)`.
- Configure `GoogleProvider`, `session: { strategy: "jwt", maxAge: 604800 }`, `NEXTAUTH_SECRET`, and custom `/login` and `/unauthorized` pages.
- Keep provider configuration build-safe: `next build` must not require runtime secrets, while the startup wrapper rejects missing secrets before serving Google mode.
- Implement an exported, testable Google profile policy used by the `signIn` callback.
- In the callback, verify `email_verified`, normalize the email, find an active membership, then update/link only that approved user. Return `/unauthorized` for denial so the callback cancels the authentication flow.
- Do not add an adapter, Account/Session tables, access-token storage, or custom JWT encoding.

Exit criteria:

- Approved verified profile returns `true` and updates only the linked approved user.
- Unverified, malformed, unknown, and disabled profiles cancel sign-in and leave `User` unchanged.
- The route exports App Router `GET` and `POST` handlers.

### 4. Make identity resolution provider-neutral and tighten error handling

Files:

- `src/features/auth/identity.ts` (new)
- `src/features/auth/mock-auth.ts`
- `src/features/auth/authorization.ts`
- `src/features/auth/authorization.test.ts` (new)
- `src/app/list/page.tsx`
- `src/app/shop/page.tsx`
- `src/app/history/page.tsx`
- `src/app/admin/page.tsx`
- `src/app/actions.ts`

Actions:

- Have `identity.ts` select Google or mock identity from `resolveAuthMode()`.
- Keep the mock user fixtures, cookie priority, and local database materialization, but validate cookie/action values against the fixture list.
- Split `AuthenticationRequiredError`, `MembershipAuthorizationError`, and `CapabilityAuthorizationError` from unexpected operational errors.
- Keep `requireMembership()` as the active membership lookup on every request. It must not trust capabilities embedded in the JWT.
- Replace blanket page catches with narrow typed catches. Missing authentication redirects to `/login`; membership/capability denial redirects to `/unauthorized`; database and programming errors are rethrown.
- Ensure every server action still calls `requireCapability()` after session expiry or membership disablement.

Exit criteria:

- A disabled membership loses access on its next request even with a valid JWT.
- Database failures reach normal error handling/logging rather than appearing as authorization denials.
- Google mode never reads or writes `mock_current_user`.

### 5. Add layered route protection and mode-aware auth UI

Files:

- `src/middleware.ts` (new)
- `src/app/login/page.tsx` (new)
- `src/components/auth-controls.tsx` (new)
- `src/components/app-shell.tsx`
- `src/components/mock-user-switcher.tsx`
- `src/app/unauthorized/page.tsx`
- `src/app/globals.css`

Actions:

- In Google mode, middleware uses the same `NEXTAUTH_SECRET` to require a JWT for `/list`, `/shop`, `/history`, and `/admin`; leave `/login`, `/unauthorized`, static assets, and `/api/auth/*` public.
- In mock mode, middleware passes through without requiring a NextAuth token.
- Add a Google sign-in button using `signIn("google", { callbackUrl: "/list" })` and sign-out using `signOut({ callbackUrl: "/login" })`.
- Render `MockUserSwitcher` only in mock mode. Render signed-in Google profile/sign-out controls only in Google mode.
- If no membership is available, render public/error content without the authenticated navigation shell.
- Remove the unconditional request-time `ensureSeedHousehold()` call from `AppShell`. Automatic fixture creation is allowed only in mock mode.
- Give `/unauthorized` a recovery action that supports both a denied callback and a later-disabled active session.

Exit criteria:

- Unauthenticated Google-mode navigation lands on `/login`.
- Approved login lands on `/list`; denied login creates no app session.
- Mock UI and cookie routes are absent/unusable in Google mode.

### 6. Add an idempotent production bootstrap command

Files:

- `src/features/household/bootstrap.service.ts` (new)
- `src/features/household/bootstrap.service.test.ts` (new)
- `prisma/bootstrap.ts` (new)
- `package.json`

Command:

```bash
npm run db:bootstrap -- \
  --admin-email family-admin@gmail.com \
  --household-name "Smith Family"
```

Behavior:

1. Validate and normalize arguments.
2. In one transaction, create the first household, administrator user, active membership with all capabilities, default stores, and collecting list only when the database has no household.
3. On rerun, succeed only when the named household and same active administrator membership already exist with administrator capability.
4. If a household exists but the supplied email is different or lacks administrator access, exit nonzero. Never silently promote a new administrator.
5. Never delete existing data and never insert mock fixture grocery data.

Exit criteria:

- First run creates exactly one usable household/admin.
- Identical rerun is a no-op.
- Conflicting rerun fails without mutation.

### 7. Complete unit, integration, E2E, and release coverage

Files:

- `playwright.config.ts`
- `e2e/app-shell.spec.ts`
- `e2e/auth.spec.ts` (new)
- Auth and bootstrap test files listed above

Target coverage map:

```text
CODE PATHS                                              USER FLOWS
[+] runtime mode                                        [+] Google default mode
  +-- [UNIT] default -> google                            +-- [BROWSER] protected route -> /login
  +-- [UNIT] explicit local/test flag -> mock             +-- [BROWSER] login button starts Google flow
  +-- [UNIT] production + mock -> startup failure         +-- [MANUAL] approved Gmail -> /list
  +-- [UNIT] missing Google config -> startup failure     +-- [MANUAL] unapproved Gmail -> denial

[+] Google sign-in policy                               [+] Mock local mode
  +-- [UNIT+DB] verified + active -> allow/update         +-- [E2E] switch known mock user
  +-- [UNIT+DB] unverified -> deny/no write               +-- [E2E] reject unknown switch value
  +-- [UNIT+DB] unknown -> deny/no write                  +-- [E2E] existing list/shop/admin journeys
  +-- [UNIT+DB] disabled -> deny/no write
  +-- [UNIT+DB] approved membership without user -> link [+] Session lifecycle
                                                           +-- [UNIT] expired/missing -> authentication error
[+] authorization                                         +-- [UNIT+DB] disabled after login -> immediate denial
  +-- [UNIT+DB] active membership -> allow                 +-- [BROWSER] sign out -> /login
  +-- [UNIT+DB] missing capability -> deny
  +-- [UNIT+DB] DB error -> rethrow

[+] bootstrap
  +-- [UNIT+DB] empty DB -> create complete initial state
  +-- [UNIT+DB] identical rerun -> no-op
  +-- [UNIT+DB] conflicting rerun -> fail/no mutation
```

Testing rules:

- Playwright's web server command must use `APP_ENV=test ... npm run start -- --mock-auth`.
- Do not fake a Google browser page. Unit/integration-test the callback policy with representative Google profiles and let NextAuth own protocol validation.
- Add a Google-default browser test that reaches `/login` without contacting Google; stub only the button navigation if needed.
- Run one real approved-account login, one unapproved-account denial, cookie inspection, sign-out, and post-disable denial as a production release gate.
- Keep branch coverage at or above the repository's current 90% target.

### 8. Update operating documentation and deployment gates

Files:

- `README.md`
- `.env.example`
- `docs/oci-deployment-plan.md`

Actions:

- Document local mock startup, local Google startup, callback URLs, required variables, bootstrap, and troubleshooting.
- Update OCI secret names to `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `NEXTAUTH_SECRET`; store `NEXTAUTH_URL` as non-secret configuration.
- Add the production bootstrap command between migrations and application rollout.
- Add a deployment assertion that `APP_ENV=production`, no `--mock-auth` argument is present, and the pod starts in Google mode.
- Configure Google redirect URIs exactly as:
  - `http://localhost:3000/api/auth/callback/google`
  - `https://<app-hostname>/api/auth/callback/google`

## Failure Modes and Required Behavior

| Failure | Test | Handling | User-visible result |
|---|---|---|---|
| Google client/secret/session secret missing | mode unit/process test | Fail before server spawn | Clear startup error; no partially working server |
| Google is unavailable or callback fails | login/browser + release smoke | NextAuth error path; no app session | Login page offers retry; no silent loop |
| Google email is absent or unverified | policy integration test | Cancel callback before database write | Denial page |
| Verified email is not stored | policy integration test | Cancel callback; no `User` row/session | “Account not approved” |
| Stored membership is disabled | policy + authorization integration tests | Deny sign-in or next protected request | Unauthorized page with sign-out/retry |
| Session expires during a server action | authorization test | Authentication error; no mutation | Redirect/recover at login |
| Database is unavailable | authorization test | Rethrow operational error | Normal app error/logging, not false unauthorized |
| `--mock-auth` reaches production | mode/process test | Exit nonzero before Next.js | Deployment fails closed |
| Mock cookie/action names an unknown user | mock unit/E2E | Reject action or fall back to configured fixture without DB creation | Clear local-test error |
| Bootstrap is run with a different admin email | bootstrap integration test | Exit nonzero, transaction rolls back | Operator sees conflict and uses normal admin UI |
| Membership changes during sign-in | authorization integration test | Callback may finish, but request-time membership check wins | Access denied on first request |

No planned failure is both silent and uncovered.

## Performance Review

- Middleware verifies the encrypted JWT without a database call.
- Each protected page/action already performs a membership lookup; retain that single indexed lookup so disables take effect immediately.
- Update Google profile fields only during successful sign-in, not on every request. This removes the current mock implementation's repeated user upsert pattern from production.
- Do not cache membership/capability results across requests. The database lookup is small and indexed, while stale authorization would be a worse tradeoff.
- No new N+1 query, large allocation, external API call after login, or background process is introduced.

## Rollout and Verification

1. Implement phases 1-6 with focused tests beside each change.
2. Run `npm run typecheck`, `npm test`, `npm run test:coverage`, and `npm run e2e` in mock mode.
3. Run `npm run build` without Google secrets to prove the image build is runtime-secret independent.
4. Configure a local Google OAuth client and verify approved/denied flows on `localhost`.
5. Deploy database migrations (none expected for this feature).
6. Run `db:bootstrap` once with the real production administrator Gmail.
7. Create the production Google client and exact HTTPS callback URI.
8. Start production without an auth-mode variable or mock flag; confirm startup resolves Google mode.
9. Verify secure cookie attributes, approved login, denied login, sign-out, capability denial, and immediate access loss after membership disablement.
10. Record commands/results in the OCI runbook before passing the existing Google OAuth release gate.

Rollback is configuration-safe: redeploy the previous image. Do not enable mock mode as a production rollback mechanism.

## Worktree Parallelization

| Lane | Modules | Depends on |
|---|---|---|
| A | `scripts/`, auth runtime mode, package scripts | none |
| B | auth email/policy/identity modules | dependency pin from A before final test |
| C | household bootstrap and Prisma command | shared email helper from B |
| D | middleware, app routes, auth UI | A + B |
| E | unit/E2E tests and docs | A + B + C + D |

Lane A and the initial bootstrap service in C can start in parallel if C temporarily keeps its email validation local, but that creates avoidable rework. Recommended execution is mostly sequential: A -> B, then C and D in parallel, then E. C and D do not share primary modules; their likely merge conflicts are limited to `package.json` and can be assigned to the final integrator.

## NOT in Scope

- Auth.js database adapter, persistent Session/Account tables, or a Prisma schema migration.
- Persisting Google access tokens, refresh tokens, or provider subjects.
- Additional identity providers, account linking, password login, passkeys, or domain-wide allowlisting.
- Treating Gmail dot variants or `+suffix` aliases as equivalent accounts.
- Automated interaction with Google's hosted login/consent UI in CI.
- Production infrastructure beyond the auth secrets, bootstrap step, startup guard, and release checks already owned by the OCI deployment plan.
- Multi-household selection or redesign of the current “primary household” behavior.

## Implementation Tasks

- [x] **T1 (P1, human: ~4h / Codex: ~30m)** - Runtime mode - Pin NextAuth.js and implement the production-safe `--mock-auth` launcher.
  - Surfaced by: scope/architecture review - production must default to Google while E2E explicitly uses mock mode.
  - Files: `package.json`, `package-lock.json`, `scripts/run-next.mjs`, `src/features/auth/mode.ts`, `.env.example`
  - Verify: mode/process tests and the three startup commands in the Outcome section.
- [x] **T2 (P1, human: ~1d / Codex: ~1h)** - Google auth - Add NextAuth v4 Google configuration, verified-email allowlist callback, seven-day JWT session, and auth route.
  - Surfaced by: architecture review - authenticate with Google but authorize by stored Gmail.
  - Files: `src/features/auth/google-auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, focused tests
  - Verify: Google policy integration suite covering allowed and denied profiles with database mutation assertions.
- [x] **T3 (P1, human: ~1d / Codex: ~1h)** - Authorization - Introduce provider-neutral identity, shared email normalization, typed failures, and narrow route catches.
  - Surfaced by: code-quality review - direct mock coupling, duplicated normalization, and blanket catches.
  - Files: `src/features/auth/`, household service/tests, protected pages, `src/app/actions.ts`
  - Verify: authorization unit/integration tests, typecheck, and no broad auth catches in protected routes.
- [x] **T4 (P1, human: ~1d / Codex: ~1h)** - Routing/UI - Add middleware, login/sign-out controls, and mode-aware shell/switcher behavior.
  - Surfaced by: architecture review - unauthenticated and unauthorized users require distinct recovery paths.
  - Files: `src/middleware.ts`, login/unauthorized routes, `src/components/`, CSS
  - Verify: browser tests for redirects, controls, mock switcher visibility, and sign-out.
- [x] **T5 (P1, human: ~4h / Codex: ~30m)** - Bootstrap - Add a transactional, idempotent first-admin bootstrap command and remove production request-time seeding.
  - Surfaced by: architecture review - placeholder `rachel@example.com` cannot bootstrap real Google access safely.
  - Files: bootstrap service/test, `prisma/bootstrap.ts`, `AppShell`, package script
  - Verify: empty, repeated, and conflicting bootstrap integration tests.
- [x] **T6 (P1, human: ~1d / Codex: ~1-2h)** - Test coverage - Cover every auth mode, policy, authorization, bootstrap, and browser branch.
  - Surfaced by: test review - the repository currently has no auth tests and E2E assumes mock cookies.
  - Files: auth/household tests, `playwright.config.ts`, `e2e/auth.spec.ts`, `e2e/app-shell.spec.ts`
  - Verify: `npm run typecheck && npm test && npm run test:coverage && npm run e2e`.
- [x] **T7 (P2, human: ~3h / Codex: ~20m)** - Operations - Update local setup, Google callback configuration, OCI secrets, bootstrap ordering, and live release checks.
  - Surfaced by: deployment review - the current OCI plan assumes v5-style variable names and lacks an executable bootstrap step.
  - Files: `README.md`, `.env.example`, `docs/oci-deployment-plan.md`
  - Verify: fresh local setup walkthrough and recorded production allow/deny/cookie smoke test.

## Branch Verification

- `npm run lint`: passed with zero findings.
- `npm run typecheck`: passed.
- `npm test`: 75 tests passed across 15 files.
- `npm run test:coverage`: 98.39% statements, 94.56% branches, 97.72% functions, 99.29% lines.
- `npm run build`: production build passed and emitted the auth route plus middleware.
- `npm run e2e`: 10 mock-mode journeys passed in Desktop Chrome and Mobile Safari.
- `npm run e2e:google-shell`: production-default login redirect and Google provider/callback contract passed.
- `APP_ENV=production npm run start -- --mock-auth`: rejected before Next.js startup as required.
- `npm audit --omit=dev`: zero vulnerabilities after the tested `uuid@11.1.1` override.

Pending before merge: configure a real localhost Google OAuth client and exercise approved login, unapproved login, sign-out, cookie attributes, and post-login membership disablement. This cannot be automated without the developer's Google client and accounts.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---:|---|---|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | Not run | Not needed for this backend/security change |
| Codex Review | `/codex review` | Independent second opinion | 0 | Not run | Outside voice skipped |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | Clear | 8 issues resolved, 0 critical gaps remain |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | Not run | Small login/control UI follows existing design system |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | Not run | CLI and setup behavior covered in this plan |

**VERDICT:** ENG CLEARED - ready to implement.

NO UNRESOLVED DECISIONS
