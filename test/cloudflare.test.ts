import { describe, expect, it } from "vitest";
import { isCloudflareScheduledEvent, requireD1, requireQueue, requireR2 } from "../src/cloudflare.js";

describe("Cloudflare binding helpers", () => {
  it("returns required bindings", () => {
    const db = { prepare: () => ({}) };
    const bucket = { put: async () => ({}) };
    const queue = { send: async () => undefined };
    expect(requireD1({ DB: db })).toBe(db);
    expect(requireR2({ MEDIA: bucket }, "MEDIA")).toBe(bucket);
    expect(requireQueue({ JOBS: queue }, "JOBS")).toBe(queue);
  });

  it("throws for missing bindings and detects scheduled events", () => {
    expect(() => requireD1({})).toThrow("Missing D1");
    expect(() => requireR2({}, "MEDIA")).toThrow("Missing R2");
    expect(() => requireQueue({}, "JOBS")).toThrow("Missing Queue");
    expect(isCloudflareScheduledEvent({ scheduledTime: 1, cron: "* * * * *" })).toBe(true);
    expect(isCloudflareScheduledEvent({})).toBe(false);
  });
});
