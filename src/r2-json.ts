import { sha256Hex } from "./ids.js";

export type R2JsonPutOptions = {
  contentType?: string;
  customMetadata?: Record<string, string>;
};

export async function putR2Json(
  bucket: R2Bucket,
  key: string,
  value: unknown,
  options: R2JsonPutOptions = {},
): Promise<R2Object> {
  return bucket.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: options.contentType ?? "application/json; charset=utf-8" },
    customMetadata: options.customMetadata,
  });
}

export async function getR2Json<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  return (await object.json()) as T;
}

export async function digestR2Key(prefix: string, value: string | Uint8Array, extension = "json"): Promise<string> {
  const input = typeof value === "string" ? value : [...value].map((byte) => String.fromCharCode(byte)).join("");
  const digest = await sha256Hex(input);
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, "");
  const cleanExtension = extension.replace(/^\./, "");
  return `${cleanPrefix}/${digest.slice(0, 2)}/${digest}.${cleanExtension}`;
}
