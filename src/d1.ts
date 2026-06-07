export type D1Primitive = string | number | boolean | null | Uint8Array;

export interface D1StatementResult {
  success: boolean;
  meta: Record<string, unknown>;
  results?: Record<string, unknown>[];
}

export interface D1PreparedStatementLike {
  bind(...values: D1Primitive[]): D1PreparedStatementLike;
  run(): Promise<D1StatementResult>;
  first<T extends object = Record<string, unknown>>(): Promise<T | null>;
  all<T extends object = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<D1StatementResult[]>;
  exec(query: string): Promise<unknown>;
}

export type Migration = {
  id: string;
  sql: string;
};

export type MigrationResult = {
  applied: string[];
  skipped: string[];
};

export async function ensureMigrationsTable(db: D1DatabaseLike, tableName = "schema_migrations"): Promise<void> {
  assertSafeIdentifier(tableName);
  await db.exec(
    `CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );
}

export async function applyD1Migrations(
  db: D1DatabaseLike,
  migrations: Migration[],
  options: { tableName?: string } = {},
): Promise<MigrationResult> {
  const tableName = options.tableName ?? "schema_migrations";
  assertSafeIdentifier(tableName);
  await ensureMigrationsTable(db, tableName);

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const migration of migrations) {
    const existing = await db.prepare(`SELECT id FROM ${tableName} WHERE id = ? LIMIT 1`).bind(migration.id).first();
    if (existing) {
      skipped.push(migration.id);
      continue;
    }

    await db.exec(migration.sql);
    await db.prepare(`INSERT INTO ${tableName} (id) VALUES (?)`).bind(migration.id).run();
    applied.push(migration.id);
  }

  return { applied, skipped };
}

export function parseJsonColumn<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function stringifyJsonColumn(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function assertSafeIdentifier(value: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
}
