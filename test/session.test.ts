import { describe, expect, it } from "vitest";
import { expiredSessionCookie, sessionCookie, signSession, verifySession } from "../src/session.js";

describe("signed sessions", () => {
  it("round-trips a signed payload", async () => {
    const token = await signSession({ accountId: "acct_1" }, "secret", { expiresInSeconds: 60 });
    await expect(verifySession<{ accountId: string }>(token, "secret")).resolves.toEqual({ accountId: "acct_1" });
  });

  it("rejects tampered payloads", async () => {
    const token = await signSession({ accountId: "acct_1" }, "secret");
    const [payload, signature] = token.split(".");
    const tampered = `${payload.slice(0, -1)}x.${signature}`;
    await expect(verifySession(tampered, "secret")).resolves.toBeNull();
  });

  it("rejects expired and malformed sessions", async () => {
    const token = await signSession({ accountId: "acct_1" }, "secret", { expiresInSeconds: -1 });
    await expect(verifySession(token, "secret")).resolves.toBeNull();
    await expect(verifySession("bad", "secret")).resolves.toBeNull();
    await expect(verifySession(token, "wrong")).resolves.toBeNull();
  });

  it("formats session cookies", () => {
    expect(sessionCookie("sid", "abc", { maxAgeSeconds: 1, secure: true })).toContain("Secure");
    expect(expiredSessionCookie("sid")).toContain("Max-Age=0");
  });
});
