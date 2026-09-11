import { DurableObject, RpcStub, RpcTarget, WorkerEntrypoint } from "cloudflare:workers";
import { skipRpcValidation, validateRpc } from "capnweb-validate";
import { createLogger } from "@gadgets/backend-utils/logger";
import {
  stripTrailingSlashes,
  type AccountDescription,
  type ApprovalQueue,
  type AvatarImage,
  type ConnectHandoff,
  type Gatekeeper,
  type GatekeeperConnectCallback,
  type GatekeeperUser,
  type GatekeeperUserVerifier,
  type GatekeeperVendor as GatekeeperVendorIface,
  type ResourceConfiguratorFrame,
  type ResourceDescription,
  type SupportedResource,
  type VendorDescription,
} from "@gadgets/workshop-shared/gatekeeper";
import {
  CONNECT_TIMEOUT_MS,
  generateNonce,
  INITIATION_NONCE_LIFETIME_MS,
  isLiveNonce,
  NONCE_BYTES,
  type TimedNonce,
} from "@gadgets/gatekeeper-kit/connect-nonce";
import {
  connectHandoffPageHtml,
  htmlResponse,
  INVALID_LINK_HTML,
} from "@gadgets/gatekeeper-kit/connect-pages";
import { commitStagedCredentials, stageCredentials } from "@gadgets/gatekeeper-kit/credential-stage";
import { connectFormHtml } from "./connect-form";
import {
  canStartRun,
  connectProbe,
  getMe,
  getRun,
  getTestCase,
  listRuns,
  listTestCases,
  normalizeProbeBaseUrl,
  ProbeError,
  startRun,
  type ProbeCredentials,
  type ProbePrincipal,
} from "./probe-api";
import {
  describeStartRun,
  parseProbeResourceUrl,
  resourceFor,
  RUN_RESOURCE,
  runResourceUrl,
  SUPPORTED_RESOURCES,
  TEST_CASE_RESOURCE,
  testCaseResourceUrl,
  WORKSPACE_RESOURCE,
  workspaceResourceUrl,
  type ParsedProbeResource,
} from "./resources";
import type {
  ProbeRun,
  ProbeRunSession,
  ProbeRunSummary,
  ProbeStartRunResult,
  ProbeTestCase,
  ProbeTestCaseSession,
  ProbeWorkspaceSession,
} from "./types";
import type { ProbeWorkspaceConfiguratorRpc } from "./configurator/workspace-configurator-types";
import type { ProbeTestCaseConfiguratorRpc } from "./configurator/test-case-configurator-types";
import type { ProbeRunConfiguratorRpc } from "./configurator/run-configurator-types";
import TYPES_CODE from "./types.txt";
import PROBE_LOGO_SVG from "./probe-logo.svg";
import WORKSPACE_CONFIGURATOR_HTML from "./generated/workspace-configurator-ui.txt";
import TEST_CASE_CONFIGURATOR_HTML from "./generated/test-case-configurator-ui.txt";
import RUN_CONFIGURATOR_HTML from "./generated/run-configurator-ui.txt";

const VENDOR_ID = "probe";
const logger = createLogger<{ vendorId: string }>({
  component: "gatekeeper.probe",
  vendorId: VENDOR_ID,
});

type Env = Cloudflare.Env & { BASE_URL?: string };

const PROBE_LOGO_URL = `data:image/svg+xml,${encodeURIComponent(PROBE_LOGO_SVG)}`;
const PROBE_AVATAR: AvatarImage = { url: PROBE_LOGO_URL };

function getBaseUrl(env: Env): string {
  return stripTrailingSlashes(env.BASE_URL ?? "http://localhost:8787/gatekeeper/probe");
}

function getBasePath(env: Env): string {
  const path = new URL(getBaseUrl(env)).pathname;
  return path === "/" ? "" : path;
}

const AUTOCOMPLETE_LIMIT = 100;

