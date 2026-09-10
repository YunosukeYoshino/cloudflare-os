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

describe("workersAiOutputTokenCap", () => {
  it("leaves prompt headroom inside the model window", () => {
    const catalog = lookupWorkersAiCatalogModel("@cf/meta/llama-3.3-70b-instruct-fp8-fast")!;
    expect(workersAiOutputTokenCap(catalog)).toBe(19_904);
    expect(workersAiOutputTokenCap(catalog, 32_768)).toBe(19_904);
  });

  it("clamps unknown models conservatively", () => {
    expect(workersAiOutputTokenCap(undefined, 32_768)).toBe(16_384);
  });
});
