import { describe, expect, it } from "vitest";
import {
  normalizeWorkersAiChatCompletionsBody,
  wrapFetchForWorkersAi,
} from "../src/workers-ai-transport.js";

describe("normalizeWorkersAiChatCompletionsBody", () => {
  it("flattens content-parts arrays to strings", () => {
    const body = normalizeWorkersAiChatCompletionsBody({
      messages: [
        {role: "system", content: [{type: "text", text: "You are helpful."}]},
        {role: "user", content: [{type: "text", text: "Hello"}]},
      ],
    });
    expect(body.messages).toEqual([
      {role: "system", content: "You are helpful."},
      {role: "user", content: "Hello"},
    ]);
  });

  it("replaces null assistant content with an empty string", () => {
    const body = normalizeWorkersAiChatCompletionsBody({
      messages: [{role: "assistant", content: null}],
    });
    expect(body.messages![0].content).toBe("");
  });

  it("joins multiple text parts with newlines", () => {
    const body = normalizeWorkersAiChatCompletionsBody({
      messages: [{
        role: "user",
        content: [{type: "text", text: "line one"}, {type: "text", text: "line two"}],
      }],
    });
    expect(body.messages![0].content).toBe("line one\nline two");
  });
});

describe("wrapFetchForWorkersAi", () => {
  it("normalizes direct REST chat/completions requests", async () => {
    let capturedBody = "";
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response("{}", {status: 200});
    };

    await wrapFetchForWorkersAi(fetchImpl)(
        "https://api.cloudflare.com/client/v4/accounts/acct/ai/v1/chat/completions",
        {
          method: "POST",
          body: JSON.stringify({
            messages: [{role: "assistant", content: null, tool_calls: []}],
          }),
        });

    expect(JSON.parse(capturedBody).messages[0].content).toBe("");
  });

  it("normalizes AI Gateway workers-ai chat/completions requests", async () => {
    let capturedBody = "";
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response("{}", {status: 200});
    };

    await wrapFetchForWorkersAi(fetchImpl)(
        "https://gateway.ai.cloudflare.com/v1/acct/gw/workers-ai/v1/chat/completions",
        {
          method: "POST",
          body: JSON.stringify({
            messages: [{role: "user", content: [{type: "text", text: "hi"}]}],
          }),
        });

    expect(JSON.parse(capturedBody).messages[0].content).toBe("hi");
  });

  it("passes through non-Workers-AI URLs unchanged", async () => {
    let capturedBody = "";
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response("{}", {status: 200});
    };

    const original = JSON.stringify({messages: [{role: "assistant", content: null}]});
    await wrapFetchForWorkersAi(fetchImpl)("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: original,
    });

    expect(capturedBody).toBe(original);
  });
});
