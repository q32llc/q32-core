export type SentQueueMessage<T> = {
  body: T;
  options?: QueueSendOptions;
};

export type MemoryQueue<T = unknown> = Pick<Queue<T>, "send" | "sendBatch"> & {
  sent: SentQueueMessage<T>[];
  clear(): void;
};

export function createMemoryQueue<T = unknown>(): MemoryQueue<T> {
  const sent: SentQueueMessage<T>[] = [];
  return {
    sent,
    async send(body: T, options?: QueueSendOptions): Promise<QueueSendResponse> {
      sent.push({ body, options });
      return queueSendResponse();
    },
    async sendBatch(messages: Iterable<MessageSendRequest<T>>): Promise<QueueSendBatchResponse> {
      for (const message of messages) sent.push({ body: message.body, options: message });
      return queueSendBatchResponse();
    },
    clear(): void {
      sent.length = 0;
    },
  };
}

export type MemoryR2Object = {
  key: string;
  body: Uint8Array;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type MemoryR2Bucket = Pick<R2Bucket, "put" | "get" | "delete"> & {
  objects: Map<string, MemoryR2Object>;
  clear(): void;
};

export function createMemoryR2Bucket(): MemoryR2Bucket {
  const objects = new Map<string, MemoryR2Object>();
  return {
    objects,
    async put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob, options?: R2PutOptions): Promise<R2Object> {
      const body = await toBytes(value);
      const object = memoryR2Object(key, body, normalizeR2HttpMetadata(options?.httpMetadata), options?.customMetadata);
      objects.set(key, object);
      return object as unknown as R2Object;
    },
    async get(key: string): Promise<R2ObjectBody | null> {
      return (objects.get(key) as unknown as R2ObjectBody | undefined) ?? null;
    },
    async delete(keys: string | string[]): Promise<void> {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
    clear(): void {
      objects.clear();
    },
  };
}

export async function expectJsonResponse<T = unknown>(response: Response, status = 200): Promise<T> {
  if (response.status !== status) throw new Error(`Expected response status ${status}, got ${response.status}.`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error(`Expected JSON response, got ${contentType || "no content-type"}.`);
  return (await response.json()) as T;
}

async function toBytes(value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob): Promise<Uint8Array> {
  if (value === null) return new Uint8Array();
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  return new Uint8Array(await new Response(value).arrayBuffer());
}

function queueSendResponse(): QueueSendResponse {
  return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } };
}

function queueSendBatchResponse(): QueueSendBatchResponse {
  return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } };
}

function normalizeR2HttpMetadata(value: R2HTTPMetadata | Headers | undefined): R2HTTPMetadata | undefined {
  if (!value) return undefined;
  if (!(value instanceof Headers)) return value;
  const contentType = value.get("content-type") ?? undefined;
  const cacheControl = value.get("cache-control") ?? undefined;
  return { contentType, cacheControl };
}

function memoryR2Object(
  key: string,
  body: Uint8Array,
  httpMetadata?: R2HTTPMetadata,
  customMetadata?: Record<string, string>,
): MemoryR2Object {
  return {
    key,
    body,
    httpMetadata,
    customMetadata,
    async text(): Promise<string> {
      return new TextDecoder().decode(body);
    },
    async json<T = unknown>(): Promise<T> {
      return JSON.parse(await this.text()) as T;
    },
    async arrayBuffer(): Promise<ArrayBuffer> {
      return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
    },
  };
}
