import { describe, expect, it } from "vitest";
import {
  DurableJobDispatcher,
  PipelineManager,
  PostgresJobStore,
  createJobPublisher,
  enqueueJobOperation,
  jobOperationKeys,
  runParentJobOrchestration,
  type DurableJobRepository,
  type EnqueueJobInput,
  type JobChildrenSummary,
  type JobRecord,
  type QueueSendOptions,
} from "../src/jobs.js";

describe("DurableJobDispatcher", () => {
  it("runs registered jobs and records terminal state", async () => {
    const jobs = new MemoryDurableJobs();
    const job = await jobs.enqueue({ jobType: "demo", payload: { count: 1 } });
    const dispatcher = new DurableJobDispatcher({
      jobs,
      services: {},
      handlers: {
        demo: async ({ job: current }) => ({ ok: (current.payload as { count: number }).count + 1 }),
      },
    });

    await expect(dispatcher.run(job.jobId)).resolves.toEqual({ kind: "done", result: { ok: 2 } });
    await expect(jobs.get(job.jobId)).resolves.toMatchObject({ status: "succeeded", result: { ok: 2 } });
  });

  it("stores failure data and requeues retryable jobs", async () => {
    const jobs = new MemoryDurableJobs();
    const job = await jobs.enqueue({ jobType: "demo", maxAttempts: 2 });
    const dispatcher = new DurableJobDispatcher({
      jobs,
      services: {},
      retryDelay: () => "2026-06-07T12:00:00.000Z",
      handlers: {
        demo: async () => {
          throw new Error("temporary");
        },
      },
    });

    await expect(dispatcher.run(job.jobId)).resolves.toEqual({ kind: "requeue", result: null });
    await expect(jobs.get(job.jobId)).resolves.toMatchObject({
      status: "queued",
      availableAt: "2026-06-07T12:00:00.000Z",
      lastError: "temporary",
    });
  });

  it("handles missing handlers, stopped jobs, handler requeues, and terminal failures", async () => {
    const events: Array<{ jobId: string; eventName: string; severity?: string }> = [];
    const jobs = new MemoryDurableJobs();
    const missing = await jobs.enqueue({ jobType: "missing" });
    const missingDispatcher = new DurableJobDispatcher({
      jobs,
      services: {},
      events: (job, event) => events.push({ jobId: job.jobId, eventName: event.eventName, severity: event.severity }),
      handlers: {},
    });
    await expect(missingDispatcher.run(missing.jobId)).rejects.toThrow("No handler registered");
    await expect(jobs.get(missing.jobId)).resolves.toMatchObject({ status: "failed" });

    const stopping = await jobs.enqueue({ jobType: "stopper" });
    const stopDispatcher = new DurableJobDispatcher({
      jobs,
      services: {},
      events: (job, event) => events.push({ jobId: job.jobId, eventName: event.eventName, severity: event.severity }),
      handlers: { stopper: async () => ({ kind: "stopped" as const, result: { stopped: true } }), demo: async () => ({ ok: false }) },
    });
    await expect(stopDispatcher.run(stopping.jobId)).resolves.toEqual({ kind: "stopped", result: { stopped: true } });

    const requeue = await jobs.enqueue({ jobType: "demo", payload: { count: 1 } });
    await expect(
      stopDispatcher.run(requeue.jobId),
    ).resolves.toEqual({ kind: "done", result: { ok: false } });

    const explicit = await jobs.enqueue({ jobType: "explicit" });
    const explicitDispatcher = new DurableJobDispatcher({
      jobs,
      services: {},
      handlers: {
        explicit: async () => ({
          kind: "requeue" as const,
          payload: { count: 2 },
          result: { waiting: true },
          availableAt: "2026-06-07T00:02:00.000Z",
        }),
      },
    });
    await expect(explicitDispatcher.run(explicit.jobId)).resolves.toEqual({
      kind: "requeue",
      payload: { count: 2 },
      result: { waiting: true },
      availableAt: "2026-06-07T00:02:00.000Z",
    });
    await expect(jobs.get(explicit.jobId)).resolves.toMatchObject({
      status: "queued",
      payload: { count: 2 },
      result: { waiting: true },
    });

    const terminal = await jobs.enqueue({ jobType: "terminal", maxAttempts: 1 });
    const terminalDispatcher = new DurableJobDispatcher({
      jobs,
      services: {},
      events: (job, event) => events.push({ jobId: job.jobId, eventName: event.eventName, severity: event.severity }),
      handlers: {
        terminal: async () => {
          throw new Error("permanent");
        },
      },
    });
    await expect(terminalDispatcher.run(terminal.jobId)).rejects.toThrow("permanent");
    await expect(jobs.get(terminal.jobId)).resolves.toMatchObject({ status: "failed", lastError: "permanent" });
    expect(events.some((event) => event.eventName === "job.failed")).toBe(true);
  });
});

