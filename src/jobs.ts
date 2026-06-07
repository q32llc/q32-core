import type { D1DatabaseLike } from "./d1.js";
import { parseJsonColumn, stringifyJsonColumn } from "./d1.js";
import { createId } from "./ids.js";
import { isFutureIso, nowIso } from "./time.js";

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type JobHandlerResult<TResult = unknown> =
  | { kind: "done"; result?: TResult | null }
  | { kind: "requeue"; result?: TResult | null; availableAt?: string | null };

export type JobRecord<TPayload = unknown, TResult = unknown> = {
  jobId: string;
  jobType: string;
  status: JobStatus;
  payload: TPayload;
  result: TResult | null;
  lockKey: string | null;
  attemptCount: number;
  maxAttempts: number;
  availableAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EnqueueJobInput<TPayload = unknown> = {
  jobType: string;
  payload?: TPayload;
  lockKey?: string | null;
  maxAttempts?: number;
  availableAt?: string | null;
};

export class D1JobStore {
  constructor(
    private readonly db: D1DatabaseLike,
    private readonly options: { tableName?: string; idPrefix?: string } = {},
  ) {}

  get tableName(): string {
    return this.options.tableName ?? "jobs";
  }

  async enqueue<TPayload = unknown>(input: EnqueueJobInput<TPayload>): Promise<JobRecord<TPayload>> {
    const jobId = createId(this.options.idPrefix ?? "job");
    const now = nowIso();
    await this.db
      .prepare(
        `INSERT INTO ${this.tableName} (
          job_id, job_type, status, payload_json, result_json, lock_key,
          attempt_count, max_attempts, available_at, created_at, updated_at
        ) VALUES (?, ?, 'queued', ?, NULL, ?, 0, ?, ?, ?, ?)`,
      )
      .bind(
        jobId,
        input.jobType,
        stringifyJsonColumn(input.payload ?? {}),
        input.lockKey ?? null,
        Math.max(1, Math.floor(input.maxAttempts ?? 3)),
        input.availableAt ?? null,
        now,
        now,
      )
      .run();

    const job = await this.get<TPayload>(jobId);
    if (!job) throw new Error(`Failed to load enqueued job: ${jobId}`);
    return job;
  }

  async get<TPayload = unknown, TResult = unknown>(jobId: string): Promise<JobRecord<TPayload, TResult> | null> {
    const row = await this.db
      .prepare(
        `SELECT
          job_id AS jobId,
          job_type AS jobType,
          status,
          payload_json AS payloadJson,
          result_json AS resultJson,
          lock_key AS lockKey,
          attempt_count AS attemptCount,
          max_attempts AS maxAttempts,
          available_at AS availableAt,
          started_at AS startedAt,
          completed_at AS completedAt,
          last_error AS lastError,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM ${this.tableName}
        WHERE job_id = ?
        LIMIT 1`,
      )
      .bind(jobId)
      .first<JobRow>();
    return row ? rowToJob<TPayload, TResult>(row) : null;
  }

  async listQueued(limit = 25): Promise<JobRecord[]> {
    const now = nowIso();
    const rows = await this.db
      .prepare(
        `SELECT
          job_id AS jobId, job_type AS jobType, status, payload_json AS payloadJson,
          result_json AS resultJson, lock_key AS lockKey, attempt_count AS attemptCount,
          max_attempts AS maxAttempts, available_at AS availableAt, started_at AS startedAt,
          completed_at AS completedAt, last_error AS lastError, created_at AS createdAt, updated_at AS updatedAt
        FROM ${this.tableName}
        WHERE status = 'queued' AND (available_at IS NULL OR available_at <= ?)
        ORDER BY created_at ASC
        LIMIT ?`,
      )
      .bind(now, Math.max(1, Math.min(100, Math.floor(limit))))
      .all<JobRow>();
    return (rows.results ?? []).map(rowToJob);
  }

  async claim<TPayload = unknown>(jobId: string): Promise<JobRecord<TPayload> | null> {
    const current = await this.get<TPayload>(jobId);
    if (!current || current.status === "succeeded" || current.status === "failed") return null;
    if (current.status === "queued" && isFutureIso(current.availableAt)) return null;
    if (current.attemptCount >= current.maxAttempts) {
      await this.fail(jobId, "Job exhausted all attempts.");
      return null;
    }

    const now = nowIso();
    const result = await this.db
      .prepare(
        `UPDATE ${this.tableName}
         SET status = 'running',
             attempt_count = attempt_count + 1,
             started_at = COALESCE(started_at, ?),
             updated_at = ?,
             last_error = NULL
         WHERE job_id = ?
           AND status IN ('queued', 'running')
           AND (available_at IS NULL OR available_at <= ?)`,
      )
      .bind(now, now, jobId, now)
      .run();

    if (!Number(result.meta.changes ?? 0)) return null;
    return this.get<TPayload>(jobId);
  }

  async succeed<TResult = unknown>(jobId: string, result: TResult | null = null): Promise<void> {
    const now = nowIso();
    await this.db
      .prepare(
        `UPDATE ${this.tableName}
         SET status = 'succeeded', result_json = ?, completed_at = ?, updated_at = ?
         WHERE job_id = ?`,
      )
      .bind(stringifyJsonColumn(result), now, now, jobId)
      .run();
  }

  async requeue<TResult = unknown>(jobId: string, result: TResult | null = null, availableAt: string | null = null): Promise<void> {
    const now = nowIso();
    await this.db
      .prepare(
        `UPDATE ${this.tableName}
         SET status = 'queued', result_json = ?, available_at = ?, updated_at = ?
         WHERE job_id = ?`,
      )
      .bind(stringifyJsonColumn(result), availableAt, now, jobId)
      .run();
  }

  async fail(jobId: string, error: unknown): Promise<void> {
    const now = nowIso();
    const message = error instanceof Error ? error.message : String(error);
    await this.db
      .prepare(
        `UPDATE ${this.tableName}
         SET status = 'failed', last_error = ?, completed_at = ?, updated_at = ?
         WHERE job_id = ?`,
      )
      .bind(message, now, now, jobId)
      .run();
  }

  async run<TPayload = unknown, TResult = unknown>(
    jobId: string,
    handler: (job: JobRecord<TPayload, TResult>) => Promise<JobHandlerResult<TResult> | TResult | void>,
  ): Promise<JobHandlerResult<TResult>> {
    const job = await this.claim<TPayload>(jobId);
    if (!job) return { kind: "done", result: null };

    try {
      const output = await handler(job as JobRecord<TPayload, TResult>);
      const normalized = normalizeJobResult<TResult>(output);
      if (normalized.kind === "requeue") {
        await this.requeue(jobId, normalized.result ?? null, normalized.availableAt ?? null);
      } else {
        await this.succeed(jobId, normalized.result ?? null);
      }
      return normalized;
    } catch (error) {
      const latest = await this.get(jobId);
      if (latest && latest.attemptCount < latest.maxAttempts) {
        await this.requeue(jobId, { retryError: error instanceof Error ? error.message : String(error) });
        return { kind: "requeue", result: null };
      }
      await this.fail(jobId, error);
      throw error;
    }
  }
}

export const D1_JOBS_SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  lock_key TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_lock_key_idx ON jobs(lock_key)
  WHERE lock_key IS NOT NULL AND status IN ('queued', 'running');
`;

type JobRow = {
  jobId: string;
  jobType: string;
  status: JobStatus;
  payloadJson: string;
  resultJson: string | null;
  lockKey: string | null;
  attemptCount: number;
  maxAttempts: number;
  availableAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

function rowToJob<TPayload = unknown, TResult = unknown>(row: JobRow): JobRecord<TPayload, TResult> {
  return {
    jobId: row.jobId,
    jobType: row.jobType,
    status: row.status,
    payload: parseJsonColumn<TPayload>(row.payloadJson, {} as TPayload),
    result: parseJsonColumn<TResult | null>(row.resultJson, null),
    lockKey: row.lockKey,
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
