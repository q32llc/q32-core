import type postgres from "postgres";
import type { D1DatabaseLike } from "./d1.js";
import { createId } from "./ids.js";

export type StandardOpsEventStatus = "started" | "ok" | "warning" | "error" | "skipped";
export type OpsEventStatus = StandardOpsEventStatus | (string & {});
export type OpsEventSeverity = "debug" | "info" | "warn" | "error";

export type OpsEventInput = {
  eventId?: string;
  eventName?: string;
  eventType?: string;
  workflow?: string;
  source?: string;
  status?: OpsEventStatus;
  severity?: OpsEventSeverity;
  runId?: string | null;
  jobId?: string | null;
  parentEventId?: string | null;
  scopeId?: string | null;
  sourceId?: string | null;
  destinationId?: string | null;
  actorId?: string | null;
  orgId?: string | null;
  siteId?: string | null;
  customerId?: string | null;
  provider?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  durationMs?: number | null;
  statusCode?: number | null;
  requestMethod?: string | null;
  requestPath?: string | null;
  requestUrl?: string | null;
  message?: string | null;
  error?: unknown;
  errorMessage?: string | null;
  payload?: unknown;
  metrics?: unknown;
  metadata?: unknown;
  occurredAt?: string | Date;
  fingerprint?: string | null;
};

export type NormalizedOpsEvent = {
  eventId: string;
  eventName: string;
  workflow: string;
  status: OpsEventStatus;
  severity: OpsEventSeverity;
  runId: string | null;
  jobId: string | null;
  parentEventId: string | null;
  scopeId: string | null;
  sourceId: string | null;
  destinationId: string | null;
  actorId: string | null;
  orgId: string | null;
  siteId: string | null;
  customerId: string | null;
  provider: string | null;
  targetType: string | null;
  targetId: string | null;
  durationMs: number | null;
  statusCode: number | null;
  requestMethod: string | null;
  requestPath: string | null;
  requestUrl: string | null;
  message: string | null;
  errorName: string | null;
  errorMessage: string | null;
  errorStack: string | null;
  payload: unknown;
  metrics: unknown;
  metadata: unknown;
  occurredAt: string;
  fingerprint: string | null;
};

export type OpsEventNormalizeOptions = {
  idPrefix?: string;
  now?: () => Date;
};

export type OpsEventColumnValue =
  | keyof NormalizedOpsEvent
  | "payloadJson"
  | "payloadJsonOrNull"
  | "metricsJson"
  | "metricsJsonOrNull"
  | "metadataJson"
  | "metadataJsonOrNull"
  | "null";

export type OpsEventColumn = {
  column: string;
  value: OpsEventColumnValue | ((event: NormalizedOpsEvent) => unknown);
  cast?: "jsonb" | "timestamptz";
};

export type OpsEventSqlInsert = {
  text: string;
  values: unknown[];
};

export type OpsEventSqlConfig = {
  tableName: string;
  columns: OpsEventColumn[];
  conflictTarget?: string[];
  updateColumns?: string[];
};

export function normalizeOpsEvent(
  input: OpsEventInput,
  options: OpsEventNormalizeOptions = {},
): NormalizedOpsEvent {
  const errorInfo = normalizeError(input.error);
  const eventName = requiredName(input.eventName ?? input.eventType, "eventName");
  return {
    eventId: input.eventId ?? createId(options.idPrefix ?? "opsevt"),
    eventName,
    workflow: requiredName(input.workflow ?? input.source ?? eventName, "workflow"),
    status: input.status ?? statusFromSeverity(input.severity),
    severity: input.severity ?? severityFromStatus(input.status),
    runId: input.runId ?? null,
    jobId: input.jobId ?? null,
    parentEventId: input.parentEventId ?? null,
    scopeId: input.scopeId ?? null,
    sourceId: input.sourceId ?? null,
    destinationId: input.destinationId ?? null,
    actorId: input.actorId ?? null,
    orgId: input.orgId ?? null,
    siteId: input.siteId ?? null,
    customerId: input.customerId ?? null,
    provider: input.provider ?? null,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    durationMs: input.durationMs ?? null,
    statusCode: input.statusCode ?? null,
    requestMethod: input.requestMethod ?? null,
    requestPath: input.requestPath ?? null,
    requestUrl: input.requestUrl ?? null,
    message: input.message ?? errorInfo.message,
    errorName: errorInfo.name,
    errorMessage: input.errorMessage ?? errorInfo.message,
    errorStack: errorInfo.stack,
    payload: input.payload === undefined ? {} : input.payload,
    metrics: input.metrics === undefined ? {} : input.metrics,
    metadata: input.metadata === undefined ? {} : input.metadata,
    occurredAt: normalizeOccurredAt(input.occurredAt, options.now),
    fingerprint: input.fingerprint ?? null,
  };
}

