# Suitability Evaluation

This package was seeded from repeated infrastructure found across Erik/Q32 TypeScript projects, including `adgiro`, `bizsnipe`, `dirtsignal`, `getflight`, `graphilize`, `ipogrid`, `logtura`, `onwardtravel`, `relin`, `zura`, and the `domains/*` apps.

## Replacement Matrix

| Common pattern | Current module | Suitable replacement scope |
| --- | --- | --- |
| Typed environment helpers and app URL fallback | `env` | Replace local `getAppUrl`, required env, optional boolean, and binding guard helpers. |
| JSON responses, bearer/admin token checks, request body parsing | `http` | Replace repeated Worker/Hono-adjacent HTTP utility functions. |
| Prefixed IDs, random tokens, base64url, SHA-256 | `ids` | Replace local `createId`, token, digest-key, and hash helpers. |
| Signed session tokens and cookies | `session` | Replace small HMAC session implementations where full auth frameworks are unnecessary. |
| Credential or provider-secret encryption | `crypto` | Replace local AES-GCM JSON encryption helpers backed by WebCrypto. |
| D1-like database typing and explicit migrations | `d1` | Replace duplicated `D1DatabaseLike` types and simple migration runners. |
| Background job table behavior | `jobs` | Replace D1 job enqueue/claim/run/requeue/succeed/fail loops in small Worker apps. |
| Operator event recording and listing | `ops-events` | Replace repeated `ops_events` insert/list helpers. |
| D1 fixed-window rate limits | `rate-limit` | Replace lead, login, public API, and admin throttle tables. |
| R2 JSON payload/artifact storage | `r2-json` | Replace raw provider payload and generated artifact JSON storage helpers. |
| OAuth/MCP metadata | `oauth`, `mcp` | Replace repeated discovery metadata and API-to-tool descriptors; full OAuth token stores remain app-specific for now. |
| API operation registries | `api` | Replace local operation registries used for OpenAPI, admin APIs, and MCP exposure. |

## Current Fit

The package is suitable for new Q32 Worker projects and for incremental replacement of local helpers in existing projects where the app-specific behavior is already separated from infrastructure primitives.

Strong first replacement candidates:

- D1-like interfaces duplicated in `relin` and `graphilize`.
- `ops_events` helpers in `onwardtravel`, `bizsnipe`, `logtura`, and `bce.email`.
- D1 jobs in `travelerideas`, `bizsnipe`, `logtura`, and smaller domain apps.
- signed session, ID, token, and base64url helpers in `zura`, `relin`, `getflight`, and `adgiro`.
- API operation metadata from `bce.email` and `relin`.
- OAuth/MCP metadata from `getflight`, `captcha`, `ipogrid`, `relin`, and `bce.email`.

## Not Yet Complete

The package intentionally does not yet replace:

- full app account systems
- full OAuth authorization-code and refresh-token stores
- Stripe billing repositories
- Postgres job runners and migration orchestration
- email provider clients
- OpenAI/provider retry and structured-output adapters
- Mantine app shells or SEO page components

Those should be added only after extracting one or two real migrations from existing apps so the shared API follows production usage rather than speculation.

## Verification

Current local gates:

- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm build`
- `pnpm pack --dry-run`

Coverage threshold is enforced in `vitest.config.ts` and CI runs the same gates.