describe("runParentJobOrchestration", () => {
  it("completes immediately when a parent has no children to queue", async () => {
    const jobs = new MemoryDurableJobs();
    const parent = await jobs.enqueue({ jobType: "parent", payload: { stage: "empty" } });
    await expect(
      runParentJobOrchestration(
        { job: parent, jobs, services: {}, events: noopEvents, shouldStop: async () => false },
        { children: [], failureMode: "continue" },
      ),
    ).resolves.toMatchObject({
      kind: "done",
      result: {
        stage: "complete",
        failureMode: "continue",
        summary: { total: 0, allTerminal: false },
      },
    });
  });

  it("queues children once and completes after child statuses roll up", async () => {
    const jobs = new MemoryDurableJobs();
    const parent = await jobs.enqueue({ jobType: "parent", payload: { stage: "start" } });
    const context = {
      job: parent,
      jobs,
      services: {},
      events: noopEvents,
      shouldStop: async () => false,
    };

    await expect(
      runParentJobOrchestration(context, {
        children: [{ jobType: "child", payload: { n: 1 } }, { jobType: "child", payload: { n: 2 } }],
        now: () => new Date("2026-06-07T00:00:00.000Z"),
        pollSeconds: 5,
      }),
    ).resolves.toEqual({
      kind: "requeue",
      payload: { stage: "start" },
      result: {
        stage: "waiting_children",
        failureMode: "fail_fast",
        queuedSiblingPolicy: "fail",
        childJobIds: ["job_2", "job_3"],
        summary: {
          parentJobId: "job_1",
          total: 2,
          queued: 2,
          running: 0,
          stopping: 0,
          succeeded: 0,
          failed: 0,
          stopped: 0,
          active: 2,
          terminal: 0,
          allTerminal: false,
        },
      },
      availableAt: "2026-06-07T00:00:05.000Z",
    });

    const children = await jobs.listChildren(parent.jobId);
    expect(children).toHaveLength(2);
    await jobs.succeed(children[0].jobId);
    await jobs.succeed(children[1].jobId);

    await expect(runParentJobOrchestration(context, { children: [] })).resolves.toMatchObject({
      kind: "done",
      result: { stage: "complete", summary: { total: 2, succeeded: 2, allTerminal: true } },
    });
  });

  it("propagates the failed child reason and leaves stopped siblings non-error", async () => {
    const jobs = new MemoryDurableJobs();
    const parent = await jobs.enqueue({ jobType: "parent", payload: { stage: "waiting" } });
    await jobs.enqueue({ jobType: "child", parentJobId: parent.jobId });
    await jobs.enqueue({ jobType: "child", parentJobId: parent.jobId });
    const [failed] = await jobs.listChildren(parent.jobId);
    await jobs.fail(failed.jobId, new Error("provider rejected request"));

    await expect(
      runParentJobOrchestration(
        {
          job: parent,
          jobs,
          services: {},
          events: noopEvents,
          shouldStop: async () => false,
        },
        { children: [], failureMode: "fail_fast", queuedSiblingPolicy: "stop" },
      ),
    ).rejects.toThrow("provider rejected request");

    const children = await jobs.listChildren(parent.jobId);
    expect(children.map((job) => job.status).sort()).toEqual(["failed", "stopped"]);
    expect(children.find((job) => job.status === "stopped")?.lastError).toBeNull();
  });

  it("continues through child failures when configured to continue", async () => {
    const jobs = new MemoryDurableJobs();
    const parent = await jobs.enqueue({ jobType: "parent" });
    const failed = await jobs.enqueue({ jobType: "child", parentJobId: parent.jobId });
    const ok = await jobs.enqueue({ jobType: "child", parentJobId: parent.jobId });
    await jobs.fail(failed.jobId, "bad child");
    await jobs.succeed(ok.jobId);

    await expect(
      runParentJobOrchestration(
        { job: parent, jobs, services: {}, events: noopEvents, shouldStop: async () => false },
        { children: [], failureMode: "continue" },
      ),
    ).resolves.toMatchObject({
      kind: "done",
      result: { stage: "complete", summary: { failed: 1, succeeded: 1, allTerminal: true } },
    });
  });
});

