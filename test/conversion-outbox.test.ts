import { describe, expect, it } from "vitest";
import {
  conversionDeliveryKey,
  createConversionDelivery,
  createPurchaseConversionEvent,
  nextConversionRetryAt,
} from "../src/conversion-outbox.js";

describe("purchase conversion outbox", () => {
  it("normalizes a durable purchase event and creates provider deliveries", () => {
    const event = createPurchaseConversionEvent({
      eventId: " purchase:order_1 ",
      orderId: " order_1 ",
      productSlug: " example ",
      conversionAt: "2026-07-12T12:34:56.000Z",
      value: 19,
      currency: "USD",
      clickIds: { gclid: " click ", wbraid: "", fbclid: null },
    });

    expect(event).toMatchObject({
      eventId: "purchase:order_1",
      orderId: "order_1",
      productSlug: "example",
      clickIds: { gclid: "click" },
    });
    expect(createConversionDelivery(event.eventId, "google_ads")).toEqual({
      deliveryKey: "purchase:order_1:google_ads",
      eventId: "purchase:order_1",
      provider: "google_ads",
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: null,
      sentAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    });
    expect(conversionDeliveryKey(event.eventId, "meta")).toBe("purchase:order_1:meta");
  });

  it("validates events and calculates bounded exponential retries", () => {
    const base = {
      eventId: "event",
      orderId: "order",
      productSlug: "product",
      conversionAt: "2026-07-12T00:00:00Z",
      value: 10,
      currency: "USD",
      clickIds: {},
    };
    expect(() => createPurchaseConversionEvent({ ...base, value: -1 })).toThrow("non-negative");
    expect(() => createPurchaseConversionEvent({ ...base, currency: "usd" })).toThrow("uppercase");
    expect(() => createPurchaseConversionEvent({ ...base, conversionAt: "nope" })).toThrow("ISO date-time");
    expect(nextConversionRetryAt(1, { now: 0 })).toBe("1970-01-01T00:00:30.000Z");
    expect(nextConversionRetryAt(4, { now: 0 })).toBe("1970-01-01T00:04:00.000Z");
    expect(nextConversionRetryAt(30, { now: 0 })).toBe("1970-01-02T00:00:00.000Z");
    expect(() => nextConversionRetryAt(0)).toThrow("positive integer");
  });
});
