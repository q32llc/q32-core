export type SnsEnvelope = {
  Type?: string;
  Message?: string;
  MessageId?: string;
  TopicArn?: string;
  SubscribeURL?: string;
};

export type SesFeedbackMessage = {
  eventType?: string;
  notificationType?: string;
  mail?: {
    destination?: unknown;
  };
  bounce?: {
    bouncedRecipients?: Array<{ emailAddress?: unknown }>;
  };
  complaint?: {
    complainedRecipients?: Array<{ emailAddress?: unknown }>;
  };
};

export type SesFeedbackEvent = {
  eventType: string;
  emails: string[];
  messageId?: string;
  topicArn?: string;
};

export type SesReceiptMessage = {
  mail?: {
    messageId?: string;
    source?: string;
    commonHeaders?: {
      subject?: string;
    };
  };
  receipt?: {
    recipients?: string[];
  };
};

export type SesReceiptEvent = {
  messageId: string;
  source?: string;
  subject?: string;
  recipients: string[];
  snsMessageId?: string;
  topicArn?: string;
};

export function parseSnsEnvelope(body: string): SnsEnvelope | null {
  const parsed = parseJsonObject(body);
  if (!parsed) return null;
  return parsed as SnsEnvelope;
}

export function isTrustedSnsSubscribeUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    (/^sns[.-][a-z0-9-]+\.amazonaws\.com$/i.test(url.hostname) ||
      /^sns\.[a-z0-9-]+\.amazonaws\.com\.cn$/i.test(url.hostname))
  );
}

export async function confirmSnsSubscription(envelope: SnsEnvelope, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (envelope.Type !== "SubscriptionConfirmation" || typeof envelope.SubscribeURL !== "string") return false;
  if (!isTrustedSnsSubscribeUrl(envelope.SubscribeURL)) return false;
  const response = await fetcher(envelope.SubscribeURL, { method: "GET" });
  return response.ok;
}

export function parseSesFeedbackNotification(envelope: SnsEnvelope): SesFeedbackEvent | null {
  if (envelope.Type !== "Notification" || typeof envelope.Message !== "string") return null;
  const message = parseJsonObject(envelope.Message) as SesFeedbackMessage | null;
  if (!message) return null;
  const { eventType, emails } = extractSesFeedbackRecipients(message);
  if (!eventType) return null;
  return {
    eventType,
    emails,
    ...(envelope.MessageId ? { messageId: envelope.MessageId } : {}),
    ...(envelope.TopicArn ? { topicArn: envelope.TopicArn } : {}),
  };
}

export function extractSesFeedbackRecipients(message: SesFeedbackMessage): { eventType: string; emails: string[] } {
  const eventType = String(message.eventType ?? message.notificationType ?? "");
  const normalized = eventType.toLowerCase();
  if (normalized === "bounce") {
    const recipients = message.bounce?.bouncedRecipients?.map((recipient) => recipient.emailAddress) ?? [];
    return { eventType, emails: uniqueEmails(recipients.length > 0 ? recipients : fallbackDestination(message)) };
  }
  if (normalized === "complaint") {
    const recipients = message.complaint?.complainedRecipients?.map((recipient) => recipient.emailAddress) ?? [];
    return { eventType, emails: uniqueEmails(recipients.length > 0 ? recipients : fallbackDestination(message)) };
  }
  return { eventType, emails: [] };
}

export function parseSesReceiptNotification(envelope: SnsEnvelope): SesReceiptEvent | null {
  if (envelope.Type !== "Notification" || typeof envelope.Message !== "string") return null;
  const message = parseJsonObject(envelope.Message) as SesReceiptMessage | null;
  const messageId = message?.mail?.messageId;
  const recipients = message?.receipt?.recipients ?? [];
  if (!messageId || recipients.length === 0) return null;
  return {
    messageId,
    recipients,
    ...(message.mail?.source ? { source: message.mail.source } : {}),
    ...(message.mail?.commonHeaders?.subject ? { subject: message.mail.commonHeaders.subject } : {}),
    ...(envelope.MessageId ? { snsMessageId: envelope.MessageId } : {}),
    ...(envelope.TopicArn ? { topicArn: envelope.TopicArn } : {}),
  };
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function fallbackDestination(message: SesFeedbackMessage): unknown[] {
  return Array.isArray(message.mail?.destination) ? message.mail.destination : [];
}

function uniqueEmails(values: Iterable<unknown>): string[] {
  const emails = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const email = value.trim().toLowerCase();
    if (email.includes("@")) emails.add(email);
  }
  return [...emails];
}
