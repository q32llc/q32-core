export type AiMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export type AiJsonRequest = {
  model: string;
  messages: AiMessage[];
  responseName?: string;
  temperature?: number;
};

export type AiJsonProvider = {
  generateJson<T>(request: AiJsonRequest): Promise<T>;
};

export type AiUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type AiResult<T> = {
  value: T;
  usage?: AiUsage;
  providerMetadata?: Record<string, unknown>;
};

export function systemUserMessages(system: string, user: string): AiMessage[] {
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return JSON.parse(trimmed);
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return JSON.parse(fenced[1].trim());
  throw new Error("No JSON object found in model output.");
}
