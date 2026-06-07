export type JsonResponseInit = ResponseInit & {
  pretty?: boolean;
};

export type FetchLike = typeof fetch;

export const defaultFetch: FetchLike = (input, init) => fetch(input, init);

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = "http_error",
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function jsonResponse(value: unknown, init: JsonResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value, null, init.pretty ? 2 : 0), {
    ...init,
    headers,
  });
}

export function errorResponse(error: unknown, fallbackStatus = 500): Response {
  if (error instanceof HttpError) {
    return jsonResponse({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : String(error);
  return jsonResponse({ error: { code: "internal_error", message } }, { status: fallbackStatus });
}

export async function readJson<T = unknown>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "Expected application/json request body.", "unsupported_media_type");
  }
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON request body.", "invalid_json");
  }
}

export function requireBearerToken(request: Request): string {
  const value = request.headers.get("authorization") ?? "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new HttpError(401, "Missing bearer token.", "missing_bearer_token");
  return match[1];
}

export function requireAdminToken(request: Request, expected: string | undefined): void {
  if (!expected) throw new HttpError(500, "Admin token is not configured.", "admin_token_not_configured");
  const provided = request.headers.get("x-admin-token") ?? requireBearerToken(request);
  if (provided !== expected) throw new HttpError(403, "Invalid admin token.", "invalid_admin_token");
}

export function absoluteUrl(appUrl: string, path: string): string {
  return `${appUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export function escapeHtml(value: string | null | undefined): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function readResponseExcerpt(response: Response, maxLength = 800): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.slice(0, maxLength);
}
