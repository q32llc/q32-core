# Q32 Jobs

`@q32/core/jobs` has two layers so projects can adopt common job behavior without all moving at the same speed.

## Durable Jobs

Use `D1JobStore` with `DurableJobDispatcher` when jobs need operator visibility, retries, stop requests, child jobs, and rollups. The store uses the shared `jobs` table shape and supports:

- statuses: `queued`, `running`, `succeeded`, `failed`, `stopping`, `stopped`
- `parent_job_id` child trees with `summarizeChildren`
- `lock_key` plus `enqueuePolicy: "dedupe_active"` for active-job dedupe
- `concurrency_key` plus `concurrency_limit` for per-tenant or per-resource throttles
- handler result types for done, requeue, and stopped
- error capture in `last_error` plus retry requeue when attempts remain
- optional stale-running reclamation with `staleRunningAfterSeconds`
- event sink hooks for `ops_events`

The intended Worker queue pattern is:

1. HTTP, cron, or another job calls `jobs.enqueue(...)`.
2. A Cloudflare Queue message carries `{ jobId }`.
3. The queue consumer calls `dispatcher.run(jobId)`.
4. The dispatcher claims, runs, catches errors, records retry or failure state, and emits lifecycle events.

Parent orchestration should use `runParentJobOrchestration`. It queues children once, polls by requeueing the parent, rolls child statuses up, fails fast by default, and can fail or stop queued siblings when a child fails.

## Pipeline Jobs

Use `PipelineManager` when the project already passes all state in queue messages, as in IPOGrid and DirtSignal ingestion. This avoids an immediate migration to durable jobs while still removing duplicated step advancement logic.

`PipelineManager` provides:

- ordered named steps
- handler-directed state updates
- explicit jumps and same-step continuations
- optional delayed next-step enqueue
- generated continuation ids
- standard completion output

## Queue Publisher

Use `createJobPublisher` around Cloudflare Queue bindings. It gives tests and local scripts the same `.put(message, { delaySeconds })` interface as production and supports inline execution for integration tests.

## Adoption Map

- Adgiro should move its job driver, job registry, parent orchestration, stop handling, and queue runner onto the durable layer.
- DirtSignal should first replace its local pipeline manager and queue publisher with the pipeline layer, then wire its ingestion job driver to the dispatcher event sink pattern.
- IPOGrid should first replace its local pipeline manager and queue publishers. A later durable migration can persist selected long-running ingestion and AI jobs without changing handler shape.