describe("job operation helpers", () => {
  it("derives stable lock and concurrency keys", () => {
    expect(
      jobOperationKeys({
        siteId: "site_123",
        operationKey: "Generate Copy",
        entity: { entityType: "campaign", entityId: "cmp_1", entityLabel: "Launch" },
      }),
    ).toEqual({
      lockKey: "jobop:site:site_123:generate-copy:campaign:cmp_1",
      concurrencyKey: "jobop:site:site_123:generate-copy",
      concurrencyLimit: 1,
    });
  });

  it("handles global, custom entity key, no-dedupe, and concurrency variants", () => {
    expect(
      jobOperationKeys({
        operationKey: " Sync / Things ",
        dedupeActive: false,
        concurrencyScope: "Provider/API",
        concurrencyLimit: 4.9,
      }),
    ).toEqual({
      lockKey: null,
      concurrencyKey: "jobop:global:provider-api",
      concurrencyLimit: 4,
    });
    expect(
      jobOperationKeys({
        operationKey: "sync",
        entity: { entityType: "company", entityId: "cik1", entityKey: " custom:key " },
        concurrencyLimit: 0,
      }),
    ).toEqual({
      lockKey: "jobop:global:sync:custom:key",
      concurrencyKey: "jobop:global:sync",
      concurrencyLimit: 1,
    });
  });

  it("enqueues operation jobs with entity metadata in the payload", async () => {
    const jobs = new MemoryDurableJobs();
    const job = await enqueueJobOperation(jobs, {
      jobType: "generate_copy",
      operationKey: "generate-copy",
      orgId: "org_1",
      siteId: "site_1",
      entity: { entityType: "page", entityId: "page_1", entityLabel: "Home" },
      payload: { tone: "direct" },
    });

    expect(job).toMatchObject({
      jobType: "generate_copy",
      orgId: "org_1",
      siteId: "site_1",
      lockKey: "jobop:site:site_1:generate-copy:page:page_1",
      concurrencyKey: "jobop:site:site_1:generate-copy",
      enqueuePolicy: "dedupe_active",
      payload: {
        tone: "direct",
        operationKey: "generate-copy",
        entityType: "page",
        entityId: "page_1",
        entityKey: "page:page_1",
        entityLabel: "Home",
      },
    });
  });

  it("enqueues non-deduped operation jobs with scheduling options", async () => {
    const jobs = new MemoryDurableJobs();
    const job = await enqueueJobOperation(jobs, {
      jobType: "sync",
      operationKey: "sync",
      dedupeActive: false,
      maxAttempts: null,
      availableAt: "2026-06-07T01:00:00.000Z",
      payload: { n: 1 },
    });

    expect(job).toMatchObject({
      enqueuePolicy: "enqueue",
      lockKey: null,
      concurrencyLimit: 1,
      availableAt: "2026-06-07T01:00:00.000Z",
      payload: { n: 1, operationKey: "sync" },
    });
  });
});

