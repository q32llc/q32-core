import { describe, expect, it } from "vitest";
import { appUrl, optionalBoolean, requiredBinding, requiredString, requiredUrl } from "../src/env.js";
import { absoluteUrl, defaultFetch, errorResponse, escapeHtml, HttpError, isCommonAttackProbe, jsonResponse, readJson, readResponseExcerpt, requireAdminToken, requireBearerToken } from "../src/http.js";

describe("env helpers", () => {
  it("reads required strings and normalized app urls", () => {
    expect(requiredString({ APP_URL: "x" }, "APP_URL")).toBe("x");
    expect(appUrl({ PUBLIC_APP_URL: "https://example.com/" })).toBe("https://example.com");
    expect(appUrl({ PUBLIC_APP_URL: "https://public.example.com/" }, { keys: ["APP_URL", "BASE_URL"] })).toBe("http://localhost:8787");
    expect(optionalBoolean({ FEATURE: "yes" }, "FEATURE")).toBe(true);
    expect(requiredUrl({ URL: "https://example.com/path/" }, "URL")).toBe("https://example.com/path");
    expect(requiredBinding<{ id: string }>({ DB: { id: "db" } }, "DB")).toEqual({ id: "db" });
  });

  it("throws useful env errors", () => {
    expect(() => requiredString({}, "APP_URL")).toThrow("Missing required env var");
    expect(() => requiredUrl({ URL: "nope" }, "URL")).toThrow("valid URL");
    expect(() => optionalBoolean({ FEATURE: "maybe" }, "FEATURE")).toThrow("boolean-like");
  });
});

describe("http helpers", () => {
  it("writes json responses", async () => {
    const response = jsonResponse({ ok: true });
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("rejects non-json request bodies", async () => {
    const request = new Request("https://example.com", { method: "POST", body: "x" });
    await expect(readJson(request)).rejects.toBeInstanceOf(HttpError);
  });

  it("handles bearer and admin token checks", () => {
    const request = new Request("https://example.com", { headers: { authorization: "Bearer abc" } });
    expect(requireBearerToken(request)).toBe("abc");
    expect(() => requireAdminToken(request, "abc")).not.toThrow();
    expect(() => requireAdminToken(request, "def")).toThrow("Invalid admin token");
  });

  it("serializes errors", async () => {
    await expect(errorResponse(new HttpError(418, "teapot", "teapot")).json()).resolves.toEqual({
      error: { code: "teapot", message: "teapot" },
    });
    await expect(errorResponse(new Error("boom")).json()).resolves.toEqual({
      error: { code: "internal_error", message: "boom" },
    });
  });

  it("provides Relin-compatible HTTP helpers", async () => {
    expect(absoluteUrl("https://example.com/", "path")).toBe("https://example.com/path");
    expect(escapeHtml(`<a href="x">it's</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;it&#039;s&lt;/a&gt;");
    await expect(readResponseExcerpt(new Response("abcdef"), 3)).resolves.toBe("abc");
    expect(typeof defaultFetch).toBe("function");
  });

  it("classifies common attack probes without catching ordinary 404s", () => {
    expect(isCommonAttackProbe("/.env")).toBe(true);
    expect(isCommonAttackProbe("/contact.php")).toBe(true);
    expect(isCommonAttackProbe(new URL("https://example.com/wp-login.php"))).toBe(true);
    expect(isCommonAttackProbe(new Request("https://example.com/wp-admin/install.php"))).toBe(true);
    expect(isCommonAttackProbe("https://example.com/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php")).toBe(true);
    expect(isCommonAttackProbe("/missing-page")).toBe(false);
    expect(isCommonAttackProbe("/products/php-light")).toBe(false);
  });

  it("normalizes common attack probe paths", () => {
    expect(isCommonAttackProbe("/%2Egit/config")).toBe(true);
    expect(isCommonAttackProbe("/Wp-Content/plugins/shell.txt")).toBe(true);
    expect(isCommonAttackProbe("/bad%zz/wp-login.php")).toBe(true);
  });
});
