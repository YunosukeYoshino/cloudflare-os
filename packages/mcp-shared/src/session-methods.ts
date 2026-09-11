// Gives a session a named method per tool, so a Gadget writes `env.LINEAR.listIssues({...})` rather
// than `env.LINEAR.callTool("list_issues", {...})`. The runtime half of `schema-to-ts.ts`.
//
// Methods go on a prototype, never as own properties, since Cap'n Web and Workers RPC both refuse
// own properties on an `RpcTarget`. Each is a one-line delegate to `callTool`, so the scope check,
// approval queue, and observation record stay in one place and the delegates inherit the
// `@validateRpc()` checking applied there.
//
// Two names are installed when they differ: the MCP wire name (`get_test_case`) when it is a usable
// identifier, and a camelCase alias (`getTestCase`). `listTools` reports the wire name, and models
// call that as RPC; advertising only the alias made `binding.get_test_case()` fail even though
// `binding.getTestCase()` and `binding.callTool("get_test_case")` both worked.

import type { ClassifiedTool } from "./tools.js";

/**
 * Method names that must never be generated. The first group is measured: an `RpcStub` intercepts
 * these or resolves them to something other than the target's method, so a tool named after one
 * would appear to exist and then misbehave. The second is the session's own surface.
 */
export const RESERVED_METHOD_NAMES: ReadonlySet<string> = new Set([
  // Intercepted or hijacked by the RPC stub itself.
  "then", "catch", "finally", "dup", "onRpcBroken", "constructor", "toString", "valueOf",
  "hasOwnProperty", "__proto__", "map",
  // The session's own methods.
  "callTool", "getActionResult", "listTools",
]);

/**
 * True when `name` can be installed as an RPC method: a JavaScript identifier the stub will not
 * intercept. Wire names that fail this stay reachable through `callTool` and, when camel-casing
 * produces a different usable identifier, through that alias.
 */
export function isUsableMethodName(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !RESERVED_METHOD_NAMES.has(name);
}

/**
 * Converts an MCP tool name to a JavaScript method name: `list_issues` -> `listIssues`. Null when
 * the name cannot become a usable identifier; servers are free to name tools anything.
 */
export function toMethodName(wireName: string): string | null {
  const parts = wireName.split(/[^A-Za-z0-9]+/).filter(part => part.length > 0);
  if (parts.length === 0) return null;

  const [first, ...rest] = parts;
  const name = first[0].toLowerCase() + first.slice(1) +
    rest.map(part => part[0].toUpperCase() + part.slice(1)).join("");

  // A leading digit cannot start an identifier, and a name the agent cannot type in the generated
  // `.d.ts` is not worth having. Such tools remain reachable through `callTool`.
  return isUsableMethodName(name) ? name : null;
}

/**
 * Maps generated method name to wire tool name, for the tools that can have one.
 *
 * Wire names that are usable identifiers are installed first, so `listTools` names and the method
 * the agent types match. CamelCase aliases are added when they would not shadow a different tool's
 * wire name. Both sides of a remaining camelCase collision are dropped: with `list_issues` and
 * `listIssues` both published, one shadowing the other would send a Gadget to a tool it did not
 * mean, while each tool's own wire name (when usable) and `callTool` keep them distinct.
 */
export function toolMethodNames(tools: ClassifiedTool[]): Map<string, string> {
  const names = new Map<string, string>();

  for (const { tool } of tools) {
    if (isUsableMethodName(tool.name)) names.set(tool.name, tool.name);
  }

  const claims = new Map<string, string[]>();
  for (const { tool } of tools) {
    const method = toMethodName(tool.name);
    if (method === null || names.has(method)) continue;
    const existing = claims.get(method);
    if (existing) existing.push(tool.name);
    else claims.set(method, [tool.name]);
  }

  for (const [method, wireNames] of claims) {
    if (wireNames.length === 1) names.set(method, wireNames[0]);
  }
  return names;
}

/**
 * Method names installed for one wire tool, wire name first when it is one of them so describeBinding
 * lists the name `listTools` reports before the camelCase alias.
 */
export function methodsForTool(methodNames: Map<string, string>, wire: string): string[] {
  const methods: string[] = [];
  for (const [method, mapped] of methodNames) {
    if (mapped === wire) methods.push(method);
  }
  return methods.toSorted((a, b) => {
    if (a === wire) return -1;
    if (b === wire) return 1;
    return a.localeCompare(b);
  });
}

// A class whose instances have a `callTool` method, which is all the generated delegates need.
type CallsTools = { callTool(name: string, args?: Record<string, unknown>): unknown };

// Constructor shape of a class that can be extended here. `any[]` because TypeScript requires
// exactly this of a mixin base (TS2545); the constructor arguments are never touched.
type SessionBase = abstract new (...args: any[]) => CallsTools;

/**
 * Returns a subclass of `Base` carrying one method per tool. `Base` is untouched, so a session built
 * from it directly still works when the tool list cannot be fetched at all.
 */
export function installToolMethods<T extends SessionBase>(Base: T, tools: ClassifiedTool[]): T {
  // An anonymous subclass, so the prototype this mutates cannot be one anything else shares.
  abstract class WithTools extends Base {}

  for (const [method, wireName] of toolMethodNames(tools)) {
    Object.defineProperty(WithTools.prototype, method, {
      value: function(this: CallsTools, args?: Record<string, unknown>) {
        return this.callTool(wireName, args);
      },
      // Not enumerable, matching how class methods are declared.
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }

  return WithTools as unknown as T;
}
