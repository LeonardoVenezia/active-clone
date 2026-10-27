// Drives the REAL unifiedResponse (app/api/workflow-chat/unified.ts) for one case and returns a full artifact:
// every turn's text, the final graph with configs (Formula expressions, Loop steps, AI prompts), validator output,
// every model call (stage, tool calls with inputs, text, usage) and the app's own build trace.
// Production code is untouched: everything goes through the existing `deps` seams of UnifiedInput.
// Import ./setup.mts before this module (server-only stub + plugin registry).
import type { LanguageModel } from "ai";
import { type Artifact, type CheckSpec, type Contract, DEFAULT_CHECKS, evaluate } from "./assertions.mjs";
/** The app's data-canvas-final payload: what was left on the canvas after validation. */
export type FinalCanvas = NonNullable<Artifact["final"]> & { name?: string; startedEmpty?: boolean };
// The app modules are CommonJS under tsx: load them dynamically and unwrap default, as evals/c13 does.
const cjs = async <T,>(p: string): Promise<T> => { const m = await import(p); return (m.default ?? m) as T; };
const { unifiedResponse } = await cjs<typeof import("../../app/api/workflow-chat/unified")>("../../app/api/workflow-chat/unified");
const { getActionOutputFields, getActionOutputItemFields } = await cjs<typeof import("../../plugins/registry")>("../../plugins/registry");
const { aiOutputOf, AI_TEXT_ACTION } = await cjs<typeof import("../../lib/agent/output-contract")>("../../lib/agent/output-contract");

/**
 * Output contract for the assertions: declared plugin outputFields (may be incomplete) plus the contracts the code fixes exactly:
 * the AI text step (lib/agent/output-contract.ts aiOutputOf) and Formula (lib/steps/formula.ts FormulaResult).
 */
export function contract(): Contract {
  return { outputFields: getActionOutputFields(), itemFields: getActionOutputItemFields(),
    exact: (at, cfg) => (at === AI_TEXT_ACTION ? ["success", "error", aiOutputOf(cfg).kind] : at === "Fórmula" || at === "Formula" ? ["success", "error", "result"] : undefined) };
}

export type Variant = "current" | "no-correctives";
export type Case = { id: string; prompt: string; turns?: { role: "user" | "assistant"; content: string }[]; followUps?: string[]; expect?: unknown; checks?: CheckSpec[] };
export type ErrorKind = "harness-call-timeout" | "transport" | "provider" | "app-abort" | "unclassified";
export type ModelCall = { n: number; stage: "chat" | "corrective" | "guide"; intercepted: boolean; toolCalls: { name: string; input: unknown }[]; text: string; finish: string; usage?: unknown; ms: number; error?: string; errorKind?: ErrorKind; done: boolean };
export const DEFAULT_FOLLOW_UPS = ["Dale, armalo así. Lo que no te dije decidilo vos."];
/** Raised by the harness when one model call exceeds its limit. The provider may keep processing (and billing) after this. */
export class HarnessCallTimeout extends Error { override name = "HarnessCallTimeout"; }

// The app marks its internal passes with these prefixes in the last user message (unified.ts). The offline test fails if they drift.
export const CORRECTIVE_MARK = "[App check, not from the user]";
export const GUIDE_MARK = "[App report after your build";
const stageOf = (prompt: { role: string; content: unknown }[]): ModelCall["stage"] => {
  const last = [...prompt].reverse().find((m) => m.role === "user"); const t = JSON.stringify(last?.content ?? "");
  return t.includes(CORRECTIVE_MARK) ? "corrective" : t.includes(GUIDE_MARK) ? "guide" : "chat";
};

const TRANSPORT = /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|UND_ERR|socket hang up|fetch failed|other side closed|terminated/i;
/**
 * Error kind of a failed call. `provider` = the provider answered with an HTTP status or sent an error event in the stream;
 * `transport` = the connection failed (network, proxy or provider side: not distinguishable from here); `app-abort` = the app's own
 * abort (its build cap) ended the call. Anything else stays `unclassified` instead of being guessed.
 */
export function classifyError(e: unknown, from: "thrown" | "stream-event", appAborted: boolean): ErrorKind {
  // biome-ignore lint/suspicious/noExplicitAny: walking an unknown error chain
  const chain: any[] = []; for (let x: any = e; x && chain.length < 5; x = x.cause) chain.push(x);
  if (chain.some((x) => x?.name === "HarnessCallTimeout")) return "harness-call-timeout";
  const text = chain.map((x) => `${x?.name ?? ""} ${x?.code ?? ""} ${x?.message ?? (typeof x === "string" ? x : "")}`).join(" | ");
  if (chain.some((x) => typeof (x?.statusCode ?? x?.status) === "number")) return "provider";
  if (TRANSPORT.test(text)) return "transport";
  if (appAborted || chain.some((x) => x?.name === "AbortError")) return "app-abort";
  return from === "stream-event" ? "provider" : "unclassified";
}
const errText = (e: unknown) => { // biome-ignore lint/suspicious/noExplicitAny: error chain
  const x = e as any; const c = x?.cause; return `${x?.name ?? "Error"}: ${String(x?.message ?? x).slice(0, 200)}${c ? ` (cause: ${c?.code ?? c?.name ?? ""} ${String(c?.message ?? c).slice(0, 120)})` : ""}`; };

