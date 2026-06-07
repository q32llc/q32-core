# @q32/core

Shared TypeScript primitives for Q32 Cloudflare Worker projects.

The first release focuses on common infrastructure repeated across Q32 apps:

- environment parsing
- IDs, tokens, and signed session cookies
- HTTP JSON/error helpers
- D1-like database types and migration runner
- D1-backed jobs
- `ops_events`
- R2 JSON artifacts
- OAuth/MCP discovery metadata
- API operation registries
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

Publishing is handled by the `Release` GitHub Actions workflow when a GitHub release is published. Configure an npm automation token as the repository secret `NPM_TOKEN` before the first release.

## Modules

```ts
import {
  D1JobStore,
  D1_JOBS_SCHEMA,
  appUrl,
  createId,
  jsonResponse,
  oauthAuthorizationServerMetadata,
  recordOpsEvent,
  signSession,
} from "@q32/core";
```

See [docs/evaluation.md](docs/evaluation.md) for the project-inventory replacement matrix.
