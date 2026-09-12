import { describe, expect, it, vi } from "vitest";

vi.mock("@gadgets/configurator-ui", () => ({
  h: (component: unknown, props: unknown, ...children: unknown[]) =>
    ({ component, props, children }),
  Section: "Section",
  Field: "Field",
  Autocomplete: "Autocomplete",
}));

async function loadTestCaseSpec() {
  vi.resetModules();
  return (await import("../src/configurator/test-case-configurator-ui.js")).default;
}

async function loadRunSpec() {
  vi.resetModules();
  return (await import("../src/configurator/run-configurator-ui.js")).default;
}

async function loadWorkspaceSpec() {
  vi.resetModules();
  return (await import("../src/configurator/workspace-configurator-ui.js")).default;
}

describe("test-case configurator", () => {
  it("round-trips a prefilled resource URL", async () => {
    const spec = await loadTestCaseSpec();
    const resourceUrl = "probe://test-case/case-1";
    const values = spec.initialValuesFromResourceUrl!({ resourceUrl } as never);
    expect(values).toEqual({ testCaseId: "case-1" });
    expect(spec.isReady({ values } as never)).toBe(true);
    expect(spec.resourceUrl({ values } as never)).toBe(resourceUrl);
  });

  it("is not ready until a test case is chosen", async () => {
    const spec = await loadTestCaseSpec();
    expect(spec.isReady({ values: {} } as never)).toBe(false);
  });
});

describe("run configurator", () => {
  it("round-trips a prefilled run URL", async () => {
    const spec = await loadRunSpec();
    const resourceUrl = "probe://run/run-1";
    const values = spec.initialValuesFromResourceUrl!({ resourceUrl } as never);
    expect(values).toEqual({ runId: "run-1" });
    expect(spec.resourceUrl({ values } as never)).toBe(resourceUrl);
  });
});

describe("workspace configurator", () => {
  it("always emits the workspace URL", async () => {
    const spec = await loadWorkspaceSpec();
    const ui = { resourceUrl: async () => "probe://workspace" };
    expect(spec.isReady()).toBe(true);
    await expect(spec.resourceUrl({ values: {}, ui } as never)).resolves.toBe("probe://workspace");
  });
});
