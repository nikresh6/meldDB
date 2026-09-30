# Provider integrations

Provider limits and APIs change. MeldDB prefers live API data; dated free-plan fallbacks are isolated in `packages/core/src/capacity.ts` and include source metadata.

## Supabase

Connection uses an owner-created Supabase OAuth application with Authorization Code + PKCE. OAuth scopes are configured on the Supabase application, not appended as a deprecated query parameter. MeldDB uses the Management API for project listing/provisioning, database SQL and metadata, Auth configuration, and Edge Functions.

New projects receive a server-generated database password that is encrypted immediately. Existing project passwords cannot be retrieved through the Management API; attach flows should use an API-supported credential or explicitly supplied project credential when required.

Required owner variables: `SUPABASE_OAUTH_CLIENT_ID`, `SUPABASE_OAUTH_CLIENT_SECRET`, and `SUPABASE_OAUTH_REDIRECT_URI`.

## Neon

V1 asks each user for a Neon API key because it does not represent this as OAuth. The key is validated by listing projects, encrypted, and used to list/create/attach projects. Creation requests a stored password and captures the returned project-scoped connection URI once, then encrypts it for data operations.

No global Neon customer-provider key belongs in the deployment environment. `DATABASE_URL` is only MeldDB's separate internal control plane.

## Cloudflare D1

Connection uses Cloudflare OAuth Authorization Code + PKCE. If the token can access multiple accounts, MeldDB requires explicit account selection and verifies the chosen account against the live account list. The D1 adapter lists, creates, attaches, queries, checks storage file size, and performs health checks.

D1 accepts SQLite placeholders; MeldDB translates numbered `$n` gateway parameters to ordered `?` bindings without modifying quoted SQL text. Canonical UUID, timestamp, JSON, and boolean columns map to appropriate SQLite storage classes.

Required owner variables: `CLOUDFLARE_OAUTH_CLIENT_ID`, `CLOUDFLARE_OAUTH_CLIENT_SECRET`, and `CLOUDFLARE_OAUTH_REDIRECT_URI`.

## Disconnect and delete

Adapter `disconnectResource` is deliberately local-only. Disconnecting removes MeldDB's access/placement relationship and leaves customer infrastructure intact. Destructive provider resource deletion must be a separate typed-confirmation workflow.
