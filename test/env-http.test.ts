import { describe, expect, it } from "vitest";
import { appUrl, optionalBoolean, requiredBinding, requiredString, requiredUrl } from "../src/env.js";
import { errorResponse, HttpError, jsonResponse, readJson, requireAdminToken, requireBearerToken } from "../src/http.js";

describe("env helpers", () => {
  it("reads required strings and normalized app urls", () => {
    expect(requiredString({ APP_URL: "x" }, "APP_URL")).toBe("x");
    expect(appUrl({ PUBLIC_APP_URL: "https://example.com/" })).toBe("https://example.com");
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
});
