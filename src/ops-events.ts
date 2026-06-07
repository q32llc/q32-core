import type { D1DatabaseLike } from "./d1.js";
import { stringifyJsonColumn } from "./d1.js";

export type OpsSeverity = "debug" | "info" | "warn" | "error";

export type OpsEventInput = {
  eventType: string;
  severity?: OpsSeverity;
  source: string;
  fingerprint?: string | null;
  payload?: unknown;
};

export type OpsEventRow = {
  id: number;
  event_type: string;
  severity: OpsSeverity;
  source: string;
  fingerprint: string | null;
  payload_json: string;
  created_at: string;
};

export async function recordOpsEvent(db: D1DatabaseLike, input: OpsEventInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ops_events (event_type, severity, source, fingerprint, payload_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(input.eventType, input.severity ?? "info", input.source, input.fingerprint ?? null, stringifyJsonColumn(input.payload ?? {}))
    .run();
}

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
