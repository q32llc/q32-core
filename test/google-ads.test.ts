import { describe, expect, it, vi } from "vitest";
import { GoogleAdsConversionClient, GoogleAdsConversionError, googleAdsDateTime } from "../src/google-ads.js";
import type { PurchaseConversionEvent } from "../src/conversion-outbox.js";

const event: PurchaseConversionEvent = {
  eventId: "purchase:order_1",
  orderId: "order_1",
  productSlug: "example",
  conversionAt: "2026-07-12T12:34:56.789Z",
  value: 19,
  currency: "USD",
  clickIds: { gclid: "gclid_1", wbraid: "wbraid_1" },
};

const config = {
  developerToken: "developer",
  clientId: "client",
  clientSecret: "secret",
  refreshToken: "refresh",
  customerId: "123-456-7890",
  loginCustomerId: "999-888-7777",
  conversionActionId: "42",
};

describe("Google Ads purchase conversions", () => {
  it("refreshes OAuth and uploads an attributed purchase", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("oauth2")) {
        expect(String(init?.body)).toContain("grant_type=refresh_token");
        return Response.json({ access_token: "access", expires_in: 3600 });
      }
      expect(String(input)).toBe("https://googleads.googleapis.com/v24/customers/1234567890:uploadClickConversions");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer access",
        "developer-token": "developer",
        "login-customer-id": "9998887777",
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        conversions: [{
          conversionAction: "customers/1234567890/conversionActions/42",
          conversionDateTime: "2026-07-12 12:34:56+00:00",
          conversionValue: 19,
          currencyCode: "USD",
          orderId: "order_1",
          conversionEnvironment: "WEB",
          gclid: "gclid_1",
        }],
        partialFailure: true,
      });
      return Response.json({ jobId: "123", results: [{}] }, { headers: { "request-id": "request_1" } });
    });
    const client = new GoogleAdsConversionClient(config, fetcher);

    await expect(client.uploadPurchase(event)).resolves.toEqual({ status: "sent", jobId: "123", requestId: "request_1" });
    await client.uploadPurchase(event);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("skips unattributed purchases and chooses one click identifier", async () => {
    const fetcher = vi.fn();
    const client = new GoogleAdsConversionClient(config, fetcher);
    await expect(client.uploadPurchase({ ...event, clickIds: {} })).resolves.toEqual({
      status: "skipped",
      reason: "missing_google_click_id",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("classifies HTTP and partial failures for retry", async () => {
    const responses = [
      Response.json({ access_token: "access" }),
      Response.json({ error: { status: "RESOURCE_EXHAUSTED", message: "quota" } }, { status: 429 }),
    ];
    const client = new GoogleAdsConversionClient(config, async () => responses.shift() as Response);
    const error = await client.uploadPurchase(event).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GoogleAdsConversionError);
    expect(error).toMatchObject({ code: "RESOURCE_EXHAUSTED", retryable: true, status: 429 });

    const partialClient = new GoogleAdsConversionClient(config, async (input) =>
      String(input).includes("oauth2")
        ? Response.json({ access_token: "access" })
        : Response.json({
            partialFailureError: {
              message: "action too new",
              details: [{ errors: [{ errorCode: { conversionUploadError: "TOO_RECENT_CONVERSION_ACTION" } }] }],
            },
          }),
    );
    await expect(partialClient.uploadPurchase(event)).rejects.toMatchObject({
      code: "TOO_RECENT_CONVERSION_ACTION",
      retryable: true,
      status: 200,
    });
  });

  it("formats Google date-times and validates resource IDs", async () => {
    expect(googleAdsDateTime("2026-07-12T12:34:56.789Z")).toBe("2026-07-12 12:34:56+00:00");
    expect(() => googleAdsDateTime("invalid")).toThrow("valid date-time");
    const client = new GoogleAdsConversionClient({ ...config, customerId: "bad" }, async () => Response.json({ access_token: "access" }));
    await expect(client.uploadPurchase(event)).rejects.toThrow("customerId");
  });
});
