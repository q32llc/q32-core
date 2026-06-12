import { awsFetch, createAwsConfigFromEnv, type AwsConfig, type AwsEnv } from "./aws.js";
import { buildRawMimeMessage, formatEmailAddress, type EmailAddress, type SendEmailInput } from "./email.js";

export type SesEmailInput = Omit<SendEmailInput, "from"> & {
  from?: EmailAddress;
  headers?: Record<string, string>;
};

export type SesSendResult = {
  messageId: string;
  provider: "ses";
};

export type SesMailer = {
  readonly enabled: boolean;
  send(input: SesEmailInput): Promise<SesSendResult>;
};

export type SesMailerEnv = AwsEnv & {
  FROM_EMAIL?: string;
  EMAIL_FROM?: string;
  NOTIFICATION_FROM_EMAIL?: string;
  POSTMARK_FROM_EMAIL?: string;
  SES_FROM_EMAIL?: string;
  EMAIL_REPLY_TO?: string;
  NOTIFICATION_REPLY_TO?: string;
};

export type SesSendOptions = {
  fetcher?: typeof fetch;
};

export class NoopSesMailer implements SesMailer {
  readonly enabled = false;

  async send(): Promise<SesSendResult> {
    throw new Error("SES mailer is not configured.");
  }
}

export class WorkerSesMailer implements SesMailer {
  readonly enabled = true;

  constructor(
    private readonly config: AwsConfig,
    private readonly defaults: {
      from: EmailAddress;
      replyTo?: EmailAddress[];
      fetcher?: typeof fetch;
    },
  ) {}

  send(input: SesEmailInput): Promise<SesSendResult> {
    return sendSesEmail(this.config, {
      ...input,
      from: input.from ?? this.defaults.from,
      replyTo: input.replyTo ?? this.defaults.replyTo,
    }, { fetcher: this.defaults.fetcher });
  }
}

export function createSesMailerFromEnv(
  env: SesMailerEnv,
  options: {
    fromEmail?: string;
    fromName?: string;
    replyTo?: string | string[] | null;
    fetcher?: typeof fetch;
  } = {},
): SesMailer {
  const config = createAwsConfigFromEnv(env);
  const fromEmail = options.fromEmail ?? env.FROM_EMAIL ?? env.EMAIL_FROM ?? env.NOTIFICATION_FROM_EMAIL ?? env.POSTMARK_FROM_EMAIL ?? env.SES_FROM_EMAIL;
  if (!config || !fromEmail) return new NoopSesMailer();
  const replyTo = options.replyTo ?? env.NOTIFICATION_REPLY_TO ?? env.EMAIL_REPLY_TO;
  return new WorkerSesMailer(config, {
    from: { email: fromEmail, name: options.fromName },
    replyTo: typeof replyTo === "string"
      ? [{ email: replyTo }]
      : Array.isArray(replyTo)
        ? replyTo.map((email) => ({ email }))
        : undefined,
    fetcher: options.fetcher,
  });
}

export async function sendSesEmail(
  config: AwsConfig,
  input: SendEmailInput & { headers?: Record<string, string> },
  options: SesSendOptions = {},
): Promise<SesSendResult> {
  const hasRawFeatures = Boolean(input.headers && Object.keys(input.headers).length > 0) || Boolean(input.attachments?.length);
  const body = hasRawFeatures ? rawSesBody(input) : simpleSesBody(input);
  const response = await awsFetch(config, `https://email.${config.region}.amazonaws.com/v2/email/outbound-emails`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, { service: "ses", fetcher: options.fetcher });
  const text = await response.text();
  if (!response.ok) throw new Error(`SES send failed: ${response.status} ${text.slice(0, 300)}`);
  const payload = parseJsonObject(text);
  const messageId = stringValue(payload.MessageId) ?? stringValue(payload.messageId) ?? "";
  return { provider: "ses", messageId };
}

export async function sesQuery(
  config: AwsConfig,
  params: Record<string, string>,
  options: SesSendOptions = {},
): Promise<string> {
  const body = new URLSearchParams({ Version: "2010-12-01", ...params }).toString();
  const response = await awsFetch(config, `https://email.${config.region}.amazonaws.com/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  }, { service: "ses", fetcher: options.fetcher });
  const text = await response.text();
  if (!response.ok) throw new Error(`SES ${params.Action ?? "query"} failed: ${response.status} ${text.slice(0, 300)}`);
  return text;
}

export function inboundSesMxHost(region = "us-east-1"): string {
  return `inbound-smtp.${region}.amazonaws.com`;
}

function simpleSesBody(input: SendEmailInput): Record<string, unknown> {
  return {
    FromEmailAddress: formatEmailAddress(input.from),
    Destination: {
      ToAddresses: input.to.map(formatEmailAddress),
      ...(input.cc?.length ? { CcAddresses: input.cc.map(formatEmailAddress) } : {}),
      ...(input.bcc?.length ? { BccAddresses: input.bcc.map(formatEmailAddress) } : {}),
    },
    ...(input.replyTo?.length ? { ReplyToAddresses: input.replyTo.map(formatEmailAddress) } : {}),
    Content: {
      Simple: {
        Subject: { Data: input.subject, Charset: "UTF-8" },
        Body: {
          ...(input.text ? { Text: { Data: input.text, Charset: "UTF-8" } } : {}),
          ...(input.html ? { Html: { Data: input.html, Charset: "UTF-8" } } : {}),
        },
      },
    },
  };
}

function rawSesBody(input: SendEmailInput & { headers?: Record<string, string> }): Record<string, unknown> {
  return {
    FromEmailAddress: formatEmailAddress(input.from),
    Destination: {
      ToAddresses: input.to.map(formatEmailAddress),
      ...(input.cc?.length ? { CcAddresses: input.cc.map(formatEmailAddress) } : {}),
      ...(input.bcc?.length ? { BccAddresses: input.bcc.map(formatEmailAddress) } : {}),
    },
    Content: {
      Raw: {
        Data: textToBase64(buildRawMimeMessage(input)),
      },
    },
  };
}

function textToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
