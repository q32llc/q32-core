import type { FetchLike } from "./http.js";
import { defaultFetch } from "./http.js";
import type { PurchaseConversionEvent } from "./conversion-outbox.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_ADS_ORIGIN = "https://googleads.googleapis.com";

export type GoogleAdsConversionConfig = {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  customerId: string;
  conversionActionId: string;
  loginCustomerId?: string;
  apiVersion?: string;
};

export type GoogleAdsUploadResult =
  | { status: "sent"; jobId: string | null; requestId: string | null }
  | { status: "skipped"; reason: "missing_google_click_id" };

export class GoogleAdsConversionError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "GoogleAdsConversionError";
  }
}

export class GoogleAdsConversionClient {
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: GoogleAdsConversionConfig,
    private readonly fetchImpl: FetchLike = defaultFetch,
  ) {}

  async uploadPurchase(event: PurchaseConversionEvent): Promise<GoogleAdsUploadResult> {
    const clickId = googleClickId(event);
    if (!clickId) return { status: "skipped", reason: "missing_google_click_id" };
    const accessToken = await this.getAccessToken();
    const customerId = digitsOnly(this.config.customerId, "customerId");
    const actionId = digitsOnly(this.config.conversionActionId, "conversionActionId");
    const apiVersion = this.config.apiVersion ?? "v24";
    const conversion = {
      conversionAction: `customers/${customerId}/conversionActions/${actionId}`,
      conversionDateTime: googleAdsDateTime(event.conversionAt),
      conversionValue: event.value,
      currencyCode: event.currency,
      orderId: event.orderId,
      conversionEnvironment: "WEB",
      [clickId.kind]: clickId.value,
    };
    const headers: Record<string, string> = {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "developer-token": this.config.developerToken,
    };
    if (this.config.loginCustomerId) {
      headers["login-customer-id"] = digitsOnly(this.config.loginCustomerId, "loginCustomerId");
    }
    const response = await this.fetchImpl(
      `${GOOGLE_ADS_ORIGIN}/${apiVersion}/customers/${customerId}:uploadClickConversions`,
      { method: "POST", headers, body: JSON.stringify({ conversions: [conversion], partialFailure: true }) },
    );
    const payload = await readJson(response);
    if (!response.ok) throw googleAdsHttpError(response.status, payload);
    const partialFailure = recordValue(payload, "partialFailureError");
    if (partialFailure) throw googleAdsPartialFailure(partialFailure);
    return {
      status: "sent",
      jobId: stringValue(payload, "jobId"),
      requestId: response.headers.get("request-id"),
    };
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) return this.accessToken.value;
    const response = await this.fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const payload = await readJson(response);
    const token = stringValue(payload, "access_token");
    if (!response.ok || !token) {
      const code = stringValue(payload, "error") ?? "oauth_refresh_failed";
      throw new GoogleAdsConversionError(`Google OAuth refresh failed: ${code}`, code, response.status >= 500, response.status);
    }
    const expiresIn = numberValue(payload, "expires_in") ?? 3600;
    this.accessToken = { value: token, expiresAt: Date.now() + expiresIn * 1000 };
    return token;
  }
}

function googleClickId(event: PurchaseConversionEvent): { kind: "gclid" | "wbraid" | "gbraid"; value: string } | null {
  const candidates = [
    ["gclid", event.clickIds.gclid],
    ["wbraid", event.clickIds.wbraid],
    ["gbraid", event.clickIds.gbraid],
  ] as const;
  for (const [kind, value] of candidates) if (value?.trim()) return { kind, value: value.trim() };
  return null;
}

export function googleAdsDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Google Ads conversion time must be a valid date-time");
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "+00:00");
}

function digitsOnly(value: string, field: string): string {
  const normalized = value.replaceAll("-", "").trim();
  if (!/^\d+$/.test(normalized)) throw new Error(`Google Ads ${field} must contain only digits`);
  return normalized;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

function googleAdsHttpError(status: number, payload: Record<string, unknown>): GoogleAdsConversionError {
  const error = recordValue(payload, "error");
  const code = stringValue(error ?? payload, "status") ?? `http_${status}`;
  const message = stringValue(error ?? payload, "message") ?? `Google Ads upload failed with HTTP ${status}`;
  return new GoogleAdsConversionError(message, code, status === 429 || status >= 500, status);
}

function googleAdsPartialFailure(error: Record<string, unknown>): GoogleAdsConversionError {
  const code = firstGoogleAdsErrorCode(error) ?? "partial_failure";
  const message = stringValue(error, "message") ?? "Google Ads rejected the conversion";
  const retryable = ["INTERNAL", "RESOURCE_EXHAUSTED", "UNAVAILABLE", "TOO_RECENT_CONVERSION_ACTION"].includes(code);
  return new GoogleAdsConversionError(message, code, retryable, 200);
}

function firstGoogleAdsErrorCode(error: Record<string, unknown>): string | null {
  const details = error.details;
  if (!Array.isArray(details)) return null;
  for (const detail of details) {
    if (!detail || typeof detail !== "object") continue;
    const errors = (detail as Record<string, unknown>).errors;
    if (!Array.isArray(errors)) continue;
    for (const item of errors) {
      if (!item || typeof item !== "object") continue;
      const errorCode = recordValue(item as Record<string, unknown>, "errorCode");
      if (!errorCode) continue;
      for (const value of Object.values(errorCode)) if (typeof value === "string") return value;
    }
  }
  return null;
}

function recordValue(input: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = input[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : null;
}

function numberValue(input: Record<string, unknown>, key: string): number | null {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