export function buildOpsEventInsert(
  config: OpsEventSqlConfig,
  input: OpsEventInput | NormalizedOpsEvent,
  options: OpsEventNormalizeOptions = {},
): OpsEventSqlInsert {
  const event = isNormalizedOpsEvent(input) ? input : normalizeOpsEvent(input, options);
  const columns = config.columns.map((column) => quoteIdentifier(column.column)).join(", ");
  const values = config.columns.map((column) => valueForColumn(event, column));
  const placeholders = config.columns
    .map((column, index) => `$${index + 1}${column.cast ? `::${column.cast}` : ""}`)
    .join(", ");
  let text = `INSERT INTO ${quoteIdentifier(config.tableName)} (${columns}) VALUES (${placeholders})`;

  if (config.conflictTarget?.length) {
    const target = config.conflictTarget.map(quoteIdentifier).join(", ");
    const updateColumns = config.updateColumns ?? config.columns.map((column) => column.column).filter((column) => !config.conflictTarget?.includes(column));
    if (updateColumns.length === 0) {
      text += ` ON CONFLICT (${target}) DO NOTHING`;
    } else {
      text += ` ON CONFLICT (${target}) DO UPDATE SET ${updateColumns
        .map((column) => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`)
        .join(", ")}`;
    }
  }

  return { text, values };
}

export async function recordPostgresOpsEvent(
  sql: postgres.Sql,
  config: OpsEventSqlConfig,
  input: OpsEventInput | NormalizedOpsEvent,
  options: OpsEventNormalizeOptions = {},
): Promise<NormalizedOpsEvent> {
  const event = isNormalizedOpsEvent(input) ? input : normalizeOpsEvent(input, options);
  const statement = buildOpsEventInsert(config, event, options);
  await sql.unsafe(statement.text, statement.values as never[]);
  return event;
}

export type D1OpsEventConfig = {
  tableName?: string;
  columns?: OpsEventColumn[];
  normalize?: OpsEventNormalizeOptions;
};

export async function recordD1OpsEvent(
  db: D1DatabaseLike,
  input: OpsEventInput | NormalizedOpsEvent,
  config: D1OpsEventConfig = {},
): Promise<NormalizedOpsEvent> {
  const event = isNormalizedOpsEvent(input) ? input : normalizeOpsEvent(input, config.normalize);
  const columns = config.columns ?? DEFAULT_D1_OPS_EVENT_COLUMNS;
  const tableName = config.tableName ?? "ops_events";
  const sql = `INSERT INTO ${quoteIdentifier(tableName)} (${columns.map((column) => quoteIdentifier(column.column)).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
  await db.prepare(sql).bind(...(columns.map((column) => valueForColumn(event, column)) as never[])).run();
  return event;
}

export async function recordOpsEvent(db: D1DatabaseLike, input: OpsEventInput): Promise<void> {
  await recordD1OpsEvent(db, input);
}

export async function recordJobAwareD1OpsEvent(db: D1DatabaseLike, input: OpsEventInput): Promise<NormalizedOpsEvent> {
  return await recordD1OpsEvent(db, input, { columns: JOB_AWARE_D1_OPS_EVENT_COLUMNS });
}

export type JobAwareD1OpsEventRow = {
  opsEventId: string;
  jobId: string | null;
  level: OpsEventSeverity;
  eventType: string;
  workflow: string;
  message: string;
  metadataJson: string;
  orgId: string | null;
  siteId: string | null;
  provider: string | null;
  sourceId: string | null;
  targetType: string | null;
  targetId: string | null;
  status: string;
  durationMs: number | null;
  actorId: string | null;
  errorMessage: string | null;
  payloadJson: string;
  metricsJson: string;
  createdAt: string;
};

export type JobAwareD1OpsEventFilters = {
  level?: OpsEventSeverity | null;
  eventType?: string | null;
  workflow?: string | null;
  jobId?: string | null;
  orgId?: string | null;
  siteId?: string | null;
  provider?: string | null;
  sourceId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  status?: string | null;
  since?: string | null;
  until?: string | null;
  limit?: number;
};

export async function listJobAwareD1OpsEvents(
  db: D1DatabaseLike,
  filters: JobAwareD1OpsEventFilters = {},
): Promise<JobAwareD1OpsEventRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  for (const [column, value] of [
    ["level", filters.level],
    ["event_type", filters.eventType],
    ["workflow", filters.workflow],
    ["job_id", filters.jobId],
    ["org_id", filters.orgId],
    ["site_id", filters.siteId],
    ["provider", filters.provider],
    ["source_id", filters.sourceId],
    ["target_type", filters.targetType],
    ["target_id", filters.targetId],
    ["status", filters.status],
  ] as const) {
    if (value?.trim()) {
      conditions.push(`${column} = ?`);
      values.push(value.trim());
    }
  }
  if (filters.since?.trim()) {
    conditions.push("created_at >= ?");
    values.push(filters.since.trim());
  }
  if (filters.until?.trim()) {
    conditions.push("created_at <= ?");
    values.push(filters.until.trim());
  }
  const limit = Math.max(1, Math.min(200, Math.floor(filters.limit ?? 100)));
  values.push(limit);
  const rows = await db
    .prepare(
      `SELECT ops_event_id AS opsEventId, job_id AS jobId, level, event_type AS eventType, workflow,
              message, metadata_json AS metadataJson, org_id AS orgId, site_id AS siteId, provider,
              source_id AS sourceId, target_type AS targetType, target_id AS targetId, status,
              duration_ms AS durationMs, actor_id AS actorId, error_message AS errorMessage,
              payload_json AS payloadJson, metrics_json AS metricsJson, created_at AS createdAt
       FROM ops_events${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...(values as never[]))
    .all<JobAwareD1OpsEventRow>();
  return rows.results ?? [];
}

export type OpsEventRow = {
  id: number;
  event_type: string;
  severity: OpsEventSeverity;
  source: string;
  fingerprint: string | null;
  payload_json: string;
  created_at: string;
};

export async function listRecentOpsEvents(
  db: D1DatabaseLike,
  options: { limit?: number; eventType?: string | null } = {},
): Promise<OpsEventRow[]> {
  const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 25)));
  const eventType = options.eventType?.trim();
  const statement = eventType
    ? db
        .prepare(
          `SELECT id, event_type, severity, source, fingerprint, payload_json, created_at
           FROM ops_events
           WHERE event_type = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ?`,
        )
        .bind(eventType, limit)
    : db
        .prepare(
          `SELECT id, event_type, severity, source, fingerprint, payload_json, created_at
           FROM ops_events
           ORDER BY created_at DESC, id DESC
           LIMIT ?`,
        )
        .bind(limit);
  const rows = await statement.all<OpsEventRow>();
  return rows.results ?? [];
}

export const DEFAULT_D1_OPS_EVENT_COLUMNS: OpsEventColumn[] = [
  { column: "event_type", value: "eventName" },
  { column: "severity", value: "severity" },
  { column: "source", value: "workflow" },
  { column: "fingerprint", value: "fingerprint" },
  { column: "payload_json", value: "payloadJson" },
];

export const JOB_AWARE_D1_OPS_EVENT_COLUMNS: OpsEventColumn[] = [
  { column: "ops_event_id", value: "eventId" },
  { column: "job_id", value: "jobId" },
  { column: "level", value: "severity" },
  { column: "event_type", value: "eventName" },
  { column: "workflow", value: "workflow" },
  { column: "message", value: (event) => event.message ?? event.errorMessage ?? event.eventName },
  { column: "metadata_json", value: "metadataJson" },
  { column: "org_id", value: "orgId" },
  { column: "site_id", value: "siteId" },
  { column: "provider", value: "provider" },
  { column: "source_id", value: "sourceId" },
  { column: "target_type", value: "targetType" },
  { column: "target_id", value: "targetId" },
  { column: "status", value: "status" },
  { column: "duration_ms", value: "durationMs" },
  { column: "actor_id", value: "actorId" },
  { column: "error_message", value: "errorMessage" },
  { column: "payload_json", value: "payloadJson" },
  { column: "metrics_json", value: "metricsJson" },
  { column: "severity", value: "severity" },
  { column: "source", value: "workflow" },
  { column: "fingerprint", value: "fingerprint" },
  { column: "created_at", value: "occurredAt" },
];

export const GRAPH_SCOPE_EVENT_COLUMNS: OpsEventColumn[] = [
  { column: "event_id", value: "eventId" },
  { column: "graph_id", value: "scopeId" },
  { column: "event_name", value: "eventName" },
  { column: "workflow", value: "workflow" },
  { column: "target_type", value: "targetType" },
  { column: "target_id", value: "targetId" },
  { column: "status", value: "status" },
  { column: "message", value: "message" },
  { column: "payload_json", value: "payloadJson", cast: "jsonb" },
  { column: "metrics_json", value: "metricsJson", cast: "jsonb" },
  { column: "metadata_json", value: "metadataJson", cast: "jsonb" },
  { column: "occurred_at", value: "occurredAt", cast: "timestamptz" },
];

export const RUN_SCOPED_OPS_EVENT_COLUMNS: OpsEventColumn[] = [
  { column: "event_id", value: "eventId" },
  { column: "run_id", value: "runId" },
  { column: "event_name", value: "eventName" },
  { column: "workflow", value: "workflow" },
  { column: "target_type", value: "targetType" },
  { column: "target_id", value: "targetId" },
  { column: "status", value: "status" },
  { column: "message", value: "message" },
  { column: "error_message", value: "errorMessage" },
  { column: "metrics_json", value: "metricsJson", cast: "jsonb" },
  { column: "metadata_json", value: "metadataJson", cast: "jsonb" },
  { column: "occurred_at", value: "occurredAt", cast: "timestamptz" },
];

export const OPERATIONAL_EVENT_COLUMNS: OpsEventColumn[] = [
  { column: "operational_event_id", value: "eventId" },
  { column: "name", value: "eventName" },
  { column: "status", value: "status" },
  { column: "customer_id", value: "customerId" },
  { column: "source_id", value: "sourceId" },
  { column: "event_id", value: "targetId" },
  { column: "destination_id", value: "destinationId" },
  { column: "duration_ms", value: "durationMs" },
  { column: "metadata_json", value: "metadataJsonOrNull" },
];

export const REQUEST_JOB_OPS_EVENT_COLUMNS: OpsEventColumn[] = [
  { column: "ops_event_id", value: "eventId" },
  { column: "level", value: "severity" },
  { column: "event_type", value: "eventName" },
  { column: "request_method", value: "requestMethod" },
  { column: "request_path", value: "requestPath" },
  { column: "request_url", value: "requestUrl" },
  { column: "status_code", value: "statusCode" },
  { column: "user_id", value: "actorId" },
  { column: "org_id", value: "orgId" },
  { column: "provider", value: "provider" },
  { column: "message", value: (event) => event.message ?? event.eventName },
  { column: "error_name", value: "errorName" },
  { column: "error_stack", value: "errorStack" },
  { column: "metadata_json", value: "metadataJson" },
  { column: "job_id", value: "jobId" },
  { column: "parent_ops_event_id", value: "parentEventId" },
];

export const D1_OPS_EVENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS ops_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  source TEXT NOT NULL,
  fingerprint TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ops_events_created_at_idx ON ops_events(created_at DESC);
CREATE INDEX IF NOT EXISTS ops_events_type_created_idx ON ops_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS ops_events_severity_created_idx ON ops_events(severity, created_at DESC);
`;

export const D1_JOB_AWARE_OPS_EVENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS ops_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ops_event_id TEXT NOT NULL UNIQUE,
  job_id TEXT,
  level TEXT NOT NULL,
  event_type TEXT NOT NULL,
  workflow TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  org_id TEXT,
  site_id TEXT,
  provider TEXT,
  source_id TEXT,
  target_type TEXT,
  target_id TEXT,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  actor_id TEXT,
  error_message TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  severity TEXT NOT NULL DEFAULT 'info',
  source TEXT NOT NULL,
  fingerprint TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ops_events_created_at_idx ON ops_events(created_at DESC);
CREATE INDEX IF NOT EXISTS ops_events_type_created_idx ON ops_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS ops_events_level_created_idx ON ops_events(level, created_at DESC);
CREATE INDEX IF NOT EXISTS ops_events_job_created_idx ON ops_events(job_id, created_at) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ops_events_org_created_idx ON ops_events(org_id, created_at DESC) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ops_events_site_created_idx ON ops_events(site_id, created_at DESC) WHERE site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ops_events_provider_created_idx ON ops_events(provider, created_at DESC) WHERE provider IS NOT NULL;
CREATE INDEX IF NOT EXISTS ops_events_target_created_idx ON ops_events(target_type, target_id, created_at DESC);
`;

function valueForColumn(event: NormalizedOpsEvent, column: OpsEventColumn): unknown {
  if (typeof column.value === "function") return column.value(event);
  if (column.value === "payloadJson") return JSON.stringify(event.payload ?? {});
  if (column.value === "payloadJsonOrNull") return event.payload == null ? null : JSON.stringify(event.payload);
  if (column.value === "metricsJson") return JSON.stringify(event.metrics ?? {});
  if (column.value === "metricsJsonOrNull") return event.metrics == null ? null : JSON.stringify(event.metrics);
  if (column.value === "metadataJson") return JSON.stringify(event.metadata ?? {});
  if (column.value === "metadataJsonOrNull") return event.metadata == null ? null : JSON.stringify(event.metadata);
  if (column.value === "null") return null;
  return event[column.value];
}

function normalizeError(error: unknown): { name: string | null; message: string | null; stack: string | null } {
  if (!error) return { name: null, message: null, stack: null };
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? error.message,
    };
  }
  return {
    name: typeof error,
    message: String(error),
    stack: String(error),
  };
}

function statusFromSeverity(severity: OpsEventSeverity | undefined): OpsEventStatus {
  if (severity === "error") return "error";
  if (severity === "warn") return "warning";
  return "ok";
}

function severityFromStatus(status: OpsEventStatus | undefined): OpsEventSeverity {
  if (status === "error") return "error";
  if (status === "warning" || status === "warn" || status === "skipped") return "warn";
  return "info";
}

function normalizeOccurredAt(value: string | Date | undefined, now: (() => Date) | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim()) return value;
  return (now?.() ?? new Date()).toISOString();
}

function requiredName(value: string | undefined, field: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`Ops event ${field} is required.`);
  return trimmed;
}

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function isNormalizedOpsEvent(value: OpsEventInput | NormalizedOpsEvent): value is NormalizedOpsEvent {
  return (
    "eventId" in value &&
    "eventName" in value &&
    "workflow" in value &&
    "severity" in value &&
    "message" in value &&
    "occurredAt" in value
  );
}
