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

  it("supports app status event hooks and max attempt policy", async () => {
    const db = new MemoryJobDb();
    const events: Array<{ status: string; message: string; attempts: number }> = [];
    const store = new D1JobStore(db, {
      defaultMaxAttempts: 1,
      onStatusEvent: ({ job, status, message }) => {
        events.push({ status, message, attempts: job.maxAttempts });
      },
    });
    const job = await store.enqueue({ jobType: "demo" });

    await store.run(job.jobId, async () => ({ ok: true }));

    expect(events).toEqual([
      { status: "queued", message: "Job queued.", attempts: 1 },
      { status: "running", message: "Job started.", attempts: 1 },
      { status: "succeeded", message: "Job succeeded.", attempts: 1 },
    ]);
  });

  it("supports dedupe, site lookups, child stop/fail helpers, and stop policy options", async () => {
    const db = new MemoryJobDb();
    const events: Array<{ jobId: string; status: string; message: string; reason: string | null }> = [];
    const store = new D1JobStore(db, {
      queuedStopStatus: "stopping",
      requestStopQueuedChildren: true,
      onStatusEvent: ({ job, status, message, metadata }) => {
        events.push({
          jobId: job.jobId,
          status,
          message,
          reason: typeof metadata?.reason === "string" ? metadata.reason : null,
        });
      },
    });

    const first = await store.enqueue({
      jobType: "sync",
      orgId: "org_1",
      siteId: "site_1",
      payload: { externalId: "abc", entityType: "company", entityId: "cik1", entityLabel: "Issuer" },
      lockKey: "lock:abc",
      enqueuePolicy: "dedupe_active",
    });
    const duplicate = await store.enqueue({
      jobType: "sync",
      siteId: "site_1",
      lockKey: "lock:abc",
      enqueuePolicy: "dedupe_active",
    });
    expect(duplicate.jobId).toBe(first.jobId);

    await expect(store.getLatestForSite({ siteId: "site_1", jobType: "sync" })).resolves.toMatchObject({
      jobId: first.jobId,
    });
    await expect(
      store.getActiveForSiteByPayload({ siteId: "site_1", jobType: "sync", key: "externalId", value: "abc" }),
    ).resolves.toMatchObject({ jobId: first.jobId });

    const childA = await store.enqueueChild(first.jobId, { jobType: "child", payload: { entityKey: "child:a" } });
    const childB = await store.enqueueChild(first.jobId, { jobType: "child", payload: { entityKey: "child:b" } });
    expect(await store.markQueuedChildrenTerminal(first.jobId, "failed", "sibling failed")).toBe(2);
    await expect(store.summarizeChildren(first.jobId)).resolves.toMatchObject({ failed: 2, terminal: 2, allTerminal: true });
    expect(events.filter((event) => event.status === "failed").map((event) => event.reason)).toContain("sibling failed");

    const tree = await store.getJobTree(first.jobId);
    expect(tree).toMatchObject({
      root: { jobId: first.jobId },
      summary: { failed: 2 },
      latestError: "sibling failed",
    });
    expect(tree?.rowStates.map((state) => state.entityKey)).toEqual(
      expect.arrayContaining(["company:cik1", "child:a", "child:b"]),
    );
    expect(tree?.children.map((child) => child.jobId)).toEqual(expect.arrayContaining([childA.jobId, childB.jobId]));

    const stopMe = await store.enqueue({ jobType: "stop", siteId: "site_1" });
    await store.requestStop(stopMe.jobId);
    await expect(store.get(stopMe.jobId)).resolves.toMatchObject({ status: "stopping", completedAt: null });

    const activeParent = await store.enqueue({ jobType: "parent" });
    await store.enqueueChild(activeParent.jobId, { jobType: "queued_child" });
    expect(await store.requestStopActiveChildren(activeParent.jobId)).toBe(1);
    await expect(store.summarizeChildren(activeParent.jobId)).resolves.toMatchObject({ stopping: 1, active: 1 });
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
      const [
        jobId,
        jobType,
        orgId,
        siteId,
        payloadJson,
        metadataJson,
        parentJobId,
        lockKey,
        concurrencyKey,
        concurrencyLimit,
        enqueuePolicy,
        maxAttempts,
        availableAt,
        createdAt,
        updatedAt,
      ] = this.bindings;
      this.db.rows.set(String(jobId), {
        jobId: String(jobId),
        jobType: String(jobType),
        status: "queued",
        payload: JSON.parse(String(payloadJson)),
        result: null,
        orgId: orgId ? String(orgId) : null,
        siteId: siteId ? String(siteId) : null,
        parentJobId: parentJobId ? String(parentJobId) : null,
        lockKey: lockKey ? String(lockKey) : null,
        concurrencyKey: concurrencyKey ? String(concurrencyKey) : null,
        concurrencyLimit: concurrencyLimit === null ? null : Number(concurrencyLimit),
        enqueuePolicy: enqueuePolicy === "dedupe_active" ? "dedupe_active" : "enqueue",
        metadata: JSON.parse(String(metadataJson)),
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
      const [startedAt, updatedAt, jobId] = this.bindings;
      const row = this.db.rows.get(String(jobId));
      if (!row) return changed(0);
      row.status = "running";
      row.attemptCount += 1;
      row.startedAt = String(startedAt);
      row.updatedAt = String(updatedAt);
      return changed(1);
    }
    if (q.includes("case when status = 'queued' then ? else 'stopping'")) {
      const [queuedStopStatus, , completedAt, updatedAt, jobId] = this.bindings;
      const row = this.db.rows.get(String(jobId));
      if (!row || !["queued", "running"].includes(row.status)) return changed(0);
      const wasQueued = row.status === "queued";
      row.status = wasQueued ? (queuedStopStatus as JobRecord["status"]) : "stopping";
      row.completedAt = wasQueued && queuedStopStatus === "stopped" ? String(completedAt) : row.completedAt;
      row.updatedAt = String(updatedAt);
      return changed(1);
    }
    if (q.includes("where parent_job_id = ? and status = 'queued'")) {
      const [status, lastError, completedAt, updatedAt, parentJobId] = this.bindings;
      let changes = 0;
      for (const row of this.db.rows.values()) {
        if (row.parentJobId !== parentJobId || row.status !== "queued") continue;
        row.status = status as JobRecord["status"];
        row.lastError = lastError ? String(lastError) : null;
        row.completedAt = String(completedAt);
        row.updatedAt = String(updatedAt);
        changes += 1;
      }
      return changed(changes);
    }
    if (q.includes("where parent_job_id = ? and status in")) {
      const [updatedAt, parentJobId] = this.bindings;
      let changes = 0;
      for (const row of this.db.rows.values()) {
        if (row.parentJobId !== parentJobId || !["queued", "running"].includes(row.status)) continue;
        row.status = "stopping";
        row.updatedAt = String(updatedAt);
        changes += 1;
      }
      return changed(changes);
    }
    if (q.includes("set status = ?") && q.includes("result_json = ?")) {
      const [status, resultJson, lastError, completedAt, updatedAt, jobId] = this.bindings;
      const row = this.db.rows.get(String(jobId));
      if (!row) return changed(0);
      row.status = status as JobRecord["status"];
      row.result = JSON.parse(String(resultJson));
      row.lastError = lastError ? String(lastError) : null;
      row.completedAt = String(completedAt);
      row.updatedAt = String(updatedAt);
      return changed(1);
    }
    if (q.includes("set status = 'queued'")) {
      const [resultJson, availableAt, lastError, updatedAt, jobId] = this.bindings;
      const row = this.db.rows.get(String(jobId));
      if (!row) return changed(0);
      row.status = "queued";
      row.result = JSON.parse(String(resultJson));
      row.availableAt = availableAt ? String(availableAt) : null;
      row.lastError = lastError ? String(lastError) : null;
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
    const q = this.query.toLowerCase();
    let row: JobRecord | undefined;
    if (q.includes("where lock_key = ?")) {
      const lockKey = String(this.bindings[0]);
      row = [...this.db.rows.values()].find((candidate) => candidate.lockKey === lockKey && ["queued", "running", "stopping"].includes(candidate.status));
    } else if (q.includes("where site_id = ?")) {
      const [siteId, maybeJobType, maybePath, maybeValue] = this.bindings;
      row = [...this.db.rows.values()]
        .filter((candidate) => candidate.siteId === siteId)
        .filter((candidate) => !q.includes("and job_type = ?") || candidate.jobType === maybeJobType)
        .filter((candidate) => !q.includes("status in") || ["queued", "running", "stopping"].includes(candidate.status))
        .filter((candidate) => {
          if (!q.includes("json_extract")) return true;
          const key = String(maybePath).replace(/^\$\./, "");
          return (candidate.payload as Record<string, unknown>)[key] === maybeValue;
        })
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    } else if (q.includes("select count(*) as count")) {
      return { count: 0 } as T;
    } else {
      const jobId = String(this.bindings[0]);
      row = this.db.rows.get(jobId);
    }
    return row ? (toDbRow(row) as T) : null;
  }

  async all<T extends object>(): Promise<{ results: T[] }> {
    const q = this.query.toLowerCase();
    if (q.includes("where parent_job_id = ?")) {
      const parentJobId = String(this.bindings[0]);
      return {
        results: [...this.db.rows.values()]
          .filter((row) => row.parentJobId === parentJobId)
          .map((row) => toDbRow(row) as T),
      };
    }
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
    orgId: row.orgId,
    siteId: row.siteId,
    metadataJson: JSON.stringify(row.metadata),
    parentJobId: row.parentJobId,
    lockKey: row.lockKey,
    concurrencyKey: row.concurrencyKey,
    concurrencyLimit: row.concurrencyLimit,
    enqueuePolicy: row.enqueuePolicy,
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
