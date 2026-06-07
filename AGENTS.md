# AGENTS.md

This repository is the shared open-source TypeScript utility library for Q32 projects.

Keep this package small, dependency-light, and runtime-portable. Prefer standard Web APIs and platform types. Add runtime dependencies only when they replace real infrastructure complexity and are appropriate for Cloudflare Workers, Node, and tests.

Before adding a helper, confirm it is common across at least two projects or is a foundational primitive for new projects. Keep app-specific policy out of this package; expose small typed building blocks that apps compose.

Run `pnpm test` and `pnpm build` before considering changes complete.
