export type EnvSource = Record<string, unknown>;

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

export function requiredString(env: EnvSource, key: string): string {
  const value = env[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new EnvError(`Missing required env var: ${key}`);
  }
  return value;
}

export function optionalString(env: EnvSource, key: string, fallback?: string): string | undefined {
  const value = env[key];
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") throw new EnvError(`Expected ${key} to be a string.`);
  return value;
}

export function requiredUrl(env: EnvSource, key: string): string {
  const value = requiredString(env, key);
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new EnvError(`Expected ${key} to be a valid URL.`);
  }
}

export function optionalBoolean(env: EnvSource, key: string, fallback = false): boolean {
  const value = env[key];
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") throw new EnvError(`Expected ${key} to be boolean-like.`);
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  throw new EnvError(`Expected ${key} to be boolean-like.`);
}

export function requiredBinding<T>(env: EnvSource, key: string): T {
  const value = env[key];
  if (value === undefined || value === null) throw new EnvError(`Missing required binding: ${key}`);
  return value as T;
}

export function appUrl(env: EnvSource, fallback = "http://localhost:8787"): string {
  const value = optionalString(env, "APP_URL") ?? optionalString(env, "BASE_URL") ?? optionalString(env, "PUBLIC_APP_URL") ?? fallback;
  return value.replace(/\/$/, "");
}
