// @ts-nocheck
// Offline, no model calls. (1) the builder accepts Datos as an action type, (2) the applyTogether example in its prompt parses, validates and applies on the in-memory repo, (3) a string-in-string "operations" is still accepted by the executor (raw API form) but is NOT what the prompt asks for.
import Module from "node:module"; import { createRequire } from "node:module"; import { readFileSync } from "node:fs";
const r = createRequire(import.meta.url);
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { if (/^server-only$/.test(q)) return r.resolve("../../evals/semantic/stubs/server-only.ts"); return o.call(this, q, ...a); };
process.env.DATOS_STORAGE_ENABLED = "true";
const bc: any = await import("../../lib/agent/build-core"); const { getValidActionTypes } = bc.default ?? bc;
const fv: any = await import("../../lib/flow-validator"); const { validateFlow } = fv.default ?? fv;
const core: any = await import("../../lib/datos/core"); const { datosApplyTogether, memoryRepo } = core.default ?? core;
let fails = 0; const ok = (c: boolean, m: string) => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"} ${m}`); };
ok(getValidActionTypes().has("Datos"), "builder valid action types include Datos");
const src = readFileSync(new URL("../../lib/agent/build-core.ts", import.meta.url), "utf8");
const m = src.match(/"operations": (\[.*?\])\}/s); ok(!!m, "prompt contains an applyTogether example");
const ops = JSON.parse(m![1]);
ok(Array.isArray(ops) && ops.length === 2, "example operations is a real array of 2 objects");
const t = { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { type: "trigger", label: "T", config: { triggerType: "Manual" } } };
const mk = (id: string, label: string, config: any) => ({ id, type: "action", position: { x: 0, y: 0 }, data: { type: "action", label, config } });
const nodes = [t, mk("evt", "Evento", { actionType: "Fórmula", input: '{"x": 1}', expression: '{"plataforma":"tn","pedido":"1","linea":"L1","tipo":"venta","sku":"S1","cantidad":-2}' }), mk("d1", "Aplicar", { actionType: "Datos", operation: "applyTogether", operations: ops }), mk("c1", "Se aplicó", { actionType: "Condition", condition: "{{@d1:Aplicar.estado}} === 'aplicado'" })];
const edges = [{ id: "a", source: "t", target: "evt" }, { id: "b", source: "evt", target: "d1" }, { id: "c", source: "d1", target: "c1" }];
const errs = validateFlow(nodes, edges, {}, getValidActionTypes()); console.log(JSON.stringify(errs).slice(0, 300));
ok(!errs.some((e: string) => /Datos|actionType|estado/.test(e)), "validator accepts the Datos flow with the estado condition");
const repo = memoryRepo(); await repo.insertIfAbsent("org", "saldos", "S1", { stock: 5 }, 5000);
const concrete = JSON.parse(JSON.stringify(ops).replace(/\{\{@evt:Evento\.result\.(\w+)\}\}/g, (_: string, k: string) => ({ plataforma: "tn", pedido: "1", linea: "L1", tipo: "venta", sku: "S1", cantidad: "-2" } as any)[k]));
const r1: any = await datosApplyTogether(repo, "org", { operations: concrete, operationId: "x1" });
ok(r1.success && r1.estado === "aplicado", "example applies: " + JSON.stringify(r1).slice(0, 120));
const r2: any = await datosApplyTogether(repo, "org", { operations: concrete, operationId: "x2" });
ok(r2.success && r2.estado === "rechazado", "repeat is rejected with success=true and estado=rechazado");
const s: any = await core.datosRead(repo, "org", { collection: "saldos", key: "S1" }); ok(s.record?.value?.stock === 3, "stock 5 -> 3, not 1");
const r3: any = await datosApplyTogether(repo, "org", { operations: JSON.stringify(concrete.map((x: any, i: number) => i ? { ...x, key: "S1" } : { ...x, key: "tn:1:L2:venta" })), operationId: "x3" });
ok(r3.success && r3.estado === "aplicado", "string form of operations is also accepted by the executor (raw form)");
// key guard: positional / invented keys are rejected, line-id keys pass
{
  const fv2: any = await import("../../lib/flow-validator"); const g = (fv2.default ?? fv2).datosMovementKeyError;
  const nd = (cfg: any) => [{ id: "d", type: "action", position: { x: 0, y: 0 }, data: { type: "action", label: "D", config: { actionType: "Datos", ...cfg } } }];
  ok(!!g(nd({ operation: "applyTogether", operations: [{ operation: "saveIfAbsent", key: "tn:ITEM-STOCK:venta" }] })), "guard rejects made-up literal key");
  ok(!!g(nd({ operation: "applyTogether", operations: JSON.stringify([{ key: "ITEM-STOCK" }]) })), "guard rejects invented key (string form)");
  ok(!g(nd({ operation: "applyTogether", operations: [{ key: "{{@evt:E.result.plataforma}}:{{@evt:E.result.pedido}}:{{@evt:E.result.linea}}:venta" }] })), "guard accepts reference key");
  ok(!g(nd({ operation: "applyTogether", operations: [{ key: "tn:{{@evt:E.result.products[0].id}}:venta", collection: "movimientos" }] })), "guard does NOT block products[0] (identity depends on source contract)");
  ok(!!g(nd({ operation: "saveIfAbsent", collection: "movimientos", key: "tn:1:venta" })), "guard rejects reference-less movement key");
}
{
  const g = ((await import("../../lib/flow-validator")) as any).datosMovementKeyError ?? ((await import("../../lib/flow-validator")) as any).default.datosMovementKeyError;
  const nd2 = (cfg: any) => [{ id: "d", type: "action", position: { x: 0, y: 0 }, data: { type: "action", label: "D", config: { actionType: "Datos", ...cfg } } }];
  ok(!!g(nd2({ operation: "save", collection: "avisos", value: { a: 1 } })), "guard rejects save without key");
  ok(!g(nd2({ operation: "save", collection: "avisos", key: "{{@x:y.z}}", value: { a: 1 } })), "guard accepts save with key");
}
{
  const fvx: any = await import("../../lib/flow-validator"); const gl = fvx.datosInLoopError ?? fvx.default.datosInLoopError;
  const loop = (st: any[]) => [{ id: "l", type: "action", position: { x: 0, y: 0 }, data: { type: "action", label: "L", config: { actionType: "Loop", steps: st } } }];
  ok(!!gl(loop([{ id: "a", config: { actionType: "Datos", operation: "add" } }])), "rejects Datos inside a Loop");
  ok(!!gl(loop([{ id: "a", actionType: "Datos", config: { operation: "add" } }])), "rejects Datos with step-level actionType (shape the builder emits)");
  ok(!gl(loop([{ id: "a", config: { actionType: "Fórmula" } }])), "allows other steps in a Loop");
}
{
  const fvy: any = await import("../../lib/flow-validator"); const F = fvy.default ?? fvy;
  const dn = (id: string, cfg: any) => ({ id, type: "action", position: { x: 0, y: 0 }, data: { type: "action", label: id, config: { actionType: "Datos", ...cfg } } });
  const cn = (id: string, condition: string) => ({ id, type: "action", position: { x: 0, y: 0 }, data: { type: "action", label: id, config: { actionType: "Condition", condition } } });
  const good = [{ operation: "saveIfAbsent", collection: "m", key: "{{@t:T.a}}" }, { operation: "add", collection: "s", key: "{{@t:T.b}}", field: "stock", amount: "-{{@t:T.c}}" }];
  // gate by estado
  const d1 = dn("d1", { operation: "applyTogether", operations: JSON.stringify(good) }); const next = dn("n1", { operation: "save", collection: "x", key: "k" });
  ok(!!F.datosGateError([d1, next], [{ id: "e", source: "d1", target: "n1" }]), "gate: step right after applyTogether without a Condition is rejected");
  ok(!!F.datosGateError([d1, cn("c1", "{{@t:T.a}} === 'aplicado'"), next], [{ id: "e1", source: "d1", target: "c1" }, { id: "e2", source: "c1", target: "n1" }]), "gate: Condition on another node is not a gate");
  ok(!F.datosGateError([d1, cn("c1", "{{@d1:D.estado}} === 'aplicado'"), next], [{ id: "e1", source: "d1", target: "c1" }, { id: "e2", source: "c1", target: "n1" }]), "gate: Condition on estado passes");
  ok(!F.datosGateError([d1], []), "gate: a lone Datos step needs no gate");
  // shape
  const sh = (ops: any) => F.datosShapeError([dn("d", { operation: "applyTogether", operations: ops })]);
  ok(!!sh(undefined), "shape: applyTogether without operations rejected");
  ok(!!sh("not json"), "shape: unparseable operations rejected");
  ok(!!sh("[]"), "shape: empty list rejected");
  ok(!!sh(JSON.stringify(Array.from({ length: 11 }, (_, i) => ({ operation: "saveIfAbsent", collection: "c", key: "k" + i })))), "shape: more than 10 operations rejected");
  ok(!!sh(JSON.stringify([{ operation: "add", collection: "c", key: "k" }])), "shape: add without field/amount rejected");
  ok(!!sh(JSON.stringify([{ operation: "saveIfAbsent", collection: "c" }])), "shape: operation without key rejected");
  ok(!!sh(JSON.stringify([{ operation: "saveIfAbsent", collection: "c", key: "k" }, { operation: "saveIfAbsent", collection: "c", key: "k" }])), "shape: duplicate collection+key rejected");
  ok(!sh(JSON.stringify(good)) && !sh(good), "shape: valid list accepted (string and array form)");
  // coverage: one list element
  const idx = dn("d", { operation: "applyTogether", operations: JSON.stringify([{ operation: "saveIfAbsent", collection: "m", key: "{{@g:G.products[0].id}}" }]) });
  ok(!!F.datosCoverageError([idx], "descontá el stock de cada producto del pedido"), "coverage: one list element for a request about every line is rejected");
  ok(/LIMIT: Datos does not support an order with several lines/.test(F.datosCoverageError([idx], "descontá el stock de cada producto del pedido") || "") && /no Loop, no HTTP/.test(F.datosCoverageError([idx], "descontá el stock de cada producto del pedido") || ""), "limit: the coverage error states the unsupported limit, validation error preserved, no host-specific text");
  { const lp: any = { id: "lp", type: "action", data: { config: { actionType: "Loop", steps: [{ actionType: "Datos" }] } } }; const m = F.datosInLoopError([lp]) || ""; ok(/Loop "lp" contains a Datos step/.test(m) && /LIMIT: Datos does not support/.test(m) && !/example\.com/.test(m) && !/applyTogether with up to 10/.test(m), "limit: Datos-in-Loop error keeps the validation error and states the unsupported limit"); }
  ok(!F.datosCoverageError([idx], "descontá solo la primera línea del pedido"), "coverage: allowed when the request is explicitly about the first line");
  ok(!F.datosCoverageError([dn("d", { operation: "applyTogether", operations: JSON.stringify(good) })], "cada línea"), "coverage: references without a list index pass");
}
{
  // wired into the builder's own error computation (computeFlowErrors), using the C-21 shape the real model produced
  const bcz: any = await import("../../lib/agent/build-core"); const { computeFlowErrors } = bcz.default ?? bcz;
  const mkn = (id: string, type: string, config: any) => ({ id, type: type === "trigger" ? "trigger" : "action", position: { x: 0, y: 0 }, data: { type, label: id, config } });
  const sh: any = { nodes: [mkn("t", "trigger", { triggerType: "Manual", inputFields: [{ key: "a", label: "A" }] }), mkn("d", "action", { actionType: "Datos", operation: "applyTogether", operations: JSON.stringify([{ operation: "saveIfAbsent", collection: "movimientos", key: "{{@t:t.a}}:{{@g:G.products[0].id}}" }]) }), mkn("n", "action", { actionType: "Datos", operation: "save", collection: "avisos", key: "{{@t:t.a}}", value: "{}" })], edges: [{ id: "e1", source: "t", target: "d" }, { id: "e2", source: "d", target: "n" }] };
  const errs: string[] = computeFlowErrors(sh, { composioCatalogMap: new Map(), sheetContracts: [], userPrompt: "descontá el stock de cada producto del pedido" });
  ok(errs.some((e) => /without a Condition that tests its result/.test(e)), "computeFlowErrors reports the missing estado gate");
  ok(errs.some((e) => /uses one element of a list/.test(e)), "computeFlowErrors reports the dropped-lines risk");
}
{
  const fvg: any = await import("../../lib/flow-validator"); const F = fvg.default ?? fvg;
  const dn = (id: string, cfg: any) => ({ id, type: "action", position: { x: 0, y: 0 }, data: { type: "action", label: id, config: { actionType: "Datos", ...cfg } } });
  const cn = (id: string, condition: string) => ({ id, type: "action", position: { x: 0, y: 0 }, data: { type: "action", label: id, config: { actionType: "Condition", condition } } });
  const nx = dn("n1", { operation: "save", collection: "x", key: "k" });
  const gate = (op: string, cond: string) => F.datosGateError([dn("d1", { operation: op }), cn("c1", cond), nx], [{ id: "e1", source: "d1", target: "c1" }, { id: "e2", source: "c1", target: "n1" }]);
  ok(!!gate("saveIfAbsent", "{{@d1:D.estado}} === 'aplicado'"), "gate by op: estado after saveIfAbsent is rejected (that op returns creado)");
  ok(!gate("saveIfAbsent", "{{@d1:D.creado}} === true"), "gate by op: creado === true after saveIfAbsent passes");
  ok(!gate("saveIfAbsent", "{{@d1:D.creado}}"), "gate by op: bare creado passes");
  ok(!gate("updateIfMatches", "{{@d1:D.actualizado}} === true"), "gate by op: actualizado after updateIfMatches passes");
  ok(!!gate("updateIfMatches", "{{@d1:D.creado}} === true"), "gate by op: wrong field after updateIfMatches rejected");
  ok(!gate("add", "{{@d1:D.aplicado}} === true"), "gate by op: aplicado after add passes");
  ok(!gate("applyTogether", "{{@d1:D.estado}} === 'rechazado'"), "gate: legitimate 'was rejected' path is preserved");
  ok(!!gate("applyTogether", "{{@d1:D.estado}} !== 'cancelado'"), "gate: estado compared with an unrelated value is rejected");
  ok(!!gate("applyTogether", "{{@d1:D.estado}} === 'aplicado' || true"), "gate: || escape hatch rejected");
  ok(!gate("applyTogether", "{{@d1:D.estado}} === 'aplicado' && {{@t:T.x}} > 1"), "gate: && with another clause passes");
  ok(!F.datosGateError([dn("d1", { operation: "read" }), nx], [{ id: "e", source: "d1", target: "n1" }]), "gate: read flows need no Condition");
  ok(!F.datosGateError([dn("d1", { operation: "save" }), nx], [{ id: "e", source: "d1", target: "n1" }]), "gate: plain save needs no Condition");
}
process.exit(fails ? 1 : 0);
