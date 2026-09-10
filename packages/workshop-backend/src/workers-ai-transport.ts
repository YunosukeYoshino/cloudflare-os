// Workers AI's OpenAI-compatible `/ai/v1/chat/completions` endpoint validates each model's
// input schema strictly. pi's openai-completions adapter emits standard OpenAI shapes that
// several Workers AI models reject: content-parts arrays and `content: null` on assistant
// messages carrying tool_calls (cloudflare/cloudflare-os#54). Normalize just before fetch.

type ChatCompletionMessage = {
  content?: unknown;
};

type ChatCompletionBody = {
  messages?: ChatCompletionMessage[];
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

function isWorkersAiChatCompletionsUrl(url: string): boolean {
  return url.includes("/ai/v1/chat/completions") || url.includes("/workers-ai/v1/chat/completions");
}

/** Wrap fetch to normalize Workers AI chat/completions request bodies. */
export function wrapFetchForWorkersAi(fetchImpl: typeof fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body !== undefined && typeof init.body === "string" &&
        isWorkersAiChatCompletionsUrl(String(input instanceof Request ? input.url : input))) {
      try {
        const body = normalizeWorkersAiChatCompletionsBody(JSON.parse(init.body));
        init = {...init, body: JSON.stringify(body)};
      } catch {
        // Malformed JSON or unexpected shape: pass through unchanged.
      }
    }
    return fetchImpl(input, init);
  };
}
