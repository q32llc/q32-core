import { describe, expect, it } from "vitest";
import {
  defineApiOperation,
  defineApiRegistry,
  dispatchApiOperation,
  interpolateOperationPath,
  openApiPathsForRegistry,
} from "../src/api.js";
import { mcpToolsFromApiRegistry } from "../src/mcp.js";

describe("api registry", () => {
  const schema = {
    parse(value: unknown): { id: string } {
      if (!value || typeof value !== "object" || typeof (value as { id?: unknown }).id !== "string") {
        throw new Error("invalid input");
      }
      return { id: (value as { id: string }).id };
    },
  };

  const registry = defineApiRegistry({
    get_widget: defineApiOperation<{ prefix: string }, { id: string }, { id: string; label: string }>({
      name: "get_widget",
      title: "Get Widget",
      description: "Fetch a widget.",
      method: "GET",
      path: "/api/widgets/{id}",
      scope: "widgets:read",
      inputSchema: schema,
      handler: (ctx, input) => ({ id: input.id, label: `${ctx.prefix}:${input.id}` }),
    }),
  });

  it("dispatches typed operations", async () => {
    await expect(dispatchApiOperation(registry, "get_widget", { prefix: "w" }, { id: "1" })).resolves.toEqual({
      id: "1",
      label: "w:1",
    });
  });

  it("builds path and metadata helpers", () => {
    expect(interpolateOperationPath("/api/widgets/{id}", { id: "a b" })).toBe("/api/widgets/a%20b");
    expect(openApiPathsForRegistry(registry)["/api/widgets/{id}"].get.operationId).toBe("get_widget");
    expect(mcpToolsFromApiRegistry(registry, { includeScopes: true })[0]).toMatchObject({
      name: "get_widget",
      annotations: { scope: "widgets:read" },
    });
  });
});
