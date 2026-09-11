import { describe, expect, it } from "vitest";

import { toolCallGroupHasError } from "./chatToolGroupError";

describe("toolCallGroupHasError", () => {
  it("is false when nothing failed", () => {
    expect(toolCallGroupHasError([{ toolName: "executeCode" }])).toBe(false);
  });

  it("is true when the only executeCode attempt failed", () => {
    expect(toolCallGroupHasError([
      { toolName: "executeCode", error: "The RPC receiver does not implement the method \"get_test_case\"." },
    ])).toBe(true);
  });

  it("does not paint the turn ERROR when a failed executeCode recovered via an MCP observation", () => {
    expect(toolCallGroupHasError(
      [{ toolName: "executeCode", error: "The RPC receiver does not implement the method \"get_test_case\"." }],
      1,
    )).toBe(false);
  });

  it("does not paint the turn ERROR when a later executeCode succeeded", () => {
    expect(toolCallGroupHasError([
      { toolName: "executeCode", error: "missing method" },
      { toolName: "executeCode" },
    ])).toBe(false);
  });

  it("still marks non-executeCode failures", () => {
    expect(toolCallGroupHasError(
      [
        { toolName: "writeFile", error: "disk full" },
        { toolName: "executeCode" },
      ],
      1,
    )).toBe(true);
  });
});
