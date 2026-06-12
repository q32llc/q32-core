# SES And SNS Helper Survey

Survey date: 2026-06-12.

This survey covers the current hand-rolled SES/SNS shapes across the maintained
Worker sites that were explicitly named or surfaced by source search:

- `/home/erik/ipogrid`
- `/home/erik/relin`
- `/home/erik/domains/bce.email`
- `/home/erik/domains/theinvestornet.com`
- `/home/erik/dirtsignal`
- `/home/erik/getflight`
- `/home/erik/onwardtravel`
- `/home/erik/adgiro`

`onwardtravel` and `adgiro` did not currently expose SES source usage in the
searched app code, despite likely operational SES use or future need.

## Current Shapes

### Simple Outbound SES

`ipogrid`, `relin`, and `getflight` each have a small SESv2 simple-email sender:

- build a client from `AWS_ACCESS_KEY` / `AWS_SECRET_KEY` / `AWS_REGION`
- require a configured from address
- accept `to`, `subject`, `text`, `html`, and optional reply-to
- call `SendEmailCommand` using `Content.Simple`
- either throw on SES failure or return `{ sent: false, reason }`

`ipogrid` and `relin` also wrap this in `NotificationMailer` classes with
`enabled`, `NoopNotificationMailer`, and `SesNotificationMailer`.

### Rich Outbound SES

`dirtsignal` has the most complete outbound helper:

- supports simple SESv2 send when no special envelope behavior is needed
- switches to raw MIME for attachments or custom RFC 5322 headers
- supports one-click unsubscribe headers
- base64 encodes UTF-8 body parts and attachments
- sanitizes custom header values by removing CR/LF
- returns `{ sent, reason, message_id }` instead of throwing

This is the best starting point for the outbound helper because it covers the
behavior the simpler sites can use and the richer newsletter use case that SES
Simple mode cannot handle.

### Worker-Native AWS Fetch

`bce.email` and `theinvestornet.com` avoid the AWS SDK for some Worker paths:

- `bce.email` signs SES Query API and SESv2 HTTP calls directly through a local
  SigV4 `awsFetch`.
- `theinvestornet.com` uses `aws4fetch` to send SESv2 email and fetch inbound
  S3 objects.

This points toward a `q32-core` helper that uses `fetch` plus SigV4 rather than
depending on `@aws-sdk/client-sesv2`, or offers the SDK client only as an
adapter. Keeping the core helper Worker-native avoids pulling the AWS SDK into
small Workers.

### SNS Feedback Webhooks

`ipogrid` and `dirtsignal` duplicate the same SES feedback flow:

- authenticate a URL token
- parse an SNS envelope
- confirm `SubscriptionConfirmation` by fetching a trusted `SubscribeURL`
- ignore unsupported SNS types
- parse `Notification.Message`
- normalize `eventType` or `notificationType`
- extract bounce or complaint recipient emails
- call app-specific suppression/unsubscribe logic

`dirtsignal` is stricter and more reusable here because it validates the SNS
hostname before confirming subscriptions and falls back to `mail.destination`
when bounce/complaint recipient arrays are missing.

### Inbound SES Receipt/SNS

`bce.email` and `theinvestornet.com` handle inbound SES receipt notifications:

- confirm SNS subscription
- parse receipt notifications from `Message`
- read `mail.messageId`, `mail.source`, common headers, and `receipt.recipients`
- fetch raw email from S3 or forward based on the message id
- route recipients through app-specific domain/workspace rules

The shared helper should parse and validate the envelope, but should not own
route resolution, raw email parsing, forwarding, R2 storage, D1 writes, or app
workflow creation.

### SES Domain And Receipt Rule Management

`bce.email` has the only substantial SES management surface:

- `VerifyDomainIdentity`
- `GetIdentityVerificationAttributes`
- `GetIdentityDkimAttributes`
- `DeleteIdentity`
- `DescribeActiveReceiptRuleSet`
- `UpdateReceiptRule` with S3 action and optional SNS action
- DNS record generation for SES TXT, DKIM CNAMEs, and inbound MX

This deserves a separate helper area from outbound mail. It is useful, but it is
not the first extraction target because it is more product-specific and bound to
customer-domain provisioning workflows.

