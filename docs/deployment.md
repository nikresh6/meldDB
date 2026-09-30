# Deployment

## Vercel / Node deployment

1. Create a production Neon database dedicated to MeldDB's control plane.
2. Configure every required environment variable from `.env.example` in the deployment secret store.
3. Set `APP_URL` and `BETTER_AUTH_URL` to the canonical HTTPS origin.
4. Run `npm run db:migrate` from a trusted release job before promoting the build.
5. Deploy the Next.js standalone application on Node.js 22.
6. Verify `GET /api/health` returns `200` without exposing connection details.
7. Schedule `npm run db:prune` daily using a protected job or platform scheduler.

## OAuth applications

Create owner-controlled Supabase and Cloudflare OAuth applications. Register exact production callback URLs:

- `https://YOUR_DOMAIN/api/providers/supabase/callback`
- `https://YOUR_DOMAIN/api/providers/cloudflare/callback`

Use least-privilege management scopes needed for the features you enable. Supabase scope selection currently belongs in the provider application configuration. Cloudflare needs account read plus D1 read/edit. Keep client secrets only in the production secret store.

## Domain and cookies

Use HTTPS and one canonical hostname. Update both URL environment variables and OAuth callback registration together. Better Auth secure cookies are enabled outside development.

## Release checklist

- Apply migrations and verify a clean migration run in staging.
- Run lint, typecheck, tests, build, and Playwright.
- Verify no `.env` or credentials are tracked.
- Test OAuth reconnect and account selection.
- Test project/key cross-tenant rejection.
- Inspect homepage, auth, onboarding, overview, editors, provider states, docs, and security at desktop/mobile widths.
- Confirm retention pruning and backup/restore procedures.

Provider OAuth credentials are optional for building the app but required to activate those live connection buttons. Neon customer credentials remain per-user encrypted records, not deployment variables.
