// Workers AI's OpenAI-compatible `/ai/v1/chat/completions` endpoint validates each model's
// input schema strictly. pi's openai-completions adapter emits standard OpenAI shapes that
// several Workers AI models reject: content-parts arrays and `content: null` on assistant
// messages carrying tool_calls (cloudflare/cloudflare-os#54). Normalize just before fetch.

import {lookupWorkersAiCatalogModel, workersAiOutputTokenCap} from "./workers-ai-catalog.js";

type ChatCompletionMessage = {
  content?: unknown;
};

export type ChatCompletionBody = {
  model?: string;
  messages?: ChatCompletionMessage[];
  max_tokens?: number;
  max_completion_tokens?: number;
};

/** Flatten content-parts arrays to strings and replace null content with "". */
export function normalizeWorkersAiChatCompletionsBody(body: ChatCompletionBody): ChatCompletionBody {
  for (const message of body.messages ?? []) {
    if (Array.isArray(message.content)) {
      message.content = message.content.map(part => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return typeof part.text === "string" ? part.text : "";
        }
        return "";
      }).join("\n");
    } else if (message.content == null) {
      message.content = "";
    }
  }
  return body;
}

/** Resolve aliases, clamp completion caps, and normalize message content. */
export function prepareWorkersAiChatCompletionsBody(body: ChatCompletionBody): ChatCompletionBody {
  const catalog = body.model ? lookupWorkersAiCatalogModel(body.model) : undefined;
  if (catalog && body.model !== catalog.id) {
    body.model = catalog.id;
  }
  const requested = body.max_completion_tokens ?? body.max_tokens;
  const cap = workersAiOutputTokenCap(catalog, requested);
  if (cap !== undefined) {
    if (body.max_completion_tokens !== undefined) body.max_completion_tokens = cap;
    if (body.max_tokens !== undefined) body.max_tokens = cap;
    if (requested === undefined) body.max_completion_tokens = cap;
  }
  return normalizeWorkersAiChatCompletionsBody(body);
}

function isWorkersAiChatCompletionsUrl(url: string): boolean {
  return url.includes("/ai/v1/chat/completions") || url.includes("/workers-ai/v1/chat/completions");
}

async function readJsonBody(body: BodyInit | null | undefined): Promise<ChatCompletionBody | undefined> {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as ChatCompletionBody;
    } catch {
      return undefined;
    }
  }
  if (body instanceof URLSearchParams || body instanceof FormData) return undefined;
  try {
    const text = typeof body === "object" && "byteLength" in body
        ? new TextDecoder().decode(body as Uint8Array)
        : await new Response(body).text();
    return JSON.parse(text) as ChatCompletionBody;
  } catch {
    return undefined;
  }
}

async function prepareFetchInput(
    input: RequestInfo | URL,
    init?: RequestInit,
): Promise<[RequestInfo | URL, RequestInit | undefined]> {
  if (input instanceof Request) {
    const url = input.url;
    if (!isWorkersAiChatCompletionsUrl(url)) return [input, init];
    const parsed = await readJsonBody(input.body);
    if (!parsed) return [input, init];
    const prepared = JSON.stringify(prepareWorkersAiChatCompletionsBody(parsed));
    const headers = new Headers(input.headers);
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    headers.set("content-type", "application/json");
    const method = init?.method ?? input.method;
    return [url, {...init, method, headers, body: prepared}];
  }

  const url = String(input);
  if (!isWorkersAiChatCompletionsUrl(url)) return [input, init];
  const parsed = await readJsonBody(init?.body);
  if (!parsed) return [input, init];
  return [input, {...init, body: JSON.stringify(prepareWorkersAiChatCompletionsBody(parsed))}];
}

/** Wrap fetch to normalize Workers AI chat/completions request bodies. */
export function wrapFetchForWorkersAi(fetchImpl: typeof fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const [nextInput, nextInit] = await prepareFetchInput(input, init);
    return fetchImpl(nextInput, nextInit);
  };
}
