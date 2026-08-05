import { escapeHtml } from "./http.js";

const DEFAULT_MAX_AGE_SECONDS = 5 * 60;

export type MagicLinkConfirmationBrand = {
  productName: string;
  logoUrl?: string;
  accentColor?: string;
  backgroundColor?: string;
  cardColor?: string;
  textColor?: string;
  mutedColor?: string;
  eyebrow?: string;
  title?: string;
  message?: string;
  buttonLabel?: string;
};

export type MagicLinkTurnstileOptions = {
  siteKey: string;
  secretKey: string;
  expectedAction?: string;
  expectedHostname?: string;
  fetcher?: typeof fetch;
};

export type MagicLinkConfirmationOptions = {
  cookieName: string;
  brand: MagicLinkConfirmationBrand;
  consume(token: string, request: Request): Promise<Response>;
  turnstile?: MagicLinkTurnstileOptions;
  maxAgeSeconds?: number;
  cookiePath?: string;
  requireSameOrigin?: boolean;
  invalidResponse?: (reason: MagicLinkConfirmationFailure, request: Request) => Response | Promise<Response>;
};

export type MagicLinkConfirmationFailure =
  | "missing_token"
  | "missing_staged_token"
  | "method_not_allowed"
  | "origin_mismatch"
  | "turnstile_failed";

export type TurnstileVerificationResult = {
  success: boolean;
  action?: string;
  hostname?: string;
  errorCodes: string[];
};

type TurnstileResponse = {
  success?: boolean;
  action?: string;
  hostname?: string;
  "error-codes"?: unknown;
};

export function createMagicLinkConfirmation(options: MagicLinkConfirmationOptions) {
  validateCookieName(options.cookieName);
  const maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new Error("Magic-link confirmation maxAgeSeconds must be a positive integer.");
  }

  return {
    handle: (request: Request, token?: string | null) =>
      handleMagicLinkConfirmation(request, token, options, maxAgeSeconds),
  };
}

export async function verifyMagicLinkTurnstile(
  request: Request,
  responseToken: string,
  options: MagicLinkTurnstileOptions,
): Promise<TurnstileVerificationResult> {
  if (!responseToken || !options.secretKey) {
    return { success: false, errorCodes: ["missing-input"] };
  }
  const form = new FormData();
  form.set("secret", options.secretKey);
  form.set("response", responseToken);
  const remoteIp = request.headers.get("cf-connecting-ip")?.trim();
  if (remoteIp) form.set("remoteip", remoteIp);

  const response = await (options.fetcher ?? ((input, init) => fetch(input, init)))(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body: form },
  );
  if (!response.ok) return { success: false, errorCodes: [`http-${response.status}`] };

  const payload = (await response.json().catch(() => null)) as TurnstileResponse | null;
  const errorCodes = Array.isArray(payload?.["error-codes"])
    ? payload["error-codes"].filter((value): value is string => typeof value === "string")
    : [];
  const success = Boolean(
    payload?.success &&
      (!options.expectedAction || payload.action === options.expectedAction) &&
      (!options.expectedHostname || payload.hostname === options.expectedHostname),
  );
  return {
    success,
    ...(payload?.action ? { action: payload.action } : {}),
    ...(payload?.hostname ? { hostname: payload.hostname } : {}),
    errorCodes,
  };
}

export function renderMagicLinkConfirmationPage(
  brand: MagicLinkConfirmationBrand,
  options: { actionPath: string; turnstileSiteKey?: string; nonce?: string },
): string {
  const nonce = options.nonce ?? randomNonce();
  const productName = escapeHtml(brand.productName);
  const title = escapeHtml(brand.title ?? `Opening ${brand.productName}`);
  const message = escapeHtml(brand.message ?? "Completing your secure sign-in.");
  const eyebrow = escapeHtml(brand.eyebrow ?? "SECURE SIGN-IN");
  const buttonLabel = escapeHtml(brand.buttonLabel ?? `Continue to ${brand.productName}`);
  const actionPath = escapeHtml(options.actionPath);
  const logo = brand.logoUrl
    ? `<img class="logo" src="${escapeHtml(brand.logoUrl)}" width="64" height="64" alt="">`
    : `<div class="logo-fallback" aria-hidden="true">${escapeHtml(brand.productName.slice(0, 1).toUpperCase())}</div>`;
  const turnstile = options.turnstileSiteKey
    ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(options.turnstileSiteKey)}" data-appearance="interaction-only" data-callback="q32MagicLinkReady"></div>`
    : "";
  const behavior = options.turnstileSiteKey
    ? `window.q32MagicLinkReady=function(){document.getElementById("magic-link-confirmation").requestSubmit();};`
    : `window.addEventListener("DOMContentLoaded",function(){document.getElementById("magic-link-confirmation").requestSubmit();},{once:true});`;
  const turnstileScript = options.turnstileSiteKey
    ? `<script nonce="${nonce}" src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${title}</title>
  <style nonce="${nonce}">
    :root{color-scheme:light;--accent:${cssColor(brand.accentColor,"#6d4aff")};--background:${cssColor(brand.backgroundColor,"#f5f3ff")};--card:${cssColor(brand.cardColor,"#ffffff")};--text:${cssColor(brand.textColor,"#171421")};--muted:${cssColor(brand.mutedColor,"#625d70")}}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--background);color:var(--text);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(100%,440px);padding:40px 32px;border:1px solid color-mix(in srgb,var(--text) 12%,transparent);border-radius:24px;background:var(--card);box-shadow:0 24px 70px color-mix(in srgb,var(--text) 10%,transparent);text-align:center}.logo,.logo-fallback{display:grid;place-items:center;margin:0 auto 22px;border-radius:18px}.logo{object-fit:contain}.logo-fallback{width:64px;height:64px;background:var(--accent);color:white;font-size:30px;font-weight:800}.eyebrow{margin:0 0 10px;color:var(--accent);font-size:12px;font-weight:800;letter-spacing:.14em}.title{margin:0;font-size:clamp(28px,7vw,38px);line-height:1.08}.message{margin:16px auto 26px;max-width:32ch;color:var(--muted);font-size:16px;line-height:1.6}.spinner{width:30px;height:30px;margin:0 auto 24px;border:3px solid color-mix(in srgb,var(--accent) 20%,transparent);border-top-color:var(--accent);border-radius:999px;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}button{width:100%;min-height:48px;border:0;border-radius:12px;background:var(--accent);color:white;font:inherit;font-weight:750;cursor:pointer}.cf-turnstile{display:flex;justify-content:center;margin-bottom:18px}
  </style>
</head>
<body>
  <main class="card">
    ${logo}
    <p class="eyebrow">${eyebrow}</p>
    <h1 class="title">${title}</h1>
    <p class="message">${message}</p>
    <div class="spinner" aria-hidden="true"></div>
    <form id="magic-link-confirmation" method="post" action="${actionPath}">
      ${turnstile}
      <button type="submit">${buttonLabel}</button>
    </form>
    <noscript><p class="message">Select the button to finish signing in.</p></noscript>
  </main>
  <script nonce="${nonce}">${behavior}</script>
  ${turnstileScript}
</body>
</html>`;
}

