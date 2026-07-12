export type ConversionProvider = "google_ads" | "meta" | "microsoft_ads";
export type ConversionDeliveryStatus = "pending" | "sending" | "sent" | "retry" | "dead" | "skipped";

export type AdClickIds = {
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  fbclid?: string | null;
  msclkid?: string | null;
};

export type PurchaseConversionEvent = {
  eventId: string;
  orderId: string;
  productSlug: string;
  conversionAt: string;
  value: number;
  currency: string;
  clickIds: AdClickIds;
  emailSha256?: string | null;
  sourceUrl?: string | null;
  metadata?: Record<string, unknown>;
};

export type ConversionDelivery = {
  deliveryKey: string;
  eventId: string;
  provider: ConversionProvider;
  status: ConversionDeliveryStatus;
  attemptCount: number;
  nextAttemptAt: string | null;
  sentAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
};

export function createPurchaseConversionEvent(input: PurchaseConversionEvent): PurchaseConversionEvent {
  if (!input.eventId.trim()) throw new Error("Purchase conversion eventId is required");
  if (!input.orderId.trim()) throw new Error("Purchase conversion orderId is required");
  if (!input.productSlug.trim()) throw new Error("Purchase conversion productSlug is required");
  if (!Number.isFinite(input.value) || input.value < 0) throw new Error("Purchase conversion value must be non-negative");
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new Error("Purchase conversion currency must be a three-letter uppercase code");
  if (!Number.isFinite(Date.parse(input.conversionAt))) throw new Error("Purchase conversion conversionAt must be an ISO date-time");
  return {
    ...input,
    eventId: input.eventId.trim(),
    orderId: input.orderId.trim(),
    productSlug: input.productSlug.trim(),
    clickIds: compactClickIds(input.clickIds),
  };
}

export function conversionDeliveryKey(eventId: string, provider: ConversionProvider): string {
  if (!eventId.trim()) throw new Error("Conversion delivery eventId is required");
  return `${eventId.trim()}:${provider}`;
}

export function createConversionDelivery(eventId: string, provider: ConversionProvider): ConversionDelivery {
  return {
    deliveryKey: conversionDeliveryKey(eventId, provider),
    eventId: eventId.trim(),
    provider,
    status: "pending",
    attemptCount: 0,
    nextAttemptAt: null,
    sentAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
  };
}

export function nextConversionRetryAt(
  attemptCount: number,
  options: { now?: number; baseDelayMs?: number; maxDelayMs?: number } = {},
): string {
  if (!Number.isInteger(attemptCount) || attemptCount < 1) throw new Error("Conversion attemptCount must be a positive integer");
  const baseDelayMs = options.baseDelayMs ?? 30_000;
  const maxDelayMs = options.maxDelayMs ?? 24 * 60 * 60 * 1000;
  const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.min(attemptCount - 1, 20));
  return new Date((options.now ?? Date.now()) + delay).toISOString();
}

function compactClickIds(input: AdClickIds): AdClickIds {
  return Object.fromEntries(
    Object.entries(input).flatMap(([key, value]) => {
      const normalized = value?.trim();
      return normalized ? [[key, normalized]] : [];
    }),
  );
}