type Part = { type: string; [k: string]: unknown };
/**
 * Wraps a LanguageModel (spec v2): records each streamed call and enforces the per-call limit `callMs`.
 * At the limit the provider is asked to abort (signal) and the app receives a HarnessCallTimeout error at once, whether or not the
 * provider honors the abort. A provider that ignores it leaves a pending read behind in this process: only the run-level limit
 * (killing the worker process, see runIsolated) guarantees nothing keeps running locally. In "no-correctives" the corrective passes
 * get an empty reply instead of reaching the model.
 */
// biome-ignore lint/suspicious/noExplicitAny: provider-level model object
function recording(model: any, variant: Variant, calls: ModelCall[], callMs: number, progress: (force?: boolean) => void): LanguageModel {
  return {
    specificationVersion: "v2", provider: model.provider, modelId: model.modelId, supportedUrls: model.supportedUrls ?? {},
    doGenerate: (o: unknown) => model.doGenerate(o),
    doStream: async (o: { prompt: { role: string; content: unknown }[]; abortSignal?: AbortSignal }) => {
      const call: ModelCall = { n: calls.length, stage: stageOf(o.prompt), intercepted: false, toolCalls: [], text: "", finish: "unknown", ms: 0, done: false }; calls.push(call);
      const t0 = Date.now(); const deadline = t0 + callMs; const appAborted = () => !!o.abortSignal?.aborted;
      const fail = (e: unknown, from: "thrown" | "stream-event") => { call.error ??= errText(e); call.errorKind ??= classifyError(e, from, appAborted()); call.ms = Date.now() - t0; progress(true); };
      progress(true);
      if (variant === "no-correctives" && call.stage === "corrective") {
        call.intercepted = true; call.finish = "stop"; call.done = true;
        return { stream: new ReadableStream({ start(c) { c.enqueue({ type: "stream-start", warnings: [] }); c.enqueue({ type: "finish", finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }); c.close(); } }) };
      }
      const limit = new AbortController(); const signal = o.abortSignal ? AbortSignal.any([o.abortSignal, limit.signal]) : limit.signal;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<"expired">((r) => { timer = setTimeout(() => { limit.abort(new HarnessCallTimeout(`call limit ${callMs} ms`)); r("expired"); }, callMs); });
      const timeout = () => new HarnessCallTimeout(`model call exceeded the harness limit of ${callMs} ms (stage ${call.stage}, call ${call.n})`);
      let res: { stream: ReadableStream<Part> };
      try {
        const r = await Promise.race([model.doStream({ ...o, abortSignal: signal }), expired]);
        if (r === "expired") throw timeout();
        res = r;
      } catch (e) { clearTimeout(timer); fail(e, "thrown"); throw e; }
      const reader = res.stream.getReader();
      return { ...res, stream: new ReadableStream<Part>({
        async pull(c) {
          let t: ReturnType<typeof setTimeout> | undefined;
          const late = new Promise<"late">((r) => { t = setTimeout(() => r("late"), Math.max(0, deadline - Date.now())); });
          let r: ReadableStreamReadResult<Part> | "late";
          try { r = await Promise.race([reader.read(), late]); } catch (e) { clearTimeout(t); clearTimeout(timer); fail(e, "thrown"); c.error(e); return; }
          clearTimeout(t);
          if (r === "late") { clearTimeout(timer); limit.abort(); reader.cancel().catch(() => {}); const e = timeout(); fail(e, "thrown"); c.error(e); return; }
          if (r.done) { clearTimeout(timer); call.done = true; call.ms = Date.now() - t0; progress(true); c.close(); return; }
          const p = r.value;
          if (p.type === "tool-call") { let input: unknown = p.input; try { input = JSON.parse(String(p.input)); } catch { /* keep raw */ } call.toolCalls.push({ name: String(p.toolName), input }); progress(true); }
          if (p.type === "text-delta") { call.text += String(p.delta ?? ""); progress(); }
          if (p.type === "finish") { call.finish = String(p.finishReason); call.usage = p.usage; call.ms = Date.now() - t0; }
          if (p.type === "error") fail(p.error, "stream-event");
          c.enqueue(p);
        },
        cancel(reason) { clearTimeout(timer); return reader.cancel(reason); },
      }) };
    },
  } as unknown as LanguageModel;
}

