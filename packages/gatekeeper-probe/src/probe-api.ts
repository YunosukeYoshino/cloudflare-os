import { HttpError } from "@gadgets/gatekeeper-kit/http-errors";
import { stripTrailingSlashes } from "@gadgets/workshop-shared/gatekeeper";

export const SESSION_COOKIE_NAME = "probe_session";
export const CSRF_COOKIE_NAME = "probe_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

const REQUEST_TIMEOUT_MS = 15_000;
const ERROR_BODY_MAX_BYTES = 200;

const METADATA_HOSTS = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.goog",
]);

/** Session cookie + CSRF pair stored for one connected Probe account. */
export type ProbeCredentials = {
  baseUrl: string;
  email: string;
  sessionToken: string;
  csrfToken: string;
};

/** Signed-in Probe principal. */
export type ProbePrincipal = {
  userId: string;
  workspaceId: string;
  email: string;
  displayName: string;
  role: "owner" | "member" | "viewer";
};

/** Probe HTTP error. 401 means the stored session is no longer valid. */
export class ProbeError extends HttpError {
  readonly isAuthError: boolean;

  constructor(status: number, message: string) {
    super(status, message);
    this.name = "ProbeError";
    this.isAuthError = status === 401;
  }
}

/** True when this role may enqueue runs (`canWriteWorkspace` on Probe). */
export function canStartRun(role: ProbePrincipal["role"]): boolean {
  return role === "owner" || role === "member";
}

/**
 * Canonical Probe API origin + path, with no trailing slash, query, or fragment.
 * Allows http for loopback (Probe's default is `http://127.0.0.1:8789`).
 */
export function normalizeProbeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Probe URL is not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Probe URL must use http:// or https://.");
  }
  if (url.username || url.password) {
    throw new Error("Probe URL must not include credentials.");
  }
  const host = url.hostname.toLowerCase();
  if (METADATA_HOSTS.has(host) || host.endsWith(".metadata.google.internal")) {
    throw new Error("That host is not allowed.");
  }
  return `${url.origin}${stripTrailingSlashes(url.pathname)}`;
}

/** Reads a cookie value from one `Set-Cookie` header. */
export function cookieFromSetCookie(header: string, name: string): string | undefined {
  const first = header.split(";", 1)[0]?.trim() ?? "";
  const eq = first.indexOf("=");
  if (eq === -1) return undefined;
  if (first.slice(0, eq) !== name) return undefined;
  const value = first.slice(eq + 1);
  return value.length > 0 ? value : undefined;
}

/** First matching cookie across `Set-Cookie` headers. */
export function pickCookie(headers: readonly string[], name: string): string | undefined {
  for (const header of headers) {
    const value = cookieFromSetCookie(header, name);
    if (value) return value;
  }
  return undefined;
}

