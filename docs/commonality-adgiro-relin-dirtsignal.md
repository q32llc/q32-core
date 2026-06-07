# Adgiro, Relin, and DirtSignal Commonality

This is the current direction for `@q32/core`: choose the best reusable pattern across the projects, then move the projects toward it.

## Chosen Defaults

- Postgres access should use Kysely over raw SQL once a project has long-lived relational read models. DirtSignal has the largest raw `postgres` surface today, but Relin's Kysely layer is the better long-term default because it makes schema ownership, joins, transactions, and refactors safer.
- Cloudflare Workers should create PG clients per request, queue invocation, cron tick, or script scope. Hyperdrive owns pooling in Worker runtime; Node scripts and tests should close clients explicitly.
- PG connection resolution should prefer Hyperdrive, then `PG_URL`, then an explicit test fallback only when the caller opts in.
- Non-local PG should use TLS by default. A provided `PG_CA_CERT` should be normalized and used for certificate verification.
- PG migrations should be explicit, status/dry-run capable, and separated from runtime credentials. Relin's admin/runtime split is the better default; DirtSignal's typed migration-array model is better than ad hoc SQL file parsing for application-owned schema modules.
- D1 remains the default for small control-plane state, but shared auth, jobs, and ops-event tables should be configurable D1 modules, not app-local forks.

## Core Modules To Grow

- `pg-kysely`: Kysely + `postgres.js` construction, Hyperdrive/PG_URL/CA-cert policy, and scoped `withKyselyPg`.
- `pg-migrations`: one migration runner that can consume SQL files or typed migration arrays, with status, dry-run, reset guard, and configurable migrations table.
- `d1-auth`: configurable users/orgs/memberships/identities/magic-link/session helpers. Apps keep policy and copy; core owns token hashing, one-time consume, identity upsert, and session persistence patterns.
- `mcp-oauth-d1`: the common OAuth client/code/token/device-flow repository used by Relin and DirtSignal, with app-provided principal lookup and entitlement policy.
- `d1-jobs`: Adgiro's richer job driver is closer to the target than the current minimal core job helper. Core should own enqueue policies, active locks, concurrency keys, delayed requeue, stale-running recovery, and linked ops events.
- `queue`: a typed Cloudflare Queue publisher/consumer adapter with inline mode for tests and local single-process execution.
- `ops-events`: converge on run IDs, event names, statuses/severity, target identifiers, metadata/error normalization, and best-effort writes.

## Project Movement

- Relin should keep using Kysely for PG and replace its local connection lifecycle with `@q32/core/pg-kysely`.
- DirtSignal should migrate new PG repositories to Kysely first, then wrap existing raw `postgres` repositories behind Kysely-compatible interfaces as they change.
- Adgiro should adopt the shared D1 job driver shape and ops-event schema before adding PG. If it adds PG, it should start on Kysely rather than raw `postgres`.
