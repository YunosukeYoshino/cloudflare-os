import type { ActionDescription, SupportedResource } from "@gadgets/workshop-shared/gatekeeper";

const WORKSPACE_PATTERN = "probe://workspace";
const TEST_CASE_PATTERN = "probe://test-case/:testCaseId";
const RUN_PATTERN = "probe://run/:runId";

/** Whole connected Probe workspace: every test case and run the signed-in user can see. */
export const WORKSPACE_RESOURCE: SupportedResource = {
  urlPattern: WORKSPACE_PATTERN,
  title: "Probe workspace",
  description:
    "List test cases, read runs, and start browser tests in the connected Probe workspace.",
};

/** One Probe test case and the runs it owns. */
export const TEST_CASE_RESOURCE: SupportedResource = {
  urlPattern: TEST_CASE_PATTERN,
  title: "Probe test case",
  description: "Read one test case and its runs. Starting a run needs confirmation.",
};

/** One Probe run. Cannot start new runs. */
export const RUN_RESOURCE: SupportedResource = {
  urlPattern: RUN_PATTERN,
  title: "Probe run",
  description: "Read one Probe run: status, steps, events, and artifact metadata.",
};

export const SUPPORTED_RESOURCES: SupportedResource[] = [
  WORKSPACE_RESOURCE,
  TEST_CASE_RESOURCE,
  RUN_RESOURCE,
];

export type ProbeResourceKind = "workspace" | "test-case" | "run";

export type ParsedProbeResource =
  | { kind: "workspace" }
  | { kind: "test-case"; testCaseId: string }
  | { kind: "run"; runId: string };

/** Resource URL for the connected workspace. The account already stores the Probe API origin. */
export function workspaceResourceUrl(): string {
  return "probe://workspace";
}

/** Resource URL for one test case. */
export function testCaseResourceUrl(testCaseId: string): string {
  return `probe://test-case/${encodeURIComponent(testCaseId)}`;
}

/** Resource URL for one run. */
export function runResourceUrl(runId: string): string {
  return `probe://run/${encodeURIComponent(runId)}`;
}

function pathId(pathname: string): string {
  const trimmed = pathname.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "";
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return "";
  }
}

/**
 * Parses a Probe resource URL into a binding kind. Throws if the URL is not one this connector
 * issues.
 */
export function parseProbeResourceUrl(url: string): ParsedProbeResource {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("That is not a valid Probe resource URL.");
  }
  if (parsed.protocol !== "probe:") {
    throw new Error("Probe resource URLs use the probe:// scheme.");
  }
  if (parsed.hostname === "workspace") {
    const rest = pathId(parsed.pathname);
    if (rest) throw new Error("A workspace URL cannot name a nested resource.");
    return { kind: "workspace" };
  }
  if (parsed.hostname === "test-case") {
    const testCaseId = pathId(parsed.pathname);
    if (!testCaseId) throw new Error("A test-case URL must include a test case id.");
    return { kind: "test-case", testCaseId };
  }
  if (parsed.hostname === "run") {
    const runId = pathId(parsed.pathname);
    if (!runId) throw new Error("A run URL must include a run id.");
    return { kind: "run", runId };
  }
  throw new Error("Unknown Probe resource URL.");
}

/** SupportedResource matching a parsed resource. */
export function resourceFor(kind: ProbeResourceKind): SupportedResource {
  switch (kind) {
    case "workspace":
      return WORKSPACE_RESOURCE;
    case "test-case":
      return TEST_CASE_RESOURCE;
    case "run":
      return RUN_RESOURCE;
  }
}

/** Approval-queue description for enqueueing a Probe browser run. */
export function describeStartRun(testCase: {
  id: string;
  name: string;
  baseUrl: string;
}): ActionDescription {
  return {
    title: `Start Probe run: ${testCase.name}`,
    description:
      `Enqueue a new browser run of test case \`${testCase.id}\` (${testCase.name}) against ` +
      `${testCase.baseUrl}. Probe uses the test case's stored URL and instruction; this cannot ` +
      `be undone once it starts.`,
    implementsRevert: false,
    awaitDecision: true,
  };
}
