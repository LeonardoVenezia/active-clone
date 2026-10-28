// Scripted language models (spec v2) for the OFFLINE tests. No network. Also loadable by worker.mts by name (FAKES) so the
// isolation and timeout paths are tested in a real child process. They prove harness behavior, never model quality.
const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
type P = Record<string, unknown>;
export const textStream = (s: string): P[] => [{ type: "stream-start", warnings: [] }, { type: "text-start", id: "x" }, { type: "text-delta", id: "x", delta: s }, { type: "text-end", id: "x" }, { type: "finish", finishReason: "stop", usage }];
const toolCalls = (cs: [string, object][]): P[] => cs.map(([n, i]) => ({ type: "tool-call", toolCallId: `c${Math.random()}`, toolName: n, input: JSON.stringify(i) }));
export const calls = (cs: [string, object][]): P[] => [{ type: "stream-start", warnings: [] }, ...toolCalls(cs), { type: "finish", finishReason: "tool-calls", usage }];
export const FORMULA = "{\"pedidos\": $count(o), \"total\": $sum(o.total)}";
const steps: [string, object][] = [["start_build", { plan: "Schedule 9am; search-orders ayer; Fórmula cantidad y total; Slack #ventas" }],
  ["add_node", { id: "t", nodeType: "trigger", label: "Cada mañana", actionType: "Schedule", config: { scheduleCron: "0 9 * * *" } }],
  ["add_node", { id: "s", nodeType: "action", label: "Buscar pedidos", actionType: "tiendanube/search-orders", config: { createdAtMin: "2026-10-27T00:00:00-03:00" } }],
  ["add_node", { id: "f", nodeType: "action", label: "Totales", actionType: "Fórmula", config: { input: "{\"o\": {{@s:Buscar pedidos.orders}}}", expression: FORMULA } }],
  ["add_node", { id: "sl", nodeType: "action", label: "Avisar", actionType: "slack/send-message", config: { slackChannel: "#ventas", slackMessage: "Pedidos: {{@f:Totales.result.pedidos}} Total: {{@f:Totales.result.total}}" } }],
  ["connect", { source: "t", target: "s" }], ["connect", { source: "s", target: "f" }], ["connect", { source: "f", target: "sl" }]];
export const build = (extra: [string, object][] = []) => calls([...steps, ...extra]);
export const orphanBuild = () => build([["add_node", { id: "x", nodeType: "action", label: "Suelto", actionType: "tiendanube/search-orders", config: {} }]]);

type Reply = P[] | ((o: { abortSignal?: AbortSignal }) => Promise<{ stream: ReadableStream<P> }>);
const model = (replies: Reply[]) => { let n = 0; const seen: string[] = []; return { seen, m: { specificationVersion: "v2", provider: "mock", modelId: "mock", supportedUrls: {}, doGenerate: async () => { throw new Error("n/a"); },
  doStream: async (o: { prompt: unknown; abortSignal?: AbortSignal }) => { seen.push(JSON.stringify(o.prompt)); const r = replies[Math.min(n++, replies.length - 1)];
    return typeof r === "function" ? r(o) : { stream: new ReadableStream({ start(c) { for (const p of r) c.enqueue(p); c.close(); } }) }; } } }; };
/** Plays `steps` in order (the last one repeats). */
export const scripted = (s: P[][]) => model(s);

// Misbehaving providers. "Ignores the abort": never looks at the signal and keeps a timer alive, like a stuck socket would.
const stuck = () => { setInterval(() => {}, 1000); };
const never = () => new Promise<never>(() => { stuck(); });
/** Emits `parts` and then nothing, forever; cancel is ignored too (pull never settles). */
const stall = (parts: P[]) => async () => { stuck(); let sent = false; return { stream: new ReadableStream<P>({ pull(c) { if (!sent) { sent = true; for (const p of parts) c.enqueue(p); return; } return new Promise<void>(() => {}); }, cancel: () => new Promise<void>(() => {}) }) }; };
const startOfBuild = [{ type: "stream-start", warnings: [] }, ...toolCalls(steps.slice(0, 3))];
const econnreset = () => Object.assign(new TypeError("terminated"), { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET", errno: -54, syscall: "read" }) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const FAKES: Record<string, () => unknown> = {
  /** doStream never resolves and ignores the abort. */
  "hang-before-stream": () => model([() => never()]).m,
  /** Turn 1 asks a question; in turn 2 the stream sends the start of a build and then stalls, ignoring abort and cancel. */
  "stall-mid-stream": () => model([textStream("¿Uso el canal #ventas?"), stall(startOfBuild)]).m,
  /** The connection resets after the start of a build (undici-style TypeError "terminated" with cause ECONNRESET). */
  econnreset: () => model([async () => ({ stream: new ReadableStream<P>({ async pull(c) { for (const p of startOfBuild) c.enqueue(p); await sleep(50); c.error(econnreset()); } }) }), textStream("Listo.")]).m,
  /** The provider answers HTTP 503 on the first call. */
  "provider-503": () => model([async () => { throw Object.assign(new Error("Service Unavailable"), { name: "AI_APICallError", statusCode: 503, isRetryable: true }); }]).m,
  /** Builds a graph with a validator error; the next step is slow, so the app's build cap (AI_BUILD_CAP_MS) is reached. Well-behaved provider. */
  cap: () => model([orphanBuild(), async () => { await sleep(600); return { stream: new ReadableStream({ start(c) { for (const p of textStream("Armé.")) c.enqueue(p); c.close(); } }) }; }, textStream("Listo.")]).m,
};