describe("PostgresJobStore", () => {
  it("rejects unsafe identifiers", () => {
    expect(() => new PostgresJobStore(new RecordingPostgresSql(), { tableName: "jobs;drop" })).toThrow(
      "Invalid Postgres identifier",
    );
  });

  it("supports custom Postgres job tables without metadata/site columns", async () => {
    const sql = new RecordingPostgresSql();
    const store = new PostgresJobStore(sql, {
      tableName: "graph_jobs",
      columns: {
        orgId: "graph_id",
        siteId: null,
        metadataJson: null,
        attemptCount: "attempts",
        availableAt: "run_after",
        startedAt: "locked_at",
        completedAt: "finished_at",
        lastError: "error_message",
      },
      statusMap: { stopped: "cancelled" },
      reverseStatusMap: { cancelled: "stopped" },
      initialResult: {},
    });

    const job = await store.enqueue({
      jobType: "clinical_trials_import",
      orgId: "graph_1",
      payload: { queueName: "sample-ingest", page: 1 },
      maxAttempts: 4,
    });

    expect(job).toMatchObject({
      jobType: "clinical_trials_import",
      orgId: "graph_1",
      status: "queued",
      payload: { queueName: "sample-ingest", page: 1 },
      result: {},
      metadata: {},
      maxAttempts: 4,
    });
    expect(sql.queries[0].query).toContain("INSERT INTO \"graph_jobs\"");
    expect(sql.queries[0].query).toContain("\"graph_id\"");
    expect(sql.queries[0].query).toContain("\"run_after\"");
    expect(sql.queries[0].query).not.toContain("metadata_json");
    expect(sql.queries[1].query).toContain("'{}'::jsonb AS \"metadataJson\"");
  });

  it("uses metadata queue names, default columns, status maps, and active-lock dedupe", async () => {
    const sql = new RecordingPostgresSql();
    sql.row = {
      jobId: "job_existing",
      orgId: "org_1",
      siteId: "site_1",
      queueName: "priority",
      jobType: "demo",
      status: "cancelled",
      payloadJson: { n: 1 },
      resultJson: null,
      metadataJson: { queueName: "priority" },
      parentJobId: null,
      lockKey: "lock_1",
      concurrencyKey: "ckey",
      concurrencyLimit: "2",
      enqueuePolicy: "dedupe_active",
      attemptCount: "1",
      maxAttempts: "5",
      availableAt: new Date("2026-06-07T00:00:00.000Z"),
      startedAt: undefined,
      completedAt: undefined,
      lastError: "",
      createdAt: new Date("2026-06-07T00:00:00.000Z"),
      updatedAt: new Date("2026-06-07T00:00:01.000Z"),
    };
    const store = new PostgresJobStore(sql, {
      reverseStatusMap: { cancelled: "stopped" },
      statusMap: { stopped: "cancelled" },
    });

    const existing = await store.enqueue({
      jobType: "demo",
      payload: ["not-record"],
      metadata: { queueName: "priority" },
      enqueuePolicy: "dedupe_active",
      lockKey: "lock_1",
    });

    expect(existing).toMatchObject({
      jobId: "job_existing",
      status: "stopped",
      metadata: { queueName: "priority" },
      concurrencyLimit: 2,
    });
    expect(sql.queries[0].query).toContain("WHERE \"lock_key\" = $1");
  });

  it("generates SQL for claim, completion, requeue, stop, and child updates", async () => {
    const sql = new RecordingPostgresSql();
    const store = new PostgresJobStore(sql, {
      tableName: "graph_jobs",
      queueName: "sample-ingest",
      columns: {
        orgId: "graph_id",
        siteId: null,
        metadataJson: null,
        attemptCount: "attempts",
        availableAt: "run_after",
        startedAt: "locked_at",
        completedAt: "finished_at",
        lastError: "error_message",
      },
      statusMap: { stopped: "cancelled" },
      reverseStatusMap: { cancelled: "stopped" },
    });
    sql.row = {
      jobId: "job_pg",
      orgId: "graph_1",
      siteId: null,
      queueName: "sample-ingest",
      jobType: "demo",
      status: "queued",
      payloadJson: "{}",
      resultJson: "{}",
      metadataJson: "{}",
      parentJobId: null,
      lockKey: null,
      concurrencyKey: null,
      concurrencyLimit: null,
      enqueuePolicy: "enqueue",
      attemptCount: 0,
      maxAttempts: 3,
      availableAt: "2026-06-07T00:00:00.000Z",
      startedAt: null,
      completedAt: null,
      lastError: null,
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    };

    await store.claim("job_pg");
    await store.succeed("job_pg", { ok: true });
    await store.requeue("job_pg", { payload: { retry: true }, result: { waiting: true }, availableAt: null, lastError: "retry" });
    await store.stop("job_pg");
    await store.fail("job_pg", new Error("failed"));
    await store.requestStop("job_pg");
    await store.markQueuedChildrenTerminal("job_parent", "failed", "bad");
    await store.markQueuedChildrenTerminal("job_parent", "stopped", "stop");
    await store.requestStopActiveChildren("job_parent");

    const combined = sql.queries.map((query) => query.query).join("\n");
    expect(combined).toContain("AND \"queue_name\" = $2");
    expect(combined).toContain("\"status\" = 'running'");
    expect(combined).toContain("\"status\" = $1");
    expect(combined).toContain("\"status\" = 'queued'");
    expect(combined).toContain("THEN 'cancelled'");
    expect(combined).toContain("SELECT COUNT(*)::int AS changed FROM updated");
  });
});

