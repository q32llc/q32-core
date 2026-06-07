import { HttpError } from "./http.js";

export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type ApiMethodLower = Lowercase<ApiMethod>;
export type ApiInputLocation = "path" | "query" | "body";

export interface SchemaLike<T = unknown> {
  parse(value: unknown): T;
}

export type JsonSchemaLike = Record<string, unknown>;

export type ApiOperationInputSpec = {
  properties?: Record<string, JsonSchemaLike>;
  required?: string[];
  locations?: Record<string, ApiInputLocation>;
  pathDescriptions?: Record<string, string>;
  schema?: JsonSchemaLike;
};

export type ApiTagSpec = {
  name: string;
  description?: string;
};

export type ApiOperationSpec<TInput = unknown> = {
  name: string;
  title: string;
  description: string;
  method: ApiMethod | ApiMethodLower;
  path: string;
  scope?: string;
  tags?: string[];
  inputSchema?: SchemaLike<TInput>;
  input?: ApiOperationInputSpec;
  responseKey?: string;
  responseSchema?: JsonSchemaLike;
  openapi?: boolean;
  mcp?: {
    toolName?: string;
    title?: string;
    description?: string;
    inputSchema?: JsonSchemaLike;
    requiresAuth?: boolean;
    annotations?: Record<string, unknown>;
  };
};

export type ApiOperation<TContext, TInput = unknown, TOutput = unknown> = ApiOperationSpec<TInput> & {
  handler: (context: TContext, input: TInput) => Promise<TOutput> | TOutput;
};

export type ApiOperationRegistry<TContext> = Record<string, ApiOperation<TContext, unknown, unknown>>;

export function defineApiOperation<TContext, TInput = unknown, TOutput = unknown>(
  operation: ApiOperation<TContext, TInput, TOutput>,
): ApiOperation<TContext, TInput, TOutput> {
  return operation;
}

export function defineApiRegistry<TContext, TRegistry extends ApiOperationRegistry<TContext>>(
  registry: TRegistry,
): TRegistry {
  const names = new Set<string>();
  for (const [key, operation] of Object.entries(registry)) {
    if (operation.name !== key) throw new Error(`API operation key/name mismatch: ${key} != ${operation.name}`);
    if (names.has(operation.name)) throw new Error(`Duplicate API operation name: ${operation.name}`);
    names.add(operation.name);
  }
  return registry;
}

export async function dispatchApiOperation<TContext>(
  registry: ApiOperationRegistry<TContext>,
  name: string,
  context: TContext,
  input: unknown,
): Promise<unknown> {
  const operation = registry[name];
  if (!operation) throw new HttpError(404, `Unknown API operation: ${name}`, "unknown_operation");
  const parsed = operation.inputSchema ? operation.inputSchema.parse(input) : input;
  return operation.handler(context, parsed);
}

export function operationPathParameters(path: string): string[] {
  const params = new Set<string>();
  for (const match of path.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) params.add(match[1]);
  return [...params];
}

export function interpolateOperationPath(path: string, input: Record<string, unknown>): string {
  return path.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key: string) => {
    const value = input[key];
    if (value === undefined || value === null || value === "") {
      throw new HttpError(400, `Missing path parameter: ${key}`, "missing_path_parameter");
    }
    return encodeURIComponent(String(value));
  });
}

export type OpenApiDocumentOptions = {
  title: string;
  version: string;
  description?: string;
  origin?: string;
  tags?: ApiTagSpec[];
  securitySchemeName?: string;
  includeDefaultErrorResponses?: boolean;
};

export function openApiDocumentForRegistry<TContext>(
  registry: ApiOperationRegistry<TContext>,
  options: OpenApiDocumentOptions,
): Record<string, unknown> {
  const securitySchemeName = options.securitySchemeName ?? "bearerAuth";
  return {
    openapi: "3.0.3",
    info: {
      title: options.title,
      version: options.version,
      ...(options.description ? { description: options.description } : {}),
    },
    ...(options.origin ? { servers: [{ url: options.origin.replace(/\/$/, "") }] } : {}),
    ...(options.tags ? { tags: options.tags } : {}),
    components: {
      securitySchemes: {
        [securitySchemeName]: { type: "http", scheme: "bearer" },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                details: {},
              },
            },
          },
        },
      },
    },
    paths: openApiPathsForRegistry(registry, {
      securitySchemeName,
      includeDefaultErrorResponses: options.includeDefaultErrorResponses ?? true,
    }),
  };
}

