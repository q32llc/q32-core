import { describe, expect, it } from "vitest";
import { applyPgMigrations, pgJson } from "../src/pg.js";
import type { PgClientLike, PgPoolLike, PgQueryResult } from "../src/pg.js";

describe("Postgres helpers", () => {
  it("applies migrations inside a transaction", async () => {
    const pool = new MemoryPgPool();
    await expect(
      applyPgMigrations(pool, [
        { id: "0001", sql: "create table demo(id text primary key)" },
        { id: "0002", sql: "alter table demo add column name text" },
      ], { lockKey: 42 }),
    ).resolves.toEqual({ applied: ["0001", "0002"], skipped: [] });
    expect(pool.migrations).toEqual(["0001", "0002"]);
    expect(pool.queries.map((query) => query.text)).toContain("SELECT pg_advisory_xact_lock($1)");
  });

  it("skips already-applied migrations and rejects unsafe table names", async () => {
    const pool = new MemoryPgPool(["0001"]);
    await expect(applyPgMigrations(pool, [{ id: "0001", sql: "select 1" }])).resolves.toEqual({
      applied: [],
      skipped: ["0001"],
    });
    await expect(applyPgMigrations(pool, [], { tableName: "bad-name" })).rejects.toThrow("Unsafe SQL identifier");
  });

  it("serializes json", () => {
    expect(pgJson({ ok: true })).toBe('{"ok":true}');
    expect(pgJson(undefined)).toBe("null");
  });
});

class MemoryPgPool implements PgPoolLike {
  migrations: string[];
  queries: Array<{ text: string; values?: readonly unknown[] }> = [];

  constructor(existing: string[] = []) {
    this.migrations = [...existing];
  }

  async connect(): Promise<PgClientLike & { release(): void }> {
    return {
      query: this.query.bind(this),
      release: () => undefined,
    };
  }

  async query<Row = unknown>(text: string, values?: readonly unknown[]): Promise<PgQueryResult<Row>> {
    this.queries.push({ text, values });
    if (/select id from schema_migrations/i.test(text)) {
      const id = String(values?.[0]);
      return { rows: this.migrations.includes(id) ? ([{ id }] as Row[]) : [], rowCount: null };
    }
    if (/insert into schema_migrations/i.test(text)) {
      this.migrations.push(String(values?.[0]));
    }
    return { rows: [], rowCount: null };
  }
}