function joinUrl(baseUrl: string, path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${suffix}`;
}

function sanitizeErrorBody(text: string): string {
  return text.slice(0, ERROR_BODY_MAX_BYTES).replace(/\s+/g, " ").trim()
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, "Bearer [redacted]");
}

function cookieHeader(creds: Pick<ProbeCredentials, "sessionToken" | "csrfToken">): string {
  return `${SESSION_COOKIE_NAME}=${creds.sessionToken}; ${CSRF_COOKIE_NAME}=${creds.csrfToken}`;
}

type JsonRequestInit = {
  method: string;
  cookie?: string;
  csrfToken?: string;
  body?: unknown;
};

type JsonResponse<T> = {
  status: number;
  body: T;
  setCookies: string[];
};

async function jsonRequest<T>(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  init: JsonRequestInit,
): Promise<JsonResponse<T>> {
  const headers = new Headers();
  if (init.cookie) headers.set("Cookie", init.cookie);
  if (init.csrfToken) headers.set(CSRF_HEADER_NAME, init.csrfToken);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetchImpl(joinUrl(baseUrl, path), {
      method: init.method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ProbeError(502, `Unable to reach Probe: ${message}`);
  }

  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];
  const text = await response.text();
  let body: T = undefined as T;
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as T;
    } catch {
      if (!response.ok) {
        throw new ProbeError(response.status, sanitizeErrorBody(text) || `Probe HTTP ${response.status}`);
      }
      throw new ProbeError(502, "Probe returned a non-JSON response.");
    }
  }
  if (!response.ok) {
    const errBody = body as { error?: unknown } | undefined;
    const message = typeof errBody?.error === "string" && errBody.error.length > 0
      ? errBody.error
      : `Probe HTTP ${response.status}`;
    throw new ProbeError(response.status, message);
  }
  return { status: response.status, body, setCookies };
}

function authedInit(
  creds: ProbeCredentials,
  method: string,
  body?: unknown,
): JsonRequestInit {
  return {
    method,
    cookie: cookieHeader(creds),
    csrfToken: method === "GET" || method === "HEAD" ? undefined : creds.csrfToken,
    body,
  };
}

/**
 * Signs into Probe at `baseUrl` with the fake-identity email flow and returns stored credentials.
 */
export async function connectProbe(
  baseUrl: string,
  email: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeCredentials> {
  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail || !trimmedEmail.includes("@")) {
    throw new Error("Enter the email Probe should sign in as.");
  }

  const health = await jsonRequest<{ ok?: unknown }>(fetchImpl, baseUrl, "/api/health", {
    method: "GET",
  });
  if (health.body?.ok !== true) {
    throw new ProbeError(502, "That URL did not respond as a Probe API.");
  }

  const csrf = await jsonRequest<{ csrfToken?: unknown }>(fetchImpl, baseUrl, "/api/auth/csrf", {
    method: "GET",
  });
  const csrfCookie = pickCookie(csrf.setCookies, CSRF_COOKIE_NAME);
  const csrfToken = typeof csrf.body?.csrfToken === "string" && csrf.body.csrfToken.length > 0
    ? csrf.body.csrfToken
    : csrfCookie;
  if (!csrfCookie || !csrfToken) {
    throw new ProbeError(502, "Probe did not issue a CSRF token.");
  }

  const signedIn = await jsonRequest<{ principal?: unknown; csrfToken?: unknown }>(
    fetchImpl,
    baseUrl,
    "/api/auth/sign-in",
    {
      method: "POST",
      cookie: `${CSRF_COOKIE_NAME}=${csrfCookie}`,
      csrfToken,
      body: { email: trimmedEmail },
    },
  );
  const sessionToken = pickCookie(signedIn.setCookies, SESSION_COOKIE_NAME);
  const nextCsrf = pickCookie(signedIn.setCookies, CSRF_COOKIE_NAME)
    ?? (typeof signedIn.body?.csrfToken === "string" ? signedIn.body.csrfToken : csrfToken);
  if (!sessionToken) {
    throw new ProbeError(502, "Probe did not issue a session cookie.");
  }

  const creds: ProbeCredentials = {
    baseUrl,
    email: trimmedEmail,
    sessionToken,
    csrfToken: nextCsrf,
  };
  await getMe(creds, fetchImpl);
  return creds;
}

/** `GET /api/auth/me`. */
export async function getMe(
  creds: ProbeCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<ProbePrincipal> {
  const result = await jsonRequest<{ principal?: ProbePrincipal }>(
    fetchImpl, creds.baseUrl, "/api/auth/me", authedInit(creds, "GET"),
  );
  const principal = result.body?.principal;
  if (!principal || typeof principal.email !== "string") {
    throw new ProbeError(502, "Probe did not return the signed-in user.");
  }
  return principal;
}

/** `GET /api/test-cases`. */
export async function listTestCases(
  creds: ProbeCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const result = await jsonRequest(fetchImpl, creds.baseUrl, "/api/test-cases", authedInit(creds, "GET"));
  return result.body;
}

/** `GET /api/test-cases/:id`. */
export async function getTestCase(
  creds: ProbeCredentials,
  testCaseId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const result = await jsonRequest(
    fetchImpl, creds.baseUrl, `/api/test-cases/${encodeURIComponent(testCaseId)}`,
    authedInit(creds, "GET"),
  );
  return result.body;
}

/** `GET /api/test-runs`. */
export async function listRuns(
  creds: ProbeCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const result = await jsonRequest(fetchImpl, creds.baseUrl, "/api/test-runs", authedInit(creds, "GET"));
  return result.body;
}

/** `GET /api/test-runs/:id` plus events. */
export async function getRun(
  creds: ProbeCredentials,
  runId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const encoded = encodeURIComponent(runId);
  const run = await jsonRequest<Record<string, unknown>>(
    fetchImpl, creds.baseUrl, `/api/test-runs/${encoded}`, authedInit(creds, "GET"),
  );
  let events: unknown = [];
  try {
    const listed = await jsonRequest(
      fetchImpl, creds.baseUrl, `/api/test-runs/${encoded}/events`, authedInit(creds, "GET"),
    );
    events = listed.body;
  } catch (error) {
    if (!(error instanceof ProbeError && error.status === 404)) throw error;
  }
  return { ...run.body, events };
}

/** `POST /api/test-cases/:id/runs`. */
export async function startRun(
  creds: ProbeCredentials,
  testCaseId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const result = await jsonRequest(
    fetchImpl,
    creds.baseUrl,
    `/api/test-cases/${encodeURIComponent(testCaseId)}/runs`,
    authedInit(creds, "POST"),
  );
  return result.body;
}
