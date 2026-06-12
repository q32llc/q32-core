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

export function sanitizeEmailHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function encodeMimeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return sanitizeEmailHeaderValue(value);
  return `=?UTF-8?B?${base64Utf8(value)}?=`;
}

export function buildListUnsubscribeHeaders(url: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${sanitizeEmailHeaderValue(url)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export type RawMimeMessageInput = Omit<SendEmailInput, "tags"> & {
  headers?: Record<string, string>;
  boundaryPrefix?: string;
};

export function buildRawMimeMessage(input: RawMimeMessageInput): string {
  const mixedBoundary = `${input.boundaryPrefix ?? "q32"}-mixed-${crypto.randomUUID()}`;
  const bodyBoundary = `${input.boundaryPrefix ?? "q32"}-body-${crypto.randomUUID()}`;
  const attachments = input.attachments ?? [];
  const headers = [
    `From: ${formatEmailAddress(input.from)}`,
    `To: ${input.to.map(formatEmailAddress).join(", ")}`,
    ...(input.cc?.length ? [`Cc: ${input.cc.map(formatEmailAddress).join(", ")}`] : []),
    `Subject: ${encodeMimeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    ...(input.replyTo?.length ? [`Reply-To: ${input.replyTo.map(formatEmailAddress).join(", ")}`] : []),
  ];

  for (const [name, value] of Object.entries(input.headers ?? {})) {
    const headerName = sanitizeHeaderName(name);
    const headerValue = sanitizeEmailHeaderValue(value);
    if (headerName && headerValue) headers.push(`${headerName}: ${headerValue}`);
  }

  const parts = [...headers, `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`, ""];
  parts.push(`--${mixedBoundary}`);

  if (input.text && input.html) {
    parts.push(`Content-Type: multipart/alternative; boundary="${bodyBoundary}"`, "");
    parts.push(`--${bodyBoundary}`);
    parts.push("Content-Type: text/plain; charset=UTF-8");
    parts.push("Content-Transfer-Encoding: base64", "", wrapBase64(base64Utf8(input.text)), "");
    parts.push(`--${bodyBoundary}`);
    parts.push("Content-Type: text/html; charset=UTF-8");
    parts.push("Content-Transfer-Encoding: base64", "", wrapBase64(base64Utf8(input.html)), "");
    parts.push(`--${bodyBoundary}--`, "");
  } else if (input.html) {
    parts.push("Content-Type: text/html; charset=UTF-8");
    parts.push("Content-Transfer-Encoding: base64", "", wrapBase64(base64Utf8(input.html)), "");
  } else {
    parts.push("Content-Type: text/plain; charset=UTF-8");
    parts.push("Content-Transfer-Encoding: base64", "", wrapBase64(base64Utf8(input.text ?? "")), "");
  }

  for (const attachment of attachments) {
    parts.push(`--${mixedBoundary}`);
    parts.push(`Content-Type: ${sanitizeEmailHeaderValue(attachment.contentType)}; name=${quoteHeaderParam(attachment.filename)}`);
    parts.push("Content-Transfer-Encoding: base64");
    parts.push(`Content-Disposition: attachment; filename=${quoteHeaderParam(attachment.filename)}`);
    parts.push("", wrapBase64(attachmentDataToBase64(attachment.data)), "");
  }

  parts.push(`--${mixedBoundary}--`, "");
  return parts.join("\r\n");
}

function sanitizeHeaderName(value: string): string {
  const name = value.trim();
  return /^[A-Za-z0-9-]+$/.test(name) ? name : "";
}

function quoteHeaderParam(value: string): string {
  return `"${sanitizeEmailHeaderValue(value).replace(/(["\\])/g, "\\$1")}"`;
}

function attachmentDataToBase64(value: Uint8Array | string): string {
  if (typeof value === "string") return base64Utf8(value);
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function wrapBase64(value: string): string {
  return value.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}
