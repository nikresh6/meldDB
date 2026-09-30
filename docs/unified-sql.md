# Unified SQL

Unified SQL is a portable, deliberately constrained interface over the logical catalog.

## Supported V1 statements

- `SELECT` from one cataloged table
- `INSERT` into one cataloged table
- `UPDATE` one cataloged table
- `DELETE` from one cataloged table with explicit confirmation
- Basic WHERE filters, ORDER BY, LIMIT, and OFFSET passed to the physical engine

The structured SDK generates parameterized forms of these operations. The gateway caps merged output at 1,000 rows.

## Rejected operations

- Multiple statements
- Cross-provider or same-provider joins in Unified mode
- Unions and unsupported complex query shapes
- DDL such as CREATE, ALTER, DROP, and TRUNCATE
- Distributed transactions
- Writes to a multi-shard table without a routing key

Choose a physical resource in the SQL editor for full PostgreSQL or SQLite behavior. Physical mode labels the target and dialect and still requires a deliberate confirmation for destructive classes.

## Parameters and routing

HTTP requests provide `sql`, `params`, optional `routingKey`, and optional `confirmDestructive`. PostgreSQL placements receive `$1` parameters. D1 safely translates those placeholders to SQLite `?` bindings while preserving order and quoted literals.

The V1 planner does not rewrite logical identifiers to different physical names. Placements use the same table name; if a placement is renamed out of band, the request is rejected rather than silently querying a wrong table.
