const DEFAULT_TOKEN_BYTES = 32;

export function createId(prefix: string, bytes = 12): string {
  const cleanPrefix = prefix.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!cleanPrefix) throw new Error("ID prefix is required.");
  return `${cleanPrefix}_${randomBase64Url(bytes)}`;
}

export function createToken(prefix = "tok", bytes = DEFAULT_TOKEN_BYTES): string {
  return createId(prefix, bytes);
}

export function randomBase64Url(bytes = DEFAULT_TOKEN_BYTES): string {
  const data = new Uint8Array(Math.max(1, Math.floor(bytes)));
  crypto.getRandomValues(data);
  return toBase64Url(data);
}

export function toBase64Url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
