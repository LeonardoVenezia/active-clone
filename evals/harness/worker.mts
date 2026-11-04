// Child process for runIsolated (drive.mts): runs ONE case and exits. argv: <job.json> <partial.json> <result.json>.
// Writes a snapshot after each recorded event (atomic rename) so a hard kill keeps everything up to the last event.
// process.exit at the end drops anything a provider left pending (requests that ignored the abort, timers).
import fs from "node:fs";
await import("./setup.mjs");
const { runCase } = await import("./drive.mjs");
const [jobFile, partialFile, resultFile] = process.argv.slice(2);
const job = JSON.parse(fs.readFileSync(jobFile, "utf8"));
const save = (f: string, v: unknown) => { fs.writeFileSync(`${f}.tmp`, JSON.stringify(v)); fs.renameSync(`${f}.tmp`, f); };

// Optional resume support (EVAL_REPLAY_DIR): successful (200) model responses are stored by sha256(url + body) and replayed on an identical request,
// so a run that a per-command time limit cut short can be continued without paying again for calls it already made. Headers (the API key) are never
// stored. A call that was in flight when the process was killed is not cached and is issued again. Hits/misses go to <dir>/log.txt.
const replayDir = process.env.EVAL_REPLAY_DIR;
const replayFetch: typeof fetch | undefined = replayDir ? (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  const body = typeof init?.body === "string" ? init.body : "";
  const { createHash } = await import("node:crypto");
  const key = createHash("sha256").update(url).update("\0").update(body).digest("hex");
  fs.mkdirSync(replayDir, { recursive: true });
  const f = `${replayDir}/${key}.json`;
  if (fs.existsSync(f)) { const c = JSON.parse(fs.readFileSync(f, "utf8")); fs.appendFileSync(`${replayDir}/log.txt`, `hit ${key.slice(0, 8)}\n`); return new Response(c.text, { status: c.status, headers: c.headers }); }
  fs.appendFileSync(`${replayDir}/log.txt`, `miss ${key.slice(0, 8)}\n`);
  const res = await fetch(input, init); const text = await res.text();
  const headers: Record<string, string> = {}; const ct = res.headers.get("content-type"); if (ct) headers["content-type"] = ct;
  if (res.status === 200) { fs.writeFileSync(`${f}.tmp`, JSON.stringify({ status: 200, headers, text })); fs.renameSync(`${f}.tmp`, f); }
  return new Response(text, { status: res.status, headers });
}) as typeof fetch : undefined;
async function makeModel() {
  if (job.model.fake) return (await import("./fakes.mjs")).FAKES[job.model.fake]();
  const m = job.model;
  if (m.kind === "google") return (await import("@ai-sdk/google")).createGoogleGenerativeAI({ apiKey: process.env[m.envKey], ...(replayFetch ? { fetch: replayFetch } : {}) })(m.model);
  return (await import("@ai-sdk/openai-compatible")).createOpenAICompatible({ name: m.id, apiKey: process.env[m.envKey], baseURL: m.baseURL })(m.model);
}
try {
  const discover = job.liveDiscover ? (await import("../../plugins/composio/steps/catalog")).discoverComposio as never : undefined;
  const fake = !!job.model.fake;
  const a = await runCase(job.kase, { model: await makeModel(), variant: job.variant, modelId: job.modelId, maxTokens: job.maxTokens, callMs: job.callMs, discover,
    ...(fake ? { catalogText: async () => "CATALOG" } : {}), onProgress: (s) => save(partialFile, s) });
  save(resultFile, a);
} catch (e) { save(resultFile, { workerError: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }); }
process.exit(0);
