# Suitability Evaluation

This package was seeded from repeated infrastructure found across Erik/Q32 TypeScript projects, including `adgiro`, `bizsnipe`, `dirtsignal`, `getflight`, `graphilize`, `ipogrid`, `logtura`, `onwardtravel`, `relin`, `zura`, and the `domains/*` apps.

## Replacement Matrix

| Common pattern | Current module | Suitable replacement scope |
| --- | --- | --- |
| AI JSON helper conventions | `ai` | Standardize model request/response contracts and JSON extraction around official provider SDK calls. |
| Typed environment helpers and app URL fallback | `env` | Replace local `getAppUrl`, required env, optional boolean, and binding guard helpers. |
| Cloudflare binding checks | `cloudflare` | Replace repeated `DB`, `R2`, and Queue binding guard code in Workers. |
| JSON responses, bearer/admin token checks, request body parsing | `http` | Replace repeated Worker/Hono-adjacent HTTP utility functions. |
| Prefixed IDs, random tokens, base64url, SHA-256 | `ids` | Replace local `createId`, token, digest-key, and hash helpers. |
| Signed session tokens and cookies | `session` | Replace small HMAC session implementations where full auth frameworks are unnecessary. |
| Auth/session/MCP authorization policy | `auth` | Keep principal lookup, session verification, admin checks, OAuth authorization-code exchange, token verification, and refresh rotation independent of Hono, React Router, or any single app. |
| Credential or provider-secret encryption | `crypto` | Replace local AES-GCM JSON encryption helpers backed by WebCrypto. |
| D1-like database typing and explicit migrations | `d1` | Replace duplicated `D1DatabaseLike` types and simple migration runners. |
| Postgres migration and JSON helpers | `pg` | Replace small pg migration scripts while still using official `pg` or `postgres` clients in apps. |
| Background job table behavior | `jobs` | Replace D1 job enqueue/claim/run/requeue/succeed/fail loops in small Worker apps. |
| Operator event recording and listing | `ops-events` | Replace repeated `ops_events` insert/list helpers. |
| D1 fixed-window rate limits | `rate-limit` | Replace lead, login, public API, and admin throttle tables. |
| R2 JSON payload/artifact storage | `r2-json` | Replace raw provider payload and generated artifact JSON storage helpers. |
| SEO/static output conventions | `seo` | Replace ad hoc sitemap, robots, canonical, Open Graph, and noindex tag helpers. |
| Email provider boundary | `email` | Standardize provider-independent send input/result shapes and address helpers. |
| Billing plan/status checks | `billing` | Replace local plan rank and active subscription status helpers around Stripe-backed apps. |
| Worker test helpers | `testing` | Replace small fake Queue/R2 helpers and JSON response assertions in unit tests; complements workerd/Miniflare integration tests. |
| OAuth/MCP metadata and storage | `oauth`, `mcp` | Replace repeated discovery metadata, API-to-tool descriptors, and configurable D1 OAuth client/code/token repositories. |
| API operation registries and discovery surfaces | `api` | Replace local operation registries, OpenAPI path generation, RFC 9727 API catalog linksets, Agent Skills indexes, and agent-discovery Link headers. |
| MCP manifests and bearer challenges | `mcp` | Replace repeated server-card metadata, plain-GET MCP manifests, API-operation tool descriptors, tool annotations, and OAuth protected-resource challenge headers. |
| Framework request adapters | `hono`, `react-router` | Translate Hono middleware and React Router loader/action requests into the same framework-neutral auth/API services. |

## Current Fit

The package is suitable for new Q32 Worker projects and for incremental replacement of local helpers in existing projects where the app-specific behavior is already separated from infrastructure primitives.

Strong first replacement candidates:

- D1-like interfaces duplicated in `relin` and `graphilize`.
- `ops_events` helpers in `onwardtravel`, `bizsnipe`, `logtura`, and `bce.email`.
- D1 jobs in `travelerideas`, `bizsnipe`, `logtura`, and smaller domain apps.
- signed session, ID, token, and base64url helpers in `zura`, `relin`, `getflight`, and `adgiro`.
- API operation metadata from `bce.email` and `relin`.
- OAuth/MCP metadata and auth/token flow from `getflight`, `captcha`, `ipogrid`, `relin`, and `bce.email`.

## Not Yet Complete

The package intentionally does not yet replace:

- complete app-specific login/account repositories
- Stripe billing repositories
- Postgres job runners and migration orchestration
- email provider clients
- Mantine app shells or SEO page components
- OpenAI/provider retry adapters beyond the shared request/result contracts
- Stripe webhook verification or Checkout/session creation, which should remain on the official Stripe SDK
- Mantine app shells or React components

Those should be added only after extracting one or two real migrations from existing apps so the shared API follows production usage rather than speculation.

## Verification

Current local gates:

- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm build`
- `pnpm pack --dry-run`

Coverage threshold is enforced in `vitest.config.ts` and CI runs the same gates.

Current coverage after the expanded common-module pass:

- Statements: 89.26%
- Branches: 75.25%
- Functions: 96.66%
- Lines: 95.15%
