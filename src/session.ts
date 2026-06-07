import { fromBase64Url, toBase64Url } from "./ids.js";
import { epochSeconds } from "./time.js";

export type SignedSessionOptions = {
  expiresInSeconds?: number;
};

type SessionEnvelope<T> = {
  payload: T;
  iat: number;
  exp: number;
};

export async function signSession<T>(payload: T, secret: string, options: SignedSessionOptions = {}): Promise<string> {
  if (!secret) throw new Error("Session secret is required.");
  const now = epochSeconds();
  const envelope: SessionEnvelope<T> = {
    payload,
    iat: now,
    exp: now + (options.expiresInSeconds ?? 30 * 24 * 60 * 60),
  };
  const encoded = toBase64Url(JSON.stringify(envelope));
  const signature = await hmacSha256(encoded, secret);
  return `${encoded}.${signature}`;
}

export async function createSignedPayload(payload: string, secret: string): Promise<string> {
  const encodedPayload = toBase64Url(payload);
  const signature = await hmacSha256(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export async function verifySignedPayload(
  token: string | null | undefined,
  secret: string,
): Promise<string | null> {
  if (!token) return null;
  const [encodedPayload, providedSignature] = token.split(".");
  if (!encodedPayload || !providedSignature) return null;
  const expectedSignature = await hmacSha256(encodedPayload, secret);
  if (!constantTimeEqual(expectedSignature, providedSignature)) return null;
  return new TextDecoder().decode(fromBase64Url(encodedPayload));
}

export async function verifySession<T>(token: string | null | undefined, secret: string): Promise<T | null> {
  if (!token || !secret) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = await hmacSha256(encoded, secret);
  if (!constantTimeEqual(signature, expected)) return null;

  try {
    const envelope = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))) as SessionEnvelope<T>;
    if (!envelope || typeof envelope.exp !== "number" || envelope.exp < epochSeconds()) return null;
    return envelope.payload;
  } catch {
    return null;
  }
}

export function sessionCookie(name: string, value: string, options: { maxAgeSeconds?: number; secure?: boolean } = {}): string {
  const secure = options.secure ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${options.maxAgeSeconds ?? 30 * 24 * 60 * 60}${secure}`;
}

export function expiredSessionCookie(name: string, secure = false): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

async function hmacSha256(input: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input));
  return toBase64Url(new Uint8Array(signature));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