export function openApiPathsForRegistry<TContext>(
  registry: ApiOperationRegistry<TContext>,
  options: {
    securitySchemeName?: string;
    includeDefaultErrorResponses?: boolean;
  } = {},
): Record<string, Record<string, Record<string, unknown>>> {
  const paths: Record<string, Record<string, Record<string, unknown>>> = {};
  const securitySchemeName = options.securitySchemeName ?? "bearerAuth";
  for (const operation of Object.values(registry)) {
    if (operation.openapi === false) continue;
    const path = operation.path.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, "{$1}");
    const method = operation.method.toLowerCase();
    const input = operation.input;
    paths[path] ??= {};
    paths[path][method] = {
      operationId: operation.name,
      summary: operation.title,
      description: operation.description,
      tags: operation.tags,
      security: operation.scope ? [{ [securitySchemeName]: [operation.scope] }] : undefined,
      parameters: openApiParametersForOperation(operation),
      requestBody: openApiRequestBody(input),
      responses: {
        "200": {
          description: "OK",
          ...(operation.responseSchema
            ? {
                content: {
                  "application/json": { schema: operation.responseSchema },
                },
              }
            : operation.responseKey
              ? {
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        additionalProperties: true,
                        properties: { [operation.responseKey]: {} },
                      },
                    },
                  },
                }
              : {}),
        },
        ...(options.includeDefaultErrorResponses === false
          ? {}
          : {
              "400": errorResponse(),
              "401": errorResponse(),
              "403": errorResponse(),
              "404": errorResponse(),
              "429": errorResponse(),
            }),
      },
    };
  }
  return paths;
}

function openApiParametersForOperation(operation: ApiOperationSpec): Array<Record<string, unknown>> {
  const input = operation.input;
  if (!input?.locations) {
    return operationPathParameters(operation.path).map((name) => ({
      name,
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
  }
  return Object.entries(input.locations)
    .filter(([, location]) => location === "path" || location === "query")
    .map(([name, location]) => ({
      name,
      in: location,
      required: location === "path" || (input.required?.includes(name) ?? false),
      ...(location === "path"
        ? {
            description: input.pathDescriptions?.[name] ?? name,
          }
        : {}),
      schema: input.properties?.[name] ?? { type: "string" },
    }));
}

function openApiRequestBody(input: ApiOperationInputSpec | undefined): Record<string, unknown> | undefined {
  if (!input?.locations) return undefined;
  const bodyEntries = Object.entries(input.locations).filter(([, location]) => location === "body");
  if (bodyEntries.length === 0) return undefined;
  const properties = Object.fromEntries(bodyEntries.map(([name]) => [name, input.properties?.[name] ?? {}]));
  const required = (input.required ?? []).filter((name) => input.locations?.[name] === "body");
  return {
    required: required.length > 0,
    content: {
      "application/json": {
        schema: input.schema ?? {
          type: "object",
          properties,
          ...(required.length ? { required } : {}),
        },
      },
    },
  };
}

function errorResponse(): Record<string, unknown> {
  return {
    description: "Error response",
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/Error" } },
    },
  };
}

export type ApiCatalogService = {
  anchor: string;
  serviceDesc?: string;
  serviceDescType?: string;
  serviceDescTitle?: string;
  serviceDoc?: string;
  serviceDocType?: string;
  serviceDocTitle?: string;
  status?: string;
  statusType?: string;
  statusTitle?: string;
};

export function apiCatalogLinkset(services: ApiCatalogService[]): { linkset: Array<Record<string, unknown>> } {
  return {
    linkset: services.map((service) => ({
      anchor: service.anchor,
      ...(service.serviceDesc
        ? {
            "service-desc": [
              {
                href: service.serviceDesc,
                type: service.serviceDescType ?? "application/json",
                ...(service.serviceDescTitle ? { title: service.serviceDescTitle } : {}),
              },
            ],
          }
        : {}),
      ...(service.serviceDoc
        ? {
            "service-doc": [
              {
                href: service.serviceDoc,
                type: service.serviceDocType ?? "text/html",
                ...(service.serviceDocTitle ? { title: service.serviceDocTitle } : {}),
              },
            ],
          }
        : {}),
      ...(service.status
        ? {
            status: [
              {
                href: service.status,
                type: service.statusType ?? "application/json",
                ...(service.statusTitle ? { title: service.statusTitle } : {}),
              },
            ],
          }
        : {}),
    })),
  };
}

export type AgentDiscoveryLink = {
  href: string;
  rel: string;
  type?: string;
};

export function agentDiscoveryLinkHeader(links: AgentDiscoveryLink[]): string {
  return links
    .map((link) => `<${link.href}>; rel="${link.rel}"${link.type ? `; type="${link.type}"` : ""}`)
    .join(", ");
}

export type AgentSkill = {
  name: string;
  type: string;
  description?: string;
  url: string;
  sha256?: string;
};

export function agentSkillsIndex(skills: readonly AgentSkill[], options: { schema?: string } = {}): Record<string, unknown> {
  return {
    $schema:
      options.schema ??
      "https://raw.githubusercontent.com/cloudflare/agent-skills-discovery-rfc/main/schema/v0.2.0/index.schema.json",
    skills,
  };
}
