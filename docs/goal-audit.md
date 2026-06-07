# Goal Audit

Objective: working Q32 core libraries, with the common libraries discussed in the project inventory, a public repo at the `q32llc` org, working CI/CD, strong types and good test coverage, evaluated as suitable to replace much common code in existing projects.

## Proven Complete

| Requirement | Evidence |
| --- | --- |
| Public repo under `q32llc` | `https://github.com/q32llc/q32-core`, public, default branch `main`. |
| Working local package | `pnpm build` succeeds and `pnpm pack --dry-run` produces a clean tarball. |
| Strong TypeScript types | `pnpm typecheck` succeeds under `strict` TypeScript with generated declarations. |
| Good test coverage | `pnpm test:coverage` succeeds with enforced thresholds; latest local coverage is 89.26% statements, 75.25% branches, 96.66% functions, 95.15% lines. |
| Working CI | GitHub Actions CI passes on `main` and runs install, typecheck, coverage, build, and pack dry run. |
| Common code surfaces | Modules exist for `api`, `ai`, `billing`, `cloudflare`, `crypto`, `d1`, `email`, `env`, `http`, `ids`, `jobs`, `mcp`, `oauth`, `ops-events`, `pg`, `r2-json`, `rate-limit`, `seo`, `session`, `testing`, and `time`. |
| Suitability evaluation | `docs/evaluation.md` maps modules to common patterns found in existing projects and identifies first replacement candidates. |
| Consumer install smoke | Packed tarball was installed into a clean temp project and imported successfully from `@q32/core`. |

## Incomplete Or Externally Blocked

| Requirement | Status |
| --- | --- |
| npm package published | Not complete. Local `npm whoami` returns `E401`, and `@q32/core` does not exist on npm yet. |
| npm publish step in CD | Workflow exists and skips safely when `NPM_TOKEN` is absent. Actual npm publishing cannot be proven until npm publishing is configured through `NPM_TOKEN` or npm trusted publishing for this repo/package. |
| Proven replacement in existing apps | Not complete. The library is evaluated as suitable, but no existing app has been migrated to consume it yet. |

## Recommended Next Proof Step

Migrate one low-risk repeated slice in an existing app, such as replacing the duplicated `D1DatabaseLike` type in `relin` or `graphilize`, or replacing `ops_events` helpers in `onwardtravel`. That will validate the public API against production code and expose any ergonomics issues before broad adoption.
