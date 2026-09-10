import { describe, expect, it } from "vitest";
import {
  lookupWorkersAiCatalogModel,
  workersAiOutputTokenCap,
} from "../src/workers-ai-catalog.js";

describe("lookupWorkersAiCatalogModel", () => {
  it("resolves the canonical @cf model id", () => {
    expect(lookupWorkersAiCatalogModel("@cf/meta/llama-3.3-70b-instruct-fp8-fast")?.id)
        .toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  });

  it("resolves a unique hand-entered alias such as llama-3.3", () => {
    expect(lookupWorkersAiCatalogModel("llama-3.3")?.id)
        .toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  });

  it("returns undefined for an unknown model id", () => {
    expect(lookupWorkersAiCatalogModel("@cf/custom/unknown-model")).toBeUndefined();
  });
});

// Observed CF-OS agent system prompt size on a minimal turn (llama-3.3 profile).
const MIN_AGENT_SYSTEM_PROMPT = 4097;

describe("workersAiOutputTokenCap", () => {
  it("leaves prompt headroom inside the model window", () => {
    const catalog = lookupWorkersAiCatalogModel("@cf/meta/llama-3.3-70b-instruct-fp8-fast")!;
    expect(workersAiOutputTokenCap(catalog)).toBe(6000);
    expect(workersAiOutputTokenCap(catalog, 32_768)).toBe(6000);
  });

  it("coexists with a realistic agent system prompt in a 24k window", () => {
    const catalog = lookupWorkersAiCatalogModel("@cf/meta/llama-3.3-70b-instruct-fp8-fast")!;
    const cap = workersAiOutputTokenCap(catalog)!;
    expect(cap + MIN_AGENT_SYSTEM_PROMPT).toBeLessThanOrEqual(catalog.contextWindow!);
  });

  it("clamps unknown models conservatively", () => {
    expect(workersAiOutputTokenCap(undefined, 32_768)).toBe(16_384);
  });
});
