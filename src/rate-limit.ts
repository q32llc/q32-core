import type { D1DatabaseLike } from "./d1.js";
import { sha256Hex } from "./ids.js";

export type RateLimitDecision = {
  allowed: boolean;
  keyHash: string;
  count: number;
  limit: number;
  resetAt: string;
};

export type FixedWindowRateLimitInput = {
  namespace: string;
  key: string;
  limit: number;
  windowSeconds: number;
  now?: Date;
};

export async function checkD1FixedWindowRateLimit(
  db: D1DatabaseLike,
  input: FixedWindowRateLimitInput,
): Promise<RateLimitDecision> {
  const now = input.now ?? new Date();
  const windowSeconds = Math.max(1, Math.floor(input.windowSeconds));
  const limit = Math.max(1, Math.floor(input.limit));
  const bucketStartMs = Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000;
  const bucket = new Date(bucketStartMs).toISOString();
  const resetAt = new Date(bucketStartMs + windowSeconds * 1000).toISOString();
  const keyHash = await sha256Hex(`${input.namespace}:${input.key}`);

  await db
    .prepare(
      `INSERT INTO rate_limits (namespace, key_hash, bucket, count, reset_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(namespace, key_hash, bucket)
       DO UPDATE SET count = count + 1, reset_at = excluded.reset_at`,
    )
    .bind(input.namespace, keyHash, bucket, resetAt)
    .run();

  const row = await db
    .prepare(
      `SELECT count, reset_at AS resetAt
       FROM rate_limits
       WHERE namespace = ? AND key_hash = ? AND bucket = ?
       LIMIT 1`,
    )
    .bind(input.namespace, keyHash, bucket)
    .first<{ count: number; resetAt: string }>();

  const count = Number(row?.count ?? 1);
  return {
    allowed: count <= limit,
    keyHash,
    count,
    limit,
    resetAt: row?.resetAt ?? resetAt,
  };
}

export async function deleteExpiredD1RateLimitBuckets(db: D1DatabaseLike, now = new Date()): Promise<number> {
  const result = await db.prepare("DELETE FROM rate_limits WHERE reset_at < ?").bind(now.toISOString()).run();
  return Number(result.meta.changes ?? 0);
}

export const D1_RATE_LIMITS_SCHEMA = `
CREATE TABLE IF NOT EXISTS rate_limits (
  namespace TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  bucket TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at TEXT NOT NULL,
  PRIMARY KEY (namespace, key_hash, bucket)
);
CREATE INDEX IF NOT EXISTS rate_limits_reset_at_idx ON rate_limits(reset_at);
`;
