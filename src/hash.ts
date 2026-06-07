const encoder = new TextEncoder();

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function sha256Hex(value: string | ArrayBuffer): Promise<string> {
  const data = typeof value === "string" ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(digest));
}

export async function hmacSha256Hex(
  secret: string,
  value: string | ArrayBuffer,
): Promise<string> {
  const signature = await hmacSha256(secret, value);
  return toHex(new Uint8Array(signature));
}

export async function hmacSha256Base64(
  secret: string,
  value: string | ArrayBuffer,
): Promise<string> {
  const signature = await hmacSha256(secret, value);
  return toBase64(new Uint8Array(signature));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

async function hmacSha256(
  secret: string,
  value: string | ArrayBuffer,
): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const data = typeof value === "string" ? encoder.encode(value) : value;
  return crypto.subtle.sign("HMAC", key, data);
}