type Ev = { type: string; data?: Record<string, unknown>; delta?: string };
export type Turn = { user: string; assistant: string; built: boolean; error: string | null; canvasFinal: Record<string, unknown> | null; buildTrace: unknown; result: unknown; cut?: true };

export type RunOpts = {
  model: unknown; variant: Variant; modelId: string; maxTokens: number;
  /** Per model call limit (ms). See recording(). */
  callMs: number;
  /** Receives a snapshot of everything recorded so far (throttled; forced on call start/end/error, tool calls and turn ends). */
  onProgress?: (snap: Snapshot) => void;
  /** Live: real Composio discovery (needs COMPOSIO_API_KEY). Offline: a stub returning nothing. */
  discover?: (x: { catalog: string; search?: string; toolkit?: string }) => Promise<{ items?: Record<string, unknown>[] }>;
  catalogText?: (userId: string) => Promise<string>;
};
export type Snapshot = { caseId: string; variant: Variant; modelId: string; startedAt: number; turns: Turn[]; current: Turn | null; final: FinalCanvas | null; modelCalls: ModelCall[] };

const turnOf = (user: string, ev: Ev[]): Turn => {
  const result = ev.find((e) => e.type === "data-chat-result")?.data ?? null;
  return { user, assistant: ev.filter((e) => e.type === "text-delta").map((e) => e.delta).join(""), built: !!result?.built, error: (ev.find((e) => e.type === "data-chat-error")?.data?.error as string) ?? null,
    canvasFinal: ev.find((e) => e.type === "data-canvas-final")?.data ?? null, buildTrace: (ev.find((e) => e.type === "data-model-trace")?.data as { build?: unknown } | undefined)?.build ?? null, result };
};

/** Checks over whatever graph and text exist (a complete run or the partial left by a cut run). */
export function checksFor(kase: Case, final: FinalCanvas | null, turns: Turn[]) {
  const artifact: Artifact = { final, assistantText: turns.map((t) => t.assistant).join("\n\n") };
  return evaluate(kase, kase.checks ?? DEFAULT_CHECKS, artifact, contract());
}

export async function runCase(kase: Case, o: RunOpts) {
  const snap: Snapshot = { caseId: kase.id, variant: o.variant, modelId: o.modelId, startedAt: Date.now(), turns: [], current: null, final: null, modelCalls: [] };
  let last = 0; const progress = (force = false) => { if (o.onProgress && (force || Date.now() - last > 500)) { last = Date.now(); o.onProgress(snap); } };
  const model = recording(o.model, o.variant, snap.modelCalls, o.callMs, progress);
  const past = [...(kase.turns ?? [])]; let canvas: { nodes: unknown[]; edges: unknown[] } | null = null;
  const queue = [kase.prompt, ...(kase.followUps ?? DEFAULT_FOLLOW_UPS)];
  for (const text of queue) {
    // Route name "refuseless" only makes the app emit its redacted build trace (it does so for paid routes); deps.model replaces the real provider.
    // choice "auto" keeps the production path (the QA-only media judge is not called).
    const selection = { ok: true as const, routes: [{ name: "refuseless" as const, baseURL: "harness", apiKey: "harness", model: o.modelId, maxTokens: o.maxTokens }], strict: true, choice: "auto" as const };
    const res = await unifiedResponse({ userId: "eval-harness", workflowId: `eval-${kase.id}`, text, canvas, past: [...past], snapshotText: "", templates: [], selection, draftMode: false,
      deps: { model: () => model, append: async () => {}, judge: async () => ({}),
        connectOutcome: async (_u: string, a: string) => ({ kind: "manual", name: a, fields: ["credentials"] }) as never,
        connectionStatuses: async (_u: string, apps: string[]) => Object.fromEntries(apps.map((a) => [a, "not_connected" as const])),
        ...(o.catalogText ? { catalogText: o.catalogText } : {}),
        discover: o.discover ?? (async () => ({ items: [] })) } });
    // Read the event stream as it arrives, so a cut run keeps what the app already sent in this turn.
    const ev: Ev[] = []; let buf = ""; const dec = new TextDecoder(); const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const take = (line: string) => { if (!line.startsWith("data: ")) return; try { const e = JSON.parse(line.slice(6)) as Ev; ev.push(e); snap.current = { ...turnOf(text, ev), cut: true }; progress(e.type !== "text-delta"); } catch { /* not JSON */ } };
    for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop() ?? ""; lines.forEach(take); }
    take(buf);
    const turn = turnOf(text, ev); snap.turns.push(turn); snap.current = null; past.push({ role: "user", content: text }, { role: "assistant", content: turn.assistant.trim() });
    if (turn.canvasFinal) { snap.final = turn.canvasFinal as FinalCanvas; canvas = { nodes: snap.final.nodes, edges: snap.final.edges }; }
    progress(true);
    if (turn.built || turn.error) break;
  }
  return { schema: 2, caseId: kase.id, variant: o.variant, modelId: o.modelId, ms: Date.now() - snap.startedAt, input: { turns: kase.turns ?? [], prompt: kase.prompt },
    turns: snap.turns, final: snap.final, modelCalls: snap.modelCalls, checks: checksFor(kase, snap.final, snap.turns) };
}

