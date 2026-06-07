import { describe, expect, it } from "vitest";
import {
  agentDiscoveryLinkHeader,
  agentSkillsIndex,
  apiCatalogLinkset,
  defineApiOperation,
  defineApiRegistry,
  dispatchApiOperation,
  interpolateOperationPath,
  openApiDocumentForRegistry,
  openApiPathsForRegistry,
} from "../src/api.js";
import {
  annotationsForApiMethod,
  mcpBearerChallenge,
  mcpManifest,
  mcpToolsFromApiRegistry,
  mcpWellKnownServerMetadata,
} from "../src/mcp.js";
import { oauthProtectedResourceMetadata } from "../src/oauth.js";

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
      tags: ["Widgets"],
      input: {
        properties: {
          id: { type: "string", description: "Widget ID" },
          include: { type: "string" },
          label: { type: "string" },
        },
        required: ["id", "label"],
        locations: {
          id: "path",
          include: "query",
          label: "body",
        },
        pathDescriptions: { id: "Widget ID" },
      },
      responseKey: "widget",
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
    const operation = openApiPathsForRegistry(registry)["/api/widgets/{id}"].get;
    expect(operation.operationId).toBe("get_widget");
    expect(operation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "id", in: "path", required: true }),
        expect.objectContaining({ name: "include", in: "query" }),
      ]),
    );
    expect(operation.requestBody).toMatchObject({
      required: true,
      content: {
        "application/json": {
          schema: {
            properties: { label: { type: "string" } },
            required: ["label"],
          },
        },
      },
    });
    expect(mcpToolsFromApiRegistry(registry, { includeScopes: true })[0]).toMatchObject({
      name: "get_widget",
      annotations: { scope: "widgets:read", readOnlyHint: true },
      requiresAuth: true,
    });
  });

  it("builds OpenAPI documents and discovery linksets", () => {
    const spec = openApiDocumentForRegistry(registry, {
      title: "Widget API",
      version: "1.0.0",
      origin: "https://app.test",
      tags: [{ name: "Widgets" }],
    });
    expect(spec).toMatchObject({
      openapi: "3.0.3",
      info: { title: "Widget API", version: "1.0.0" },
      servers: [{ url: "https://app.test" }],
    });
    expect(JSON.stringify(spec)).toContain('"429"');

    expect(
      apiCatalogLinkset([
        {
          anchor: "https://app.test/api/v1",
          serviceDesc: "https://app.test/api/v1/openapi.json",
          serviceDoc: "https://app.test/docs/api",
          status: "https://app.test/health",
        },
        {
          anchor: "https://app.test/mcp",
          serviceDesc: "https://app.test/.well-known/mcp/server-card.json",
          serviceDoc: "https://app.test/docs/mcp",
        },
      ]),
    ).toMatchObject({
      linkset: [
        {
          anchor: "https://app.test/api/v1",
          "service-desc": [{ href: "https://app.test/api/v1/openapi.json" }],
          status: [{ href: "https://app.test/health" }],
        },
        {
          anchor: "https://app.test/mcp",
          "service-doc": [{ href: "https://app.test/docs/mcp" }],
        },
      ],
    });

    expect(
      agentDiscoveryLinkHeader([
        { href: "/.well-known/api-catalog", rel: "api-catalog" },
        { href: "/api/v1/openapi.json", rel: "service-desc", type: "application/json" },
      ]),
    ).toBe('</.well-known/api-catalog>; rel="api-catalog", </api/v1/openapi.json>; rel="service-desc"; type="application/json"');

    expect(
      agentSkillsIndex([
        {
          name: "app-mcp",
          type: "mcp",
          url: "https://app.test/mcp",
          sha256: "a".repeat(64),
        },
      ]),
    ).toMatchObject({
      skills: [{ name: "app-mcp", type: "mcp", url: "https://app.test/mcp" }],
    });
  });

  it("builds MCP manifests, server cards, annotations, and bearer challenges", () => {
    expect(annotationsForApiMethod("DELETE")).toMatchObject({ destructiveHint: true });
    expect(
      mcpWellKnownServerMetadata({
        name: "Widget MCP",
        url: "https://app.test/mcp",
        authorizationServers: ["https://app.test/.well-known/oauth-authorization-server"],
        protectedResource: "https://app.test/.well-known/oauth-protected-resource/mcp",
        tools: mcpToolsFromApiRegistry(registry),
      }),
    ).toMatchObject({
      name: "Widget MCP",
      oauth: {
        authorization_server: "https://app.test/.well-known/oauth-authorization-server",
        protected_resource: "https://app.test/.well-known/oauth-protected-resource/mcp",
      },
      tools: [{ name: "get_widget" }],
    });

    expect(
      mcpManifest({
        name: "Widget",
        endpoint: "https://app.test/mcp",
        anonymousDescription: "Public tools are available.",
        authenticatedDescription: "OAuth unlocks private tools.",
        tools: mcpToolsFromApiRegistry(registry),
      }),
    ).toMatchObject({
      server: { name: "Widget", endpoint: "https://app.test/mcp", transport: "streamable_http" },
      authentication: { authenticated: "OAuth unlocks private tools." },
      capabilities: { tools: { get_widget: { requiresAuth: true } } },
    });

    expect(mcpBearerChallenge({ origin: "https://app.test/" })).toBe(
      'Bearer error="Unauthorized", error_description="Unauthorized", resource_metadata="https://app.test/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it("builds OAuth protected-resource metadata with optional display fields", () => {
    expect(
      oauthProtectedResourceMetadata("https://app.test/mcp", "https://app.test/", {
        scopes: ["mcp:read"],
        resourceName: "Widget MCP",
        resourceDocumentation: "https://app.test/docs/mcp",
      }),
    ).toEqual({
      resource: "https://app.test/mcp",
      authorization_servers: ["https://app.test"],
      scopes_supported: ["mcp:read"],
      bearer_methods_supported: ["header"],
      resource_name: "Widget MCP",
      resource_documentation: "https://app.test/docs/mcp",
    });
  });
});
