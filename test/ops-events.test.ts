import { describe, expect, it } from "vitest";
import {
  ADGIRO_OPS_EVENTS_COLUMNS,
  buildOpsEventInsert,
  DIRT_SIGNAL_OPS_EVENTS_COLUMNS,
  GRAPHILIZE_GRAPH_EVENTS_COLUMNS,
  normalizeOpsEvent,
  recordD1OpsEvent,
  RELIN_OPERATIONAL_EVENTS_COLUMNS,
} from "../src/ops-events.js";
import type { D1DatabaseLike, D1PreparedStatementLike, D1StatementResult } from "../src/d1.js";

describe("ops event helpers", () => {
  it("normalizes app events with error details and stable defaults", () => {
    const event = normalizeOpsEvent(
      {
        eventName: "job.failed",
        workflow: "clinical-trials.import",
        status: "error",
        targetType: "job",
        targetId: "job_1",
        error: new TypeError("boom"),
      },
      {
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      },
    );

    expect(event).toMatchObject({
      eventName: "job.failed",
      workflow: "clinical-trials.import",
      status: "error",
      severity: "error",
      targetType: "job",
      targetId: "job_1",
      message: "boom",
      errorName: "TypeError",
      errorMessage: "boom",
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    expect(event.eventId).toMatch(/^opsevt_/);
  });

  it("builds mapped Postgres inserts for Graphilize graph_events", () => {
    const statement = buildOpsEventInsert(
      {
        tableName: "graph_events",
        columns: GRAPHILIZE_GRAPH_EVENTS_COLUMNS,
      },
      {
        eventId: "event_1",
        eventName: "job.created",
        workflow: "source-sync",
        status: "ok",
        scopeId: "graph_1",
        targetType: "job",
        targetId: "job_1",
        payload: { queueName: "graphilize-ingest" },
        metrics: { queued: 1 },
        metadata: { source: "test" },
        occurredAt: "2026-01-01T00:00:00.000Z",
      },
    );

    expect(statement.text).toContain('INSERT INTO "graph_events"');
    expect(statement.text).toContain('"payload_json"');
    expect(statement.text).toContain("$9::jsonb");
    expect(statement.text).toContain("$12::timestamptz");
    expect(statement.values).toEqual([
      "event_1",
      "graph_1",
      "job.created",
      "source-sync",
      "job",
      "job_1",
      "ok",
      null,
      '{"queueName":"graphilize-ingest"}',
      '{"queued":1}',
      '{"source":"test"}',
      "2026-01-01T00:00:00.000Z",
    ]);
  });

  it("builds mapped Postgres inserts for DirtSignal ops_events", () => {
    const statement = buildOpsEventInsert(
      {
        tableName: "ops_events",
        columns: DIRT_SIGNAL_OPS_EVENTS_COLUMNS,
        conflictTarget: ["event_id"],
      },
      {
        eventId: "event_1",
        runId: "run_1",
        eventName: "source.refresh.failed",
        workflow: "source-refresh",
        targetType: "source",
        targetId: "source_1",
        status: "error",
        errorMessage: "provider timeout",
        metrics: { durationMs: 1200 },
        metadata: { provider: "ctgov" },
        occurredAt: "2026-01-01T00:00:00.000Z",
      },
    );

    expect(statement.text).toContain('INSERT INTO "ops_events"');
    expect(statement.text).toContain('ON CONFLICT ("event_id") DO UPDATE SET');
    expect(statement.text).toContain("$10::jsonb");
    expect(statement.values).toEqual([
      "event_1",
      "run_1",
      "source.refresh.failed",
      "source-refresh",
      "source",
      "source_1",
      "error",
      null,
      "provider timeout",
      '{"durationMs":1200}',
      '{"provider":"ctgov"}',
      "2026-01-01T00:00:00.000Z",
    ]);
  });

  it("builds mapped D1 inserts for Relin operational_events", async () => {
    const db = new MemoryD1();
    const event = await recordD1OpsEvent(
      db,
      {
        eventId: "op_1",
        eventName: "projection.applied",
        status: "ok",
        customerId: "cus_1",
        sourceId: "src_1",
        targetId: "evt_1",
        destinationId: "dst_1",
        durationMs: 42,
        metadata: { attempt: 1 },
      },
      {
        tableName: "operational_events",
        columns: RELIN_OPERATIONAL_EVENTS_COLUMNS,
      },
    );

    expect(event.eventId).toBe("op_1");
    expect(db.lastQuery).toContain('"operational_events"');
    expect(db.lastValues).toEqual([
      "op_1",
      "projection.applied",
      "ok",
      "cus_1",
      "src_1",
      "evt_1",
      "dst_1",
      42,
      '{"attempt":1}',
    ]);
  });

  it("builds mapped D1 inserts for Adgiro request and job ops_events", async () => {
    const db = new MemoryD1();
    await recordD1OpsEvent(
      db,
      {
        eventId: "ops_1",
        eventName: "provider.sync.failed",
        severity: "error",
        requestMethod: "POST",
        requestPath: "/api/sync",
        requestUrl: "https://adgiro.test/api/sync",
        statusCode: 502,
        actorId: "user_1",
        orgId: "org_1",
        provider: "google",
        error: new Error("bad gateway"),
        metadata: { attempt: 2 },
        jobId: "job_1",
        parentEventId: "ops_parent",
      },
      {
        tableName: "ops_events",
        columns: ADGIRO_OPS_EVENTS_COLUMNS,
      },
    );

    expect(db.lastQuery).toContain('"parent_ops_event_id"');
    expect(db.lastValues.slice(0, 12)).toEqual([
      "ops_1",
      "error",
      "provider.sync.failed",
      "POST",
      "/api/sync",
      "https://adgiro.test/api/sync",
      502,
      "user_1",
      "org_1",
      "google",
      "bad gateway",
      "Error",
    ]);
    expect(db.lastValues.at(-3)).toBe('{"attempt":2}');
    expect(db.lastValues.at(-2)).toBe("job_1");
    expect(db.lastValues.at(-1)).toBe("ops_parent");
  });

  it("rejects unsafe table names", () => {
    expect(() =>
      buildOpsEventInsert(
        {
          tableName: "graph_events; drop table users",
          columns: GRAPHILIZE_GRAPH_EVENTS_COLUMNS,
        },
        { eventName: "x", workflow: "test" },
      ),
    ).toThrow("Unsafe SQL identifier");
  });

  it("keeps the D1 default ops_events compatibility path", async () => {
    const db = new MemoryD1();
    const event = await recordD1OpsEvent(db, {
      eventName: "source.refreshed",
      workflow: "source-sync",
      severity: "warn",
      fingerprint: "source:1",
      payload: { ok: false },
    });

    expect(event.status).toBe("warning");
    expect(db.lastQuery).toContain('"ops_events"');
    expect(db.lastValues).toEqual([
      "source.refreshed",
      "warn",
      "source-sync",
      "source:1",
      '{"ok":false}',
    ]);
  });
});

class MemoryD1 implements D1DatabaseLike {
  lastQuery = "";
  lastValues: unknown[] = [];

  prepare(query: string): D1PreparedStatementLike {
    this.lastQuery = query;
    const statement: D1PreparedStatementLike = {
      bind: (...values: unknown[]) => {
        this.lastValues = values;
        return statement;
      },
      run: async (): Promise<D1StatementResult> => ({ success: true, meta: {} }),
      first: async () => null,
      all: async () => ({ results: [] }),
    };
    return statement;
  }

  async batch(): Promise<D1StatementResult[]> {
    return [];
  }

  async exec(): Promise<unknown> {
    return undefined;
  }
}
