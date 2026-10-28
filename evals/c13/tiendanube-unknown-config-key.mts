// Offline: a tiendanube/* action config key the step does not read must block the build (computeFlowErrors). search-orders reads
// only createdAtMin as a date bound, so createdAtMax was dropped silently and "yesterday" also included today's orders.
// Scope: Tiendanube actions only (top level and Loop inner steps); other plugins, triggers and system actions are not judged.
// Fixtures are minimal and synthetic. Also checks that the 154 evals/semantic snapshots get no Tiendanube unknown-key error.
import Module from "node:module"; import { createRequire } from "node:module"; import { readFileSync, readdirSync } from "node:fs";
const r = createRequire(import.meta.url); const stub = r.resolve("../../evals/semantic/stubs/server-only.ts");
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { return q === "server-only" ? stub : o.call(this, q, ...a); };
await import("../../plugins");
const B: any = await import("../../lib/agent/build-core"); const { computeFlowErrors } = B.default ?? B;
const res: [string, boolean, string][] = []; const t = (n: string, ok: boolean, d = "") => res.push([n, ok, d]);
const KEY_ERR = /^configuración: "[^"]*" sets /;
const keyErrs = (nodes: any[], edges: any[] = []) => (computeFlowErrors({ nodes, edges }, { composioCatalogMap: new Map(), sheetContracts: [], userPrompt: "" }) as string[]).filter((e) => KEY_ERR.test(e));
const n = (id: string, config: any, type = "action") => ({ id, type, data: { label: id, type, config } });
const trig = n("cron", { triggerType: "Schedule", scheduleCron: "0 9 * * *", scheduleTimezone: "America/Argentina/Buenos_Aires" }, "trigger");
const search = (extra: any = {}) => n("pedidos", { actionType: "tiendanube/search-orders", createdAtMin: "2026-10-26T00:00:00-03:00", limit: "50", ...extra });
const chain = (...ns: any[]) => ns.slice(1).map((x, i) => ({ source: ns[i].id, target: x.id }));

{ const g = [trig, search({ createdAtMax: "2026-10-27T00:00:00-03:00" })]; const e = keyErrs(g, chain(...g));
  t("search-orders with createdAtMax: flagged, names the key and the accepted keys", e.length === 1 && e[0].includes("sets createdAtMax") && e[0].includes("tiendanube/search-orders") && /it accepts: [^)]*createdAtMin/.test(e[0]), JSON.stringify(e)); }
{ const g = [trig, search()]; t("same graph without createdAtMax: no unknown-key error", keyErrs(g, chain(...g)).length === 0, JSON.stringify(keyErrs(g, chain(...g)))); }
{ const loop = n("loop", { actionType: "Loop", source: "{{@pedidos:pedidos.orders}}", steps: [{ id: "detalle", actionType: "tiendanube/get-order", config: { orderId: "{{@item:item.id}}", incluirProductos: "true" } }] });
  const g = [trig, search(), loop]; const e = keyErrs(g, chain(...g));
  t("Tiendanube step inside a Loop with an invented key: flagged", e.length === 1 && e[0].includes("loop > detalle") && e[0].includes("sets incluirProductos"), JSON.stringify(e)); }
{ const f = n("calc", { actionType: "Fórmula", input: "{}", expression: "1", extra: "x" }); const g = [trig, f];
  t("system action (Fórmula) with an extra key: not judged", keyErrs(g, chain(...g)).length === 0); }
{ const s = n("cron", { triggerType: "Schedule", scheduleCron: "0 9 * * *", timezone: "America/Argentina/Buenos_Aires" }, "trigger"); const g = [s, search()];
  t("trigger with an unread key (Schedule.timezone): not judged", keyErrs(g, chain(...g)).length === 0); }
{ const z = n("envio", { actionType: "zipnova/get-shipment", shipmentId: "1", externalId: "x" }); const g = [trig, z];
  t("non-Tiendanube plugin (zipnova/get-shipment) with an extra key: not judged", keyErrs(g, chain(...g)).length === 0); }

const dir = "evals/semantic/snapshots/"; let files = 0, hits: string[] = [];
for (const f of readdirSync(dir)) { const g = JSON.parse(readFileSync(dir + f, "utf8")); files++; for (const e of keyErrs(g.nodes, g.edges ?? [])) hits.push(`${f}: ${e}`); }
t(`${files} semantic snapshots: no Tiendanube unknown-key error`, files > 0 && hits.length === 0, hits.join("\n").slice(0, 1200));

let fails = 0; for (const [k, ok, d] of res) { console.log(ok ? "PASS" : "FAIL", k, ok ? "" : d); if (!ok) fails++; } console.log(`${res.length - fails}/${res.length}`); process.exit(fails ? 1 : 0);
