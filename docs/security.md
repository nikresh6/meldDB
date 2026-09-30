# Security model

## Threat assumptions

MeldDB assumes attackers may find an application bug or XSS, obtain logs, steal an API key, or read the control-plane database. The design limits what any one failure exposes.

## Credential storage

Provider tokens, user-supplied Neon keys, project database passwords, and project connection URIs are encrypted with AES-256-GCM. Each record stores ciphertext, nonce, authentication tag, algorithm, and key version. The root encryption secret exists only in the deployment environment. Rotation can decrypt with the previous version and re-encrypt with a new version; an operations runbook should retain old keys only for the migration window.

API keys use high-entropy random material. The database stores a short prefix for candidate lookup and an HMAC-SHA-256 verifier keyed by the credential encryption secret. Verification uses timing-safe comparison. Raw keys are shown once.

## Tenant isolation

Session routes resolve `user -> project_members -> project -> resource` on the server. Workspace provider connections require workspace roles. Public gateway routes verify that the authenticated key's `project_id` exactly matches the requested project. Resource queries include project predicates.

Tests cover cross-user membership rejection and cross-project API-key rejection. Any new resource table must add equivalent ownership checks before release.

## SQL

Unified SQL uses `node-sql-parser`, accepts one statement, and allows SELECT/INSERT/UPDATE/DELETE only. Unsupported joins, unions, groupings outside the V1 subset, and DDL are rejected. Values are always parameters. Identifiers sourced from users pass a strict identifier schema and are quoted. Physical SQL is explicitly targeted and destructive statements require confirmation.

## Web and session controls

Better Auth owns password hashing, session lifecycle, CSRF-relevant auth behavior, and secure HTTP-only cookie configuration. Next.js response headers set CSP, frame denial, MIME sniffing prevention, a restrictive permissions policy, and referrer policy. Monaco currently requires `unsafe-eval`; remove it when Monaco is moved to a CSP-compatible worker build.

## Logging

Never log authorization headers, raw keys, passwords, tokens, database connection URIs, or provider secret fields. Query logs store a SHA-256 statement fingerprint and safe metadata rather than raw SQL or results. Errors expose a request ID and actionable provider state without dumping upstream bodies.

## Operational requirements

- Generate production secrets with a cryptographically secure generator.
- Use distinct secrets per environment and restrict database/network access.
- Configure least-privilege OAuth applications and review granted scopes.
- Run migrations and retention pruning from trusted deployment contexts.
- Monitor dependency advisories and rotate credentials after suspected exposure.
- Back up the control plane and test restores without exporting decrypted credentials.

MeldDB does not claim SOC 2, ISO 27001, PCI DSS, HIPAA compliance, or any other certification.
