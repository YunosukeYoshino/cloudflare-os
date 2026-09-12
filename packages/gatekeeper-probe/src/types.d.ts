// TypeScript interface for the Probe gatekeeper. These types are exposed to gadgets and agents
// that have been granted access to a connected Probe instance.
//
// Probe is a local QA tool: a test case is a name, target URL, and instruction; a run is one
// queued browser execution with steps, events, and artifact metadata.
//
// Bindings are capability-based:
//
// * Workspace — every test case and run the signed-in Probe user can see.
// * Test case — one test case and the runs it owns.
// * Run — one run. Cannot start new runs.
//
// Methods take positional arguments. Field names are camelCase, matching Probe's JSON.

import type { RpcTarget } from "cloudflare:workers";

/** Probe workspace role. Viewers can read; owners and members can start runs. */
export type ProbeRole = "owner" | "member" | "viewer";

/** Signed-in Probe user for the connected account. */
export interface ProbePrincipal {
  userId: string;
  workspaceId: string;
  email: string;
  displayName: string;
  role: ProbeRole;
}

/** A Probe test case. */
export interface ProbeTestCase {
  /** Stable id. */
  id: string;
  workspaceId: string;
  name: string;
  /** URL the browser run will open. */
  baseUrl: string;
  /** Natural-language instruction the run follows. */
  instruction: string;
  status: "active";
  createdAt: string;
  updatedAt: string;
  /** Present on workspace listings. */
  latestRun?: ProbeRunSummary | null;
}

/** Lifecycle of one run. */
export type ProbeRunStatus = "queued" | "running" | "passed" | "failed" | "cancelled";

/** High-level phase inside a run. */
export type ProbeQaPhase =
  | "plan"
  | "execute"
  | "verify"
  | "investigate"
  | "report"
  | "completed";

/** Failure ownership Probe assigned, if any. */
export type ProbeFailureClassification =
  | "product"
  | "test_spec"
  | "agent"
  | "environment"
  | "unknown";

/** Compact run row from list endpoints. */
export interface ProbeRunSummary {
  id: string;
  testCaseId: string;
  status: ProbeRunStatus;
  phase: ProbeQaPhase;
  failureClassification: ProbeFailureClassification | null;
  summary: string;
  reportArtifactKey: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

/** One planned/executed step on a run. */
export interface ProbeRunStep {
  id: string;
  runId: string;
  stepIndex: number;
  description: string;
  actionJson: string;
  expectedOutcome: string | null;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Artifact metadata. Binary bytes are not returned; open Probe's UI to download. */
export interface ProbeArtifact {
  id: string;
  runId: string;
  stepId: string | null;
  type: string;
  storageKey: string;
  contentType: string;
  createdAt: string;
}

/** Evidence/ops event recorded on a run. */
export interface ProbeEvent {
  id: string;
  runId: string;
  type: string;
  payloadJson: string;
  createdAt: string;
}

/** Run plus steps, artifacts, and events. */
export interface ProbeRun extends ProbeRunSummary {
  steps: ProbeRunStep[];
  artifacts: ProbeArtifact[];
  events: ProbeEvent[];
  queue?: unknown;
  workerHealth?: unknown;
}

/**
 * Result of `startRun`. A queued run is not created until the user confirms, so poll
 * `getActionResult` with the returned `actionId`.
 */
export type ProbeStartRunResult =
  | { status: "pending"; actionId: number; message: string }
  | { status: "ok"; run: ProbeRunSummary }
  | { status: "rejected"; actionId: number; message: string };

/** Whole-workspace session. Suggested binding name: `PROBE`. */
export interface ProbeWorkspaceSession extends RpcTarget {
  /** Who this connection signed into Probe as. */
  getMe(): Promise<ProbePrincipal>;

  /** Test cases in the workspace, newest listings include `latestRun`. */
  listTestCases(): Promise<ProbeTestCase[]>;

  /**
   * One test case by id.
   * @param testCaseId Test case id.
   */
  getTestCase(testCaseId: string): Promise<ProbeTestCase>;

  /** Every run in the workspace, newest first. */
  listRuns(): Promise<ProbeRunSummary[]>;

  /**
   * One run by id, including steps, events, and artifact metadata.
   * @param runId Run id.
   */
  getRun(runId: string): Promise<ProbeRun>;

  /**
   * Enqueue a browser run of `testCaseId`. Returns `{ status: "pending", actionId }` until the
   * user confirms; then call `getActionResult(actionId)` for the queued run. Each call creates a
   * new run. Viewers cannot start runs.
   * @param testCaseId Test case to run.
   */
  startRun(testCaseId: string): Promise<ProbeStartRunResult>;

  /**
   * Outcome of a previously returned `actionId`.
   * @param actionId Id from `startRun`.
   */
  getActionResult(actionId: number): Promise<ProbeStartRunResult>;
}

/** Single test-case session. Suggested binding name: `PROBE_TEST_CASE`. */
export interface ProbeTestCaseSession extends RpcTarget {
  /** The bound test case. */
  getTestCase(): Promise<ProbeTestCase>;

  /**
   * Runs of this test case, newest first.
   * @param limit Max rows (1–100). Default 20.
   * @param offset Rows to skip. Default 0.
   */
  listRuns(limit?: number, offset?: number): Promise<ProbeRunSummary[]>;

  /**
   * One run of this test case.
   * @param runId Run id. Other test cases' runs are unavailable.
   */
  getRun(runId: string): Promise<ProbeRun>;

  /**
   * Enqueue a browser run of this test case. Same pending/`getActionResult` protocol as the
   * workspace session. Each call creates a new run.
   */
  startRun(): Promise<ProbeStartRunResult>;

  /**
   * Outcome of a previously returned `actionId`.
   * @param actionId Id from `startRun`.
   */
  getActionResult(actionId: number): Promise<ProbeStartRunResult>;
}

/** Single-run session. Suggested binding name: `PROBE_RUN`. Cannot start runs. */
export interface ProbeRunSession extends RpcTarget {
  /** The bound run, including steps, events, and artifact metadata. */
  getRun(): Promise<ProbeRun>;
}