describe("PipelineManager", () => {
  it("advances steps and sends delayed continuations", async () => {
    const enqueued: Array<{ job: unknown; options: QueueSendOptions | undefined }> = [];
    const pipeline = new PipelineManager<"fetch" | "load", { page: number }>({
      pipeline: "demo",
      steps: ["fetch", "load"],
      makeContinuationId: () => "cont_test",
      enqueue: async (job, options) => {
        enqueued.push({ job, options });
      },
      handlers: {
        fetch: async () => ({ state: { page: 2 }, nextStepDelaySeconds: 3 }),
        load: async () => ({ nextStep: null, completion: { status: "ok", targetsTotal: 1, targetsSucceeded: 1, targetsFailed: 0 } }),
      },
    });

    await expect(pipeline.run({ pipeline: "demo", runId: "run1", step: "fetch", state: { page: 1 } })).resolves.toMatchObject({
      nextStep: "load",
      state: { page: 2 },
      completion: null,
    });
    expect(enqueued).toEqual([
      {
        job: { pipeline: "demo", runId: "run1", step: "load", continuationId: "cont_test", state: { page: 2 } },
        options: { delaySeconds: 3 },
      },
    ]);
  });

  it("honors explicit next steps, omitted continuation ids, and default completion", async () => {
    const enqueued: Array<{ job: unknown; options: QueueSendOptions | undefined }> = [];
    const pipeline = new PipelineManager<"a" | "b" | "c", { n: number }>({
      pipeline: "demo",
      steps: ["a", "b", "c"],
      enqueue: async (job, options) => {
        enqueued.push({ job, options });
      },
      handlers: {
        a: async ({ job }) => ({ nextStep: { step: "c", state: { n: job.state.n + 2 } } }),
        b: async () => ({ nextStep: null }),
        c: async () => undefined,
      },
    });

    expect(pipeline.getNextStep("a")).toBe("b");
    await expect(pipeline.run({ pipeline: "demo", runId: "run2", step: "a", state: { n: 1 } })).resolves.toMatchObject({
      nextStep: "c",
      state: { n: 3 },
    });
    expect(enqueued).toEqual([{ job: { pipeline: "demo", runId: "run2", step: "c", state: { n: 3 } }, options: undefined }]);
    await expect(pipeline.run({ pipeline: "demo", runId: "run2", step: "c", state: { n: 3 } })).resolves.toMatchObject({
      completion: { status: "completed", targetsTotal: 0, targetsSucceeded: 0, targetsFailed: 0 },
    });
    await expect(pipeline.run({ pipeline: "other", runId: "run2", step: "a", state: { n: 1 } })).rejects.toThrow("Unexpected pipeline");
    expect(() => pipeline.getNextStep("missing" as "a")).toThrow("Unknown pipeline step");
  });

  it("honors explicit null next steps and explicit completion payloads", async () => {
    const enqueued: unknown[] = [];
    const pipeline = new PipelineManager<"a" | "b", { n: number }>({
      pipeline: "demo",
      steps: ["a", "b"],
      enqueue: async (job) => {
        enqueued.push(job);
      },
      handlers: {
        a: async () => ({
          nextStep: null,
          completion: { status: "skipped", targetsTotal: 2, targetsSucceeded: 0, targetsFailed: 0, message: null },
        }),
        b: async () => undefined,
      },
    });

    await expect(pipeline.run({ pipeline: "demo", runId: "run3", step: "a", state: { n: 1 } })).resolves.toEqual({
      nextStep: null,
      state: { n: 1 },
      completion: { status: "skipped", targetsTotal: 2, targetsSucceeded: 0, targetsFailed: 0, message: null },
    });
    expect(enqueued).toEqual([]);
  });
});

