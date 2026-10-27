// OFFLINE harness tests: scripted model, no network, no spend.
// They prove WIRING and RULES only (the driver captures the artifact; each assertion decides as specified).
// They are NOT evidence about any real model's quality.
// Usage: npx tsx evals/harness/offline.mts
import fs from "node:fs";
await import("./setup.mjs");
const { evaluate } = await import("./assertions.mjs");
const { runCase, contract, CORRECTIVE_MARK, GUIDE_MARK } = await import("./drive.mjs");
const K = contract();
const cases = Object.fromEntries(fs.readFileSync(new URL("../cases.jsonl", import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((c) => [c.id, c]));

let fails = 0; const t = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `  ${detail}`}`); if (!ok) fails++; };
// biome-ignore lint/suspicious/noExplicitAny: test fixtures
const node = (id: string, label: string, config: any, type = "action") => ({ id, type, data: { label, type, config } });
const chain = (...ids: string[]) => ids.slice(1).map((id, i) => ({ source: ids[i], target: id }));
const st = (res: { id: string; status: string }[], id: string) => res.find((r) => r.id === id)?.status;
const art = (nodes: unknown[], edges: unknown[], text = "", validation: string[] = []) => ({ final: { nodes, edges, validation } as never, assistantText: text });
const trig = node("t", "Cada mañana", { triggerType: "Schedule", scheduleCron: "0 9 * * *" }, "trigger");
const search = node("s", "Buscar pedidos", { actionType: "tiendanube/search-orders" });
const slack = (ref: string) => node("sl", "Slack", { actionType: "slack/send-message", slackChannel: "#ventas", slackMessage: ref });
const ai = (prompt: string) => node("ai", "Resumen", { actionType: "ai-gateway/generate-text", aiFormat: "text", aiPrompt: prompt });

// ---- 1. Assertion rules on hand-built graphs (fixtures, not model output)
{ const c = cases["C-14"]; const run = (nodes: unknown[], edges: unknown[], text = "") => evaluate(c, c.checks, art(nodes, edges, text), K);
  const unbacked = run([trig, search, ai("Pedidos: {{@s:Buscar pedidos.orders}}. Incluí los productos más vendidos."), slack("{{@ai:Resumen.text}}")], chain("t", "s", "ai", "sl"), "Listo, te llega cada mañana.");
  t("C-14 AI prompt asks products fed only by search-orders -> ai_prompt_backed fail", st(unbacked, "ai_prompt_backed") === "fail");
  const loop = node("lp", "Detalle", { actionType: "Loop", source: "{{@s:Buscar pedidos.orders}}", maxItems: 50, steps: [{ id: "go", actionType: "tiendanube/get-order", config: { orderId: "{{@item:Item.id}}" } }] });
  const backed = run([trig, search, loop, ai("Pedidos y productos: {{@lp:Detalle.items}}. Incluí los productos más vendidos."), slack("{{@ai:Resumen.text}}")], chain("t", "s", "lp", "ai", "sl"));
  t("C-14 products referenced through a get-order Loop -> ai_prompt_backed pass, disclosure na, loop source pass", st(backed, "ai_prompt_backed") === "pass" && st(backed, "disclosed_if_dropped") === "na" && st(backed, "loop_sources_valid") === "pass", JSON.stringify(backed));
  const viaFormula = run([trig, search, loop, node("f", "Ranking", { actionType: "Fórmula", input: "{\"d\": {{@lp:Detalle.items}}}", expression: "d" }), ai("Ranking: {{@f:Ranking.result}}. Incluí los productos más vendidos."), slack("{{@ai:Resumen.text}}")], chain("t", "s", "lp", "f", "ai", "sl"));
  t("C-14 prompt reads a Formula that reads the get-order Loop -> transitive reference chain, ai_prompt_backed pass", st(viaFormula, "ai_prompt_backed") === "pass", JSON.stringify(viaFormula));
  const wiredNotRead = run([trig, search, loop, ai("Pedidos: {{@s:Buscar pedidos.orders}}. Incluí los productos más vendidos."), slack("{{@ai:Resumen.text}}")], chain("t", "s", "lp", "ai", "sl"));
  t("C-14 get-order Loop connected upstream but the prompt never references its data -> ai_prompt_backed fail", st(wiredNotRead, "ai_prompt_backed") === "fail", JSON.stringify(wiredNotRead));
  t("text and reference-chain checks are flagged as signals; graph checks are not", unbacked.filter((x) => x.signal).map((x) => x.id).sort().join() === "ai_prompt_backed,disclosed_if_dropped" && !unbacked.find((x) => x.id === "refs_resolve")?.signal);
  const dropped = [trig, search, ai("Pedidos: {{@s:Buscar pedidos.orders}}. Cantidad y total."), slack("{{@ai:Resumen.text}}")];
  t("C-14 products dropped and the reply says so -> disclosed pass", st(run(dropped, chain("t", "s", "ai", "sl"), "Lo armé sin los productos más vendidos: la búsqueda de pedidos no los trae."), "disclosed_if_dropped") === "pass");
  t("C-14 products dropped silently -> disclosed fail", st(run(dropped, chain("t", "s", "ai", "sl"), "Listo, te llega el resumen cada mañana."), "disclosed_if_dropped") === "fail");
  t("C-14 a reply that PROMISES products is not a disclosure", st(run(dropped, chain("t", "s", "ai", "sl"), "Listo: incluye los productos más vendidos."), "disclosed_if_dropped") === "fail"); }
{ const c = cases["C-16"]; const run = (p: string, text: string) => evaluate(c, c.checks, art([trig, search, ai(p), slack("{{@ai:Resumen.text}}")], chain("t", "s", "ai", "sl"), text), K);
  t("C-16 AI prompt asks for visits (no source exists) -> ai_prompt_backed fail", st(run("Total: {{@s:Buscar pedidos.orders}} y la cantidad de visitas de la tienda.", "Listo"), "ai_prompt_backed") === "fail");
  t("C-16 visits left out and disclosed -> pass", st(run("Total: {{@s:Buscar pedidos.orders}}", "Las visitas no están disponibles: Tiendanube no las expone acá."), "disclosed_if_dropped") === "pass");
  t("C-16 visits left out silently -> fail", st(run("Total: {{@s:Buscar pedidos.orders}}", "Listo, te mando el total cada mañana."), "disclosed_if_dropped") === "fail"); }
{ const c = cases["C-17"]; const lp = (source: string) => node("lp", "Detalle", { actionType: "Loop", source, steps: [{ id: "go", actionType: "tiendanube/get-order", config: { orderId: "{{@item:Item.id}}" } }] });
  const run = (extra: unknown[], source: string) => evaluate(c, [{ id: "loop_sources_valid" }], art([trig, search, ...extra, lp(source)], chain("t", "s", "lp")), K);
  t("C-17 Loop over search-orders.orders -> pass", st(run([], "{{@s:Buscar pedidos.orders}}"), "loop_sources_valid") === "pass");
  t("C-17 Loop over a field search-orders does not list (declarations may be incomplete) -> unknown, not fail", st(run([], "{{@s:Buscar pedidos.products}}"), "loop_sources_valid") === "unknown");
  t("C-17 Loop over an AI text step (exact contract, no list) -> fail", st(run([ai("x")], "{{@ai:Resumen.text}}"), "loop_sources_valid") === "fail");
  t("C-17 Loop over a Formula -> unknown (shape not checked), never fail", st(run([node("f", "Calc", { actionType: "Fórmula", input: "{}", expression: "x" })], "{{@f:Calc.result}}"), "loop_sources_valid") === "unknown");
  t("C-17 Loop source with literal text around the reference -> fail", st(run([], "pedidos {{@s:Buscar pedidos.orders}}"), "loop_sources_valid") === "fail"); }
{ const res = evaluate({}, [{ id: "refs_resolve" }, { id: "ref_fields_declared" }], art([trig, search, slack("{{@ghost:Fantasma.text}} {{@s:Buscar pedidos.total}}")], chain("t", "s", "sl")), K);
  t("reference to a missing node -> refs_resolve fail", st(res, "refs_resolve") === "fail");
  t("reference to a field the declared list omits -> ref_fields_declared unknown, not fail", st(res, "ref_fields_declared") === "unknown", JSON.stringify(res));
  const exact = evaluate({}, [{ id: "ref_fields_declared" }], art([trig, search, ai("x"), slack("{{@ai:Resumen.answer}}")], chain("t", "s", "ai", "sl")), K);
  t("reference outside the exact AI-step contract (.answer on a text step) -> fail", st(exact, "ref_fields_declared") === "fail", JSON.stringify(exact));
  const okAi = evaluate({}, [{ id: "ref_fields_declared" }], art([trig, search, ai("x"), slack("{{@ai:Resumen.text}}")], chain("t", "s", "ai", "sl")), K);
  t("reference inside the exact AI-step contract (.text) -> pass", st(okAi, "ref_fields_declared") === "pass", JSON.stringify(okAi));
  const fx = evaluate({}, [{ id: "ref_fields_declared" }], art([trig, search, node("f", "Calc", { actionType: "Fórmula", input: "{}", expression: "x" }), slack("{{@f:Calc.total}}")], chain("t", "s", "f", "sl")), K);
  t("Formula returns exactly success/result/error: .total (without .result) -> fail", st(fx, "ref_fields_declared") === "fail", JSON.stringify(fx));
  const manual = evaluate({}, [{ id: "ref_fields_declared" }], art([node("t", "Run", { triggerType: "Manual", inputFields: [{ key: "producto", label: "Producto" }] }, "trigger"), slack("{{@t:Run.producto}} {{@t:Run.sku}}")], chain("t", "sl")), K);
  t("Manual trigger inputs are exact: a declared input passes, an undeclared one fails", st(manual, "ref_fields_declared") === "fail" && /t\.sku/.test(manual[0].detail) && !/t\.producto/.test(manual[0].detail), JSON.stringify(manual));
  const unk = evaluate({}, [{ id: "ref_fields_declared" }], art([trig, node("h", "API", { actionType: "HTTP Request" }), slack("{{@h:API.data}}")], chain("t", "h", "sl")), K);
  t("reference into an action without declared outputs -> unknown, not fail", st(unk, "ref_fields_declared") === "unknown", JSON.stringify(unk));
  const inner = evaluate({}, [{ id: "refs_resolve" }], art([trig, search, node("lp", "L", { actionType: "Loop", source: "{{@s:Buscar pedidos.orders}}", steps: [{ id: "a", actionType: "tiendanube/get-order", config: { orderId: "{{@item:Item.id}}" } }, { id: "b", actionType: "slack/send-message", config: { slackMessage: "{{@a:A.products}}" } }] })], chain("t", "s", "lp")), K);
  t("item/index and earlier inner-step refs inside a Loop resolve", st(inner, "refs_resolve") === "pass");
  t("no build -> built fail, graph checks na", (() => { const r = evaluate({}, [{ id: "built" }, { id: "refs_resolve" }], { final: null, assistantText: "" }, K); return st(r, "built") === "fail" && st(r, "refs_resolve") === "na"; })()); }
{ const c = cases["C-01"]; const r = evaluate(c, [{ id: "structural" }], art([trig, search], chain("t", "s")), K);
  t("existing expect (C-01) still enforced through the shared structural module", st(r, "structural") === "fail"); }

// ---- 2. Driver wiring through the REAL unifiedResponse with a scripted model
const { textStream, calls, build, orphanBuild, scripted, FORMULA } = await import("./fakes.mjs");
const opts = (m: unknown, variant: "current" | "no-correctives") => ({ model: m, variant, modelId: "mock", maxTokens: 1000, callMs: 30_000, catalogText: async () => "CATALOG" });

{ const sm = scripted([textStream("¿Te sirve que use el canal #ventas?"), build(), textStream("Armé el flujo."), textStream("Listo: cada mañana te llega la cantidad de pedidos y el total.")]);
  const a = await runCase(cases["C-15"], opts(sm.m, "current"));
  t("question turn then follow-up: two turns recorded, the second builds", a.turns.length === 2 && !a.turns[0].built && a.turns[1].built, JSON.stringify(a.turns.map((x) => x.built)));
  t("artifact keeps the full graph with configs (Formula expression verbatim)", a.final?.nodes?.length === 4 && JSON.stringify(a.final).includes(JSON.stringify(FORMULA).slice(1, -1)));
  t("artifact keeps validator output and completion flags", Array.isArray(a.final?.validation) && a.final?.timedOut === false && a.final?.interrupted === false);
  t("artifact keeps every model call with its tool calls and inputs", a.modelCalls.length >= 3 && a.modelCalls.some((c) => c.toolCalls.some((x) => x.name === "add_node" && (x.input as { id?: string }).id === "f")));
  t("artifact keeps the app build trace (rounds, passes)", !!(a.turns[1].buildTrace as { rounds?: unknown[] } | null)?.rounds);
  t("checks are computed for the case (pre-registered list)", a.checks.length === cases["C-15"].checks.length, JSON.stringify(a.checks));
  t("a clean scripted build passes the C-15 checks (rules agree with a correct graph)", a.checks.every((c) => c.status === "pass" || c.status === "na"), JSON.stringify(a.checks.filter((c) => c.status !== "pass" && c.status !== "na"))); }

for (const variant of ["current", "no-correctives"] as const) {
  const sm = scripted([orphanBuild(), textStream("Armé."), calls([["remove_node", { nodeId: "x" }]]), textStream("corregido"), textStream("Listo.")]);
  const a = await runCase({ ...cases["C-15"], followUps: [] }, opts(sm.m, variant));
  const corr = a.modelCalls.filter((c) => c.stage === "corrective"); const guide = a.modelCalls.filter((c) => c.stage === "guide");
  if (variant === "current") t("current: the orphan triggers a corrective pass that reaches the model and fixes it", corr.length >= 1 && corr.every((c) => !c.intercepted) && !a.final?.nodes?.some((n: { id: string }) => n.id === "x"), JSON.stringify({ corr, v: a.final?.validation }));
  else t("no-correctives: corrective passes are intercepted (model never sees them), the orphan stays and validation reports it", corr.length >= 1 && corr.every((c) => c.intercepted) && !!a.final?.nodes?.some((n: { id: string }) => n.id === "x") && (a.final?.validation?.length ?? 0) > 0, JSON.stringify({ corr: corr.length, v: a.final?.validation }));
  t(`${variant}: the guide pass still reaches the model`, guide.length >= 1 && guide.every((c) => !c.intercepted), JSON.stringify(a.modelCalls.map((c) => [c.stage, c.intercepted, c.toolCalls.length, c.text.slice(0, 20)])));
}
{ const sm = scripted([orphanBuild(), textStream("Armé."), textStream("x"), textStream("x"), textStream("x"), textStream("Listo.")]);
  await runCase({ ...cases["C-15"], followUps: [] }, opts(sm.m, "current"));
  t("stage markers still match what unified.ts sends (drift guard)", sm.seen.some((s) => s.includes(CORRECTIVE_MARK.slice(1, 20))) && sm.seen.some((s) => s.includes(GUIDE_MARK.slice(1, 20)))); }

// ---- 3. Limits, isolation and classification: each case runs in a REAL worker process (runIsolated) against a misbehaving fake.
const { runIsolated } = await import("./drive.mjs");
const { runSummary, render } = await import("./summary.mjs");
const os = await import("node:os"); const path = await import("node:path");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "harness-offline-"));
const job = (fake: string, callMs: number, extra: object = {}) => ({ kase: { ...cases["C-15"], followUps: [] }, variant: "current" as const, modelId: "mock", maxTokens: 1000, callMs, model: { fake }, ...extra });
const kinds = (r: { incidents: { kind: string }[] }) => [...new Set(r.incidents.map((x) => x.kind))].sort().join();
const dead = (pid?: number) => { try { process.kill(pid as number, 0); return false; } catch { return true; } };
const rows: Parameters<typeof render>[0] = []; const keep = (a: { checks: never[] }) => { const r = runSummary(a as never); rows.push({ ...r, checks: a.checks }); return r; };

{ // call never returns and ignores the abort; the call limit fires well before the run limit
  const a = await runIsolated(job("hang-before-stream", 800), 60_000, work); const r = keep(a);
  t("hang before stream: the call limit ends the call although the fake ignores the abort", a.modelCalls[0]?.errorKind === "harness-call-timeout", JSON.stringify(a.modelCalls));
  t("hang before stream: the worker exits by itself (pending promise and timer dropped), long before the run limit", a.termination.by === "completed" && a.termination.elapsedMs < 30_000 && dead(a.termination.pid), JSON.stringify(a.termination));
  t("hang before stream: run classified as harness timeout and kept out of complete evaluations", kinds(r) === "harness-call-timeout" && r.evaluation === "interrupted", JSON.stringify(r.incidents)); }
{ // stream stalls mid-build and ignores abort AND cancel; the call limit is longer than the run limit, so only the hard kill can end it
  const a = await runIsolated({ ...job("stall-mid-stream", 120_000), kase: cases["C-15"] }, 6_000, work); const r = keep(a);
  t("stall (call limit > run limit): the run limit kills the worker; nothing keeps running", a.termination.by === "harness-run-timeout" && a.termination.elapsedMs < 15_000 && dead(a.termination.pid), JSON.stringify(a.termination));
  t("stall: the partial keeps the finished turn 1 and the cut turn 2", a.turns.length === 2 && !a.turns[0].cut && a.turns[0].assistant.includes("#ventas") && a.turns[1].cut === true, JSON.stringify(a.turns.map((x: { user: string; cut?: boolean }) => [x.user.slice(0, 20), x.cut])));
  t("stall: the partial keeps the tool calls streamed before the cut", a.modelCalls[1]?.toolCalls.map((x: { name: string }) => x.name).join() === "start_build,add_node,add_node", JSON.stringify(a.modelCalls[1]));
  t("stall: the artifact lists what is incomplete (cut turn, call without end/usage, no final graph)", a.incomplete.some((x: string) => x.includes("cut before")) && a.incomplete.some((x: string) => x.startsWith("model call 1")) && a.incomplete.includes("no final graph"), JSON.stringify(a.incomplete));
  t("stall: classified as harness run timeout; checks still evaluated on the partial (built fails, not hidden)", kinds(r) === "harness-run-timeout" && r.evaluation === "interrupted" && r.deterministic.fail.includes("built"), JSON.stringify(r)); }
{ // same stall, call limit shorter than the run: the app gets the error mid-pass and closes the turn itself
  const a = await runIsolated({ ...job("stall-mid-stream", 1_500), kase: cases["C-15"] }, 60_000, work); const r = keep(a);
  t("stall (call limit < run limit): the call limit cuts the stalled stream and the app finishes the turn", a.termination.by === "completed" && a.modelCalls[1]?.errorKind === "harness-call-timeout" && a.turns.length === 2 && !a.turns[1].cut, JSON.stringify({ t: a.termination, c: a.modelCalls[1] }));
  t("stall (call limit): the app reports the failed call to the user; classified harness timeout, not transport or provider", !!a.turns[1].error && kinds(r) === "harness-call-timeout", JSON.stringify({ err: a.turns[1].error, inc: r.incidents })); }
{ const a = await runIsolated(job("econnreset", 30_000), 60_000, work); const r = keep(a);
  t("ECONNRESET mid-stream: classified as transport (not provider, not app limit, not harness)", a.modelCalls[0]?.errorKind === "transport" && kinds(r).split(",").includes("transport") && !/provider|harness/.test(kinds(r)), JSON.stringify({ c: a.modelCalls[0], inc: r.incidents }));
  t("ECONNRESET: the run ends normally and is reported as interrupted", a.termination.by === "completed" && r.evaluation === "interrupted"); }
{ const a = await runIsolated(job("provider-503", 30_000), 60_000, work); const r = keep(a);
  t("HTTP 503 from the provider: classified as provider", a.modelCalls[0]?.errorKind === "provider" && kinds(r) === "provider" && r.evaluation === "interrupted", JSON.stringify({ c: a.modelCalls[0], inc: r.incidents })); }
{ const a = await runIsolated(job("cap", 30_000, { env: { AI_BUILD_CAP_MS: "300" } }), 60_000, work); const r = keep(a);
  t("app build cap reached with a well-behaved provider: app limit only, no infrastructure incident", String(a.turns[0]?.buildTrace?.closeReason ?? "").includes("cap-reached") && r.incidents.every((x) => x.kind === "app-limit") && r.incidents.length > 0, JSON.stringify({ trace: a.turns[0]?.buildTrace?.closeReason, inc: r.incidents, calls: a.modelCalls.map((c: { errorKind?: string }) => c.errorKind) }));
  t("app build cap: counted as a complete evaluation; its validator fail is visible", r.evaluation === "complete" && r.deterministic.fail.includes("validator_clean"), JSON.stringify(r)); }
fs.rmSync(work, { recursive: true, force: true });
{ const report = render(rows);
  t("report: no aggregate pass; deterministic and signals on separate lines per run", !/\bpass=|"pass":/.test(report) && report.includes("deterministic fail:") && report.includes("signals       fail:"));
  t("report: complete and interrupted runs of a case are in separate buckets", /C-15: 6 runs, 1 complete, 5 interrupted/.test(report) && report.includes("  complete (1;") && report.includes("  interrupted (5;"), report);
  t("signals are never counted as deterministic", rows.every((x) => !x.deterministic.pass.concat(x.deterministic.fail).includes("ai_prompt_backed")) && rows.some((x) => x.signals.pass.concat(x.signals.fail).includes("ai_prompt_backed"))); }

console.log(fails ? `\n${fails} FAILED` : "\nall offline harness tests passed (wiring and rules only; no model quality evidence)");
process.exit(fails ? 1 : 0);
