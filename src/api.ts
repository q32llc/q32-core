import { HttpError } from "./http.js";

export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface SchemaLike<T = unknown> {
  parse(value: unknown): T;
}

export type ApiOperationSpec<TInput = unknown> = {
  name: string;
  title: string;
  description: string;
  method: ApiMethod;
  path: string;
  scope?: string;
  inputSchema?: SchemaLike<TInput>;
  openapi?: boolean;
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

export function openApiPathsForRegistry<TContext>(
  registry: ApiOperationRegistry<TContext>,
): Record<string, Record<string, Record<string, unknown>>> {
  const paths: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const operation of Object.values(registry)) {
    if (operation.openapi === false) continue;
    const path = operation.path.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, "{$1}");
    const method = operation.method.toLowerCase();
    paths[path] ??= {};
    paths[path][method] = {
      operationId: operation.name,
      summary: operation.title,
      description: operation.description,
      security: operation.scope ? [{ bearerAuth: [operation.scope] }] : undefined,
      parameters: operationPathParameters(operation.path).map((name) => ({
        name,
        in: "path",
        required: true,
        schema: { type: "string" },
      })),
      responses: {
        "200": {
          description: "OK",
        },
      },
    };
  }
  return paths;
}
