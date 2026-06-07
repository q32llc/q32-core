import { describe, expect, it } from "vitest";
import {
  hmacSha256Base64,
  hmacSha256Hex,
  sha256Hex,
  timingSafeEqual,
  toBase64,
  toHex,
} from "../src/hash.js";

describe("hash helpers", () => {
  it("matches Relin-compatible hash behavior", async () => {
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe("000fff");
    expect(toBase64(new Uint8Array([104, 105]))).toBe("aGk=");
    await expect(sha256Hex("hello")).resolves.toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    await expect(hmacSha256Hex("secret", "value")).resolves.toBe(
      "50e03ebe65be98bb8bf11ba2c892d54c079aca2b0d3b0162769c6d757a25434f",
    );
    await expect(hmacSha256Base64("secret", "value")).resolves.toBe(
      "UOA+vmW+mLuL8RuiyJLVTAeayisNOwFidpxtdXolQ08=",
    );
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "ab")).toBe(false);
  });
});
