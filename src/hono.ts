import type { AuthSystem, McpAuthService, McpAuthorizationParams } from "./auth.js";
import { errorResponse, HttpError } from "./http.js";
import type { OAuthClientInformation } from "./oauth.js";

export type HonoContextLike<TEnv = unknown> = {
  req: {
    raw: Request;
    url: string;
  };
  env?: TEnv;
  set?: (key: string, value: unknown) => void;
  get?: (key: string) => unknown;
  json: (value: unknown, status?: number) => Response;
  redirect: (location: string, status?: number) => Response;
  res?: Response;
};

export type HonoNext = () => Promise<void>;

export function honoAuthMiddleware<TPrincipal, TSession>(
  auth: AuthSystem<TPrincipal, TSession>,
  options: { contextKey?: string; requirePrincipal?: boolean } = {},
): (context: HonoContextLike, next: HonoNext) => Promise<Response | void> {
  return async (context, next) => {
    try {
      const authContext = await auth.contextFromRequest(context.req.raw);
      if (options.requirePrincipal && !authContext.principal) {
        throw new HttpError(401, "Authentication required.", "authentication_required");
      }
      context.set?.(options.contextKey ?? "auth", authContext);
      await next();
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export async function honoRequirePrincipal<TPrincipal, TSession>(
  context: HonoContextLike,
  auth: AuthSystem<TPrincipal, TSession>,
): Promise<TPrincipal> {
  return auth.requirePrincipal(context.req.raw);
}

export async function honoMcpAuthorize<TPrincipal, TSubject extends Record<string, string>>(
  context: HonoContextLike,
  service: McpAuthService<TPrincipal, TSubject>,
  client: OAuthClientInformation,
  params: McpAuthorizationParams,
): Promise<Response> {
  const result = await service.authorize(client, params, context.req.raw);
  if (result.kind === "redirect") return context.redirect(result.location, result.status ?? 302);
  return context.redirect(result.redirect, 302);
}