## Recommended `q32-core` Shape

Add three layers, keeping app policy outside the package.

### `@q32/core/email`

Extend the existing generic email types:

- normalize and format addresses
- build MIME-safe headers
- build simple text/html messages
- build raw MIME messages with:
  - multipart alternative text/html
  - attachments
  - custom headers
  - CR/LF header-value sanitization
  - UTF-8/base64 transfer encoding
- generate `List-Unsubscribe` and `List-Unsubscribe-Post` header pairs from a
  caller-provided URL

### `@q32/core/aws`

Add Worker-native AWS/SigV4 helpers:

- `awsFetch(config, url, init, { service, region })`
- `createAwsConfigFromEnv(env, aliases?)`
- support both env naming families:
  - `AWS_ACCESS_KEY` / `AWS_SECRET_KEY`
  - `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`
- default region to `us-east-1`

This keeps SES and S3 helpers small without importing the AWS SDK.

### `@q32/core/ses`

Add SES-specific helpers on top of `awsFetch`:

- `sendSesEmail(config, input)` using SESv2 HTTP API
- `sendSesRawEmail(config, input)` using SESv2 raw content
- `createSesMailerFromEnv(env, options)` returning a small provider with
  `enabled` and `send`
- `sesQuery(config, params)` for legacy SES Query API calls
- `inboundSesMxHost(region)`
- `sesDomainDnsRecords(identityAttributes, region)` for verification, DKIM, and
  inbound MX record description
- receipt-rule update helpers only after `bce.email` is ready to migrate

The first extraction should include outbound send plus raw MIME. Domain
provisioning can come after that so the API is not shaped by one app too early.

### `@q32/core/ses-sns`

Add SNS envelope and SES notification parsing:

- `parseSnsEnvelope(body)`
- `isTrustedSnsSubscribeUrl(url)`
- `confirmSnsSubscription(envelope, fetcher?)`
- `parseSesFeedbackNotification(envelope)`
- `extractSesFeedbackRecipients(message)`
- `handleSesFeedbackWebhook(input)` that returns structured action data but
  accepts an app callback for suppression/unsubscribe side effects
- `parseSesReceiptNotification(envelope)` for inbound receipt flows

The helper should return data like:

```ts
type SesFeedbackEvent = {
  eventType: "Bounce" | "Complaint" | string;
  emails: string[];
  messageId?: string;
  topicArn?: string;
};

type SesReceiptEvent = {
  messageId: string;
  source?: string;
  subject?: string;
  recipients: string[];
};
```

Apps still decide whether a bounce disables newsletters, login emails,
workspace senders, or all notification surfaces.

## Migration Order

1. Extract pure utilities first: address normalization, raw MIME builder,
   trusted SNS URL check, SNS envelope parsing, and SES feedback recipient
   extraction.
2. Migrate `dirtsignal` and `ipogrid` SNS feedback handlers to shared parsing
   while keeping their app-specific unsubscribe callbacks local.
3. Migrate `getflight`, `relin`, and `ipogrid` simple outbound senders to a
   shared SES mailer.
4. Migrate `dirtsignal` outbound mail once raw MIME behavior is covered by
   focused tests for custom headers and attachments.
5. Consider `theinvestornet.com` AWS client extraction for shared SES/S3 fetch.
6. Only then extract `bce.email` domain identity and receipt-rule management.

## Test Coverage To Carry Into Core

Core should have focused tests for:

- simple text/html SESv2 request shape
- raw MIME text/html alternative body
- raw MIME attachments
- raw MIME custom headers with CR/LF stripped
- UTF-8 subject encoding
- trusted and untrusted SNS subscription URLs
- SNS `SubscriptionConfirmation`
- SNS unsupported type handling
- SES feedback `Bounce` and `Complaint` extraction
- fallback extraction from `mail.destination`
- SES receipt notification extraction with missing-message-data rejection

## What Should Stay App-Local

- D1 repository updates
- unsubscribe and suppression policy
- notification preference semantics
- workspace sender selection
- per-product audit/ops event recording
- R2/S3 object retention policy
- raw inbound email parsing and attachment handling
- customer-domain provisioning job orchestration
- Domain Connect and DNS-provider UX
