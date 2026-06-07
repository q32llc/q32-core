import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";

export type PgConnectionSource = "hyperdrive" | "url" | "fallback";
export type PgSslMode = "auto" | "disable" | "require" | "verify-ca";

export type HyperdriveLike = {
  connectionString?: string;
};

export type PgEnvLike = Record<string, unknown> & {
  HYPERDRIVE?: HyperdriveLike;
  PG_URL?: string;
  PG_CA_CERT?: string;
};

export type ResolvedPgConnection = {
  connectionString: string;
  source: PgConnectionSource;
  closeConnection: boolean;
  caCert?: string;
};

export type PgConnectionOptions = {
  hyperdriveKey?: string;
  urlKey?: string;
  caCertKey?: string;
  fallbackConnectionString?: string;
  requireConnection?: boolean;
  closeConnection?: boolean;
};

export type PgClientOptions = {
  max?: number;
  prepare?: boolean;
  idleTimeoutSeconds?: number;
  connectTimeoutSeconds?: number;
  sslMode?: PgSslMode;
};

export type KyselyPgOptions = PgConnectionOptions &
  PgClientOptions & {
    onDestroyError?: (error: unknown) => void;
  };

type PostgresOptions = NonNullable<Parameters<typeof postgres>[1]>;

export function resolvePgConnection(
  env: PgEnvLike,
  options: PgConnectionOptions = {},
): ResolvedPgConnection {
  const hyperdriveKey = options.hyperdriveKey ?? "HYPERDRIVE";
  const urlKey = options.urlKey ?? "PG_URL";
  const caCertKey = options.caCertKey ?? "PG_CA_CERT";
  const hyperdrive = env[hyperdriveKey] as HyperdriveLike | undefined;
  const hyperdriveString = cleanString(hyperdrive?.connectionString);
  if (hyperdriveString) {
    return {
      connectionString: hyperdriveString,
      source: "hyperdrive",
      closeConnection: options.closeConnection ?? false,
    };
  }

  const urlString = cleanString(env[urlKey]);
  if (urlString) {
    return {
      connectionString: urlString,
      source: "url",
      closeConnection: options.closeConnection ?? true,
      caCert: normalizePem(cleanString(env[caCertKey])),
    };
  }

  const fallback = cleanString(options.fallbackConnectionString);
  if (fallback) {
    return {
      connectionString: fallback,
      source: "fallback",
      closeConnection: options.closeConnection ?? true,
      caCert: normalizePem(cleanString(env[caCertKey])),
    };
  }

  if (options.requireConnection ?? true) {
    throw new Error(`${urlKey} or ${hyperdriveKey}.connectionString is required for Postgres.`);
  }

  return {
    connectionString: "",
    source: "fallback",
    closeConnection: options.closeConnection ?? true,
  };
}

export function postgresClientOptions(
  connection: Pick<ResolvedPgConnection, "connectionString" | "source" | "caCert">,
  options: PgClientOptions = {},
): PostgresOptions {
  const clientOptions: PostgresOptions = {
    max: options.max ?? 1,
    prepare: options.prepare ?? false,
    idle_timeout: options.idleTimeoutSeconds ?? 20,
    connect_timeout: options.connectTimeoutSeconds ?? 5,
  };

  const ssl = resolvePgSsl(connection, options.sslMode ?? "auto");
  if (ssl !== undefined) clientOptions.ssl = ssl;
  return clientOptions;
}

export function createPostgresSql(
  connection: ResolvedPgConnection,
  options: PgClientOptions = {},
): postgres.Sql {
  return postgres(connection.connectionString, postgresClientOptions(connection, options));
}

export function createKyselyPg<Database>(
  env: PgEnvLike,
  options: KyselyPgOptions = {},
): {
  db: Kysely<Database>;
  sql: postgres.Sql;
  connection: ResolvedPgConnection;
  destroy(): Promise<void>;
} {
  const connection = resolvePgConnection(env, options);
  const sql = createPostgresSql(connection, options);
  const db = new Kysely<Database>({
    dialect: new PostgresJSDialect({ postgres: sql }),
  });

  return {
    db,
    sql,
    connection,
    async destroy() {
      try {
        await db.destroy();
      } catch (error) {
        options.onDestroyError?.(error);
        if (!options.onDestroyError) throw error;
      }
    },
  };
}

export async function withKyselyPg<Database, Result>(
  env: PgEnvLike,
  fn: (db: Kysely<Database>, context: { sql: postgres.Sql; connection: ResolvedPgConnection }) => Promise<Result>,
  options: KyselyPgOptions = {},
): Promise<Result> {
  const handle = createKyselyPg<Database>(env, options);
  try {
    return await fn(handle.db, { sql: handle.sql, connection: handle.connection });
  } finally {
    if (handle.connection.closeConnection) {
      await handle.destroy();
    }
  }
}

export function normalizePem(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.includes("\\n") ? trimmed.replace(/\\n/g, "\n") : trimmed;
}

function resolvePgSsl(
  connection: Pick<ResolvedPgConnection, "connectionString" | "source" | "caCert">,
  mode: PgSslMode,
): PostgresOptions["ssl"] | undefined {
  if (mode === "disable") return false;
  if (mode === "require") return "require";
  if (mode === "verify-ca") {
    if (!connection.caCert) throw new Error("PG_CA_CERT is required when sslMode is verify-ca.");
    return { ca: connection.caCert, rejectUnauthorized: true };
  }
  if (connection.source === "hyperdrive") return false;
  if (connection.caCert) return { ca: connection.caCert, rejectUnauthorized: true };
  if (isLocalPgUrl(connection.connectionString)) return false;
  return "require";
}

function isLocalPgUrl(connectionString: string): boolean {
  try {
    const host = new URL(connectionString).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
