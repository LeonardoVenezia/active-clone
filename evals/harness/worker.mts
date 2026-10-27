// Child process for runIsolated (drive.mts): runs ONE case and exits. argv: <job.json> <partial.json> <result.json>.
// Writes a snapshot after each recorded event (atomic rename) so a hard kill keeps everything up to the last event.
// process.exit at the end drops anything a provider left pending (requests that ignored the abort, timers).
import fs from "node:fs";
await import("./setup.mjs");
const { runCase } = await import("./drive.mjs");
const [jobFile, partialFile, resultFile] = process.argv.slice(2);
const job = JSON.parse(fs.readFileSync(jobFile, "utf8"));
const save = (f: string, v: unknown) => { fs.writeFileSync(`${f}.tmp`, JSON.stringify(v)); fs.renameSync(`${f}.tmp`, f); };

async function makeModel() {
  if (job.model.fake) return (await import("./fakes.mjs")).FAKES[job.model.fake]();
  const m = job.model;
  if (m.kind === "google") return (await import("@ai-sdk/google")).createGoogleGenerativeAI({ apiKey: process.env[m.envKey] })(m.model);
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
