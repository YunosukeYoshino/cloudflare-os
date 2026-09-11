import {
  escapeHtml,
  PAGE_STYLE,
} from "@gadgets/gatekeeper-kit/connect-pages";

const FORM_STYLE = `
  label { display: block; font-size: 14px; font-weight: 600; color: var(--strong); margin: 0 0 6px; }
  p.hint { margin: 6px 0 0; font-size: 13px; color: var(--subtle); }

  input { width: 100%; box-sizing: border-box; padding: 9px 11px; font: inherit;
          background: var(--control); color: var(--text);
          border: 1px solid var(--line); border-radius: 8px; }
  input::placeholder { color: var(--subtle); }
  input:focus { outline: 0; border-color: var(--brand);
                box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 22%, transparent); }

  button { width: 100%; margin-top: 20px; padding: 10px; border: 0; border-radius: 8px;
           background: var(--contrast); color: var(--on-contrast); font: inherit; font-weight: 600;
           cursor: pointer; }
  button:hover { opacity: .9; }
`;

/** Connect form: Probe API origin + the email Probe's fake identity will sign in as. */
export function connectFormHtml(path: string, error?: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Probe</title><style>${PAGE_STYLE}${FORM_STYLE}</style></head>
<body><main>
  <h1>Connect Probe</h1>
  <p class="sub">Point this at a Probe API (local default
  <code>http://127.0.0.1:8789</code>) and sign in with the email Probe should use.</p>
  ${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
  <form method="POST" action="${escapeHtml(path)}">
    <label for="baseUrl">Probe API URL</label>
    <input id="baseUrl" type="url" name="baseUrl" required autofocus
           placeholder="http://127.0.0.1:8789" value="http://127.0.0.1:8789">
    <p class="hint">Include the protocol. No trailing slash. Loopback HTTP is expected for local Probe.</p>
    <label for="email" style="margin-top:16px">Email</label>
    <input id="email" type="email" name="email" required placeholder="you@example.com">
    <p class="hint">Local Probe uses fake identity: that email is provisioned on first sign-in.
    No Probe MCP grant is required.</p>
    <button type="submit">Connect</button>
  </form>
</main></body></html>`;
}