describe("createJobPublisher", () => {
  it("supports queue and inline modes with the same interface", async () => {
    const sent: unknown[] = [];
    const queued = createJobPublisher<{ id: string }>({
      queue: { send: async (message) => void sent.push(message) },
    });
    await queued.put({ id: "queued" });

    const handled: unknown[] = [];
    const inline = createJobPublisher<{ id: string }>({
      inline: true,
      handleInline: async (message) => void handled.push(message),
    });
    await inline.put({ id: "inline" });

    expect(sent).toEqual([{ id: "queued" }]);
    expect(handled).toEqual([{ id: "inline" }]);
  });

  it("rejects missing queue and inline handlers", async () => {
    await expect(createJobPublisher<{ id: string }>({}).put({ id: "none" })).rejects.toThrow("Job queue is not configured");
    await expect(createJobPublisher<{ id: string }>({ inline: true }).put({ id: "inline" })).rejects.toThrow(
      "Inline job publisher requires handleInline",
    );
  });
});

const noopEvents = {
  info: async () => undefined,
  warn: async () => undefined,
  error: async () => undefined,
};

class MemoryDurableJobs implements DurableJobRepository {
  private readonly rows = new Map<string, JobRecord>();
  private sequence = 0;

  async enqueue<TPayload = unknown>(input: EnqueueJobInput<TPayload>): Promise<JobRecord<TPayload>> {
    if (input.enqueuePolicy === "dedupe_active" && input.lockKey) {
      const existing = [...this.rows.values()].find(
        (row) => row.lockKey === input.lockKey && ["queued", "running", "stopping"].includes(row.status),
      );
      if (existing) return existing as JobRecord<TPayload>;
    }
    const now = "2026-06-07T00:00:00.000Z";
    const row: JobRecord<TPayload> = {
      jobId: `job_${++this.sequence}`,
      jobType: input.jobType,
      status: "queued",
      payload: (input.payload ?? {}) as TPayload,
      result: null,
      orgId: input.orgId ?? null,
      siteId: input.siteId ?? null,
      parentJobId: input.parentJobId ?? null,
      lockKey: input.lockKey ?? null,
      concurrencyKey: input.concurrencyKey ?? null,
      concurrencyLimit: input.concurrencyLimit ?? null,
      enqueuePolicy: input.enqueuePolicy ?? "enqueue",
      metadata: input.metadata ?? {},
      attemptCount: 0,
      maxAttempts: Math.max(1, Math.floor(input.maxAttempts ?? 3)),
      availableAt: input.availableAt ?? null,
      startedAt: null,
      completedAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(row.jobId, row as JobRecord);
    return row;
  }

  async get<TPayload = unknown, TResult = unknown>(jobId: string): Promise<JobRecord<TPayload, TResult> | null> {
    return (this.rows.get(jobId) as JobRecord<TPayload, TResult> | undefined) ?? null;
  }

  async claim<TPayload = unknown>(jobId: string): Promise<JobRecord<TPayload> | null> {
    const row = this.rows.get(jobId) as JobRecord<TPayload> | undefined;
    if (!row || row.status !== "queued") return null;
    row.status = "running";
    row.attemptCount += 1;
    row.startedAt = "2026-06-07T00:00:01.000Z";
    return row;
  }

  async succeed<TResult = unknown>(jobId: string, result: TResult | null = null): Promise<void> {
    this.complete(jobId, "succeeded", result, null);
  }

  async requeue<TPayload = unknown, TResult = unknown>(
    jobId: string,
    input: { payload?: TPayload; result?: TResult | null; availableAt?: string | null; lastError?: string | null } = {},
  ): Promise<void> {
    const row = this.rows.get(jobId);
    if (!row) return;
    row.status = "queued";
    if (input.payload !== undefined) row.payload = input.payload;
    row.result = (input.result ?? null) as never;
    row.availableAt = input.availableAt ?? null;
    row.lastError = input.lastError ?? null;
  }

  async fail(jobId: string, error: unknown): Promise<void> {
    this.complete(jobId, "failed", null, error instanceof Error ? error.message : String(error));
  }

  async stop<TResult = unknown>(jobId: string, result: TResult | null = null): Promise<void> {
    this.complete(jobId, "stopped", result, null);
  }

  async requestStop(jobId: string): Promise<void> {
    const row = this.rows.get(jobId);
    if (!row) return;
    row.status = row.status === "queued" ? "stopped" : "stopping";
  }

  async listChildren(parentJobId: string): Promise<JobRecord[]> {
    return [...this.rows.values()].filter((row) => row.parentJobId === parentJobId);
  }

  async summarizeChildren(parentJobId: string): Promise<JobChildrenSummary> {
    const children = await this.listChildren(parentJobId);
    return {
      parentJobId,
      total: children.length,
      queued: children.filter((row) => row.status === "queued").length,
      running: children.filter((row) => row.status === "running").length,
      stopping: children.filter((row) => row.status === "stopping").length,
      succeeded: children.filter((row) => row.status === "succeeded").length,
      failed: children.filter((row) => row.status === "failed").length,
      stopped: children.filter((row) => row.status === "stopped").length,
      active: children.filter((row) => !["succeeded", "failed", "stopped"].includes(row.status)).length,
      terminal: children.filter((row) => ["succeeded", "failed", "stopped"].includes(row.status)).length,
      allTerminal: children.length > 0 && children.every((row) => ["succeeded", "failed", "stopped"].includes(row.status)),
    };
  }

  async markQueuedChildrenTerminal(parentJobId: string, status: "failed" | "stopped", error?: unknown): Promise<number> {
    let changed = 0;
    for (const row of await this.listChildren(parentJobId)) {
      if (row.status !== "queued") continue;
      row.status = status;
      row.lastError = status === "failed" && error ? (error instanceof Error ? error.message : String(error)) : null;
      changed += 1;
    }
    return changed;
  }

  async requestStopActiveChildren(parentJobId: string): Promise<number> {
    let changed = 0;
    for (const row of await this.listChildren(parentJobId)) {
      if (row.status !== "running") continue;
      row.status = "stopping";
      changed += 1;
    }
    return changed;
  }

  private complete<TResult>(jobId: string, status: "succeeded" | "failed" | "stopped", result: TResult | null, lastError: string | null): void {
    const row = this.rows.get(jobId);
    if (!row) return;
    row.status = status;
    row.result = result;
    row.lastError = lastError;
    row.completedAt = "2026-06-07T00:00:02.000Z";
  }
}

class RecordingPostgresSql {
  readonly queries: Array<{ query: string; values: readonly unknown[] }> = [];
  row: Record<string, unknown> | null = null;

  async unsafe<Row extends object = Record<string, unknown>>(
    query: string,
    values: readonly unknown[] = [],
  ): Promise<Row[]> {
    this.queries.push({ query, values });
    if (query.includes("INSERT INTO")) {
      this.row = {
        jobId: String(values[0]),
        orgId: values[1] as string | null,
        siteId: null,
        queueName: values[2] as string | null,
        jobType: values[3] as string,
        status: "queued",
        payloadJson: values[5] as string,
        resultJson: "null",
        metadataJson: "{}",
        parentJobId: values[7] as string | null,
        lockKey: values[8] as string | null,
        concurrencyKey: values[9] as string | null,
        concurrencyLimit: values[10] as number | null,
        enqueuePolicy: values[11] as string,
        attemptCount: 0,
        maxAttempts: values[12] as number,
        availableAt: "2026-06-07T00:00:00.000Z",
        startedAt: null,
        completedAt: null,
        lastError: null,
        createdAt: "2026-06-07T00:00:00.000Z",
        updatedAt: "2026-06-07T00:00:00.000Z",
      };
      return [];
    }
    return this.row ? ([this.row] as Row[]) : [];
  }
}
