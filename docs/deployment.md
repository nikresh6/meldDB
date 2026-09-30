# Deployment

## Fastest Vercel deployment

MeldDB is configured so the core application can go live without local setup or a manual migration command.

1. Import `nikresh6/meldDB` into Vercel.
2. Add these two Production environment variables:
   - `DATABASE_URL`: MeldDB's pooled internal Neon connection string.
   - `CREDENTIAL_ENCRYPTION_KEY`: exactly 32 random bytes, normally represented as 64 hex characters.
3. Deploy.

The committed `vercel.json` runs `npm run db:migrate` before `npm run build`, so the first production deployment creates the control-plane schema automatically.

MeldDB automatically uses Vercel's system URL variables for its production app/auth origin. `APP_URL` and `BETTER_AUTH_URL` are only needed when you intentionally want to override that behavior.

`BETTER_AUTH_SECRET` is also optional. If it is absent, MeldDB derives a distinct stable auth-signing secret from `CREDENTIAL_ENCRYPTION_KEY`.

After deployment, verify:

- the homepage loads,
- signup and login work,
- a MeldDB project can be created,
- `GET /api/health` returns `200`.

## Optional provider integrations

### Neon

Customer Neon credentials are entered through MeldDB's **Connect Neon** UI. Do not put a customer's Neon API key into Vercel environment variables.

### Supabase OAuth

When ready to activate Supabase, create an owner-controlled Supabase OAuth application and set:

- `SUPABASE_OAUTH_CLIENT_ID`
- `SUPABASE_OAUTH_CLIENT_SECRET`

MeldDB infers the production callback URL as:

`https://YOUR_VERCEL_PRODUCTION_DOMAIN/api/providers/supabase/callback`

You may override it with `SUPABASE_OAUTH_REDIRECT_URI` if necessary.

### Cloudflare OAuth

When ready to activate Cloudflare D1, create an owner-controlled Cloudflare OAuth application and set:

- `CLOUDFLARE_OAUTH_CLIENT_ID`
- `CLOUDFLARE_OAUTH_CLIENT_SECRET`

MeldDB infers the production callback URL as:

`https://YOUR_VERCEL_PRODUCTION_DOMAIN/api/providers/cloudflare/callback`

You may override it with `CLOUDFLARE_OAUTH_REDIRECT_URI` if necessary.

Use least-privilege management scopes. Keep all client secrets in Vercel's secret/environment-variable store.

## Optional production operations

- Set up email delivery before relying on password-reset emails.
- Schedule `npm run db:prune` daily using a protected scheduler when usage grows.
- Add a custom domain later if desired.
- Test provider reconnect, cross-tenant rejection, and destructive confirmations before inviting outside users.

## Release checklist

- Verify the latest GitHub Actions run is green.
- Confirm no `.env` or credentials are tracked.
- Confirm `DATABASE_URL` and `CREDENTIAL_ENCRYPTION_KEY` are configured in Vercel.
- Confirm the production build ran migrations successfully.
- Verify `/api/health`.
- Test signup/login and project creation.
- Test Connect Neon with a real user-scoped Neon API key.
- Test Supabase/Cloudflare OAuth after their client credentials are configured.
- Inspect homepage, auth, onboarding, overview, editors, provider states, docs, and security at desktop/mobile widths.

Provider OAuth credentials are optional for the initial deployment. The core product and Neon user-key flow can be tested first.
