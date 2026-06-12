export type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

export type AwsConfig = AwsCredentials & {
  region: string;
};

export type AwsEnv = {
  AWS_ACCESS_KEY?: string;
  AWS_SECRET_KEY?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_SESSION_TOKEN?: string;
  AWS_REGION?: string;
};

export function createAwsConfigFromEnv(env: AwsEnv, defaultRegion = "us-east-1"): AwsConfig | null {
  const accessKeyId = env.AWS_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY ?? env.AWS_SECRET_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: env.AWS_SESSION_TOKEN,
    region: env.AWS_REGION ?? defaultRegion,
  };
}

export type AwsFetchOptions = {
  service: string;
  region?: string;
  fetcher?: typeof fetch;
};

export async function awsFetch(
  config: AwsConfig,
  input: string | URL,
  init: RequestInit,
  options: AwsFetchOptions,
): Promise<Response> {
  const url = new URL(input.toString());
  const region = options.region ?? config.region;
  const method = (init.method ?? "GET").toUpperCase();
  const body = bodyToString(init.body);
  const payloadHash = await sha256Hex(body);
  const headers = new Headers(init.headers);
  headers.set("host", url.host);
  headers.set("x-amz-content-sha256", payloadHash);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  headers.set("x-amz-date", amzDate);
  if (config.sessionToken) headers.set("x-amz-security-token", config.sessionToken);

  const signedHeaderNames = headerNames(headers).map((key) => key.toLowerCase()).sort();
  const canonicalHeaders = signedHeaderNames.map((key) => `${key}:${normalizeHeaderValue(headers.get(key) ?? "")}\n`).join("");
  const canonicalRequest = [
    method,
    canonicalPath(url),
    canonicalQuery(url),
    canonicalHeaders,
    signedHeaderNames.join(";"),
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${region}/${options.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = await hmacHex(await signingKey(config.secretAccessKey, dateStamp, region, options.service), stringToSign);
  headers.set(
    "authorization",
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`,
  );

  return (options.fetcher ?? fetch)(url, {
    ...init,
    method,
    headers,
    body: init.body,
  });
}

function bodyToString(body: BodyInit | null | undefined): string {
  if (!body) return "";
  if (typeof body === "string") return body;
  throw new Error("awsFetch currently supports string request bodies.");
}

function canonicalPath(url: URL): string {
  return url.pathname
    .split("/")
    .map((part) => encodeURIComponent(decodeURIComponent(part)).replace(/[!'()*]/g, pctEncode))
    .join("/");
}

function canonicalQuery(url: URL): string {
  const entries: Array<[string, string]> = [];
  url.searchParams.forEach((value, key) => entries.push([key, value]));
  return entries
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function headerNames(headers: Headers): string[] {
  const names: string[] = [];
  headers.forEach((_value, key) => names.push(key));
  return names;
}

function normalizeHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, pctEncode);
}

function pctEncode(char: string): string {
  return `%${char.charCodeAt(0).toString(16).toUpperCase()}`;
}

async function signingKey(secret: string, date: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmacRaw(new TextEncoder().encode(`AWS4${secret}`), date);
  const kRegion = await hmacRaw(kDate, region);
  const kService = await hmacRaw(kRegion, service);
  return hmacRaw(kService, "aws4_request");
}

async function hmacRaw(key: BufferSource, value: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value));
}

async function hmacHex(key: BufferSource, value: string): Promise<string> {
  return bytesToHex(new Uint8Array(await hmacRaw(key, value)));
}

async function sha256Hex(value: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
