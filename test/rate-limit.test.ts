import { describe, expect, it } from "vitest";
import { checkD1FixedWindowRateLimit } from "../src/rate-limit.js";
import type { D1DatabaseLike, D1PreparedStatementLike, D1Primitive, D1StatementResult } from "../src/d1.js";

describe("D1 fixed-window rate limits", () => {
  it("allows up to the configured limit", async () => {
    const db = new MemoryRateLimitDb();
    const now = new Date("2026-01-01T00:00:00.000Z");

    await expect(checkD1FixedWindowRateLimit(db, { namespace: "login", key: "ip", limit: 2, windowSeconds: 60, now })).resolves.toMatchObject({
      allowed: true,
      count: 1,
    });
    await expect(checkD1FixedWindowRateLimit(db, { namespace: "login", key: "ip", limit: 2, windowSeconds: 60, now })).resolves.toMatchObject({
      allowed: true,
      count: 2,
    });
    await expect(checkD1FixedWindowRateLimit(db, { namespace: "login", key: "ip", limit: 2, windowSeconds: 60, now })).resolves.toMatchObject({
      allowed: false,
      count: 3,
    });
  });
});

class MemoryRateLimitDb implements D1DatabaseLike {
  rows = new Map<string, { count: number; resetAt: string }>();

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
    private readonly db: MemoryRateLimitDb,
    private readonly query: string,
  ) {}

  bind(...values: D1Primitive[]): D1PreparedStatementLike {
    this.bindings = values;
    return this;
  }

  async run(): Promise<D1StatementResult> {
    if (this.query.toLowerCase().includes("insert into rate_limits")) {
      const [namespace, keyHash, bucket, resetAt] = this.bindings.map(String);
      const key = `${namespace}:${keyHash}:${bucket}`;
      const current = this.db.rows.get(key);
      this.db.rows.set(key, { count: (current?.count ?? 0) + 1, resetAt });
      return { success: true, meta: { changes: 1 } };
    }
    return { success: true, meta: { changes: 0 } };
  }

  async first<T extends object>(): Promise<T | null> {
    const [namespace, keyHash, bucket] = this.bindings.map(String);
    const row = this.db.rows.get(`${namespace}:${keyHash}:${bucket}`);
    return row ? ({ count: row.count, resetAt: row.resetAt } as T) : null;
  }

  async all<T extends object>(): Promise<{ results: T[] }> {
    return { results: [] };
  }
}
