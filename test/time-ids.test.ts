import { describe, expect, it } from "vitest";
import { createBase36Id, createBase36Token, createId, fromBase64Url, toBase64Url } from "../src/ids.js";
import { addSeconds, epochSeconds, isFutureIso, nowIso } from "../src/time.js";

describe("time helpers", () => {
  it("formats and compares timestamps", () => {
    const base = new Date("2026-01-01T00:00:00.000Z");
    expect(nowIso(base)).toBe("2026-01-01T00:00:00.000Z");
    expect(epochSeconds(base)).toBe(1767225600);
    expect(addSeconds(base, 30)).toBe("2026-01-01T00:00:30.000Z");
    expect(isFutureIso("2026-01-01T00:00:31.000Z", base)).toBe(true);
    expect(isFutureIso("not-a-date", base)).toBe(false);
    expect(isFutureIso(null, base)).toBe(false);
  });
});

describe("id helpers", () => {
  it("creates prefixed IDs and base64url round trips", () => {
    expect(createId("bad prefix!", 4)).toMatch(/^bad_prefix_/);
    const encoded = toBase64Url("hello");
    expect(new TextDecoder().decode(fromBase64Url(encoded))).toBe("hello");
    expect(createBase36Id("evt")).toMatch(/^evt_[0-9a-z]{20}$/);
    expect(createBase36Token("tok")).toMatch(/^tok_[0-9a-z]{40}$/);
  });

  it("requires non-empty prefixes", () => {
    expect(() => createId("   ")).toThrow("ID prefix is required");
  });
});
