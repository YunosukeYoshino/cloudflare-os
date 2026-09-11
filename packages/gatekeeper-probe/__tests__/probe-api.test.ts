import { describe, expect, it, vi } from "vitest";

import {
  canStartRun,
  connectProbe,
  cookieFromSetCookie,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  getRun,
  listRuns,
  listTestCases,
  normalizeProbeBaseUrl,
  pickCookie,
  ProbeError,
  SESSION_COOKIE_NAME,
  startRun,
} from "../src/probe-api.js";

describe("normalizeProbeBaseUrl", () => {
  it("strips a trailing slash and keeps an explicit port", () => {
    expect(normalizeProbeBaseUrl("http://127.0.0.1:8789/")).toBe("http://127.0.0.1:8789");
    expect(normalizeProbeBaseUrl("https://probe.example.com/api/")).toBe("https://probe.example.com/api");
  });

  it("allows loopback HTTP", () => {
    expect(normalizeProbeBaseUrl("http://localhost:8789")).toBe("http://localhost:8789");
  });

  it("rejects credentials, non-http schemes, and cloud metadata hosts", () => {
    expect(() => normalizeProbeBaseUrl("http://user:pass@127.0.0.1:8789")).toThrow(/credentials/);
    expect(() => normalizeProbeBaseUrl("javascript:alert(1)")).toThrow(/http:\/\/ or https:\/\//);
    expect(() => normalizeProbeBaseUrl("http://169.254.169.254/latest")).toThrow(/not allowed/);
  });
});

describe("cookie parsing", () => {
  it("reads Probe session and CSRF cookies from Set-Cookie", () => {
    const headers = [
      `${SESSION_COOKIE_NAME}=sess-1; Path=/; HttpOnly; Secure`,
      `${CSRF_COOKIE_NAME}=csrf-1; Path=/; Secure`,
    ];
    expect(pickCookie(headers, SESSION_COOKIE_NAME)).toBe("sess-1");
    expect(pickCookie(headers, CSRF_COOKIE_NAME)).toBe("csrf-1");
    expect(cookieFromSetCookie(headers[0]!, "other")).toBeUndefined();
  });
});

describe("canStartRun", () => {
  it("matches Probe write policy", () => {
    expect(canStartRun("owner")).toBe(true);
    expect(canStartRun("member")).toBe(true);
    expect(canStartRun("viewer")).toBe(false);
  });
});

type MockCall = {
  url: string;
  method: string;
  cookie?: string | null;
  csrf?: string | null;
  body?: unknown;
};

function jsonResponse(status: number, body: unknown, setCookies: string[] = []): Response {
  const headers = new Headers({ "content-type": "application/json" });
  for (const cookie of setCookies) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function mockProbeFetch(script: (call: MockCall) => Response): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const call: MockCall = {
      url,
      method: init?.method ?? "GET",
      cookie: headers.get("Cookie"),
      csrf: headers.get(CSRF_HEADER_NAME),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    return script(call);
  }) as unknown as typeof fetch;
}

describe("connectProbe", () => {
  it("signs in over health + csrf + session cookies", async () => {
    const fetchImpl = mockProbeFetch(call => {
      if (call.url.endsWith("/api/health")) return jsonResponse(200, { ok: true });
      if (call.url.endsWith("/api/auth/csrf")) {
        return jsonResponse(200, { csrfToken: "csrf-token" }, [
          `${CSRF_COOKIE_NAME}=csrf-token; Path=/`,
        ]);
      }
      if (call.url.endsWith("/api/auth/sign-in")) {
        expect(call.csrf).toBe("csrf-token");
        expect(call.cookie).toContain(`${CSRF_COOKIE_NAME}=csrf-token`);
        expect(call.body).toEqual({ email: "you@example.com" });
        return jsonResponse(200, {
          principal: { email: "you@example.com", role: "owner" },
          csrfToken: "csrf-2",
        }, [
          `${SESSION_COOKIE_NAME}=sess; Path=/`,
          `${CSRF_COOKIE_NAME}=csrf-2; Path=/`,
        ]);
      }
      if (call.url.endsWith("/api/auth/me")) {
        expect(call.cookie).toContain(`${SESSION_COOKIE_NAME}=sess`);
        return jsonResponse(200, {
          principal: {
            userId: "u1",
            workspaceId: "w1",
            email: "you@example.com",
            displayName: "You",
            role: "owner",
          },
        });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const creds = await connectProbe("http://127.0.0.1:8789", "you@example.com", fetchImpl);
    expect(creds).toEqual({
      baseUrl: "http://127.0.0.1:8789",
      email: "you@example.com",
      sessionToken: "sess",
      csrfToken: "csrf-2",
    });
  });

  it("rejects an email Probe cannot sign in as", async () => {
    await expect(connectProbe("http://127.0.0.1:8789", "not-an-email"))
      .rejects.toThrow(/email/);
  });

  it("rejects a host that is not Probe", async () => {
    const fetchImpl = mockProbeFetch(() => jsonResponse(200, { ok: false }));
    await expect(connectProbe("http://127.0.0.1:9", "a@b.c", fetchImpl))
      .rejects.toThrow(/did not respond as a Probe API/);
  });
});

describe("authenticated calls", () => {
  const creds = {
    baseUrl: "http://127.0.0.1:8789",
    email: "you@example.com",
    sessionToken: "sess",
    csrfToken: "csrf",
  };

  it("returns Probe's test-case and run list arrays", async () => {
    const fetchImpl = mockProbeFetch(call => {
      if (call.url.endsWith("/api/test-cases")) {
        return jsonResponse(200, [{ id: "t1", name: "Login" }]);
      }
      if (call.url.endsWith("/api/test-runs")) {
        return jsonResponse(200, [{ id: "r1", testCaseId: "t1", status: "queued" }]);
      }
      throw new Error(`unexpected ${call.url}`);
    });
    await expect(listTestCases(creds, fetchImpl)).resolves.toEqual([
      { id: "t1", name: "Login" },
    ]);
    await expect(listRuns(creds, fetchImpl)).resolves.toEqual([
      { id: "r1", testCaseId: "t1", status: "queued" },
    ]);
  });

  it("merges run events onto getRun", async () => {
    const fetchImpl = mockProbeFetch(call => {
      if (call.url.endsWith("/api/test-runs/r1") && !call.url.endsWith("/events")) {
        return jsonResponse(200, { id: "r1", testCaseId: "t1", status: "passed", steps: [] });
      }
      if (call.url.endsWith("/api/test-runs/r1/events")) {
        return jsonResponse(200, [{ id: "e1", type: "run.completed" }]);
      }
      throw new Error(`unexpected ${call.url}`);
    });
    await expect(getRun(creds, "r1", fetchImpl)).resolves.toEqual({
      id: "r1",
      testCaseId: "t1",
      status: "passed",
      steps: [],
      events: [{ id: "e1", type: "run.completed" }],
    });
  });

  it("sends CSRF on startRun and surfaces Probe errors", async () => {
    const fetchImpl = mockProbeFetch(call => {
      expect(call.method).toBe("POST");
      expect(call.csrf).toBe("csrf");
      expect(call.url.endsWith("/api/test-cases/t1/runs")).toBe(true);
      return jsonResponse(403, { error: "Forbidden" });
    });
    await expect(startRun(creds, "t1", fetchImpl)).rejects.toMatchObject({
      name: "ProbeError",
      status: 403,
      message: "Forbidden",
    } satisfies Partial<ProbeError>);
  });
});
