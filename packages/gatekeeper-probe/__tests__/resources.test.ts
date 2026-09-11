import { describe, expect, it } from "vitest";

import {
  describeStartRun,
  parseProbeResourceUrl,
  runResourceUrl,
  SUPPORTED_RESOURCES,
  testCaseResourceUrl,
  workspaceResourceUrl,
} from "../src/resources.js";

describe("parseProbeResourceUrl", () => {
  it("parses workspace, test-case, and run URLs", () => {
    expect(parseProbeResourceUrl("probe://workspace")).toEqual({ kind: "workspace" });
    expect(parseProbeResourceUrl(workspaceResourceUrl())).toEqual({ kind: "workspace" });
    expect(parseProbeResourceUrl(testCaseResourceUrl("abc-1"))).toEqual({
      kind: "test-case",
      testCaseId: "abc-1",
    });
    expect(parseProbeResourceUrl(runResourceUrl("run-9"))).toEqual({
      kind: "run",
      runId: "run-9",
    });
  });

  it("round-trips ids that need encoding", () => {
    const id = "case/with spaces";
    expect(parseProbeResourceUrl(testCaseResourceUrl(id))).toEqual({
      kind: "test-case",
      testCaseId: id,
    });
  });

  it("rejects other schemes and unknown hosts", () => {
    expect(() => parseProbeResourceUrl("https://127.0.0.1:8789/")).toThrow(/probe:\/\//);
    expect(() => parseProbeResourceUrl("probe://other/x")).toThrow(/Unknown/);
    expect(() => parseProbeResourceUrl("probe://test-case/")).toThrow(/test case id/);
    expect(() => parseProbeResourceUrl("probe://workspace/extra")).toThrow(/nested/);
  });
});

describe("SUPPORTED_RESOURCES", () => {
  it("advertises the three Probe granularities", () => {
    expect(SUPPORTED_RESOURCES.map(resource => resource.urlPattern)).toEqual([
      "probe://workspace",
      "probe://test-case/:testCaseId",
      "probe://run/:runId",
    ]);
  });
});

describe("describeStartRun", () => {
  it("marks the run as needing a decision and not revertible", () => {
    const description = describeStartRun({
      id: "tc-1",
      name: "Demo login",
      baseUrl: "http://localhost:3001/login",
    });
    expect(description.awaitDecision).toBe(true);
    expect(description.implementsRevert).toBe(false);
    expect(description.title).toContain("Demo login");
    expect(description.description).toContain("tc-1");
    expect(description.description).toContain("http://localhost:3001/login");
  });
});
