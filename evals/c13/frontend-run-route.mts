// @ts-nocheck
// Offline: the REAL dedicated route handler (app/api/frontend/[workflowId]/run) with access facts and the execute route stubbed.
import Module from "node:module"; import { createRequire } from "node:module";
const r = createRequire(import.meta.url);
const map: [RegExp, string][] = [[/^server-only$/, r.resolve("../../evals/semantic/stubs/server-only.ts")], [/lib\/datos\/access$/, r.resolve("./stubs/route-access.ts")], [/execute\/route$/, r.resolve("./stubs/route-execute.ts")]];
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { for (const [re, p] of map) if (re.test(q)) return p; return o.call(this, q, ...a); };
const mod: any = await import("../../app/api/frontend/[workflowId]/run/route"); const { POST } = mod.default ?? mod;
let fails = 0; const ok = (c: boolean, m: string) => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"} ${m}`); };
const O = "https://app.example";
const good = { signedIn: true, anonymous: false, workflowExists: true, isOwner: true, hasShare: false, scopeOrganizationId: "org1", isMemberOfScopeOrg: true };
const nodesOk = [{ data: { config: { actionType: "Frontend", collection: "sku" } } }];
async function call(facts: any, nodes: any, headers: any = { origin: O }, body: any = "{}") {
  (globalThis as any).__facts = facts; (globalThis as any).__nodes = nodes; (globalThis as any).__exec = [];
  const res = await POST(new Request(`${O}/api/frontend/w1/run`, { method: "POST", headers: { cookie: "s=1", ...headers }, body }), { params: Promise.resolve({ workflowId: "w1" }) });
  return { status: res.status, exec: (globalThis as any).__exec };
}
{ const x = await call(good, nodesOk); ok(x.status === 200 && x.exec.length === 1 && x.exec[0].workflowId === "w1", "P1 authorized: delegates to the execute route once"); ok(JSON.stringify(x.exec[0].body) === '{"input":{}}' && x.exec[0].cookie === "s=1", "P1 fixed empty input and the caller's session is forwarded"); }
{ const x = await call(good, nodesOk, { origin: O }, JSON.stringify({ input: { evil: 1 }, organizationId: "orgEvil", workflowId: "w2" })); ok(x.exec[0]?.body && JSON.stringify(x.exec[0].body) === '{"input":{}}' && x.exec[0].workflowId === "w1", "P2 request body is ignored (no input, org or workflow id taken from it)"); }
for (const [name, facts, nodes, headers, st] of [
  ["no session", { ...good, signedIn: false }, nodesOk, { origin: O }, 401],
  ["user outside the organization", { ...good, isMemberOfScopeOrg: false }, nodesOk, { origin: O }, 403],
  ["shared without membership", { ...good, isOwner: false, hasShare: true, isMemberOfScopeOrg: false }, nodesOk, { origin: O }, 403],
  ["cross-origin", good, nodesOk, { origin: "https://evil.example" }, 403],
  ["no Origin header", good, nodesOk, {}, 403],
  ["button off", good, [{ data: { config: { actionType: "Frontend", collection: "sku", showRun: "false" } } }], { origin: O }, 404],
  ["no Frontend node", good, [{ data: { config: { actionType: "Condition" } } }], { origin: O }, 404],
] as const) { const x = await call(facts, nodes, headers); ok(x.status === st && x.exec.length === 0, `P3 direct POST refused (${name}): ${x.status}, execute route NOT called`); }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS"); process.exit(fails ? 1 : 0);
