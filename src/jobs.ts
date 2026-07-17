import type { D1DatabaseLike } from "./d1.js";
import { parseJsonColumn, stringifyJsonColumn } from "./d1.js";
import { createId } from "./ids.js";
import { isFutureIso, nowIso } from "./time.js";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "stopping" | "stopped";
export type TerminalJobStatus = "succeeded" | "failed" | "stopped";
export type JobEnqueuePolicy = "enqueue" | "dedupe_active";

export type JobHandlerResult<TResult = unknown, TPayload = unknown> =
  | { kind: "done"; result?: TResult | null }
  | { kind: "requeue"; payload?: TPayload; result?: TResult | null; availableAt?: string | null }
  | { kind: "stopped"; result?: TResult | null };

export type JobRecord<TPayload = unknown, TResult = unknown> = {
  jobId: string;
  jobType: string;
  status: JobStatus;
  payload: TPayload;
  result: TResult | null;
  orgId: string | null;
  siteId: string | null;
  parentJobId: string | null;
  lockKey: string | null;
  concurrencyKey: string | null;
  concurrencyLimit: number | null;
  enqueuePolicy: JobEnqueuePolicy;
  metadata: Record<string, unknown>;
  attemptCount: number;
  maxAttempts: number;
  availableAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JobListFilters = {
  status?: JobStatus | null;
  jobType?: string | null;
  orgId?: string | null;
  siteId?: string | null;
  parentJobId?: string | null;
  createdAfter?: string | null;
  createdBefore?: string | null;
  limit?: number;
};

export type EnqueueJobInput<TPayload = unknown> = {
  jobType: string;
  payload?: TPayload;
  orgId?: string | null;
  siteId?: string | null;
  parentJobId?: string | null;
  lockKey?: string | null;
  concurrencyKey?: string | null;
  concurrencyLimit?: number | null;
  enqueuePolicy?: JobEnqueuePolicy;
  metadata?: Record<string, unknown> | null;
  maxAttempts?: number;
  availableAt?: string | null;
};

export type DurableJobEventInput = {
  eventName: string;
  status?: "started" | "ok" | "warning" | "error" | "skipped" | string;
  severity?: "debug" | "info" | "warn" | "error";
  message?: string | null;
  error?: unknown;
  metrics?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export type DurableJobEventSink<TPayload = unknown, TResult = unknown> = (
  job: JobRecord<TPayload, TResult>,
  event: DurableJobEventInput,
) => Promise<void> | void;

export interface DurableJobRepository {
  enqueue<TPayload = unknown>(input: EnqueueJobInput<TPayload>): Promise<JobRecord<TPayload>>;
  get<TPayload = unknown, TResult = unknown>(jobId: string): Promise<JobRecord<TPayload, TResult> | null>;
  claim<TPayload = unknown>(jobId: string): Promise<JobRecord<TPayload> | null>;
  succeed<TResult = unknown>(jobId: string, result?: TResult | null): Promise<void>;
  requeue<TPayload = unknown, TResult = unknown>(
    jobId: string,
    input?: { payload?: TPayload; result?: TResult | null; availableAt?: string | null; lastError?: string | null },
  ): Promise<void>;
  fail(jobId: string, error: unknown): Promise<void>;
  stop<TResult = unknown>(jobId: string, result?: TResult | null): Promise<void>;
  requestStop(jobId: string): Promise<void>;
  listChildren(parentJobId: string): Promise<JobRecord[]>;
  summarizeChildren(parentJobId: string): Promise<JobChildrenSummary>;
  markQueuedChildrenTerminal(parentJobId: string, status: "failed" | "stopped", error?: unknown): Promise<number>;
  requestStopActiveChildren(parentJobId: string): Promise<number>;
}

export type JobStatusEventInput<TPayload = unknown, TResult = unknown> = {
  job: JobRecord<TPayload, TResult>;
  status: JobStatus;
  message: string;
  error?: unknown;
  metadata?: Record<string, unknown> | null;
};

export type JobStatusEventSink = (event: JobStatusEventInput) => Promise<void> | void;

export type JobChildrenSummary = {
  parentJobId: string;
  total: number;
  queued: number;
  running: number;
  stopping: number;
  succeeded: number;
  failed: number;
  stopped: number;
  active: number;
  terminal: number;
  allTerminal: boolean;
};

export type JobTreeRollupStatus = "queued" | "running" | "succeeded" | "failed" | "stopped";

export type JobEntityState = {
  jobId: string;
  jobType: string;
  status: JobStatus;
  entityKey: string;
  entityType: string | null;
  entityId: string | null;
  label: string | null;
  lastError: string | null;
  result: unknown;
  depth: number;
};

export type JobActivityEvent = {
  opsEventId: string;
  jobId: string | null;
  level: "info" | "warn" | "error";
  eventType: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type JobTreeRecord<TPayload = unknown, TResult = unknown> = {
  root: JobRecord<TPayload, TResult>;
  children: Array<JobRecord & { depth: number }>;
  summary: JobChildrenSummary;
  rollupStatus: JobTreeRollupStatus;
  rowStates: JobEntityState[];
  activityEvents: JobActivityEvent[];
  latestError: string | null;
};

export type DurableJobHandlerContext<TPayload = unknown, TResult = unknown, TServices = unknown> = {
  job: JobRecord<TPayload, TResult>;
  jobs: DurableJobRepository;
  services: TServices;
  events: {
    info(input: Omit<DurableJobEventInput, "severity">): Promise<void>;
    warn(input: Omit<DurableJobEventInput, "severity">): Promise<void>;
    error(input: Omit<DurableJobEventInput, "severity">): Promise<void>;
  };
  shouldStop(): Promise<boolean>;
};

export class JobDeadline {
  private readonly startedAt = Date.now();

  constructor(private readonly budgetMs = 50_000) {}

  shouldYield(): boolean {
    return Date.now() - this.startedAt >= this.budgetMs;
  }
}

export type JobOperationEntity = {
  entityType: string;
  entityId: string;
  entityLabel?: string | null;
  entityKey?: string | null;
};

export type EnqueueJobOperationInput<TPayload extends Record<string, unknown> = Record<string, unknown>> = {
  jobType: string;
  operationKey: string;
  orgId?: string | null;
  siteId?: string | null;
  parentJobId?: string | null;
  entity?: JobOperationEntity | null;
  payload?: TPayload | null;
  dedupeActive?: boolean;
  concurrencyScope?: string | null;
  concurrencyLimit?: number | null;
  maxAttempts?: number | null;
  availableAt?: string | null;
};

export type JobOperationKeys = {
  lockKey: string | null;
  concurrencyKey: string;
  concurrencyLimit: number;
};

export type DurableJobHandler<TPayload = unknown, TResult = unknown, TServices = unknown> = (
  context: DurableJobHandlerContext<TPayload, TResult, TServices>,
) => Promise<JobHandlerResult<TResult, TPayload> | TResult | void>;

export type DurableJobRegistry<TServices = unknown> = Record<string, DurableJobHandler<unknown, unknown, TServices>>;

export type DurableJobDispatcherOptions<TServices = unknown> = {
  jobs: DurableJobRepository;
  handlers: DurableJobRegistry<TServices>;
  services: TServices;
  events?: DurableJobEventSink;
  retryDelay?: (input: { job: JobRecord; error: unknown }) => string | null | undefined;
};

export class DurableJobDispatcher<TServices = unknown> {
  constructor(private readonly options: DurableJobDispatcherOptions<TServices>) {}

  async run<TResult = unknown>(jobId: string): Promise<JobHandlerResult<TResult>> {
    const job = await this.options.jobs.claim(jobId);
    if (!job) return { kind: "done", result: null };

    const handler = this.options.handlers[job.jobType];
    if (!handler) {
      await this.options.jobs.fail(job.jobId, `No handler registered for job type: ${job.jobType}`);
      throw new Error(`No handler registered for job type: ${job.jobType}`);
    }

    const events = new DurableJobEvents(job, this.options.events);
    await events.info({ eventName: "job.started", status: "started", message: "Job started." });

    try {
      if (await this.shouldStop(job.jobId)) {
        await this.options.jobs.stop(job.jobId);
        await events.warn({ eventName: "job.stopped", status: "skipped", message: "Job stopped before handler ran." });
        return { kind: "stopped", result: null };
      }

      const output = await handler({
        job,
        jobs: this.options.jobs,
        services: this.options.services,
        events,
        shouldStop: () => this.shouldStop(job.jobId),
      });
      const normalized = normalizeJobResult<TResult>(output as JobHandlerResult<TResult> | TResult | void);
      if (normalized.kind === "requeue") {
        await this.options.jobs.requeue(job.jobId, {
          payload: normalized.payload,
          result: normalized.result ?? null,
          availableAt: normalized.availableAt ?? null,
        });
        await events.info({ eventName: "job.requeued", status: "started", message: "Job requeued." });
      } else if (normalized.kind === "stopped") {
        await this.options.jobs.stop(job.jobId, normalized.result ?? null);
        await events.warn({ eventName: "job.stopped", status: "skipped", message: "Job stopped." });
      } else {
        await this.options.jobs.succeed(job.jobId, normalized.result ?? null);
        await events.info({ eventName: "job.succeeded", status: "ok", message: "Job succeeded." });
      }
      return normalized;
    } catch (error) {
      const latest = await this.options.jobs.get(job.jobId);
      if (latest && latest.attemptCount < latest.maxAttempts) {
        await this.options.jobs.requeue(job.jobId, {
          result: { retryError: errorMessage(error) },
          availableAt: this.options.retryDelay?.({ job: latest, error }) ?? null,
          lastError: errorMessage(error),
        });
        await events.warn({ eventName: "job.retrying", status: "warning", message: "Job failed and will retry.", error });
        return { kind: "requeue", result: null };
      }
      await this.options.jobs.fail(job.jobId, error);
      await events.error({ eventName: "job.failed", status: "error", message: "Job failed.", error });
      throw error;
    }
  }

  private async shouldStop(jobId: string): Promise<boolean> {
    const latest = await this.options.jobs.get(jobId);
    return latest?.status === "stopping" || latest?.status === "stopped";
  }
}

export type ParentJobOrchestrationInput<TPayload = unknown> = {
  children: EnqueueJobInput<TPayload>[];
  failureMode?: "fail_fast" | "continue";
  queuedSiblingPolicy?: "fail" | "stop";
  pollSeconds?: number;
  now?: () => Date;
  onChildQueued?: (job: JobRecord<TPayload>) => Promise<void> | void;
};

export type ParentJobOrchestrationResult = {
  stage: "waiting_children" | "complete";
  failureMode: "fail_fast" | "continue";
  queuedSiblingPolicy: "fail" | "stop";
  childJobIds: string[];
  summary: JobChildrenSummary;
};

export async function runParentJobOrchestration<TPayload = unknown, TResult = unknown, TServices = unknown>(
  context: DurableJobHandlerContext<TPayload, TResult, TServices>,
  input: ParentJobOrchestrationInput<TPayload>,
): Promise<JobHandlerResult> {
  const existing = await context.jobs.listChildren(context.job.jobId);
  const failureMode = input.failureMode ?? "fail_fast";
  const queuedSiblingPolicy = input.queuedSiblingPolicy ?? "fail";
  if (existing.length === 0) {
    if (input.children.length === 0) {
      return {
        kind: "done",
        result: {
          stage: "complete",
          failureMode,
          queuedSiblingPolicy,
          childJobIds: [],
          summary: emptyChildrenSummary(context.job.jobId),
        } satisfies ParentJobOrchestrationResult,
      };
    }
    const children: JobRecord[] = [];
    for (const child of input.children) {
      const queued = await context.jobs.enqueue({
        ...child,
        parentJobId: child.parentJobId ?? context.job.jobId,
      });
      children.push(queued);
      await input.onChildQueued?.(queued as JobRecord<TPayload>);
    }
    await context.events.info({
      eventName: "job.children_queued",
      status: "started",
      message: "Child jobs queued.",
      metrics: { queued: input.children.length },
    });
    return requeueParent<TPayload>(context.job.payload, children, summarizeJobs(context.job.jobId, children), input);
  }

  const summary = await context.jobs.summarizeChildren(context.job.jobId);
  if (failureMode === "fail_fast" && summary.failed > 0) {
    const failedReason =
      (await context.jobs.listChildren(context.job.jobId)).find((child) => child.status === "failed" && child.lastError)
        ?.lastError ?? `Child job failed for parent ${context.job.jobId}.`;
    if (queuedSiblingPolicy === "stop") {
      await context.jobs.markQueuedChildrenTerminal(context.job.jobId, "stopped", failedReason);
    } else {
      await context.jobs.markQueuedChildrenTerminal(context.job.jobId, "failed", failedReason);
    }
    await context.jobs.requestStopActiveChildren(context.job.jobId);
    await context.events.warn({
      eventName: "job.children_failed",
      status: "warning",
      message: "One or more child jobs failed.",
      metrics: summary,
    });
    const updated = await context.jobs.summarizeChildren(context.job.jobId);
    if (!updated.allTerminal) {
      const children = await context.jobs.listChildren(context.job.jobId);
      return requeueParent<TPayload>(context.job.payload, children, updated, input);
    }
    throw new Error(failedReason);
  }

  const children = await context.jobs.listChildren(context.job.jobId);
  if (!summary.allTerminal) return requeueParent<TPayload>(context.job.payload, children, summary, input);
  return {
    kind: "done",
    result: {
      stage: "complete",
      failureMode,
      queuedSiblingPolicy,
      childJobIds: children.map((child) => child.jobId),
      summary,
    } satisfies ParentJobOrchestrationResult,
  };
}

export class D1JobStore implements DurableJobRepository {
  constructor(
    private readonly db: D1DatabaseLike,
    private readonly options: {
      tableName?: string;
      idPrefix?: string;
      staleRunningAfterSeconds?: number;
      opsEventsTableName?: string;
      defaultMaxAttempts?: number;
      onStatusEvent?: JobStatusEventSink;
      queuedStopStatus?: "stopping" | "stopped";
      requestStopQueuedChildren?: boolean;
    } = {},
  ) {}

  get tableName(): string {
    return this.options.tableName ?? "jobs";
  }

  async enqueue<TPayload = unknown>(input: EnqueueJobInput<TPayload>): Promise<JobRecord<TPayload>> {
    const jobId = createId(this.options.idPrefix ?? "job");
    const now = nowIso();
    const enqueuePolicy = input.enqueuePolicy ?? "enqueue";
    if (enqueuePolicy === "dedupe_active" && input.lockKey) {
      const existing = await this.getActiveForLockKey<TPayload>(input.lockKey);
      if (existing) return existing;
    }

    await this.db
      .prepare(
        `INSERT INTO ${this.tableName} (
          job_id, job_type, status, org_id, site_id, payload_json, result_json, metadata_json,
          parent_job_id, lock_key, concurrency_key, concurrency_limit, enqueue_policy,
          attempt_count, max_attempts, available_at, created_at, updated_at
        ) VALUES (?, ?, 'queued', ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      )
      .bind(
        jobId,
        input.jobType,
        input.orgId ?? null,
        input.siteId ?? null,
        stringifyJsonColumn(input.payload ?? {}),
        stringifyJsonColumn(input.metadata ?? {}),
        input.parentJobId ?? null,
        input.lockKey ?? null,
        input.concurrencyKey ?? null,
        normalizeConcurrencyLimit(input.concurrencyLimit),
        enqueuePolicy,
        Math.max(1, Math.floor(input.maxAttempts ?? this.options.defaultMaxAttempts ?? 3)),
        input.availableAt ?? null,
        now,
        now,
      )
      .run();

    const job = await this.get<TPayload>(jobId);
    if (!job) throw new Error(`Failed to load enqueued job: ${jobId}`);
    await this.emitStatusEvent(job, "queued", "Job queued.");
    return job;
  }

  async get<TPayload = unknown, TResult = unknown>(jobId: string): Promise<JobRecord<TPayload, TResult> | null> {
    const row = await this.db
      .prepare(`${this.selectSql()} WHERE job_id = ? LIMIT 1`)
      .bind(jobId)
      .first<JobRow>();
    return row ? rowToJob<TPayload, TResult>(row) : null;
  }

  async getJob<TPayload = unknown, TResult = unknown>(jobId: string): Promise<JobRecord<TPayload, TResult> | null> {
    return this.get(jobId);
  }

  async enqueueChild<TPayload = unknown>(
    parentJobId: string,
    input: Omit<EnqueueJobInput<TPayload>, "parentJobId">,
  ): Promise<JobRecord<TPayload>> {
    return this.enqueue({ ...input, parentJobId });
  }

  async enqueueChildren<TPayload = unknown>(
    parentJobId: string,
    inputs: Array<Omit<EnqueueJobInput<TPayload>, "parentJobId">>,
  ): Promise<Array<JobRecord<TPayload>>> {
    const children: Array<JobRecord<TPayload>> = [];
    for (const input of inputs) children.push(await this.enqueueChild(parentJobId, input));
    return children;
  }

  async listQueued(limit = 25): Promise<JobRecord[]> {
    const now = nowIso();
    const rows = await this.db
      .prepare(
        `${this.selectSql()}
        WHERE status = 'queued' AND (available_at IS NULL OR available_at <= ?)
        ORDER BY created_at ASC
        LIMIT ?`,
      )
      .bind(now, Math.max(1, Math.min(100, Math.floor(limit))))
      .all<JobRow>();
    return (rows.results ?? []).map(rowToJob);
  }

  async listJobs(filters: JobListFilters = {}): Promise<JobRecord[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    for (const [column, value] of [
      ["status", filters.status],
      ["job_type", filters.jobType],
      ["org_id", filters.orgId],
      ["site_id", filters.siteId],
      ["parent_job_id", filters.parentJobId],
    ] as const) {
      if (value?.trim()) {
        conditions.push(`${column} = ?`);
        values.push(value.trim());
      }
    }
    if (filters.createdAfter?.trim()) {
      conditions.push("created_at >= ?");
      values.push(filters.createdAfter.trim());
    }
    if (filters.createdBefore?.trim()) {
      conditions.push("created_at <= ?");
      values.push(filters.createdBefore.trim());
    }
    values.push(Math.max(1, Math.min(200, Math.floor(filters.limit ?? 100))));
    const rows = await this.db
      .prepare(
        `${this.selectSql()}${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""}
         ORDER BY created_at DESC LIMIT ?`,
      )
      .bind(...(values as never[]))
      .all<JobRow>();
    return (rows.results ?? []).map(rowToJob);
  }

  async getLatestForSite(input: { siteId: string; jobType?: string | null }): Promise<JobRecord | null> {
    const row = await this.db
      .prepare(
        `${this.selectSql()}
         WHERE site_id = ?
           ${input.jobType ? "AND job_type = ?" : ""}
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .bind(...([input.siteId, ...(input.jobType ? [input.jobType] : [])] as never[]))
      .first<JobRow>();
    return row ? rowToJob(row) : null;
  }

  async getActiveForSite(input: { siteId: string; jobType?: string | null }): Promise<JobRecord | null> {
    const row = await this.db
      .prepare(
        `${this.selectSql()}
         WHERE site_id = ?
           AND status IN ('queued', 'running', 'stopping')
           ${input.jobType ? "AND job_type = ?" : ""}
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .bind(...([input.siteId, ...(input.jobType ? [input.jobType] : [])] as never[]))
      .first<JobRow>();
    return row ? rowToJob(row) : null;
  }

  async getLatestForSiteByPayload(input: {
    siteId: string;
    jobType?: string | null;
    key: string;
    value: string | number | boolean | null;
  }): Promise<JobRecord | null> {
    return this.getForSiteByPayload({ ...input, activeOnly: false });
  }

  async getActiveForSiteByPayload(input: {
    siteId: string;
    jobType?: string | null;
    key: string;
    value: string | number | boolean | null;
  }): Promise<JobRecord | null> {
    return this.getForSiteByPayload({ ...input, activeOnly: true });
  }

  async claim<TPayload = unknown>(jobId: string): Promise<JobRecord<TPayload> | null> {
    const current = await this.get<TPayload>(jobId);
    if (!current || isTerminalJobStatus(current.status) || current.status === "stopping") return null;
    if (current.status === "running") {
      if (!isStaleRunningJob(current, this.options.staleRunningAfterSeconds)) return null;
      await this.markStaleRunningQueued(jobId);
    }
    if (current.status === "queued" && isFutureIso(current.availableAt)) return null;
    if (current.attemptCount >= current.maxAttempts) {
      await this.fail(jobId, "Job exhausted all attempts.");
      return null;
    }
    if (current.concurrencyKey && current.status === "queued") {
      const limit = current.concurrencyLimit ?? 1;
      const running = await this.countRunningForConcurrencyKey(current.concurrencyKey);
      if (running >= limit) return null;
    }

    const now = nowIso();
    const result = await this.db
      .prepare(
        `UPDATE ${this.tableName}
         SET status = 'running',
             attempt_count = attempt_count + 1,
             started_at = ?,
             updated_at = ?,
             last_error = NULL
         WHERE job_id = ?
           AND status = 'queued'
           AND (available_at IS NULL OR available_at <= ?)`,
      )
      .bind(now, now, jobId, now)
      .run();

    if (!Number(result.meta.changes ?? 0)) return null;
    const job = await this.get<TPayload>(jobId);
    if (job) await this.emitStatusEvent(job, "running", "Job started.");
    return job;
  }

  async run<TPayload = unknown, TResult = unknown>(
    jobId: string,
    handler: (job: JobRecord<TPayload, TResult>) => Promise<JobHandlerResult<TResult, TPayload> | TResult | void>,
  ): Promise<JobHandlerResult<TResult>> {
    const job = await this.claim<TPayload>(jobId);
    if (!job) return { kind: "done", result: null };

    try {
      const output = await handler(job as JobRecord<TPayload, TResult>);
      const normalized = normalizeJobResult<TResult>(output);
      if (normalized.kind === "requeue") {
        await this.requeue(jobId, {
          payload: normalized.payload as TPayload | undefined,
          result: normalized.result ?? null,
          availableAt: normalized.availableAt ?? null,
        });
      } else if (normalized.kind === "stopped") {
        await this.stop(jobId, normalized.result ?? null);
      } else {
        await this.succeed(jobId, normalized.result ?? null);
      }
      return normalized;
    } catch (error) {
      const latest = await this.get(jobId);
      if (latest && latest.attemptCount < latest.maxAttempts) {
        await this.requeue(jobId, { result: { retryError: errorMessage(error) }, lastError: errorMessage(error) });
        return { kind: "requeue", result: null };
      }
      await this.fail(jobId, error);
      throw error;
    }
  }

  async succeed<TResult = unknown>(jobId: string, result: TResult | null = null): Promise<void> {
    await this.complete(jobId, "succeeded", result, null);
  }

  async stop<TResult = unknown>(jobId: string, result: TResult | null = null): Promise<void> {
    await this.complete(jobId, "stopped", result, null);
  }

  async requeue<TResult = unknown>(jobId: string, result: TResult | null, availableAt?: string | null): Promise<void>;
  async requeue<TPayload = unknown, TResult = unknown>(
    jobId: string,
    input?: { payload?: TPayload; result?: TResult | null; availableAt?: string | null; lastError?: string | null },
  ): Promise<void>;
  async requeue<TPayload = unknown, TResult = unknown>(
    jobId: string,
    inputOrResult: { payload?: TPayload; result?: TResult | null; availableAt?: string | null; lastError?: string | null } | TResult | null = {},
    legacyAvailableAt?: string | null,
  ): Promise<void> {
    const input =
      isRequeueInput(inputOrResult)
        ? inputOrResult
        : { result: inputOrResult as TResult | null, availableAt: legacyAvailableAt ?? null };
    const now = nowIso();
    const payloadSql = input.payload === undefined ? "" : "payload_json = ?,";
    const bindings = input.payload === undefined ? [] : [stringifyJsonColumn(input.payload)];
    await this.db
      .prepare(
        `UPDATE ${this.tableName}
         SET status = 'queued',
             ${payloadSql}
             result_json = ?,
             available_at = ?,
             last_error = ?,
             updated_at = ?
         WHERE job_id = ?`,
      )
      .bind(
        ...(bindings as never[]),
        stringifyJsonColumn(input.result ?? null),
        input.availableAt ?? null,
        input.lastError ?? null,
        now,
        jobId,
      )
      .run();
    const job = await this.get(jobId);
    if (job) {
      await this.emitStatusEvent(job, "queued", "Job requeued.", {
        availableAt: input.availableAt ?? null,
        ...(input.lastError ? { lastError: input.lastError } : {}),
      });
    }
  }

  async fail(jobId: string, error: unknown): Promise<void> {
    await this.complete(jobId, "failed", null, errorMessage(error));
  }

  async requestStop(jobId: string): Promise<void> {
    const now = nowIso();
    const queuedStopStatus = this.options.queuedStopStatus ?? "stopped";
    await this.db
      .prepare(
        `UPDATE ${this.tableName}
         SET status = CASE WHEN status = 'queued' THEN ? ELSE 'stopping' END,
             completed_at = CASE WHEN status = 'queued' AND ? = 'stopped' THEN ? ELSE completed_at END,
             updated_at = ?
         WHERE job_id = ? AND status IN ('queued', 'running')`,
      )
      .bind(queuedStopStatus, queuedStopStatus, now, now, jobId)
      .run();
    const job = await this.get(jobId);
    if (job) await this.emitStatusEvent(job, job.status, "Job stop requested.");
  }

  async retryFailed(jobId: string): Promise<boolean> {
    const now = nowIso();
    const result = await this.db
      .prepare(
        `UPDATE ${this.tableName}
         SET status = 'queued', result_json = NULL, available_at = NULL, completed_at = NULL,
             last_error = NULL, max_attempts = CASE WHEN attempt_count >= max_attempts THEN attempt_count + 1 ELSE max_attempts END,
             updated_at = ?
         WHERE job_id = ? AND status = 'failed'`,
      )
      .bind(now, jobId)
      .run();
    const changed = Number(result.meta.changes ?? 0) === 1;
    if (changed) {
      const job = await this.get(jobId);
      if (job) await this.emitStatusEvent(job, "queued", "Failed job queued for an operator retry.");
    }
    return changed;
  }

  async releaseStale(jobId: string, now = new Date()): Promise<boolean> {
    const threshold = Math.max(1, this.options.staleRunningAfterSeconds ?? 15 * 60);
    const nowValue = now.toISOString();
    const cutoff = new Date(now.getTime() - threshold * 1000).toISOString();
    const result = await this.db
      .prepare(
        `UPDATE ${this.tableName}
         SET status = 'queued', available_at = NULL, started_at = NULL, completed_at = NULL,
             last_error = 'Released after an operator confirmed a stale lease.', updated_at = ?
         WHERE job_id = ? AND status IN ('running', 'stopping') AND updated_at <= ?`,
      )
      .bind(nowValue, jobId, cutoff)
      .run();
    const changed = Number(result.meta.changes ?? 0) === 1;
    if (changed) {
      const job = await this.get(jobId);
      if (job) await this.emitStatusEvent(job, "queued", "Stale job lease released by an operator.");
    }
    return changed;
  }

  async listChildren(parentJobId: string): Promise<JobRecord[]> {
    const rows = await this.db
      .prepare(`${this.selectSql()} WHERE parent_job_id = ? ORDER BY created_at ASC`)
      .bind(parentJobId)
      .all<JobRow>();
    return (rows.results ?? []).map(rowToJob);
  }

  async getJobTree<TPayload = unknown, TResult = unknown>(jobId: string): Promise<JobTreeRecord<TPayload, TResult> | null> {
    const root = await this.get<TPayload, TResult>(jobId);
    if (!root) return null;
    const rows = await this.db
      .prepare(
        `WITH RECURSIVE tree(job_id, depth) AS (
           SELECT job_id, 0 FROM ${this.tableName} WHERE job_id = ?
           UNION ALL
           SELECT jobs.job_id, tree.depth + 1
           FROM ${this.tableName} jobs
           JOIN tree ON jobs.parent_job_id = tree.job_id
         )
         SELECT
           jobs.job_id AS jobId,
           jobs.job_type AS jobType,
           jobs.status,
           jobs.org_id AS orgId,
           jobs.site_id AS siteId,
           jobs.payload_json AS payloadJson,
           jobs.result_json AS resultJson,
           jobs.metadata_json AS metadataJson,
           jobs.parent_job_id AS parentJobId,
           jobs.lock_key AS lockKey,
           jobs.concurrency_key AS concurrencyKey,
           jobs.concurrency_limit AS concurrencyLimit,
           jobs.enqueue_policy AS enqueuePolicy,
           jobs.attempt_count AS attemptCount,
           jobs.max_attempts AS maxAttempts,
           jobs.available_at AS availableAt,
           jobs.started_at AS startedAt,
           jobs.completed_at AS completedAt,
           jobs.last_error AS lastError,
           jobs.created_at AS createdAt,
           jobs.updated_at AS updatedAt,
           tree.depth AS depth
         FROM ${this.tableName} jobs
         JOIN tree ON jobs.job_id = tree.job_id
         WHERE jobs.job_id <> ?
         ORDER BY tree.depth ASC, jobs.created_at ASC`,
      )
      .bind(jobId, jobId)
      .all<JobTreeRow>();
    const children = (rows.results ?? []).map((row) => ({ ...rowToJob(row), depth: Number(row.depth) }));
    const allJobs = [root as JobRecord, ...children];
    return {
      root,
      children,
      summary: summarizeJobs(root.jobId, children),
      rollupStatus: rollupJobTreeStatus(allJobs),
      rowStates: [
        jobEntityState(root as JobRecord, 0),
        ...children.map((child) => jobEntityState(child, child.depth)),
      ],
      activityEvents: await this.listJobActivityEvents(allJobs.map((job) => job.jobId)),
      latestError: latestJobError(allJobs),
    };
  }

  async summarizeChildren(parentJobId: string): Promise<JobChildrenSummary> {
    return summarizeJobs(parentJobId, await this.listChildren(parentJobId));
  }

  async markQueuedChildrenTerminal(parentJobId: string, status: "failed" | "stopped", error?: unknown): Promise<number> {
    const now = nowIso();
    const result = await this.db
      .prepare(
        `UPDATE ${this.tableName}
         SET status = ?, last_error = ?, completed_at = ?, updated_at = ?
         WHERE parent_job_id = ? AND status = 'queued'`,
      )
      .bind(status, status === "failed" && error ? errorMessage(error) : null, now, now, parentJobId)
      .run();
    const changed = Number(result.meta.changes ?? 0);
    if (changed > 0 && this.options.onStatusEvent) {
      for (const child of await this.listChildren(parentJobId)) {
        if (child.status === status) {
          await this.emitStatusEvent(
            child,
            status,
            status === "failed" ? errorMessage(error ?? "Child job failed.") : "Job stopped.",
            error ? { reason: errorMessage(error) } : null,
          );
        }
      }
    }
    return changed;
  }

  async requestStopActiveChildren(parentJobId: string): Promise<number> {
    const now = nowIso();
    const statuses = this.options.requestStopQueuedChildren ? "'queued', 'running'" : "'running'";
    const result = await this.db
      .prepare(
        `UPDATE ${this.tableName}
         SET status = 'stopping', updated_at = ?
         WHERE parent_job_id = ? AND status IN (${statuses})`,
      )
      .bind(now, parentJobId)
      .run();
    const changed = Number(result.meta.changes ?? 0);
    if (changed > 0 && this.options.onStatusEvent) {
      for (const child of await this.listChildren(parentJobId)) {
        if (child.status === "stopping") await this.emitStatusEvent(child, "stopping", "Job stop requested.");
      }
    }
    return changed;
  }

  async failQueuedChildren(input: { parentJobId: string; reason?: string | null }): Promise<number> {
    return this.markQueuedChildrenTerminal(input.parentJobId, "failed", input.reason ?? "Child job failed.");
  }

  async stopQueuedChildren(input: { parentJobId: string; reason?: string | null }): Promise<number> {
    return this.markQueuedChildrenTerminal(input.parentJobId, "stopped", input.reason ?? "Child job stopped.");
  }

  private async getActiveForLockKey<TPayload = unknown>(lockKey: string): Promise<JobRecord<TPayload> | null> {
    const row = await this.db
      .prepare(`${this.selectSql()} WHERE lock_key = ? AND status IN ('queued', 'running', 'stopping') ORDER BY created_at ASC LIMIT 1`)
      .bind(lockKey)
      .first<JobRow>();
    return row ? rowToJob<TPayload>(row) : null;
  }

  private async countRunningForConcurrencyKey(concurrencyKey: string): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM ${this.tableName}
         WHERE concurrency_key = ? AND status IN ('running', 'stopping')`,
      )
      .bind(concurrencyKey)
      .first<{ count: number }>();
    return Number(row?.count ?? 0);
  }

  private async getForSiteByPayload(input: {
    siteId: string;
    jobType?: string | null;
    key: string;
    value: string | number | boolean | null;
    activeOnly: boolean;
  }): Promise<JobRecord | null> {
    const row = await this.db
      .prepare(
        `${this.selectSql()}
         WHERE site_id = ?
           ${input.jobType ? "AND job_type = ?" : ""}
           ${input.activeOnly ? "AND status IN ('queued', 'running', 'stopping')" : ""}
           AND json_extract(payload_json, ?) = ?
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .bind(
        ...([
          input.siteId,
          ...(input.jobType ? [input.jobType] : []),
          `$.${input.key}`,
          input.value,
        ] as never[]),
      )
      .first<JobRow>();
    return row ? rowToJob(row) : null;
  }

  private async listJobActivityEvents(jobIds: string[]): Promise<JobActivityEvent[]> {
    if (jobIds.length === 0) return [];
    const placeholders = jobIds.map(() => "?").join(", ");
    try {
      const rows = await this.db
        .prepare(
          `SELECT
             ops_event_id AS opsEventId,
             job_id AS jobId,
             level,
             event_type AS eventType,
             message,
             metadata_json AS metadataJson,
             created_at AS createdAt
           FROM ${this.options.opsEventsTableName ?? "ops_events"}
           WHERE job_id IN (${placeholders})
           ORDER BY created_at ASC
           LIMIT 200`,
        )
        .bind(...(jobIds as never[]))
        .all<JobActivityEventRow>();
      return (rows.results ?? []).map(rowToActivityEvent);
    } catch {
      return [];
    }
  }

  private async complete<TResult = unknown>(
    jobId: string,
    status: TerminalJobStatus,
    result: TResult | null,
    lastError: string | null,
  ): Promise<void> {
    const now = nowIso();
    await this.db
      .prepare(
        `UPDATE ${this.tableName}
         SET status = ?, result_json = ?, last_error = ?, completed_at = ?, updated_at = ?
         WHERE job_id = ?`,
      )
      .bind(status, stringifyJsonColumn(result), lastError, now, now, jobId)
      .run();
    const job = await this.get(jobId);
    if (job) {
      await this.emitStatusEvent(
        job,
        status,
        status === "succeeded" ? "Job succeeded." : status === "stopped" ? "Job stopped." : (lastError ?? "Job failed."),
      );
    }
  }

  private async markStaleRunningQueued(jobId: string): Promise<void> {
    const now = nowIso();
    await this.db
      .prepare(
        `UPDATE ${this.tableName}
         SET status = 'queued',
             available_at = ?,
             last_error = ?,
             updated_at = ?
         WHERE job_id = ? AND status = 'running'`,
      )
      .bind(now, "Job reclaimed after stale running lease.", now, jobId)
      .run();
    const job = await this.get(jobId);
    if (job) {
      await this.emitStatusEvent(job, "queued", "Stale running job requeued.", {
        previousStatus: "running",
      });
    }
  }

  private async emitStatusEvent(
    job: JobRecord,
    status: JobStatus,
    message: string,
    metadata?: Record<string, unknown> | null,
    error?: unknown,
  ): Promise<void> {
    await this.options.onStatusEvent?.({ job, status, message, metadata: metadata ?? null, error });
  }

  private selectSql(): string {
    return `SELECT
      job_id AS jobId,
      job_type AS jobType,
      status,
      org_id AS orgId,
      site_id AS siteId,
      payload_json AS payloadJson,
      result_json AS resultJson,
      metadata_json AS metadataJson,
      parent_job_id AS parentJobId,
      lock_key AS lockKey,
      concurrency_key AS concurrencyKey,
      concurrency_limit AS concurrencyLimit,
      enqueue_policy AS enqueuePolicy,
      attempt_count AS attemptCount,
      max_attempts AS maxAttempts,
      available_at AS availableAt,
      started_at AS startedAt,
      completed_at AS completedAt,
      last_error AS lastError,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM ${this.tableName}`;
  }
}

export type PostgresSqlLike = {
  unsafe<Row extends object = Record<string, unknown>>(query: string, values?: readonly unknown[]): Promise<Row[]>;
  json?: (value: unknown) => unknown;
};

export type PostgresJobStoreOptions = {
  tableName?: string;
  idPrefix?: string;
  queueName?: string;
  statusMap?: Partial<Record<JobStatus, string>>;
  reverseStatusMap?: Record<string, JobStatus>;
  columns?: Partial<PostgresJobColumns>;
  defaultMaxAttempts?: number;
  initialResult?: unknown;
  retryDelaySql?: string;
};

export type PostgresJobColumns = {
  jobId: string;
  orgId: string | null;
  siteId: string | null;
  queueName: string;
  jobType: string;
  status: string;
  payloadJson: string;
  resultJson: string;
  metadataJson: string | null;
  parentJobId: string | null;
  lockKey: string | null;
  concurrencyKey: string | null;
  concurrencyLimit: string | null;
  enqueuePolicy: string | null;
  attemptCount: string;
  maxAttempts: string;
  availableAt: string;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

const DEFAULT_POSTGRES_JOB_COLUMNS: PostgresJobColumns = {
  jobId: "job_id",
  orgId: "org_id",
  siteId: "site_id",
  queueName: "queue_name",
  jobType: "job_type",
  status: "status",
  payloadJson: "payload_json",
  resultJson: "result_json",
  metadataJson: "metadata_json",
  parentJobId: "parent_job_id",
  lockKey: "lock_key",
  concurrencyKey: "concurrency_key",
  concurrencyLimit: "concurrency_limit",
  enqueuePolicy: "enqueue_policy",
  attemptCount: "attempt_count",
  maxAttempts: "max_attempts",
  availableAt: "available_at",
  startedAt: "started_at",
  completedAt: "completed_at",
  lastError: "last_error",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

type PostgresJobRow = Omit<
  JobRow,
  | "payloadJson"
  | "resultJson"
  | "metadataJson"
  | "availableAt"
  | "startedAt"
  | "completedAt"
  | "createdAt"
  | "updatedAt"
> & {
  payloadJson: unknown;
  resultJson: unknown;
  metadataJson?: unknown;
  availableAt: unknown;
  startedAt: unknown;
  completedAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
};

export class PostgresJobStore implements DurableJobRepository {
  private readonly tableName: string;
  private readonly columns: PostgresJobColumns;

  constructor(
    private readonly sql: PostgresSqlLike,
    private readonly options: PostgresJobStoreOptions = {},
  ) {
    this.tableName = quotePgIdent(options.tableName ?? "jobs");
    this.columns = { ...DEFAULT_POSTGRES_JOB_COLUMNS, ...(options.columns ?? {}) };
  }

  async enqueue<TPayload = unknown>(input: EnqueueJobInput<TPayload>): Promise<JobRecord<TPayload>> {
    if (input.enqueuePolicy === "dedupe_active" && input.lockKey) {
      const existing = await this.getActiveForLockKey<TPayload>(input.lockKey);
      if (existing) return existing;
    }
    const jobId = createId(this.options.idPrefix ?? "job");
    const queueName = stringValue(input.metadata?.queueName) ?? queueNameFromPayload(input.payload) ?? this.options.queueName ?? null;
    const insertColumnKeys: Array<keyof PostgresJobColumns> = [
      "jobId",
      "orgId",
      "siteId",
      "queueName",
      "jobType",
      "status",
      "payloadJson",
      "resultJson",
      "metadataJson",
      "parentJobId",
      "lockKey",
      "concurrencyKey",
      "concurrencyLimit",
      "enqueuePolicy",
      "maxAttempts",
      "availableAt",
    ];
    const insertColumns = insertColumnKeys.filter((key) => this.columns[key] !== null);
    const insertValues: Record<keyof PostgresJobColumns, unknown> = {
      jobId,
      orgId: input.orgId ?? null,
      siteId: input.siteId ?? null,
      queueName,
      jobType: input.jobType,
      status: this.toDbStatus("queued"),
      payloadJson: jsonParam(input.payload ?? {}),
      resultJson: jsonParam(this.options.initialResult ?? null),
      metadataJson: jsonParam(input.metadata ?? {}),
      parentJobId: input.parentJobId ?? null,
      lockKey: input.lockKey ?? null,
      concurrencyKey: input.concurrencyKey ?? null,
      concurrencyLimit: normalizeConcurrencyLimit(input.concurrencyLimit),
      enqueuePolicy: input.enqueuePolicy ?? "enqueue",
      attemptCount: 0,
      maxAttempts: Math.max(1, Math.floor(input.maxAttempts ?? this.options.defaultMaxAttempts ?? 3)),
      availableAt: input.availableAt ?? null,
      startedAt: null,
      completedAt: null,
      lastError: null,
      createdAt: null,
      updatedAt: null,
    };
    const values = insertColumns.map((key) => insertValues[key]);
    await this.sql.unsafe(
      `INSERT INTO ${this.tableName} (
        ${insertColumns.map((key) => this.col(key)).join(", ")}
      ) VALUES (${insertColumns.map((key, index) => this.insertPlaceholder(key, index + 1)).join(", ")})`,
      values,
    );
    const job = await this.get<TPayload>(jobId);
    if (!job) throw new Error(`Failed to load enqueued job: ${jobId}`);
    return job;
  }

  async get<TPayload = unknown, TResult = unknown>(jobId: string): Promise<JobRecord<TPayload, TResult> | null> {
    const rows = await this.sql.unsafe<PostgresJobRow>(`${this.selectSql()} WHERE ${this.col("jobId")} = $1 LIMIT 1`, [jobId]);
    return rows[0] ? this.rowToJob<TPayload, TResult>(rows[0]) : null;
  }

  async claim<TPayload = unknown>(jobId: string): Promise<JobRecord<TPayload> | null> {
    const queueClause = this.options.queueName ? `AND ${this.col("queueName")} = $2` : "";
    const values = this.options.queueName ? [jobId, this.options.queueName] : [jobId];
    const rows = await this.sql.unsafe<PostgresJobRow>(
      `UPDATE ${this.tableName}
       SET ${this.col("status")} = '${this.toDbStatus("running")}',
           ${this.col("attemptCount")} = ${this.col("attemptCount")} + 1,
           ${this.setSql("startedAt", "now(),")}
           ${this.col("updatedAt")} = now(),
           ${this.setSql("lastError", "NULL")}
       WHERE ${this.col("jobId")} = $1
         ${queueClause}
         AND ${this.col("status")} = '${this.toDbStatus("queued")}'
         AND ${this.col("availableAt")} <= now()
         AND (
           ${this.nullableColSql("concurrencyKey", "NULL")} IS NULL
           OR (
             SELECT COUNT(*)
             FROM ${this.tableName} active
             WHERE active.${this.colRaw("concurrencyKey")} = ${this.tableName}.${this.colRaw("concurrencyKey")}
               AND active.${this.colRaw("status")} IN ('${this.toDbStatus("running")}', '${this.toDbStatus("stopping")}')
               AND active.${this.colRaw("jobId")} <> ${this.tableName}.${this.colRaw("jobId")}
           ) < COALESCE(${this.nullableColSql("concurrencyLimit", "1")}, 1)
         )
       RETURNING ${this.returningSql()}`,
      values,
    );
    return rows[0] ? this.rowToJob<TPayload>(rows[0]) : null;
  }

  async succeed<TResult = unknown>(jobId: string, result: TResult | null = null): Promise<void> {
    await this.complete(jobId, "succeeded", result, null);
  }

  async requeue<TPayload = unknown, TResult = unknown>(
    jobId: string,
    input: { payload?: TPayload; result?: TResult | null; availableAt?: string | null; lastError?: string | null } = {},
  ): Promise<void> {
    const payloadSet = input.payload === undefined ? "" : `${this.col("payloadJson")} = $5::jsonb,`;
    const values = [
      jsonParam(input.result ?? null),
      input.availableAt ?? null,
      input.lastError ?? null,
      jobId,
      ...(input.payload === undefined ? [] : [jsonParam(input.payload)]),
    ];
    await this.sql.unsafe(
      `UPDATE ${this.tableName}
       SET ${this.col("status")} = '${this.toDbStatus("queued")}',
           ${payloadSet}
           ${this.col("resultJson")} = $1::jsonb,
           ${this.col("availableAt")} = COALESCE($2::timestamptz, now()),
           ${this.setSql("lastError", "$3,")}
           ${this.col("updatedAt")} = now()
       WHERE ${this.col("jobId")} = $4`,
      values,
    );
  }

  async fail(jobId: string, error: unknown): Promise<void> {
    await this.complete(jobId, "failed", null, errorMessage(error));
  }

  async stop<TResult = unknown>(jobId: string, result: TResult | null = null): Promise<void> {
    await this.complete(jobId, "stopped", result, null);
  }

  async requestStop(jobId: string): Promise<void> {
    await this.sql.unsafe(
      `UPDATE ${this.tableName}
       SET ${this.col("status")} = CASE
             WHEN ${this.col("status")} = '${this.toDbStatus("queued")}' THEN '${this.toDbStatus("stopped")}'
             ELSE '${this.toDbStatus("stopping")}'
           END,
           ${this.setSql("completedAt", `CASE
             WHEN ${this.col("status")} = '${this.toDbStatus("queued")}' THEN now()
             ELSE ${this.col("completedAt")}
           END,`)}
           ${this.col("updatedAt")} = now()
       WHERE ${this.col("jobId")} = $1
         AND ${this.col("status")} IN ('${this.toDbStatus("queued")}', '${this.toDbStatus("running")}')`,
      [jobId],
    );
  }

  async listChildren(parentJobId: string): Promise<JobRecord[]> {
    const rows = await this.sql.unsafe<PostgresJobRow>(
      `${this.selectSql()} WHERE ${this.col("parentJobId")} = $1 ORDER BY ${this.col("createdAt")} ASC`,
      [parentJobId],
    );
    return rows.map((row) => this.rowToJob(row));
  }

  async summarizeChildren(parentJobId: string): Promise<JobChildrenSummary> {
    return summarizeJobs(parentJobId, await this.listChildren(parentJobId));
  }

  async markQueuedChildrenTerminal(parentJobId: string, status: "failed" | "stopped", error?: unknown): Promise<number> {
    const rows = await this.sql.unsafe<{ changed: number }>(
      `WITH updated AS (
         UPDATE ${this.tableName}
         SET ${this.col("status")} = $1,
             ${this.setSql("lastError", "$2,")}
             ${this.setSql("completedAt", "now(),")}
             ${this.col("updatedAt")} = now()
         WHERE ${this.col("parentJobId")} = $3
           AND ${this.col("status")} = '${this.toDbStatus("queued")}'
         RETURNING ${this.col("jobId")}
       )
       SELECT COUNT(*)::int AS changed FROM updated`,
      [this.toDbStatus(status), status === "failed" && error ? errorMessage(error) : null, parentJobId],
    );
    return Number(rows[0]?.changed ?? 0);
  }

  async requestStopActiveChildren(parentJobId: string): Promise<number> {
    const rows = await this.sql.unsafe<{ changed: number }>(
      `WITH updated AS (
         UPDATE ${this.tableName}
         SET ${this.col("status")} = '${this.toDbStatus("stopping")}',
             ${this.col("updatedAt")} = now()
         WHERE ${this.col("parentJobId")} = $1
           AND ${this.col("status")} = '${this.toDbStatus("running")}'
         RETURNING ${this.col("jobId")}
       )
       SELECT COUNT(*)::int AS changed FROM updated`,
      [parentJobId],
    );
    return Number(rows[0]?.changed ?? 0);
  }

  private async getActiveForLockKey<TPayload = unknown>(lockKey: string): Promise<JobRecord<TPayload> | null> {
    const rows = await this.sql.unsafe<PostgresJobRow>(
      `${this.selectSql()}
       WHERE ${this.col("lockKey")} = $1
         AND ${this.col("status")} IN ('${this.toDbStatus("queued")}', '${this.toDbStatus("running")}', '${this.toDbStatus("stopping")}')
       ORDER BY ${this.col("createdAt")} DESC
       LIMIT 1`,
      [lockKey],
    );
    return rows[0] ? this.rowToJob<TPayload>(rows[0]) : null;
  }

  private async complete<TResult>(jobId: string, status: TerminalJobStatus, result: TResult | null, lastError: string | null): Promise<void> {
    await this.sql.unsafe(
      `UPDATE ${this.tableName}
       SET ${this.col("status")} = $1,
           ${this.col("resultJson")} = $2::jsonb,
           ${this.setSql("lastError", "$3,")}
           ${this.setSql("completedAt", "now(),")}
           ${this.col("updatedAt")} = now()
       WHERE ${this.col("jobId")} = $4`,
      [this.toDbStatus(status), jsonParam(result), lastError, jobId],
    );
  }

  private selectSql(): string {
    return `SELECT ${this.returningSql()} FROM ${this.tableName}`;
  }

  private returningSql(): string {
    return ([
      ["jobId", "jobId"],
      ["jobType", "jobType"],
      ["status", "status"],
      ["orgId", "orgId"],
      ["siteId", "siteId"],
      ["payloadJson", "payloadJson"],
      ["resultJson", "resultJson"],
      ["metadataJson", "metadataJson"],
      ["parentJobId", "parentJobId"],
      ["lockKey", "lockKey"],
      ["concurrencyKey", "concurrencyKey"],
      ["concurrencyLimit", "concurrencyLimit"],
      ["enqueuePolicy", "enqueuePolicy"],
      ["attemptCount", "attemptCount"],
      ["maxAttempts", "maxAttempts"],
      ["availableAt", "availableAt"],
      ["startedAt", "startedAt"],
      ["completedAt", "completedAt"],
      ["lastError", "lastError"],
      ["createdAt", "createdAt"],
      ["updatedAt", "updatedAt"],
    ] as Array<[keyof PostgresJobColumns, string]>)
      .map(([key, alias]) => `${this.selectExpr(key)} AS "${alias}"`)
      .join(", ");
  }

  private rowToJob<TPayload = unknown, TResult = unknown>(row: PostgresJobRow): JobRecord<TPayload, TResult> {
    return rowToJob({
      ...row,
      status: this.fromDbStatus(String(row.status)),
      payloadJson: jsonText(row.payloadJson) ?? "{}",
      resultJson: jsonText(row.resultJson),
      metadataJson: jsonText(row.metadataJson),
      availableAt: dateText(row.availableAt),
      startedAt: dateText(row.startedAt),
      completedAt: dateText(row.completedAt),
      createdAt: dateText(row.createdAt) ?? "",
      updatedAt: dateText(row.updatedAt) ?? "",
    });
  }

  private toDbStatus(status: JobStatus): string {
    return this.options.statusMap?.[status] ?? status;
  }

  private fromDbStatus(status: string): JobStatus {
    return this.options.reverseStatusMap?.[status] ?? (status as JobStatus);
  }

  private col(key: keyof PostgresJobColumns): string {
    const column = this.columns[key];
    if (!column) throw new Error(`Postgres job column is not configured: ${String(key)}`);
    return quotePgIdent(column);
  }

  private colRaw(key: keyof PostgresJobColumns): string {
    const column = this.columns[key];
    if (!column) throw new Error(`Postgres job column is not configured: ${String(key)}`);
    return column;
  }

  private insertPlaceholder(key: keyof PostgresJobColumns, index: number): string {
    if (key === "payloadJson" || key === "resultJson" || key === "metadataJson") return `$${index}::jsonb`;
    if (key === "availableAt" || key === "startedAt" || key === "completedAt") return `COALESCE($${index}::timestamptz, now())`;
    return `$${index}`;
  }

  private nullableColSql(key: keyof PostgresJobColumns, fallback: string): string {
    return this.columns[key] ? this.col(key) : fallback;
  }

  private selectExpr(key: keyof PostgresJobColumns): string {
    if (this.columns[key]) return this.col(key);
    if (key === "metadataJson") return `'{}'::jsonb`;
    if (key === "resultJson") return `'null'::jsonb`;
    if (key === "enqueuePolicy") return `'enqueue'`;
    if (key === "concurrencyLimit" || key === "attemptCount" || key === "maxAttempts") return "0";
    return "NULL";
  }

  private setSql(key: keyof PostgresJobColumns, assignment: string): string {
    return this.columns[key] ? `${this.col(key)} = ${assignment}` : "";
  }
}

export type PipelineJob<StepName extends string, State> = {
  pipeline: string;
  runId: string;
  step: StepName;
  continuationId?: string;
  state: State;
};

export type PipelineStepHandlerInput<StepName extends string, State> = {
  job: PipelineJob<StepName, State>;
  stepIndex: number;
  isFinalStep: boolean;
};

export type PipelineCompletion = {
  status: string;
  targetsTotal: number;
  targetsSucceeded: number;
  targetsFailed: number;
  message?: string | null;
};

export type PipelineStepHandlerResult<StepName extends string, State> = {
  state?: State;
  nextStep?: { step: StepName; state?: State } | null;
  nextStepDelaySeconds?: number;
  completion?: PipelineCompletion | null;
};

export type PipelineStepHandler<StepName extends string, State> = (
  input: PipelineStepHandlerInput<StepName, State>,
) => Promise<PipelineStepHandlerResult<StepName, State> | undefined> | Promise<void>;

export type PipelineManagerOptions<StepName extends string, State> = {
  pipeline: string;
  steps: readonly StepName[];
  handlers: Record<StepName, PipelineStepHandler<StepName, State>>;
  enqueue: (job: PipelineJob<StepName, State>, options?: { delaySeconds?: number }) => Promise<void>;
  makeContinuationId?: () => string;
};

export class PipelineManager<StepName extends string, State> {
  constructor(private readonly options: PipelineManagerOptions<StepName, State>) {}

  getNextStep(step: StepName): StepName | null {
    const index = this.options.steps.indexOf(step);
    if (index === -1) throw new Error(`Unknown pipeline step: ${step}`);
    return this.options.steps[index + 1] ?? null;
  }

  async run(job: PipelineJob<StepName, State>): Promise<{
    nextStep: StepName | null;
    state: State;
    completion: PipelineCompletion | null;
  }> {
    if (job.pipeline !== this.options.pipeline) throw new Error(`Unexpected pipeline: ${job.pipeline}`);
    const stepIndex = this.options.steps.indexOf(job.step);
    if (stepIndex === -1) throw new Error(`Unknown pipeline step: ${job.step}`);

    const defaultNextStep = this.options.steps[stepIndex + 1] ?? null;
    const result = await this.options.handlers[job.step]({
      job,
      stepIndex,
      isFinalStep: defaultNextStep === null,
    });
    const nextState = result?.state ?? job.state;
    const explicitNextStep = result?.nextStep;
    const nextStep =
      explicitNextStep === undefined
        ? defaultNextStep
        : explicitNextStep === null
          ? null
          : (explicitNextStep.step as StepName);
    const enqueuedState = explicitNextStep && explicitNextStep !== null ? (explicitNextStep.state ?? nextState) : nextState;

    if (nextStep) {
      const continuationId = this.options.makeContinuationId?.();
      const nextJob = {
        pipeline: job.pipeline,
        runId: job.runId,
        step: nextStep,
        ...(continuationId ? { continuationId } : {}),
        state: enqueuedState,
      };
      if (result?.nextStepDelaySeconds === undefined) await this.options.enqueue(nextJob);
      else await this.options.enqueue(nextJob, { delaySeconds: result.nextStepDelaySeconds });
    }

    const completion =
      result?.completion ??
      (nextStep === null && defaultNextStep === null
        ? {
            status: "completed",
            targetsTotal: 0,
            targetsSucceeded: 0,
            targetsFailed: 0,
            message: `${job.pipeline} pipeline completed`,
          }
        : null);

    return { nextStep, state: enqueuedState, completion };
  }
}

export type QueueSendOptions = { delaySeconds?: number };
export type QueueBindingLike<TMessage> = {
  send(message: TMessage, options?: QueueSendOptions): Promise<void>;
};

export type JobPublisher<TMessage> = {
  put(message: TMessage, options?: QueueSendOptions): Promise<void>;
};

export type JobPublisherOptions<TMessage> = {
  queue?: QueueBindingLike<TMessage>;
  inline?: boolean;
  handleInline?: (message: TMessage) => Promise<void>;
  onQueued?: (message: TMessage, options: QueueSendOptions & { mode: "inline" | "queue" }) => Promise<void> | void;
};

export function createJobPublisher<TMessage>(options: JobPublisherOptions<TMessage>): JobPublisher<TMessage> {
  return {
    async put(message, sendOptions = {}) {
      if (options.inline) {
        if (!options.handleInline) throw new Error("Inline job publisher requires handleInline.");
        await options.onQueued?.(message, { ...sendOptions, mode: "inline" });
        await options.handleInline(message);
        return;
      }
      if (!options.queue) throw new Error("Job queue is not configured.");
      await options.onQueued?.(message, { ...sendOptions, mode: "queue" });
      await options.queue.send(message, sendOptions);
    },
  };
}

export async function enqueueJobOperation<TPayload extends Record<string, unknown> = Record<string, unknown>>(
  jobs: Pick<DurableJobRepository, "enqueue">,
  input: EnqueueJobOperationInput<TPayload>,
): Promise<JobRecord> {
  const keys = jobOperationKeys(input);
  return jobs.enqueue({
    jobType: input.jobType,
    orgId: input.orgId ?? null,
    siteId: input.siteId ?? null,
    parentJobId: input.parentJobId ?? null,
    payload: jobOperationPayload(input),
    lockKey: keys.lockKey,
    concurrencyKey: keys.concurrencyKey,
    concurrencyLimit: keys.concurrencyLimit,
    enqueuePolicy: input.dedupeActive === false ? "enqueue" : "dedupe_active",
    maxAttempts: input.maxAttempts ?? undefined,
    availableAt: input.availableAt ?? null,
  });
}

export function jobOperationKeys(input: {
  operationKey: string;
  siteId?: string | null;
  entity?: JobOperationEntity | null;
  dedupeActive?: boolean;
  concurrencyScope?: string | null;
  concurrencyLimit?: number | null;
}): JobOperationKeys {
  const scope = keyPart(input.siteId ? `site:${input.siteId}` : "global");
  const operation = keyPart(input.operationKey);
  const entityKey = input.entity ? jobOperationEntityKey(input.entity) : null;
  const concurrencyScope = keyPart(input.concurrencyScope ?? input.operationKey);
  return {
    lockKey:
      input.dedupeActive === false
        ? null
        : ["jobop", scope, operation, entityKey ? keyPart(entityKey) : "root"].join(":"),
    concurrencyKey: ["jobop", scope, concurrencyScope].join(":"),
    concurrencyLimit: normalizeOperationConcurrencyLimit(input.concurrencyLimit),
  };
}

export const D1_JOBS_SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  org_id TEXT,
  site_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  parent_job_id TEXT,
  lock_key TEXT,
  concurrency_key TEXT,
  concurrency_limit INTEGER,
  enqueue_policy TEXT NOT NULL DEFAULT 'enqueue',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  available_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_status_available_idx ON jobs(status, available_at, created_at);
CREATE INDEX IF NOT EXISTS jobs_type_status_idx ON jobs(job_type, status, created_at);
CREATE INDEX IF NOT EXISTS jobs_org_status_idx ON jobs(org_id, status, created_at);
CREATE INDEX IF NOT EXISTS jobs_site_status_idx ON jobs(site_id, status, created_at);
CREATE INDEX IF NOT EXISTS jobs_parent_status_idx ON jobs(parent_job_id, status, created_at);
CREATE INDEX IF NOT EXISTS jobs_concurrency_active_idx ON jobs(concurrency_key, status)
  WHERE concurrency_key IS NOT NULL AND status IN ('running', 'stopping');
CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_lock_key_idx ON jobs(lock_key)
  WHERE lock_key IS NOT NULL AND status IN ('queued', 'running', 'stopping');
`;

type JobRow = {
  jobId: string;
  jobType: string;
  status: JobStatus;
  orgId?: string | null;
  siteId?: string | null;
  payloadJson: string;
  resultJson: string | null;
  metadataJson?: string | null;
  parentJobId?: string | null;
  lockKey: string | null;
  concurrencyKey?: string | null;
  concurrencyLimit?: number | null;
  enqueuePolicy?: JobEnqueuePolicy | null;
  attemptCount: number;
  maxAttempts: number;
  availableAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

type JobTreeRow = JobRow & {
  depth: number | string;
};

type JobActivityEventRow = {
  opsEventId: string;
  jobId: string | null;
  level: string;
  eventType: string;
  message: string;
  metadataJson: string | null;
  createdAt: string;
};

function rowToJob<TPayload = unknown, TResult = unknown>(row: JobRow): JobRecord<TPayload, TResult> {
  return {
    jobId: row.jobId,
    jobType: row.jobType,
    status: row.status,
    payload: parseJsonColumn<TPayload>(row.payloadJson, {} as TPayload),
    result: parseJsonColumn<TResult | null>(row.resultJson, null),
    orgId: row.orgId ?? null,
    siteId: row.siteId ?? null,
    parentJobId: row.parentJobId ?? null,
    lockKey: row.lockKey,
    concurrencyKey: row.concurrencyKey ?? null,
    concurrencyLimit: row.concurrencyLimit === undefined || row.concurrencyLimit === null ? null : Number(row.concurrencyLimit),
    enqueuePolicy: row.enqueuePolicy ?? "enqueue",
    metadata: parseJsonColumn<Record<string, unknown>>(row.metadataJson, {}),
    attemptCount: Number(row.attemptCount),
    maxAttempts: Number(row.maxAttempts),
    availableAt: row.availableAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeJobResult<TResult>(output: JobHandlerResult<TResult> | TResult | void): JobHandlerResult<TResult> {
  if (output && typeof output === "object" && "kind" in output) return output as JobHandlerResult<TResult>;
  return { kind: "done", result: (output ?? null) as TResult | null };
}

function quotePgIdent(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Invalid Postgres identifier: ${value}`);
  return `"${value}"`;
}

function jsonText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function jsonParam(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function queueNameFromPayload(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return stringValue((value as Record<string, unknown>).queueName);
}

function dateText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return String(value);
}

function rowToActivityEvent(row: JobActivityEventRow): JobActivityEvent {
  const level = row.level === "warn" || row.level === "error" ? row.level : "info";
  return {
    opsEventId: row.opsEventId,
    jobId: row.jobId,
    level,
    eventType: row.eventType,
    message: row.message,
    metadata: parseJsonColumn<Record<string, unknown> | null>(row.metadataJson, null),
    createdAt: row.createdAt,
  };
}

function summarizeJobs(parentJobId: string, jobs: readonly JobRecord[]): JobChildrenSummary {
  const summary: JobChildrenSummary = {
    parentJobId,
    total: jobs.length,
    queued: 0,
    running: 0,
    stopping: 0,
    succeeded: 0,
    failed: 0,
    stopped: 0,
    active: 0,
    terminal: 0,
    allTerminal: jobs.length > 0,
  };
  for (const job of jobs) {
    summary[job.status] += 1;
    if (isTerminalJobStatus(job.status)) summary.terminal += 1;
    else summary.active += 1;
  }
  summary.allTerminal = summary.total > 0 && summary.terminal === summary.total;
  return summary;
}

function rollupJobTreeStatus(jobs: readonly JobRecord[]): JobTreeRollupStatus {
  if (jobs.some((job) => job.status === "failed")) return "failed";
  if (jobs.some((job) => job.status === "stopped")) return "stopped";
  if (jobs.some((job) => job.status === "running" || job.status === "stopping")) return "running";
  if (jobs.some((job) => job.status === "queued")) return "queued";
  return "succeeded";
}

function latestJobError(jobs: readonly JobRecord[]): string | null {
  return (
    [...jobs]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .find((job) => job.lastError && job.lastError.trim().length > 0)?.lastError ?? null
  );
}

function jobEntityState(job: JobRecord, depth: number): JobEntityState {
  const payload = isRecord(job.payload) ? job.payload : {};
  const entityType = stringValue(payload.entityType);
  const entityId = stringValue(payload.entityId);
  const entityKey = stringValue(payload.entityKey) ?? (entityType && entityId ? `${entityType}:${entityId}` : job.jobId);
  return {
    jobId: job.jobId,
    jobType: job.jobType,
    status: job.status,
    entityKey,
    entityType,
    entityId,
    label: stringValue(payload.entityLabel),
    lastError: job.lastError,
    result: job.result,
    depth,
  };
}

function emptyChildrenSummary(parentJobId: string): JobChildrenSummary {
  return summarizeJobs(parentJobId, []);
}

function requeueParent<TPayload>(
  payload: TPayload,
  children: readonly JobRecord[],
  summary: JobChildrenSummary,
  input: ParentJobOrchestrationInput<TPayload>,
): JobHandlerResult {
  const pollSeconds = Math.max(1, Math.floor(input.pollSeconds ?? 10));
  const now = input.now?.() ?? new Date();
  return {
    kind: "requeue",
    payload,
    result: {
      stage: "waiting_children",
      failureMode: input.failureMode ?? "fail_fast",
      queuedSiblingPolicy: input.queuedSiblingPolicy ?? "fail",
      childJobIds: children.map((child) => child.jobId),
      summary,
    } satisfies ParentJobOrchestrationResult,
    availableAt: new Date(now.getTime() + pollSeconds * 1000).toISOString(),
  };
}

function isTerminalJobStatus(status: JobStatus): status is TerminalJobStatus {
  return status === "succeeded" || status === "failed" || status === "stopped";
}

function normalizeConcurrencyLimit(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Math.max(1, Math.floor(value));
}

function jobOperationPayload<TPayload extends Record<string, unknown>>(
  input: EnqueueJobOperationInput<TPayload>,
): Record<string, unknown> {
  return {
    ...(input.payload ?? {}),
    operationKey: input.operationKey,
    ...(input.entity
      ? {
          entityType: input.entity.entityType,
          entityId: input.entity.entityId,
          entityKey: jobOperationEntityKey(input.entity),
          ...(input.entity.entityLabel ? { entityLabel: input.entity.entityLabel } : {}),
        }
      : {}),
  };
}

function jobOperationEntityKey(entity: JobOperationEntity): string {
  return entity.entityKey?.trim() || `${entity.entityType}:${entity.entityId}`;
}

function keyPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeOperationConcurrencyLimit(value: number | null | undefined): number {
  if (!Number.isFinite(value) || !value) return 1;
  return Math.max(1, Math.floor(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function isRequeueInput(value: unknown): value is {
  payload?: unknown;
  result?: unknown;
  availableAt?: string | null;
  lastError?: string | null;
} {
  return (
    !!value &&
    typeof value === "object" &&
    ("payload" in value || "result" in value || "availableAt" in value || "lastError" in value)
  );
}

function isStaleRunningJob(job: JobRecord, staleRunningAfterSeconds: number | undefined): boolean {
  if (!staleRunningAfterSeconds || staleRunningAfterSeconds <= 0 || !job.startedAt) return false;
  const startedAt = Date.parse(job.startedAt);
  if (!Number.isFinite(startedAt)) return false;
  return Date.now() - startedAt >= staleRunningAfterSeconds * 1000;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class DurableJobEvents<TPayload = unknown, TResult = unknown> {
  constructor(
    private readonly job: JobRecord<TPayload, TResult>,
    private readonly sink: DurableJobEventSink<TPayload, TResult> | undefined,
  ) {}

  async info(input: Omit<DurableJobEventInput, "severity">): Promise<void> {
    await this.emit({ ...input, severity: "info" });
  }

  async warn(input: Omit<DurableJobEventInput, "severity">): Promise<void> {
    await this.emit({ ...input, severity: "warn" });
  }

  async error(input: Omit<DurableJobEventInput, "severity">): Promise<void> {
    await this.emit({ ...input, severity: "error" });
  }

  private async emit(input: DurableJobEventInput): Promise<void> {
    await this.sink?.(this.job, input);
  }
}