function optionMatches(parts: (string | undefined | null)[], query: string): boolean {
  const lowerQuery = query.trim().toLowerCase();
  if (!lowerQuery) return true;
  const corpus = parts.filter(Boolean).join(" ").toLowerCase();
  return lowerQuery.split(/\s+/).every(term => corpus.includes(term));
}

function requireId(value: string, label: string): string {
  const id = value.trim();
  if (!id || /[/?#]/.test(id)) throw new Error(`Invalid ${label}.`);
  return id;
}

function asRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Record<string, unknown> =>
    typeof row === "object" && row !== null);
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

type StoredNonce = TimedNonce & {
  reconnect?: true;
  connecting?: true;
};

type CompleteConnectionResult =
  | { kind: "ok"; handoff: ConnectHandoff }
  | { kind: "invalid_nonce" }
  | { kind: "error"; message: string };

type StoredAction = {
  id: number;
  testCaseId: string;
  state: "pending" | "applied" | "rejected";
  run?: unknown;
};

type ProbeUserImplProps = { userObjectId: string };

type ProbeGatekeeperImplProps = {
  userObjectId: string;
  resource: ParsedProbeResource;
};

type ConfiguratorOption = { value: string; title: string; subtitle?: string; meta?: string };

// ---------------------------------------------------------------------------
// HTTP handler

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const basePath = getBasePath(env);
    if (!url.pathname.startsWith(`${basePath}/`) && url.pathname !== basePath) {
      throw new Error(`Request path ${url.pathname} does not match BASE_URL path ${basePath}`);
    }
    const relPath = url.pathname.slice(basePath.length);
    const path = relPath.slice(1).split("/");

    if (path.length === 2 && path[0].length === 64 && path[1].length === NONCE_BYTES * 2) {
      const doId = path[0];
      const nonce = path[1];
      const stub = ctx.exports.UserAccount.get(ctx.exports.UserAccount.idFromString(doId));

      if (req.method === "GET") {
        if (!await stub.verifyNonceWithoutConsuming(nonce)) {
          return htmlResponse(INVALID_LINK_HTML, 400);
        }
        return htmlResponse(connectFormHtml(url.pathname + url.search));
      }

      if (req.method === "POST") {
        let formData: FormData;
        try {
          formData = await req.formData();
        } catch {
          return htmlResponse(connectFormHtml(url.pathname + url.search, "Invalid form submission."), 400);
        }
        const baseUrlInput = String(formData.get("baseUrl") ?? "").trim();
        const emailInput = String(formData.get("email") ?? "").trim();
        const result = await stub.completeConnection(nonce, baseUrlInput, emailInput);
        if (result.kind === "invalid_nonce") return htmlResponse(INVALID_LINK_HTML, 400);
        if (result.kind === "error") {
          return htmlResponse(connectFormHtml(url.pathname + url.search, result.message), 400);
        }
        return htmlResponse(connectHandoffPageHtml(result.handoff));
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};

// ---------------------------------------------------------------------------
// Vendor

@validateRpc()
export class GatekeeperVendor extends WorkerEntrypoint<Env> implements GatekeeperVendorIface {
  async describe(): Promise<VendorDescription> {
    return {
      displayName: "Probe",
      url: "https://github.com/YunosukeYoshino/qa-agent",
      logo: PROBE_AVATAR,
      color: "#e8f0ee",
      tagline: "Run browser tests from a URL and instruction, with evidence on the run.",
      description:
        "Connect a Probe API so Gadgets can read test cases, inspect runs, and start browser tests. " +
        "Reads return immediately. Starting a run waits for your confirmation. Local Probe " +
        "(http://127.0.0.1:8789) works without an MCP grant or MCP_ALLOW_INSECURE.",
    };
  }

  async connectAccount(callback: Fetcher<GatekeeperConnectCallback>): Promise<{ url: string }> {
    const userObjectId = this.ctx.exports.UserAccount.newUniqueId();
    const nonce = generateNonce();
    await this.ctx.exports.UserAccount.get(userObjectId).setCallback(callback, nonce);
    return { url: `${getBaseUrl(this.env)}/${userObjectId.toString()}/${nonce}` };
  }

  async getSupportedResources(): Promise<SupportedResource[]> {
    return SUPPORTED_RESOURCES;
  }

  async getTypeScriptTypes(): Promise<string> {
    return TYPES_CODE;
  }
}

// ---------------------------------------------------------------------------
// UserAccount

export class UserAccount extends DurableObject<Env> {
  async setCallback(callback: Fetcher<GatekeeperConnectCallback>, nonce: string): Promise<void> {
    if (!this.ctx.storage.kv.get<ProbeCredentials>("credentials")) {
      await this.ctx.storage.setAlarm(Date.now() + CONNECT_TIMEOUT_MS);
    }
    this.ctx.storage.kv.put("callback", callback);
    this.ctx.storage.kv.put<StoredNonce>("nonce", {
      value: nonce,
      expiresAt: Date.now() + INITIATION_NONCE_LIFETIME_MS,
    });
  }

  async prepareReconnect(nonce: string): Promise<void> {
    this.ctx.storage.kv.put("expiredNotified", false);
    this.ctx.storage.kv.put<StoredNonce>("nonce", {
      value: nonce,
      expiresAt: Date.now() + INITIATION_NONCE_LIFETIME_MS,
      reconnect: true,
    });
  }

  async verifyNonceWithoutConsuming(nonce: string): Promise<boolean> {
    const stored = this.ctx.storage.kv.get<StoredNonce>("nonce");
    return isLiveNonce(stored, nonce, Date.now());
  }

  async completeConnection(
    nonce: string,
    baseUrlInput: string,
    emailInput: string,
  ): Promise<CompleteConnectionResult> {
    const stored = this.ctx.storage.kv.get<StoredNonce>("nonce");
    if (!stored || stored.connecting || !isLiveNonce(stored, nonce, Date.now())) {
      return { kind: "invalid_nonce" };
    }
    this.ctx.storage.kv.put<StoredNonce>("nonce", { ...stored, connecting: true });

    let creds: ProbeCredentials;
    try {
      creds = await connectProbe(normalizeProbeBaseUrl(baseUrlInput), emailInput);
    } catch (error) {
      this.#releaseNonceClaim(nonce);
      logger.warn("probe connect failed", { event: "connect.failed", error });
      return {
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to connect to Probe.",
      };
    }

    this.ctx.storage.kv.delete("nonce");
    const callback = this.ctx.storage.kv.get<Fetcher<GatekeeperConnectCallback>>("callback");
    if (!callback) {
      return { kind: "error", message: "Connection callback expired. Please restart." };
    }

    let handoff: ConnectHandoff;
    if (stored.reconnect) {
      const stageId = stageCredentials<ProbeCredentials>(this.ctx.storage.kv, creds, Date.now());
      try {
        handoff = await callback.reconnectComplete(stageId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { kind: "error", message: `Failed to notify workshop: ${message}` };
      }
    } else {
      this.ctx.storage.kv.put<ProbeCredentials>("credentials", creds);
      this.ctx.storage.kv.put("expiredNotified", false);
      try {
        const props: ProbeUserImplProps = { userObjectId: this.ctx.id.toString() };
        handoff = await callback.complete(this.ctx.exports.ProbeUserImpl({ props }));
      } catch (error) {
        this.ctx.storage.kv.delete("credentials");
        const message = error instanceof Error ? error.message : String(error);
        return { kind: "error", message: `Failed to notify workshop: ${message}` };
      }
    }

    await this.ctx.storage.deleteAlarm();
    return { kind: "ok", handoff };
  }

  #releaseNonceClaim(nonce: string): void {
    const stored = this.ctx.storage.kv.get<StoredNonce>("nonce");
    if (!stored?.connecting || !isLiveNonce({ value: stored.value, expiresAt: stored.expiresAt }, nonce, Date.now())) {
      return;
    }
    const { connecting: _, ...released } = stored;
    this.ctx.storage.kv.put<StoredNonce>("nonce", released);
  }

  async commitReconnect(stageId: string): Promise<void> {
    const creds = commitStagedCredentials<ProbeCredentials>(this.ctx.storage.kv, Date.now(), stageId);
    if (!creds) throw new Error("No reconnect is awaiting confirmation. Please try again.");
    this.ctx.storage.kv.put<ProbeCredentials>("credentials", creds);
    this.ctx.storage.kv.put("expiredNotified", false);
  }

  getCredentials(): ProbeCredentials {
    const creds = this.ctx.storage.kv.get<ProbeCredentials>("credentials");
    if (!creds) throw new Error("Probe credentials are not configured for this account.");
    return creds;
  }

  async noteCredentialsExpired(): Promise<void> {
    if (this.ctx.storage.kv.get<boolean>("expiredNotified")) return;
    this.ctx.storage.kv.put("expiredNotified", true);
    const callback = this.ctx.storage.kv.get<Fetcher<GatekeeperConnectCallback>>("callback");
    if (callback) await callback.credentialsExpired();
  }

  async alarm(): Promise<void> {
    if (!this.ctx.storage.kv.get<ProbeCredentials>("credentials")) {
      await this.ctx.storage.deleteAll();
    }
  }

  async revoke(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
}

// ---------------------------------------------------------------------------
// User

@validateRpc()
export class ProbeUserImpl extends WorkerEntrypoint<Env, ProbeUserImplProps> implements GatekeeperUser {
  #userAccount() {
    return this.ctx.exports.UserAccount.get(
      this.ctx.exports.UserAccount.idFromString(this.ctx.props.userObjectId));
  }

  async describe(): Promise<AccountDescription> {
    const creds = await this.#userAccount().getCredentials();
    let displayName = "Probe";
    try {
      const me = await getMe(creds);
      displayName = `Probe (${me.email})`;
    } catch (error) {
      if (error instanceof ProbeError && error.isAuthError) {
        await this.#userAccount().noteCredentialsExpired();
      }
    }
    return {
      displayName,
      uniqueName: `${creds.email} @ ${creds.baseUrl}`,
      avatar: PROBE_AVATAR,
    };
  }

  async getAuthenticatedEmail(): Promise<string | null> {
    return null;
  }

  async getSupportedResources(): Promise<SupportedResource[]> {
    return SUPPORTED_RESOURCES;
  }

  async startResourceConfigurator(resourceUrlPattern: string): Promise<ResourceConfiguratorFrame> {
    const getCredentials = async () => await this.#userAccount().getCredentials();
    switch (resourceUrlPattern) {
      case WORKSPACE_RESOURCE.urlPattern:
        return {
          iframeHtml: WORKSPACE_CONFIGURATOR_HTML,
          ui: new RpcStub(new WorkspaceConfiguratorUI(getCredentials)),
        };
      case TEST_CASE_RESOURCE.urlPattern:
        return {
          iframeHtml: TEST_CASE_CONFIGURATOR_HTML,
          ui: new RpcStub(new TestCaseConfiguratorUI(getCredentials)),
        };
      case RUN_RESOURCE.urlPattern:
        return {
          iframeHtml: RUN_CONFIGURATOR_HTML,
          ui: new RpcStub(new RunConfiguratorUI(getCredentials)),
        };
      default:
        throw new Error(`Unsupported Probe resource: ${resourceUrlPattern}`);
    }
  }

  async getGatekeeperClassFor(url: string): Promise<{
    class: DurableObjectClass<Gatekeeper<any>>;
    resource: SupportedResource;
  }> {
    const parsed = parseProbeResourceUrl(url);
    return {
      class: this.ctx.exports.ProbeGatekeeperImpl({
        props: { userObjectId: this.ctx.props.userObjectId, resource: parsed },
      }),
      resource: resourceFor(parsed.kind),
    };
  }

  async revoke(): Promise<void> {
    await this.#userAccount().revoke();
  }

  async reconnect(): Promise<{ url: string }> {
    const nonce = generateNonce();
    await this.#userAccount().prepareReconnect(nonce);
    return { url: `${getBaseUrl(this.env)}/${this.ctx.props.userObjectId}/${nonce}` };
  }

  async commitReconnect(stageId: string): Promise<void> {
    await this.#userAccount().commitReconnect(stageId);
  }

  async ensureResources(_resourceUrlPatterns: string[]): Promise<{ url?: string }> {
    return {};
  }

  @skipRpcValidation()
  async getVerifier(): Promise<Fetcher<GatekeeperUserVerifier>> {
    return this.ctx.exports.ProbeVerifier({});
  }
}

@validateRpc()
export class ProbeVerifier extends WorkerEntrypoint<Env> implements GatekeeperUserVerifier {
  verify(): void {}
}

const configuratorCreds = new WeakMap<object, () => Promise<ProbeCredentials>>();

function credsOf(target: object): Promise<ProbeCredentials> {
  const getter = configuratorCreds.get(target);
  if (!getter) throw new Error("Configurator is not initialized.");
  return getter();
}

@validateRpc()
class WorkspaceConfiguratorUI extends RpcTarget implements ProbeWorkspaceConfiguratorRpc {
  constructor(getCredentials: () => Promise<ProbeCredentials>) {
    super();
    configuratorCreds.set(this, getCredentials);
  }

  async resourceUrl(): Promise<string> {
    return workspaceResourceUrl();
  }

  async describeWorkspace(): Promise<{ baseUrl: string; email: string }> {
    const creds = await credsOf(this);
    return { baseUrl: creds.baseUrl, email: creds.email };
  }
}

@validateRpc()
class TestCaseConfiguratorUI extends RpcTarget implements ProbeTestCaseConfiguratorRpc {
  constructor(getCredentials: () => Promise<ProbeCredentials>) {
    super();
    configuratorCreds.set(this, getCredentials);
  }

  async listTestCases(query: string): Promise<ConfiguratorOption[]> {
    const creds = await credsOf(this);
    const rows = asRecords(await listTestCases(creds));
    const options: ConfiguratorOption[] = [];
    for (const row of rows) {
      const value = stringField(row, "id");
      if (!value) continue;
      const title = stringField(row, "name") || value;
      const subtitle = stringField(row, "baseUrl");
      if (!optionMatches([title, subtitle, value], query)) continue;
      options.push({ value, title, subtitle, meta: stringField(row, "status") || undefined });
      if (options.length >= AUTOCOMPLETE_LIMIT) break;
    }
    return options;
  }
}

@validateRpc()
class RunConfiguratorUI extends RpcTarget implements ProbeRunConfiguratorRpc {
  constructor(getCredentials: () => Promise<ProbeCredentials>) {
    super();
    configuratorCreds.set(this, getCredentials);
  }

  async listRuns(query: string): Promise<ConfiguratorOption[]> {
    const creds = await credsOf(this);
    const rows = asRecords(await listRuns(creds));
    const options: ConfiguratorOption[] = [];
    for (const row of rows) {
      const value = stringField(row, "id");
      if (!value) continue;
      const status = stringField(row, "status");
      const summary = stringField(row, "summary");
      const testCaseId = stringField(row, "testCaseId");
      const title = [status, summary || value].filter(Boolean).join(" · ");
      if (!optionMatches([title, testCaseId, value], query)) continue;
      options.push({
        value,
        title,
        subtitle: testCaseId ? `test case ${testCaseId}` : undefined,
        meta: stringField(row, "createdAt") || undefined,
      });
      if (options.length >= AUTOCOMPLETE_LIMIT) break;
    }
    return options;
  }
}

// ---------------------------------------------------------------------------
// Gatekeeper facet

@validateRpc()
export class ProbeGatekeeperImpl extends DurableObject<Env, ProbeGatekeeperImplProps>
  implements Gatekeeper<ProbeWorkspaceSession | ProbeTestCaseSession | ProbeRunSession>
{
  #userAccount() {
    return this.ctx.exports.UserAccount.get(
      this.ctx.exports.UserAccount.idFromString(this.ctx.props.userObjectId));
  }

  async #handleAuth(error: unknown): Promise<void> {
    if (error instanceof ProbeError && error.isAuthError) {
      await this.#userAccount().noteCredentialsExpired();
    }
  }

  #nextActionId(): number {
    const next = (this.ctx.storage.kv.get<number>("nextActionId") ?? 1) | 0;
    this.ctx.storage.kv.put("nextActionId", next + 1);
    return next;
  }

  #putAction(action: StoredAction): void {
    this.ctx.storage.kv.put<StoredAction>(`action:${action.id}`, action);
  }

  #getAction(actionId: number): StoredAction | undefined {
    return this.ctx.storage.kv.get<StoredAction>(`action:${actionId}`);
  }

  async describe(): Promise<ResourceDescription> {
    const creds = await this.#userAccount().getCredentials();
    const resource = this.ctx.props.resource;
    if (resource.kind === "workspace") {
      return {
        url: creds.baseUrl,
        title: "Probe workspace",
        snippet: `Probe at ${creds.baseUrl}`,
        suggestedBindingName: "PROBE",
        tsType: "ProbeWorkspaceSession",
      };
    }
    if (resource.kind === "test-case") {
      let name = resource.testCaseId;
      try {
        const testCase = await getTestCase(creds, resource.testCaseId) as { name?: unknown };
        if (typeof testCase?.name === "string" && testCase.name) name = testCase.name;
      } catch (error) {
        await this.#handleAuth(error);
      }
      return {
        url: testCaseResourceUrl(resource.testCaseId),
        title: `Test case: ${name}`,
        snippet: `Probe test case \`${resource.testCaseId}\`.`,
        suggestedBindingName: "PROBE_TEST_CASE",
        tsType: "ProbeTestCaseSession",
      };
    }
    return {
      url: runResourceUrl(resource.runId),
      title: `Run: ${resource.runId}`,
      snippet: `Probe run \`${resource.runId}\`.`,
      suggestedBindingName: "PROBE_RUN",
      tsType: "ProbeRunSession",
    };
  }

  async getTypeScriptTypes(): Promise<string> {
    return TYPES_CODE;
  }

  async getAutoApprovableActions() {
    return [];
  }

  async startSession(
    approvalQueue: RpcStub<ApprovalQueue>,
  ): Promise<ProbeWorkspaceSession | ProbeTestCaseSession | ProbeRunSession> {
    const ctx = this.#sessionContext(approvalQueue.dup());
    switch (this.ctx.props.resource.kind) {
      case "workspace":
        return new WorkspaceSession(ctx);
      case "test-case":
        return new TestCaseSession(ctx, this.ctx.props.resource.testCaseId);
      case "run":
        return new RunSession(ctx, this.ctx.props.resource.runId);
    }
  }

  async applyAction(actionId: number): Promise<void> {
    const stored = this.#getAction(actionId);
    if (stored?.state === "applied") return;
    if (!stored || stored.state !== "pending") {
      throw new Error(`No queued Probe action exists with id ${actionId}.`);
    }
    const creds = await this.#userAccount().getCredentials();
    try {
      stored.run = await startRun(creds, stored.testCaseId);
    } catch (error) {
      await this.#handleAuth(error);
      throw error;
    }
    stored.state = "applied";
    this.#putAction(stored);
  }

  async rejectAction(actionId: number): Promise<void> {
    const stored = this.#getAction(actionId);
    if (!stored) return;
    stored.state = "rejected";
    this.#putAction(stored);
  }

  async revertAction(_actionId: number): Promise<{ message: string }> {
    return { message: "Probe runs cannot be undone once started." };
  }

  async addObserver(_id: string, _user: Fetcher<GatekeeperUserVerifier>): Promise<void> {
    throw new Error(
      "a workspace that reads from Probe can only be opened by its owner, because there is no " +
      "way to check whether anyone else is allowed to see what it read. Publish it as a blueprint " +
      "instead, so each person connects their own Probe.",
    );
  }

  async removeObserver(_id: string): Promise<void> {}

  #sessionContext(queue: RpcStub<ApprovalQueue>): SessionContext {
    const self = this;
    return {
      queue,
      resource: this.ctx.props.resource,
      async creds() {
        return await self.#userAccount().getCredentials();
      },
      async handleAuth(error: unknown) {
        await self.#handleAuth(error);
      },
      lookupAction(actionId: number) {
        return actionResult(self.#getAction(actionId), actionId);
      },
      async submitStartRun(testCaseId: string) {
        const creds = await self.#userAccount().getCredentials();
        let testCase: ProbeTestCase;
        try {
          testCase = await getTestCase(creds, testCaseId) as ProbeTestCase;
        } catch (error) {
          await self.#handleAuth(error);
          throw error;
        }
        const me = await getMe(creds).catch(async error => {
          await self.#handleAuth(error);
          throw error;
        });
        if (!canStartRun(me.role)) {
          throw new Error("This Probe user cannot start runs.");
        }
        if (self.ctx.props.resource.kind === "test-case"
            && testCase.id !== self.ctx.props.resource.testCaseId) {
          throw new Error("This binding cannot start runs of other test cases.");
        }
        if (self.ctx.props.resource.kind === "run") {
          throw new Error("A run binding cannot start new runs.");
        }
        const id = self.#nextActionId();
        self.#putAction({ id, testCaseId, state: "pending" });
        try {
          await queue.submitAction(id, describeStartRun({
            id: testCase.id,
            name: testCase.name,
            baseUrl: testCase.baseUrl,
          }));
        } catch (error) {
          self.ctx.storage.kv.delete(`action:${id}`);
          throw error;
        }
        return actionResult(self.#getAction(id), id);
      },
    };
  }
}

