# Development

## Setup

1. Install Node.js 22.12 or newer.
2. Run `npm ci`.
3. Copy `.env.example` to `.env.local` and add a Neon pooled `DATABASE_URL`.
4. Generate `BETTER_AUTH_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` with at least 32 random bytes each.
5. Run `npm run db:migrate` and `npm run dev`.

Before adding any secret, confirm `git check-ignore .env.local` prints `.env.local`.

## Repository layout

- `src/app`: Next.js pages and route handlers
- `src/components`: marketing, auth, and product UI
- `src/db`: Drizzle control-plane schema and connection
- `src/lib`: authorization, OAuth, gateway, provider services, and rate limiting
- `packages/core`: provider contracts, routing, capacity, encryption, key verification, SQL planning
- `packages/providers`: Supabase, Neon, and D1 adapters
- `packages/sdk`: fluent server-side client
- `drizzle`: committed SQL migrations
- `e2e`: Playwright browser tests

## Quality gates

Run `npm run check` before pushing. Browser tests use `npm run test:e2e`; install Chromium once with `npx playwright install chromium`. Real provider credentials are not needed for provider-independent unit/integration tests.

Add unit coverage for pure logic, mock upstream HTTP at adapter boundaries, and add authorization regression coverage whenever a new project-owned resource type appears.

## Schema changes

Edit `src/db/schema.ts`, run `npm run db:generate`, inspect the SQL, and commit both migration and metadata. Never hand-edit a migration already applied in production.

## Design discipline

Authenticated pages must render persisted or live state—never invented metrics. Buttons must work, explain their unavailable state, or remain hidden. Preserve upstream provider error meaning and request IDs.
