# Family Grocery List

Family Grocery List is a responsive web app for collecting, organizing, shopping, and reviewing a household grocery list. It is built for a shared family workflow where requestors add items, shoppers run store-specific trips, and admins manage household access and store configuration.

The current implementation is a local/mock-auth version of the product. Google federation is intentionally deferred until the core household, list, and shopping lifecycle is stable.

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
- `src/features/auth/` - Mock auth and authorization helpers.
- `src/features/household/` - Household, member, and store services.
- `src/features/parser/` - Grocery request parsing and category inference.
- `src/features/shopping/` - List, trip, history, outcome, and suggestion services.
- `src/test/` - Test factories and fixtures.
- `e2e/` - Playwright browser tests.
- `prisma/` - Prisma schema, migrations, and seed data.

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

6. Start the development server:

```bash
npm run dev
```

7. Open the app:

```text
http://localhost:3000
```

The dev server is configured to bind to `0.0.0.0`, so you can also test from another device on your network by opening your computer's LAN IP address with port `3000`.

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

Local authentication is mocked. The current user comes from this priority order:

1. The `mock_current_user` cookie.
2. `MOCK_CURRENT_USER_EMAIL` in `.env`.
3. The first built-in mock user.

Use the mock user switcher in the app header to switch users. After switching users, the app returns to the shopping list page so local testing does not leave a non-admin user stranded on an admin-only route.

Google federation is not implemented yet. Do not deploy this app publicly with mock auth enabled.

## Running The App

For local development:

```bash
npm run dev
```

For a production-style local run:

```bash
npm run build
npm run start
```

The `start` script also binds to `0.0.0.0`.

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

The E2E test runner:

- Builds the Next.js app.
- Starts a production Next server on `http://127.0.0.1:3100`.
- Runs tests serially against Desktop Chrome and Mobile Safari profiles.
- Resets and seeds the E2E database before each test.

Because the E2E tests reset the database, do not run them against data you care about.

## Test Coverage Areas

Unit and service tests cover:

- Request parsing and category inference.
- Member approval, updates, status changes, and store configuration.
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
npm run db:generate
npm run db:migrate
npm run db:seed
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