type SessionContext = {
  queue: RpcStub<ApprovalQueue>;
  resource: ParsedProbeResource;
  creds(): Promise<ProbeCredentials>;
  handleAuth(error: unknown): Promise<void>;
  submitStartRun(testCaseId: string): Promise<ProbeStartRunResult>;
  lookupAction(actionId: number): ProbeStartRunResult;
};

function actionResult(stored: StoredAction | undefined, actionId: number): ProbeStartRunResult {
  if (!stored) throw new Error(`No Probe action with id ${actionId}.`);
  if (stored.state === "pending") {
    return {
      status: "pending",
      actionId,
      message:
        "Starting this Probe run needs confirmation. Return from executeCode so the prompt can " +
        `appear in chat. After approval, call getActionResult(${actionId}) for the queued run.`,
    };
  }
  if (stored.state === "rejected") {
    return { status: "rejected", actionId, message: "The Probe run was not started." };
  }
  return { status: "ok", run: stored.run as ProbeRunSummary };
}

function pageSlice<T>(rows: T[], limit?: number, offset?: number): T[] {
  const start = Math.max(0, offset ?? 0);
  const size = Math.min(100, Math.max(1, limit ?? 20));
  return rows.slice(start, start + size);
}

async function observe<T>(
  ctx: SessionContext,
  title: string,
  description: string,
  fn: () => Promise<T>,
): Promise<T> {
  let value: T;
  try {
    value = await fn();
  } catch (error) {
    await ctx.handleAuth(error);
    throw error;
  }
  await ctx.queue.authorizeObservation({ title, description });
  return value;
}

