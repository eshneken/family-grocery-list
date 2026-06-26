# Family Grocery List

Responsive family grocery list app built from the gstack engineering master spec.

## Local Setup

1. Copy `.env.example` to `.env`.
2. Start Postgres: `docker compose up -d postgres`.
3. Install dependencies: `npm install`.
4. Apply schema and seed data: `npm run db:migrate && npm run db:seed`.
5. Start the app: `npm run dev`.

The first implementation uses mock auth through the `mock_current_user` cookie and the header user switcher. Google federation is intentionally deferred until the core household, list, and shopping lifecycle is stable.

## Useful Commands

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run e2e`
