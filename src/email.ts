export type EmailAddress = {
  email: string;
  name?: string;
};

export type EmailAttachment = {
  filename: string;
  contentType: string;
  data: Uint8Array | string;
};

export type SendEmailInput = {
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  replyTo?: EmailAddress[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: EmailAttachment[];
  tags?: Record<string, string>;
};

export type SendEmailResult = {
  id: string;
  provider?: string;
  metadata?: Record<string, unknown>;
};

export interface EmailProvider {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

export function formatEmailAddress(address: EmailAddress): string {
  if (!address.name) return address.email;
  const escaped = address.name.replace(/"/g, '\\"');
  return `"${escaped}" <${address.email}>`;
}

export function normalizeEmailAddress(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) throw new Error(`Invalid email address: ${email}`);
  return normalized;
}

export function appendUnsubscribeFooter(text: string, unsubscribeUrl: string): string {
  return `${text.trim()}\n\nUnsubscribe: ${unsubscribeUrl}\n`;
}
