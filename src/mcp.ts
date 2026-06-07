import type { ApiOperationRegistry } from "./api.js";

export type McpToolDescriptor = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

export function mcpToolsFromApiRegistry<TContext>(
  registry: ApiOperationRegistry<TContext>,
  options: { includeScopes?: boolean } = {},
): McpToolDescriptor[] {
  return Object.values(registry).map((operation) => ({
    name: operation.name,
    title: operation.title,
    description: operation.description,
    inputSchema: jsonSchemaPlaceholder(operation.path),
    annotations: options.includeScopes && operation.scope ? { scope: operation.scope } : undefined,
  }));
}

export function mcpWellKnownServerMetadata(options: {
  name: string;
  url: string;
  description?: string;
  authorizationServers?: string[];
}): Record<string, unknown> {
  return {
    name: options.name,
    description: options.description,
    transport: "http",
    url: options.url,
    authorization_servers: options.authorizationServers,
  };
}

function jsonSchemaPlaceholder(path: string): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const match of path.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    properties[match[1]] = { type: "string" };
    required.push(match[1]);
  }
  return {
    type: "object",
    properties,
    required,
    additionalProperties: true,
  };
}
