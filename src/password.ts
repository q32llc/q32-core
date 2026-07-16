import { fromBase64Url, randomBase64Url, toBase64Url } from "./ids.js";

const ALGORITHM = "pbkdf2-sha256";
const DEFAULT_ITERATIONS = 210_000;
const MAX_STORED_ITERATIONS = 1_000_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

export type PasswordHashOptions = {
  iterations?: number;
};

export type PasswordVerification = {
  valid: boolean;
  needsRehash: boolean;
};

export function passwordValidationError(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 256) return "Use at most 256 characters.";
  return null;
}

export async function hashPassword(password: string, options: PasswordHashOptions = {}): Promise<string> {
  const validationError = passwordValidationError(password);
  if (validationError) throw new Error(validationError);
  const iterations = validIterations(options.iterations ?? DEFAULT_ITERATIONS);
  const salt = fromBase64Url(randomBase64Url(SALT_BYTES));
  const derived = await derive(password, salt, iterations);
  return `${ALGORITHM}$${iterations}$${toBase64Url(salt)}$${toBase64Url(derived)}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<PasswordVerification> {
  const parsed = parseStoredHash(stored);
  if (!parsed) return { valid: false, needsRehash: false };
  const actual = await derive(password, parsed.salt, parsed.iterations);
  const valid = timingSafeEqual(actual, parsed.hash);
  return { valid, needsRehash: valid && parsed.iterations < DEFAULT_ITERATIONS };
}

function parseStoredHash(stored: string | null | undefined): { iterations: number; salt: Uint8Array; hash: Uint8Array } | null {
  if (!stored) return null;
  const [algorithm, iterationText, saltText, hashText, extra] = stored.split("$");
  const iterations = Number(iterationText);
  if (algorithm !== ALGORITHM || extra !== undefined || !saltText || !hashText) return null;
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_STORED_ITERATIONS) return null;
  try {
    const salt = fromBase64Url(saltText);
    const hash = fromBase64Url(hashText);
    if (salt.byteLength !== SALT_BYTES || hash.byteLength !== HASH_BYTES) return null;
    return { iterations, salt, hash };
  } catch {
    return null;
  }
}

function validIterations(iterations: number): number {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_STORED_ITERATIONS) {
    throw new Error(`Password iterations must be an integer between 1 and ${MAX_STORED_ITERATIONS}.`);
  }
  return iterations;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations },
    material,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
