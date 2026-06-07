import { fromBase64Url, randomBase64Url, toBase64Url } from "./ids.js";

const AES_GCM_IV_BYTES = 12;
const AES_GCM_KEY_BYTES = 32;

export type EncryptedJsonEnvelope = {
  v: 1;
  alg: "A256GCM";
  iv: string;
  ciphertext: string;
};

export function createEncryptionKey(): string {
  return randomBase64Url(AES_GCM_KEY_BYTES);
}

export async function encryptJson(value: unknown, keyMaterial: string): Promise<EncryptedJsonEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const key = await importAesKey(keyMaterial);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    v: 1,
    alg: "A256GCM",
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
  };
}

export async function decryptJson<T>(envelope: EncryptedJsonEnvelope, keyMaterial: string): Promise<T> {
  if (envelope.v !== 1 || envelope.alg !== "A256GCM") throw new Error("Unsupported encrypted JSON envelope.");
  const key = await importAesKey(keyMaterial);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(fromBase64Url(envelope.iv)) },
    key,
    toArrayBuffer(fromBase64Url(envelope.ciphertext)),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

async function importAesKey(keyMaterial: string): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = fromBase64Url(keyMaterial);
  } catch {
    throw new Error("Encryption key must be 32 base64url-encoded bytes.");
  }
  if (raw.byteLength !== AES_GCM_KEY_BYTES) {
    throw new Error("Encryption key must be 32 base64url-encoded bytes.");
  }
  return crypto.subtle.importKey("raw", toArrayBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
