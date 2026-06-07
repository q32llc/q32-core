import { describe, expect, it } from "vitest";
import { D1JobStore, type JobRecord } from "../src/jobs.js";
import type { D1DatabaseLike, D1PreparedStatementLike, D1Primitive, D1StatementResult } from "../src/d1.js";

describe("D1JobStore", () => {
  it("enqueues and runs a job", async () => {
    const db = new MemoryJobDb();
    const store = new D1JobStore(db);
    const job = await store.enqueue({ jobType: "demo", payload: { n: 1 } });

    await expect(store.get(job.jobId)).resolves.toMatchObject({ status: "queued", payload: { n: 1 } });
    const result = await store.run<{ n: number }, { ok: boolean }>(job.jobId, async (record) => {
      expect(record.payload.n).toBe(1);
      return { ok: true };
    });

    expect(result).toEqual({ kind: "done", result: { ok: true } });
    await expect(store.get(job.jobId)).resolves.toMatchObject({ status: "succeeded", result: { ok: true } });
  });

  it("requeues handler-directed work and lists queued jobs", async () => {
    const db = new MemoryJobDb();
    const store = new D1JobStore(db);
    const job = await store.enqueue({ jobType: "demo", payload: { n: 2 } });

    await expect(store.listQueued()).resolves.toHaveLength(1);
    await expect(
      store.run(job.jobId, async () => ({ kind: "requeue", result: { waiting: true }, availableAt: null })),
    ).resolves.toEqual({ kind: "requeue", result: { waiting: true }, availableAt: null });
    await expect(store.get(job.jobId)).resolves.toMatchObject({ status: "queued", result: { waiting: true } });
  });

  it("fails exhausted jobs", async () => {
    const db = new MemoryJobDb();
    const store = new D1JobStore(db);
    const job = await store.enqueue({ jobType: "demo", maxAttempts: 1 });

    await expect(store.run(job.jobId, async () => {
      throw new Error("bad");
    })).rejects.toThrow("bad");
    await expect(store.get(job.jobId)).resolves.toMatchObject({ status: "failed", lastError: "bad" });
  });
});

class MemoryJobDb implements D1DatabaseLike {
  rows = new Map<string, JobRecord>();

  prepare(query: string): D1PreparedStatementLike {
    return new MemoryStatement(this, query);
  }

  async batch(statements: D1PreparedStatementLike[]): Promise<D1StatementResult[]> {
    return Promise.all(statements.map((statement) => statement.run()));
  }

  async exec(): Promise<unknown> {
    return undefined;
  }
}

class MemoryStatement implements D1PreparedStatementLike {
  private bindings: D1Primitive[] = [];

  constructor(
    private readonly db: MemoryJobDb,
    private readonly query: string,
  ) {}

  bind(...values: D1Primitive[]): D1PreparedStatementLike {
    this.bindings = values;
    return this;
  }

  async run(): Promise<D1StatementResult> {
    const q = this.query.toLowerCase();
    if (q.includes("insert into jobs")) {
      const [jobId, jobType, payloadJson, lockKey, maxAttempts, availableAt, createdAt, updatedAt] = this.bindings;
      this.db.rows.set(String(jobId), {
        jobId: String(jobId),
        jobType: String(jobType),
        status: "queued",
        payload: JSON.parse(String(payloadJson)),
        result: null,
        lockKey: lockKey ? String(lockKey) : null,
        attemptCount: 0,
        maxAttempts: Number(maxAttempts),
        availableAt: availableAt ? String(availableAt) : null,
        startedAt: null,
        completedAt: null,
        lastError: null,
        createdAt: String(createdAt),
        updatedAt: String(updatedAt),
      });
      return changed(1);
    }
    if (q.includes("set status = 'running'")) {
      const [, updatedAt, jobId] = this.bindings;
      const row = this.db.rows.get(String(jobId));
      if (!row) return changed(0);
      row.status = "running";
      row.attemptCount += 1;
      row.startedAt ??= String(updatedAt);
      row.updatedAt = String(updatedAt);
      return changed(1);
    }
    if (q.includes("set status = 'succeeded'")) {
      const [resultJson, completedAt, updatedAt, jobId] = this.bindings;
      const row = this.db.rows.get(String(jobId));
      if (!row) return changed(0);
      row.status = "succeeded";
      row.result = JSON.parse(String(resultJson));
      row.completedAt = String(completedAt);
      row.updatedAt = String(updatedAt);
      return changed(1);
    }
    if (q.includes("set status = 'queued'")) {
      const [resultJson, availableAt, updatedAt, jobId] = this.bindings;
      const row = this.db.rows.get(String(jobId));
      if (!row) return changed(0);
      row.status = "queued";
      row.result = JSON.parse(String(resultJson));
      row.availableAt = availableAt ? String(availableAt) : null;
      row.updatedAt = String(updatedAt);
      return changed(1);
    }
    if (q.includes("set status = 'failed'")) {
      const [lastError, completedAt, updatedAt, jobId] = this.bindings;
      const row = this.db.rows.get(String(jobId));
      if (!row) return changed(0);
      row.status = "failed";
      row.lastError = String(lastError);
      row.completedAt = String(completedAt);
      row.updatedAt = String(updatedAt);
      return changed(1);
    }
    return changed(0);
  }

  async first<T extends object>(): Promise<T | null> {
    const jobId = String(this.bindings[0]);
    const row = this.db.rows.get(jobId);
    return row ? (toDbRow(row) as T) : null;
  }

  async all<T extends object>(): Promise<{ results: T[] }> {
    return { results: [...this.db.rows.values()].map((row) => toDbRow(row) as T) };
  }
}

function changed(changes: number): D1StatementResult {
  return { success: true, meta: { changes } };
}

function toDbRow(row: JobRecord): Record<string, unknown> {
  return {
    jobId: row.jobId,
    jobType: row.jobType,
    status: row.status,
    payloadJson: JSON.stringify(row.payload),
    resultJson: row.result === null ? null : JSON.stringify(row.result),
    lockKey: row.lockKey,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    availableAt: row.availableAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
