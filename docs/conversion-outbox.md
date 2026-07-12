# Purchase conversion outbox

Commit the product purchase and its conversion event before calling an ad provider. Create one delivery per configured provider, acknowledge the verified payment webhook, and retry deliveries independently.

```ts
import { createConversionDelivery, createPurchaseConversionEvent } from "@q32/core/conversion-outbox";
import { GoogleAdsConversionClient } from "@q32/core/google-ads";

const purchase = createPurchaseConversionEvent({
  eventId: `purchase:${order.id}`,
  orderId: order.id,
  productSlug: "example",
  conversionAt: order.paidAt,
  value: order.valueCents / 100,
  currency: order.currency.toUpperCase(),
  clickIds: { gclid: attribution.gclid, gbraid: attribution.gbraid, wbraid: attribution.wbraid },
});
const googleDelivery = createConversionDelivery(purchase.eventId, "google_ads");
```

Persist both records atomically with the purchase. The package intentionally does not prescribe D1 or Postgres table names.

Upload with a client shared by the Worker isolate:

```ts
const google = new GoogleAdsConversionClient({
  developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN,
  clientId: env.GOOGLE_ADS_CLIENT_ID,
  clientSecret: env.GOOGLE_ADS_CLIENT_SECRET,
  refreshToken: env.GOOGLE_ADS_REFRESH_TOKEN,
  customerId: env.GOOGLE_ADS_CUSTOMER_ID,
  loginCustomerId: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
  conversionActionId: env.GOOGLE_ADS_PURCHASE_CONVERSION_ACTION_ID,
});
```

`uploadPurchase` returns `skipped` when no Google click identifier is available. It throws `GoogleAdsConversionError` for provider failures; `retryable` distinguishes transient failures from permanent rejection. Store bounded error details and schedule retry with `nextConversionRetryAt`.

Google requires an `UPLOAD_CLICKS` conversion action, `partialFailure: true`, and a unique order ID per conversion action. Keep browser purchase events when useful for diagnostics, but do not make the durable upload depend on a success-page visit.