class WorkspaceSession extends RpcTarget implements ProbeWorkspaceSession {
  #ctx: SessionContext;
  constructor(ctx: SessionContext) {
    super();
    this.#ctx = ctx;
  }

  async getMe(): Promise<ProbePrincipal> {
    return await observe(this.#ctx, "Read Probe user", "Read the signed-in Probe principal.",
      async () => await getMe(await this.#ctx.creds()));
  }

  async listTestCases(): Promise<ProbeTestCase[]> {
    return await observe(this.#ctx, "List Probe test cases", "List test cases in the Probe workspace.",
      async () => await listTestCases(await this.#ctx.creds()) as ProbeTestCase[]);
  }

  async getTestCase(testCaseId: string): Promise<ProbeTestCase> {
    const id = requireId(testCaseId, "test case id");
    return await observe(this.#ctx, "Read Probe test case", `Read Probe test case \`${id}\`.`,
      async () => await getTestCase(await this.#ctx.creds(), id) as ProbeTestCase);
  }

  async listRuns(): Promise<ProbeRunSummary[]> {
    return await observe(this.#ctx, "List Probe runs", "List runs in the Probe workspace.",
      async () => await listRuns(await this.#ctx.creds()) as ProbeRunSummary[]);
  }

  async getRun(runId: string): Promise<ProbeRun> {
    const id = requireId(runId, "run id");
    return await observe(this.#ctx, "Read Probe run", `Read Probe run \`${id}\`.`,
      async () => await getRun(await this.#ctx.creds(), id) as ProbeRun);
  }

  async startRun(testCaseId: string): Promise<ProbeStartRunResult> {
    return await this.#ctx.submitStartRun(requireId(testCaseId, "test case id"));
  }

  async getActionResult(actionId: number): Promise<ProbeStartRunResult> {
    if (!Number.isInteger(actionId)) throw new Error("getActionResult() requires an action id.");
    return this.#ctx.lookupAction(actionId);
  }
}

class TestCaseSession extends RpcTarget implements ProbeTestCaseSession {
  #ctx: SessionContext;
  #testCaseId: string;
  constructor(ctx: SessionContext, testCaseId: string) {
    super();
    this.#ctx = ctx;
    this.#testCaseId = testCaseId;
  }

  async getTestCase(): Promise<ProbeTestCase> {
    const id = this.#testCaseId;
    return await observe(this.#ctx, "Read Probe test case", `Read Probe test case \`${id}\`.`,
      async () => await getTestCase(await this.#ctx.creds(), id) as ProbeTestCase);
  }

  async listRuns(limit?: number, offset?: number): Promise<ProbeRunSummary[]> {
    const id = this.#testCaseId;
    return await observe(this.#ctx, "List Probe runs", `List runs of Probe test case \`${id}\`.`,
      async () => {
        const rows = await listRuns(await this.#ctx.creds()) as ProbeRunSummary[];
        return pageSlice(rows.filter(row => row.testCaseId === id), limit, offset);
      });
  }

  async getRun(runId: string): Promise<ProbeRun> {
    const id = requireId(runId, "run id");
    return await observe(this.#ctx, "Read Probe run", `Read Probe run \`${id}\`.`, async () => {
      const run = await getRun(await this.#ctx.creds(), id) as ProbeRun;
      if (run.testCaseId !== this.#testCaseId) throw new Error("Run not found in this binding.");
      return run;
    });
  }

  async startRun(): Promise<ProbeStartRunResult> {
    return await this.#ctx.submitStartRun(this.#testCaseId);
  }

  async getActionResult(actionId: number): Promise<ProbeStartRunResult> {
    if (!Number.isInteger(actionId)) throw new Error("getActionResult() requires an action id.");
    return this.#ctx.lookupAction(actionId);
  }
}

class RunSession extends RpcTarget implements ProbeRunSession {
  #ctx: SessionContext;
  #runId: string;
  constructor(ctx: SessionContext, runId: string) {
    super();
    this.#ctx = ctx;
    this.#runId = runId;
  }

  async getRun(): Promise<ProbeRun> {
    const id = this.#runId;
    return await observe(this.#ctx, "Read Probe run", `Read Probe run \`${id}\`.`, async () => {
      const run = await getRun(await this.#ctx.creds(), id) as ProbeRun;
      if (run.id !== id) throw new Error("Run not found in this binding.");
      return run;
    });
  }
}
