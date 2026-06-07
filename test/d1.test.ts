import { describe, expect, it } from "vitest";
import { applyD1Migrations, parseJsonColumn, stringifyJsonColumn } from "../src/d1.js";
import type { D1DatabaseLike, D1PreparedStatementLike, D1Primitive, D1StatementResult } from "../src/d1.js";

describe("D1 helpers", () => {
  it("applies migrations once", async () => {
    const db = new MigrationDb();
    await expect(
      applyD1Migrations(db, [
        { id: "0001", sql: "create table demo (id text primary key)" },
        { id: "0002", sql: "alter table demo add column name text" },
      ]),
    ).resolves.toEqual({ applied: ["0001", "0002"], skipped: [] });

    await expect(applyD1Migrations(db, [{ id: "0001", sql: "select 1" }])).resolves.toEqual({
      applied: [],
      skipped: ["0001"],
    });
    expect(db.executed).toContain("create table demo (id text primary key)");
  });

  it("rejects unsafe migration table names", async () => {
    await expect(applyD1Migrations(new MigrationDb(), [], { tableName: "bad-name" })).rejects.toThrow("Unsafe SQL identifier");
  });

  it("parses and stringifies json columns", () => {
    expect(parseJsonColumn<{ ok: boolean }>('{"ok":true}', { ok: false })).toEqual({ ok: true });
    expect(parseJsonColumn("not-json", { ok: false })).toEqual({ ok: false });
    expect(stringifyJsonColumn(undefined)).toBe("null");
  });
});

class MigrationDb implements D1DatabaseLike {
  migrations = new Set<string>();
  executed: string[] = [];

  prepare(query: string): D1PreparedStatementLike {
    return new MigrationStatement(this, query);
  }

  async batch(statements: D1PreparedStatementLike[]): Promise<D1StatementResult[]> {
    return Promise.all(statements.map((statement) => statement.run()));
  }

  async exec(query: string): Promise<unknown> {
    this.executed.push(query);
    return undefined;
  }
}

class MigrationStatement implements D1PreparedStatementLike {
  private bindings: D1Primitive[] = [];

  constructor(
    private readonly db: MigrationDb,
    private readonly query: string,
  ) {}

  bind(...values: D1Primitive[]): D1PreparedStatementLike {
    this.bindings = values;
    return this;
  }

  async run(): Promise<D1StatementResult> {
    if (this.query.toLowerCase().includes("insert into schema_migrations")) {
      this.db.migrations.add(String(this.bindings[0]));
      return { success: true, meta: { changes: 1 } };
    }
    return { success: true, meta: { changes: 0 } };
  }

  async first<T extends object>(): Promise<T | null> {
    const id = String(this.bindings[0]);
    return this.db.migrations.has(id) ? ({ id } as T) : null;
  }

  async all<T extends object>(): Promise<{ results: T[] }> {
    return { results: [] };
  }
}