async function handleMagicLinkConfirmation(
  request: Request,
  token: string | null | undefined,
  options: MagicLinkConfirmationOptions,
  maxAgeSeconds: number,
): Promise<Response> {
  if (request.method === "GET") {
    if (!token) return failureResponse("missing_token", request, options);
    const url = new URL(request.url);
    const cookiePath = options.cookiePath ?? url.pathname;
    const nonce = randomNonce();
    const body = renderMagicLinkConfirmationPage(options.brand, {
      actionPath: cookiePath,
      ...(options.turnstile?.siteKey ? { turnstileSiteKey: options.turnstile.siteKey } : {}),
      nonce,
    });
    return new Response(body, {
      status: 200,
      headers: confirmationHeaders(
        nonce,
        options.turnstile !== undefined,
        stagedTokenCookie(options.cookieName, token, cookiePath, maxAgeSeconds, url.protocol === "https:"),
      ),
    });
  }

  if (request.method !== "POST") return failureResponse("method_not_allowed", request, options);
  if ((options.requireSameOrigin ?? true) && !sameOriginPost(request)) {
    return failureResponse("origin_mismatch", request, options);
  }

  const cookiePath = options.cookiePath ?? new URL(request.url).pathname;
  const stagedToken = readCookie(request.headers.get("cookie"), options.cookieName);
  if (!stagedToken) return failureResponse("missing_staged_token", request, options);

  if (options.turnstile) {
    const form = await request.clone().formData().catch(() => null);
    const responseToken = String(form?.get("cf-turnstile-response") ?? "");
    const verification = await verifyMagicLinkTurnstile(request, responseToken, options.turnstile);
    if (!verification.success) return failureResponse("turnstile_failed", request, options);
  }

  const response = await options.consume(stagedToken, request);
  return appendCookie(response, clearStagedTokenCookie(options.cookieName, cookiePath, new URL(request.url).protocol === "https:"));
}

function confirmationHeaders(nonce: string, turnstile: boolean, cookie: string): Headers {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "text/html; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-robots-tag": "noindex, nofollow",
    "set-cookie": cookie,
  });
  const turnstileSources = turnstile ? " https://challenges.cloudflare.com" : "";
  headers.set(
    "content-security-policy",
    `default-src 'none'; img-src 'self' https: data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'${turnstileSources}; frame-src${turnstileSources || " 'none'"}; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
  );
  return headers;
}

function sameOriginPost(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin";
}

function stagedTokenCookie(name: string, token: string, path: string, maxAgeSeconds: number, secure: boolean): string {
  return `${name}=${encodeURIComponent(token)}; Path=${cookiePath(path)}; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}

function clearStagedTokenCookie(name: string, path: string, secure: boolean): string {
  return `${name}=; Path=${cookiePath(path)}; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(value.join("="));
    } catch {
      return null;
    }
  }
  return null;
}

function appendCookie(response: Response, cookie: string): Response {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function failureResponse(
  reason: MagicLinkConfirmationFailure,
  request: Request,
  options: MagicLinkConfirmationOptions,
): Promise<Response> {
  if (options.invalidResponse) return options.invalidResponse(reason, request);
  const status = reason === "method_not_allowed" ? 405 : reason === "origin_mismatch" ? 403 : 400;
  const message = reason === "turnstile_failed" ? "Browser verification failed. Open the email link again." : "This sign-in link is unavailable. Request a new email.";
  return new Response(message, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "referrer-policy": "no-referrer",
      ...(reason === "method_not_allowed" ? { allow: "GET, POST" } : {}),
    },
  });
}

function randomNonce(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function validateCookieName(name: string): void {
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name)) throw new Error("Invalid magic-link confirmation cookie name.");
}

function cookiePath(path: string): string {
  if (!path.startsWith("/") || /[;\r\n]/u.test(path)) throw new Error("Invalid magic-link confirmation cookie path.");
  return path;
}

function cssColor(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  return /^(#[0-9a-f]{3,8}|[a-z]{3,20}|(?:rgb|hsl)a?\([0-9.,%\s/-]+\))$/iu.test(value) ? value : fallback;
}
