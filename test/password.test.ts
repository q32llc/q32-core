import { describe, expect, it } from "vitest";
import { hashPassword, passwordValidationError, verifyPassword } from "../src/password.js";

describe("password hashing", () => {
  it("hashes and verifies a valid password without storing it", async () => {
    const stored = await hashPassword("a long soft mochi password");
    expect(stored).toMatch(/^pbkdf2-sha256\$210000\$/);
    expect(stored).not.toContain("mochi");
    await expect(verifyPassword("a long soft mochi password", stored)).resolves.toEqual({ valid: true, needsRehash: false });
    await expect(verifyPassword("incorrect password", stored)).resolves.toEqual({ valid: false, needsRehash: false });
  });

  it("marks hashes with older work factors for upgrade after successful verification", async () => {
    const stored = await hashPassword("a suitable old password", { iterations: 1 });
    await expect(verifyPassword("a suitable old password", stored)).resolves.toEqual({ valid: true, needsRehash: true });
    await expect(verifyPassword("incorrect password", stored)).resolves.toEqual({ valid: false, needsRehash: false });
  });

  it("rejects malformed and unreasonably expensive stored hashes", async () => {
    await expect(verifyPassword("anything at all", null)).resolves.toEqual({ valid: false, needsRehash: false });
    await expect(verifyPassword("anything at all", "pbkdf2-sha256$1000001$bad$bad")).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
    await expect(verifyPassword("anything at all", "pbkdf2-sha256$2$bad!$bad!")).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it("provides bounded input validation", async () => {
    expect(passwordValidationError("short")).toBe("Use at least 10 characters.");
    expect(passwordValidationError("x".repeat(257))).toBe("Use at most 256 characters.");
    expect(passwordValidationError("long enough")).toBeNull();
    await expect(hashPassword("short")).rejects.toThrow("at least 10");
    await expect(hashPassword("long enough", { iterations: 0 })).rejects.toThrow("iterations");
  });
});
