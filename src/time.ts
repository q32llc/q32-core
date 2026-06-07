export function nowIso(date = new Date()): string {
  return date.toISOString();
}

export function epochSeconds(date = new Date()): number {
  return Math.floor(date.getTime() / 1000);
}

export function addSeconds(date: Date | string, seconds: number): string {
  const base = typeof date === "string" ? new Date(date) : date;
  return new Date(base.getTime() + seconds * 1000).toISOString();
}

export function isFutureIso(value: string | null | undefined, now = new Date()): boolean {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}
