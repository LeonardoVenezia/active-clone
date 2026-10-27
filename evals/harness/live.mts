// Real-model evaluation runner. DRY RUN by default: prints the matrix, missing keys and a token/cost estimate, calls nothing.
//   npx tsx evals/harness/live.mts --cases new|all|C-14,C-15 --variants current,no-correctives --models ds-refuseless --k 3 [--call-ms N] [--run-ms N] [--run] [--allow-paid]
// With --run: runs sequentially (no parallel load on one account), each run in its own worker process, and writes one artifact per
// run plus summary.jsonl and summary.txt under <out>/<stamp>/.
// Limits: --call-ms per model call (the app receives an error at the limit) and --run-ms per whole run (all turns; the worker is
// killed). Neither stops the provider: it may keep processing and bill a request after the harness gives up on it.
// Artifacts hold model output and stay OUT of the (public) repo: <out> defaults to ~/active-clone-eval-runs (or EVAL_OUT_DIR / --out)
// and a path inside the repository is refused.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { execSync } from "node:child_process";
await import("./setup.mjs");
const { runIsolated, PROVIDER_NOTE } = await import("./drive.mjs");
const { runSummary, render } = await import("./summary.mjs");

const arg = (k: string, d?: string) => { const a = process.argv.slice(2); const i = a.indexOf(`--${k}`); return i < 0 ? d : a[i + 1]; };
const flag = (k: string) => process.argv.includes(`--${k}`);
const here = path.dirname(new URL(import.meta.url).pathname);
type M = { id: string; kind: "openai-compatible" | "google"; baseURL?: string; model: string; envKey: string; maxTokens: number; paid: boolean; priceInPerM: number | null; priceCachedInPerM: number | null; priceOutPerM: number | null };
const MODELS: M[] = JSON.parse(fs.readFileSync(path.join(here, "models.json"), "utf8")).models;
const ALL = fs.readFileSync(path.join(here, "../cases.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const NEW = ["C-14", "C-15", "C-16", "C-17"];
const sel = arg("cases", "new") as string;
const cases = sel === "all" ? ALL : ALL.filter((c) => (sel === "new" ? NEW : sel.split(",")).includes(c.id));
const variants = (arg("variants", "current,no-correctives") as string).split(",") as ("current" | "no-correctives")[];
const models = (arg("models", "ds-refuseless") as string).split(",").map((id) => { const m = MODELS.find((x) => x.id === id); if (!m) throw new Error(`unknown model ${id}`); return m; });
const k = Number(arg("k", "3"));
// Defaults: the app's build cap is 210 s per turn plus a 45 s guide pass; a run has up to 2 turns here.
const callMs = Number(arg("call-ms", "240000")); const runMs = Number(arg("run-ms", "720000"));
const repoRoot = execSync("git rev-parse --show-toplevel").toString().trim();
const outBase = path.resolve(arg("out") ?? process.env.EVAL_OUT_DIR ?? path.join(os.homedir(), "active-clone-eval-runs"));
const rel = path.relative(repoRoot, outBase); const outInsideRepo = rel === "" || !(rel.startsWith("..") || path.isAbsolute(rel));

// Estimate (HYPOTHESIS until the pilot measures real usage): the first call carries ~65k chars of system+catalog (measured offline,
// evals/harness, 3024e63) ~= 16-19k tokens at 3.5-4 chars/token, plus tool definitions. Calls per run: 4 (few multi-tool steps, no
// corrections) to 30 (one tool per step, 3 corrective rounds, multi-step guide). Output: 2k-10k tokens per run.
const EST = { low: { calls: 4, inPerCall: 19_000, out: 2_000 }, high: { calls: 30, inPerCall: 25_000, out: 10_000 } };
const runs = cases.length * variants.length * models.length * k;
console.log(`matrix: ${cases.length} cases x ${variants.length} variants x ${models.length} models x k=${k} = ${runs} runs`);
console.log(`cases: ${cases.map((c) => c.id).join(", ")}\nvariants: ${variants.join(", ")}\nlimits: ${callMs} ms per model call, ${runMs} ms per run (hard kill). ${PROVIDER_NOTE}`);
let blocked = false;
for (const m of models) {
  const n = cases.length * variants.length * k; const lo = { in: n * EST.low.calls * EST.low.inPerCall, out: n * EST.low.out }; const hi = { in: n * EST.high.calls * EST.high.inPerCall, out: n * EST.high.out };
  const cost = (t: { in: number; out: number }) => m.priceInPerM == null || m.priceOutPerM == null ? "price not set" : `$${((t.in / 1e6) * m.priceInPerM + (t.out / 1e6) * m.priceOutPerM).toFixed(2)} (no cache discount)`;
  const problems = [m.model === "TO_CONFIRM" || m.baseURL === "TO_CONFIRM" ? "model/baseURL TO_CONFIRM" : "", process.env[m.envKey] ? "" : `missing ${m.envKey}`, m.paid && !flag("allow-paid") ? "paid route: needs --allow-paid" : ""].filter(Boolean);
  if (problems.length) blocked = true;
  console.log(`- ${m.id} (${m.model}${m.paid ? ", PAID" : ""}): ${n} runs, input ${(lo.in / 1e6).toFixed(1)}M-${(hi.in / 1e6).toFixed(1)}M tok, output ${(lo.out / 1e6).toFixed(2)}M-${(hi.out / 1e6).toFixed(2)}M tok, cost ${cost(lo)} - ${cost(hi)}${problems.length ? `  [BLOCKED: ${problems.join("; ")}]` : ""}`);
}
console.log(`artifacts: ${outBase}${outInsideRepo ? "  [BLOCKED: inside the repository; use a path outside it]" : ""}`);
if (outInsideRepo) blocked = true;
if (!process.env.COMPOSIO_API_KEY) console.log("note: COMPOSIO_API_KEY not set: external app discovery is stubbed (recorded in each artifact); cases that need Gmail/Sheets/Docs are biased.");
if (!flag("run")) { console.log("\nDRY RUN: nothing was called. Add --run to execute."); process.exit(0); }
if (blocked) { console.log("\nnot running: fix the BLOCKED items above."); process.exit(2); }

const commit = execSync("git rev-parse --short HEAD").toString().trim(); const dirty = execSync("git status --porcelain -- app lib plugins").toString().trim() !== "";
const out = path.join(outBase, `${new Date().toISOString().replace(/[:.]/g, "-")}-${commit}`); fs.mkdirSync(out, { recursive: true });
const rows = [];
for (const m of models) for (const c of cases) for (const v of variants) for (let i = 1; i <= k; i++) {
  const a = await runIsolated({ kase: c, variant: v, modelId: m.model, maxTokens: m.maxTokens, callMs, model: m, liveDiscover: !!process.env.COMPOSIO_API_KEY }, runMs, path.join(out, ".work"));
  Object.assign(a, { run: i, model: m.id, commit, productCodeDirty: dirty, composio: process.env.COMPOSIO_API_KEY ? "live" : "stubbed" });
  fs.writeFileSync(path.join(out, `${c.id}__${v}__${m.id}__${i}.json`), JSON.stringify(a, null, 1));
  const row = runSummary(a); rows.push({ ...row, checks: a.checks ?? [] });
  fs.appendFileSync(path.join(out, "summary.jsonl"), `${JSON.stringify(row)}\n`); console.log(`${c.id} ${v} ${m.id} #${i}: ${row.evaluation}, ${row.termination}, incidents ${row.incidents.map((x) => x.kind).join(",") || "none"}`);
}
fs.rmSync(path.join(out, ".work"), { recursive: true, force: true });
const report = render(rows); fs.writeFileSync(path.join(out, "summary.txt"), `${report}\n`); console.log(`\n${report}\n\nartifacts: ${out}`);
process.exit(0);
