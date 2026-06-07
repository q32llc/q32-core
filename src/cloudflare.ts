export type WorkerQueueMessage<T = unknown> = {
  jobId: string;
  payload?: T;
};

export type DurableObjectIdLike = {
  toString(): string;
};

export function requireD1(env: Record<string, unknown>, binding = "DB"): D1Database {
  const db = env[binding];
  if (!db || typeof db !== "object" || typeof (db as D1Database).prepare !== "function") {
    throw new Error(`Missing D1 binding: ${binding}`);
  }
  return db as D1Database;
}

export function requireR2(env: Record<string, unknown>, binding: string): R2Bucket {
  const bucket = env[binding];
  if (!bucket || typeof bucket !== "object" || typeof (bucket as R2Bucket).put !== "function") {
    throw new Error(`Missing R2 binding: ${binding}`);
  }
  return bucket as R2Bucket;
}

export function requireQueue<T = unknown>(env: Record<string, unknown>, binding: string): Queue<T> {
  const queue = env[binding];
  if (!queue || typeof queue !== "object" || typeof (queue as Queue<T>).send !== "function") {
    throw new Error(`Missing Queue binding: ${binding}`);
  }
  return queue as Queue<T>;
}

export function isCloudflareScheduledEvent(value: unknown): value is ScheduledEvent {
  return Boolean(value && typeof value === "object" && "scheduledTime" in value && "cron" in value);
}
