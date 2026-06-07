import type { AuthSystem, McpAuthService, McpAuthorizationParams } from "./auth.js";
import { HttpError, jsonResponse } from "./http.js";
import type { OAuthClientInformation } from "./oauth.js";

export type ReactRouterRequestArgs = {
  request: Request;
  params?: Record<string, string | undefined>;
  context?: unknown;
};

export async function reactRouterAuthContext<TPrincipal, TSession>(
  auth: AuthSystem<TPrincipal, TSession>,
  args: ReactRouterRequestArgs,
) {
  return auth.contextFromRequest(args.request);
}

export async function reactRouterRequirePrincipal<TPrincipal, TSession>(
  auth: AuthSystem<TPrincipal, TSession>,
  args: ReactRouterRequestArgs,
): Promise<TPrincipal> {
  return auth.requirePrincipal(args.request);
}

export function reactRouterJson(value: unknown, init: ResponseInit = {}): Response {
  return jsonResponse(value, init);
}

export function reactRouterRedirect(location: string, status = 302): Response {
  return new Response(null, {
    status,
    headers: { location },
  });
}

export function reactRouterError(error: unknown): Response {
  if (error instanceof Response) return error;
  if (error instanceof HttpError) {
    return jsonResponse({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : String(error);
  return jsonResponse({ error: { code: "internal_error", message } }, { status: 500 });
}

export async function reactRouterMcpAuthorize<TPrincipal, TSubject extends Record<string, string>>(
  args: ReactRouterRequestArgs,
  service: McpAuthService<TPrincipal, TSubject>,
  client: OAuthClientInformation,
  params: McpAuthorizationParams,
): Promise<Response> {
  const result = await service.authorize(client, params, args.request);
  return reactRouterRedirect(result.kind === "redirect" ? result.location : result.redirect, result.kind === "redirect" ? (result.status ?? 302) : 302);
}
