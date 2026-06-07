import { describe, expect, it } from "vitest";
import { createEncryptionKey, decryptJson, encryptJson } from "../src/crypto.js";

describe("encrypted JSON", () => {
  it("encrypts and decrypts payloads", async () => {
    const key = createEncryptionKey();
    const envelope = await encryptJson({ secret: "value" }, key);

    expect(envelope.alg).toBe("A256GCM");
    expect(envelope.ciphertext).not.toContain("value");
    await expect(decryptJson(envelope, key)).resolves.toEqual({ secret: "value" });
  });

  it("rejects invalid key material", async () => {
    await expect(encryptJson({ secret: "value" }, "short")).rejects.toThrow("Encryption key");
  });
});
