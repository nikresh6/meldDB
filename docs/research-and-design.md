# MeldDB research and design direction

Last reviewed: 2026-09-30

## Useful patterns

- **Supabase Studio:** database work stays task-oriented: schema navigation, a dense editable grid, SQL workspaces, explicit loading/error states, and API documentation live close together. Studio's open-source code also keeps metadata/DDL concerns separate from row operations. MeldDB follows that separation and never treats a grid mutation as an unstructured SQL string.
- **Neon:** projects, branches, computes, and connection details are distinct resources. MeldDB models a provider resource rather than flattening all infrastructure into a generic “database.” Live API capacity wins over plan assumptions.
- **PlanetScale:** safe migrations and deploy requests make destructive schema work feel deliberate. MeldDB V1 uses explicit confirmations and audit events; it does not promise automatic zero-downtime cross-provider migrations.
- **Railway and Cloudflare:** infrastructure state is most useful as a compact operational table with status, region, last check, latency, and an inspectable detail surface—not as decorative cards.
- **Vercel:** its 2026 dashboard moved common workflows into a hideable, resizable sidebar and added a mobile bottom bar. MeldDB uses a shallow, workflow-first navigation hierarchy with a command palette.
- **Clerk:** high-level authentication choices are separated from session/security controls and advanced settings. MeldDB mirrors that hierarchy for customer Supabase Auth configuration while keeping MeldDB account auth entirely separate.
- **Linear, Raycast, and Resend:** restrained color, quick keyboard paths, strong empty states, and short transitions make dense products feel calm. MeldDB uses one blue accent, borders over large shadows, and motion only to clarify routing or state change.
- **shadcn/ui and 21st.dev:** composable accessible primitives are useful, but visual identity comes from a coherent token system and product-specific composition—not from assembling unrelated showcase components.

## Patterns intentionally avoided

- Invented usage, health, latency, customers, or provider success.
- A card wall dashboard, ornamental gradients, glass panels, excessive pills, and perpetual animation.
- Treating external provisioning as one atomic transaction or rolling back healthy resources when another provider fails.
- Hiding dialect and provider limits behind a false “universal SQL” promise.
- Using management endpoints as an unbounded high-volume application data plane.
- Storing raw provider credentials, raw MeldDB API keys, query results, or unlimited request logs.

## MeldDB design philosophy

MeldDB is an honest control plane. It makes independently owned infrastructure feel coherent without pretending the providers are identical. The default product density is closer to an IDE than a marketing dashboard: compact navigation, aligned numeric data, visible system state, and a clear distinction between logical and physical views. The public site can be more expressive, but its centerpiece is an actual routing model rather than a generic illustration.

Core positioning: **You own the databases. MeldDB connects them.** Disconnecting MeldDB does not delete customer infrastructure by default.

## Architecture decisions

- Next.js App Router with Server Components for reads, Server Actions for product mutations, and Route Handlers for OAuth callbacks, health, and the public gateway.
- A small workspace with reusable `core`, `providers`, and `sdk` packages. Provider APIs depend on stable domain types, not UI types.
- Drizzle over MeldDB's internal Neon Postgres database. The control plane stores tenant metadata, encrypted credentials, logical schema, shard placement, bounded telemetry, and audits—never normal customer rows.
- Better Auth owns MeldDB email/password sessions. Protected pages and every mutation validate the real server session; proxy checks are navigation hints, not an authorization boundary.
- A canonical logical catalog maps tables to explicit physical shards. Routing uses a documented SHA-256-derived unsigned integer over a canonical key representation, so it is stable across JavaScript runtimes.
- Unified SQL parses to an AST, accepts a conservative single-table subset, and fails closed for joins, DDL, transactions, or ambiguous operations. Physical SQL is plainly labeled by provider and dialect.
- Provisioning is a saga with independent provider states. A quota-full or failed provider never invalidates the MeldDB project or destroys healthy resources.
- Provider limits are dated fallback metadata only. Live provider API responses take precedence. Current research corrected Neon Free to 20 projects with 0.5 GB per project; D1 documents 10 Free databases, 500 MB per database, and 5 GB account storage. UI copy always notes that limits may change.

## Provider integration strategy

- **Supabase:** OAuth 2.0 Authorization Code + PKCE, configured scopes rather than a runtime `scope=all` request. OAuth token exchange accepts any successful 2xx response (the endpoint changed from 201 to 200 in 2026). Existing-project database passwords cannot currently be retrieved by the Management API, so direct Postgres access must collect one only when necessary. API/log endpoints and Data API exposure changes are isolated inside the adapter.
- **Neon:** a user pastes a Neon API key once; MeldDB validates it, encrypts it, then lists or creates projects through the current API client/REST surface. Account/API-reported limits override fallback plan metadata.
- **Cloudflare D1:** OAuth Authorization Code is preferred, requesting only account membership plus D1 Read/Edit as needed. REST manages/list/queries D1 for V1; the UI exposes its SQLite dialect and 30-second/parameter limits. A future customer Worker data plane can replace high-volume REST use without changing the adapter contract.

All adapters normalize errors into actionable states such as `quota_full`, `credentials_expired`, `permission_missing`, `temporarily_unreachable`, and `unsupported` while retaining safe provider context and a request ID.

## Security assumptions

- Provider tokens are AES-256-GCM encrypted with versioned key material supplied only through `CREDENTIAL_ENCRYPTION_KEY`.
- MeldDB API secrets are high-entropy random values shown once; only an HMAC-SHA-256 verifier, prefix, and metadata are stored.
- Authorization always resolves user → workspace membership → project role → resource. Browser-supplied project IDs are never trusted alone.
- OAuth state and PKCE verifier records expire and are single-use. Cookies are HTTP-only, secure in production, and SameSite Lax unless a documented callback requires otherwise.
- Queries are parsed, classified, limited, and parameterized; identifier allowlists come from the logical catalog. No regex is used as the SQL security boundary.
- Audit and recent-query metadata are bounded and redacted. Secrets, authorization headers, SQL results, and sensitive payloads are excluded from logs.
- Destructive infrastructure deletion is separate from disconnect. High-impact actions require typed confirmation and create an audit record.

## Primary references

- Supabase Management API, OAuth integration/scopes, Supabase Studio source, and September 2026 breaking-change feed.
- Neon API documentation and current Free-plan guidance.
- Cloudflare D1 limits, REST API, SQL behavior, and OAuth client documentation.
- Better Auth Next.js, email/password, and session-management documentation.
- Vercel February 2026 dashboard navigation rollout and shadcn accessible composition guidance.
