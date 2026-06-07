import { describe, expect, it } from "vitest";
import { jsonResponse } from "../src/http.js";
import { createMemoryQueue, createMemoryR2Bucket, expectJsonResponse } from "../src/testing.js";

describe("testing helpers", () => {
  it("captures queue messages", async () => {
    const queue = createMemoryQueue<{ jobId: string }>();
    await queue.send({ jobId: "job_1" }, { delaySeconds: 5 });
    await queue.sendBatch([{ body: { jobId: "job_2" } }]);
    expect(queue.sent.map((message) => message.body.jobId)).toEqual(["job_1", "job_2"]);
    queue.clear();
    expect(queue.sent).toHaveLength(0);
  });

  it("stores memory R2 objects", async () => {
    const bucket = createMemoryR2Bucket();
    await bucket.put("demo.json", JSON.stringify({ ok: true }), { httpMetadata: { contentType: "application/json" } });
    await expect(bucket.get("demo.json").then((object) => object?.json())).resolves.toEqual({ ok: true });
    await bucket.delete("demo.json");
    await expect(bucket.get("demo.json")).resolves.toBeNull();
  });

  it("asserts JSON responses", async () => {
    await expect(expectJsonResponse<{ ok: boolean }>(jsonResponse({ ok: true }))).resolves.toEqual({ ok: true });
    await expect(expectJsonResponse(new Response("nope"))).rejects.toThrow("Expected JSON response");
  });
});