export type Job = { kase: Case; variant: Variant; modelId: string; maxTokens: number; callMs: number; model: Record<string, unknown> | { fake: string }; liveDiscover?: boolean; env?: Record<string, string> };
export type Termination = { by: "completed" | "harness-run-timeout" | "worker-crash" | "worker-error"; runMs: number; elapsedMs: number; pid?: number; detail?: string };
export const PROVIDER_NOTE = "Aborting a call or killing the worker closes the connection on this side only; the provider may keep processing and bill the request.";

/**
 * Runs one case in a child process (worker.mts) under a HARD run-level limit `runMs`: at the limit the process is killed (SIGKILL),
 * so no pending request, timer or stream survives locally even if the provider or client ignored every abort. The worker writes a
 * snapshot after each recorded event; on a kill the artifact is assembled from the last snapshot and says what is incomplete.
 */
export async function runIsolated(job: Job, runMs: number, dir: string) {
  const fs = await import("node:fs"); const path = await import("node:path"); const { fork } = await import("node:child_process");
  const tag = `${job.kase.id}-${job.variant}-${process.pid}-${Date.now()}`; const files = { job: path.join(dir, `${tag}.job.json`), partial: path.join(dir, `${tag}.partial.json`), result: path.join(dir, `${tag}.result.json`) };
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(files.job, JSON.stringify(job));
  const t0 = Date.now(); let stderr = "";
  const child = fork(new URL("./worker.mts", import.meta.url).pathname, [files.job, files.partial, files.result], { env: { ...process.env, ...job.env }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  child.stderr?.on("data", (d) => { stderr = (stderr + d).slice(-2000); });
  let killed = false; const timer = setTimeout(() => { killed = true; child.kill("SIGKILL"); }, runMs);
  const code = await new Promise<number | null>((r) => child.on("exit", (c) => r(c)));
  clearTimeout(timer);
  const read = (f: string) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
  const result = read(files.result); const partial = read(files.partial) as Snapshot | null;
  for (const f of Object.values(files)) fs.rmSync(f, { force: true });
  const elapsedMs = Date.now() - t0;
  if (result && !result.workerError) return { ...result, termination: { by: "completed", runMs, elapsedMs, pid: child.pid } as Termination, providerNote: PROVIDER_NOTE };
  const termination: Termination = killed ? { by: "harness-run-timeout", runMs, elapsedMs, pid: child.pid, detail: `run killed at the harness limit of ${runMs} ms` }
    : result?.workerError ? { by: "worker-error", runMs, elapsedMs, detail: String(result.workerError) } : { by: "worker-crash", runMs, elapsedMs, detail: `exit ${code}: ${stderr.slice(-600)}` };
  const turns = [...(partial?.turns ?? []), ...(partial?.current ? [partial.current] : [])];
  const modelCalls = partial?.modelCalls ?? []; const final = (partial?.current?.canvasFinal as FinalCanvas | null) ?? partial?.final ?? null;
  const incomplete = [
    ...(partial ? [] : ["no snapshot: nothing was recorded before the cut"]),
    ...turns.filter((t) => t.cut).map((t) => `turn "${t.user.slice(0, 40)}": cut before the app finished it (no final result${t.canvasFinal ? "" : ", no final canvas"}${t.buildTrace ? "" : ", no build trace"})`),
    ...modelCalls.filter((c) => !c.done && !c.error).map((c) => `model call ${c.n} (${c.stage}): no end recorded; text/tool calls up to the last snapshot, usage unknown`),
    ...(final ? ["final graph is the last canvas the app sent before the cut; later changes, if any, are lost"] : ["no final graph"]),
    "events after the last snapshot (at most ~0.5 s of streamed text) may be missing",
  ];
  return { schema: 2, caseId: job.kase.id, variant: job.variant, modelId: job.modelId, ms: elapsedMs, input: { turns: job.kase.turns ?? [], prompt: job.kase.prompt },
    turns, final, modelCalls, checks: checksFor(job.kase, final, turns), termination, incomplete, providerNote: PROVIDER_NOTE };
}
