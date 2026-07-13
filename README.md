# @q32/core

Dependency-light TypeScript building blocks shared by Q32 applications. The package targets Cloudflare Workers, Node, and tests, favors standard Web APIs, and keeps application policy in the consuming app.

## Install

```bash
pnpm add @q32/core
```

Import from the package root or use a subpath for a focused dependency surface:

```ts
import { createId, jsonResponse } from "@q32/core";
import { D1JobStore } from "@q32/core/jobs";
import { createKyselyPostgres } from "@q32/core/pg-kysely";
```

`pg-kysely` is the only optional integration with peer dependencies. All other modules use platform APIs and types.

## What's included

- **Application and HTTP:** [API operation registries and discovery documents](src/api.ts), [JSON responses and errors](src/http.ts), [environment parsing](src/env.ts), and [Cloudflare binding guards](src/cloudflare.ts)
- **Identity and security:** [auth services](src/auth.ts), [Hono](src/hono.ts) and [React Router](src/react-router.ts) adapters, [signed sessions](src/session.ts), [IDs and tokens](src/ids.ts), [encoding](src/encoding.ts), and [WebCrypto encryption](src/crypto.ts)
- **Agents and authorization:** [AI provider contracts and JSON extraction](src/ai.ts), [MCP metadata](src/mcp.ts), and [OAuth discovery and protected-resource metadata](src/oauth.ts)
- **Data and durable work:** [D1 types and migrations](src/d1.ts), [durable jobs and orchestration](src/jobs.ts), [operational events](src/ops-events.ts), [D1 rate limiting](src/rate-limit.ts), [R2 JSON storage](src/r2-json.ts), and [time helpers](src/time.ts)
- **Postgres:** [migration helpers](src/pg.ts) and the optional [Kysely/Postgres integration](src/pg-kysely.ts)
- **Messaging and commerce:** [email contracts and addresses](src/email.ts), [AWS request signing](src/aws.ts), [Amazon SES](src/ses.ts) and [SES/SNS webhooks](src/ses-sns.ts), [billing primitives](src/billing.ts), [conversion outbox contracts](src/conversion-outbox.ts), and [Google Ads uploads](src/google-ads.ts)
- **Presentation and tests:** [SEO and social metadata, JSON-LD, sitemaps, and robots](src/seo.ts) and [Worker queue, R2, and response test helpers](src/testing.ts)

See [Durable jobs](docs/jobs.md), [Purchase conversion outbox](docs/conversion-outbox.md), and [SEO primitives](docs/seo.md) for larger workflow guidance.

Framework adapters are intentionally thin: put policy and persistence in shared services, then use an adapter only to translate framework request and response shapes.

## Development

```bash
pnpm install
pnpm test
pnpm build
```

## Release

Publishing runs through the [Release workflow](.github/workflows/release.yml) when a GitHub release is published, using npm trusted publishing and provenance through GitHub OIDC.
