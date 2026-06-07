import type { ApiMethod, ApiMethodLower, ApiOperationRegistry } from "./api.js";

export type McpToolDescriptor = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  requiresAuth?: boolean;
};

export type McpToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export function mcpToolsFromApiRegistry<TContext>(
  registry: ApiOperationRegistry<TContext>,
  options: { includeScopes?: boolean } = {},
): McpToolDescriptor[] {
  return Object.values(registry).map((operation) => {
    const annotations = {
      ...annotationsForApiMethod(operation.method),
      ...(options.includeScopes && operation.scope ? { scope: operation.scope } : {}),
      ...(operation.mcp?.annotations ?? {}),
    };
    return {
      name: operation.mcp?.toolName ?? operation.name,
      title: operation.mcp?.title ?? operation.title,
      description: operation.mcp?.description ?? operation.description,
      inputSchema: operation.mcp?.inputSchema ?? operation.input?.schema ?? jsonSchemaPlaceholder(operation.path),
      annotations,
      requiresAuth: operation.mcp?.requiresAuth ?? Boolean(operation.scope),
    };
  });
}

export function mcpWellKnownServerMetadata(options: {
  name: string;
  url: string;
  description?: string;
  authorizationServers?: string[];
  protectedResource?: string;
  tools?: readonly McpToolDescriptor[];
  resources?: ReadonlyArray<Record<string, unknown>>;
  prompts?: ReadonlyArray<Record<string, unknown>>;
  oauth?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    name: options.name,
    description: options.description,
    transport: "http",
    url: options.url,
    authorization_servers: options.authorizationServers,
    oauth: options.oauth ?? oauthLinks(options.authorizationServers?.[0], options.protectedResource),
    tools: options.tools,
    resources: options.resources,
    prompts: options.prompts,
    metadata: options.metadata,
  };
}

export function mcpManifest(options: {
  name: string;
  endpoint: string;
  transport?: "streamable_http" | "http";
  anonymousDescription?: string;
  authenticatedDescription?: string;
  tools?: readonly McpToolDescriptor[];
  resources?: ReadonlyArray<Record<string, unknown>>;
  prompts?: ReadonlyArray<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    server: {
      name: options.name,
      endpoint: options.endpoint,
      transport: options.transport ?? "streamable_http",
    },
    authentication: {
      anonymous: options.anonymousDescription,
      authenticated: options.authenticatedDescription,
    },
    capabilities: {
      tools: options.tools
        ? Object.fromEntries(
            options.tools.map((tool) => [
              tool.name,
              {
                name: tool.name,
                title: tool.title,
                description: tool.description,
                requiresAuth: tool.requiresAuth,
              },
            ]),
          )
        : undefined,
      resources: options.resources,
      prompts: options.prompts,
    },
    metadata: options.metadata,
  };
}

export function mcpBearerChallenge(options: {
  origin: string;
  resourcePath?: string;
  error?: string;
  errorDescription?: string;
}): string {
  const origin = options.origin.replace(/\/$/, "");
  const resourcePath = options.resourcePath ?? "/.well-known/oauth-protected-resource/mcp";
  return `Bearer error="${options.error ?? "Unauthorized"}", error_description="${options.errorDescription ?? "Unauthorized"}", resource_metadata="${origin}${resourcePath}"`;
}

export function annotationsForApiMethod(method: ApiMethod | ApiMethodLower): McpToolAnnotations {
  const normalized = method.toUpperCase();
  if (normalized === "GET") return READ_ONLY_ANNOTATIONS;
  if (normalized === "DELETE") return DESTRUCTIVE_ANNOTATIONS;
  return MUTATING_ANNOTATIONS;
}

const READ_ONLY_ANNOTATIONS: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const MUTATING_ANNOTATIONS: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const DESTRUCTIVE_ANNOTATIONS: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

function oauthLinks(authorizationServer: string | undefined, protectedResource: string | undefined): Record<string, unknown> | undefined {
  if (!authorizationServer && !protectedResource) return undefined;
  return {
    authorization_server: authorizationServer,
    protected_resource: protectedResource,
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
