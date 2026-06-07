# @q32/core

Shared TypeScript primitives for Q32 Cloudflare Worker projects.

The first release focuses on common infrastructure repeated across Q32 apps:

- AI provider contracts and JSON extraction helpers
- API operation registries
- framework-neutral auth/session/MCP auth services with thin Hono and React Router adapters
- billing plan/status primitives
- Cloudflare binding guards
- environment parsing
- email provider contracts and address helpers
- IDs, tokens, and signed session cookies
- hash and HMAC helpers
- HTTP JSON/error helpers
- D1-like database types and migration runner
- encoding helpers
- durable D1-backed jobs, child orchestration, queue publishers, and pipeline managers
- `ops_events`
- Postgres migration helpers
- R2 JSON artifacts
- SEO sitemap, robots, and metadata helpers
- test helpers for Worker queues, R2, and JSON responses
- OAuth/MCP discovery metadata
- D1 rate limiting
- WebCrypto JSON encryption

## Install

```bash
pnpm add @q32/core
```

## Development

```bash
pnpm install
pnpm test
pnpm build
```

## Release

Publishing is handled by the `Release` GitHub Actions workflow when a GitHub release is published. npm trusted publishing is configured for `q32llc/q32-core` using `.github/workflows/release.yml`, so the workflow publishes with provenance through GitHub OIDC.

## Modules

```ts
import {
  D1JobStore,
  D1_JOBS_SCHEMA,
  appUrl,
  createAuthSystem,
  createId,
  honoAuthMiddleware,
  jsonResponse,
  oauthAuthorizationServerMetadata,
  reactRouterAuthContext,
  renderSitemapXml,
  recordOpsEvent,
  signSession,
} from "@q32/core";
```

See [docs/evaluation.md](docs/evaluation.md) for the project-inventory replacement matrix and [docs/jobs.md](docs/jobs.md) for the shared jobs model.

Framework adapters are deliberately thin. Put policy and persistence in `auth`,
`jobs`, `ops-events`, and `api`; use `hono` or `react-router` only to translate a
framework request/response shape into those shared services.
