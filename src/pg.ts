export interface PgQueryResult<Row = unknown> {
  rows: Row[];
  rowCount: number | null;
}

export interface PgClientLike {
  query<Row = unknown>(text: string, values?: readonly unknown[]): Promise<PgQueryResult<Row>>;
}

export interface PgPoolLike extends PgClientLike {
  connect(): Promise<PgClientLike & { release(): void }>;
}

export type PgMigration = {
  id: string;
  sql: string;
};

export type PgMigrationResult = {
  applied: string[];
  skipped: string[];
};

export async function ensurePgMigrationsTable(client: PgClientLike, tableName = "schema_migrations"): Promise<void> {
  assertSafeIdentifier(tableName);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function applyPgMigrations(
  pool: PgPoolLike,
  migrations: PgMigration[],
  options: { tableName?: string; lockKey?: number } = {},
): Promise<PgMigrationResult> {
  const tableName = options.tableName ?? "schema_migrations";
  assertSafeIdentifier(tableName);
  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await client.query("BEGIN");
    if (options.lockKey !== undefined) {
      await client.query("SELECT pg_advisory_xact_lock($1)", [options.lockKey]);
    }
    await ensurePgMigrationsTable(client, tableName);

    for (const migration of migrations) {
      const existing = await client.query<{ id: string }>(`SELECT id FROM ${tableName} WHERE id = $1 LIMIT 1`, [migration.id]);
      if (existing.rows[0]) {
        skipped.push(migration.id);
        continue;
      }
      await client.query(migration.sql);
      await client.query(`INSERT INTO ${tableName} (id) VALUES ($1)`, [migration.id]);
      applied.push(migration.id);
    }

    await client.query("COMMIT");
    return { applied, skipped };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function pgJson<T>(value: T): string {
  return JSON.stringify(value ?? null);
}

function assertSafeIdentifier(value: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
}
