// Run and case summaries without a single aggregate "pass". Keeps apart: deterministic checks (decided by the code), heuristic
// SIGNALS (regex/graph shape: evidence, never proof that the workflow works), unknown and na. Runs cut by the harness, a transport or
// provider error are "interrupted" and reported apart from complete evaluations; their checks are still shown (fails before the cut
// are not hidden). App limits (build cap, corrective rounds) are product behavior: they stay in complete evaluations, flagged, and
// their cause is not attributed.
import type { CheckResult, Status } from "./assertions.mjs";

export type IncidentKind = "harness-run-timeout" | "harness-call-timeout" | "transport" | "provider" | "app-limit" | "unclassified" | "worker-crash" | "worker-error";
export type Incident = { kind: IncidentKind; where: string; detail: string };
type Call = { n: number; stage: string; ms: number; error?: string; errorKind?: string };
// biome-ignore lint/suspicious/noExplicitAny: saved artifact
export type RunArtifact = Record<string, any> & { caseId: string; variant: string; checks?: CheckResult[]; modelCalls?: Call[] };
const INTERRUPTING = new Set<IncidentKind>(["harness-run-timeout", "harness-call-timeout", "transport", "provider", "unclassified", "worker-crash", "worker-error"]);

export function incidentsOf(a: RunArtifact): Incident[] {
  const out: Incident[] = [];
  if (a.termination && a.termination.by !== "completed") out.push({ kind: a.termination.by, where: "run", detail: String(a.termination.detail ?? "") });
  if (a.error) out.push({ kind: "worker-error", where: "run", detail: String(a.error) });
  for (const c of a.modelCalls ?? []) if (c.error) out.push({ kind: c.errorKind === "app-abort" ? "app-limit" : ((c.errorKind as IncidentKind) ?? "unclassified"), where: `call ${c.n} (${c.stage}, ${c.ms} ms)`, detail: c.errorKind === "app-abort" ? `ended by the app's own abort: ${c.error}` : c.error });
  (a.turns ?? []).forEach((t: { buildTrace?: { closeReason?: string; capMs?: number } }, i: number) => {
    const why = String(t.buildTrace?.closeReason ?? "").split("+");
    if (why.includes("cap-reached")) out.push({ kind: "app-limit", where: `turn ${i + 1}`, detail: `app build cap (${t.buildTrace?.capMs} ms) reached with validation errors left; cause not attributed` });
    if (why.includes("rounds-exhausted")) out.push({ kind: "app-limit", where: `turn ${i + 1}`, detail: "app ran its corrective rounds; validation errors remain" });
    if (why.includes("model-call-interrupted") && !(a.modelCalls ?? []).some((c) => c.error)) out.push({ kind: "unclassified", where: `turn ${i + 1}`, detail: "the app reports an interrupted model call but the harness recorded no call error" });
  });
  return out;
}

const group = (checks: CheckResult[], signal: boolean) => { const g: Record<Status, string[]> = { pass: [], fail: [], unknown: [], na: [] }; for (const c of checks) if (!!c.signal === signal) g[c.status].push(c.id); return g; };

export function runSummary(a: RunArtifact) {
  const incidents = incidentsOf(a); const checks = a.checks ?? [];
  return { case: a.caseId, variant: a.variant, model: a.model ?? a.modelId, run: a.run ?? null, ms: a.ms ?? null,
    evaluation: incidents.some((x) => INTERRUPTING.has(x.kind)) ? ("interrupted" as const) : ("complete" as const),
    termination: a.termination?.by ?? (a.error ? "worker-error" : "completed"), incidents, deterministic: group(checks, false), signals: group(checks, true), incomplete: a.incomplete ?? [] };
}
export type RunRow = ReturnType<typeof runSummary> & { checks?: CheckResult[] };

const list = (g: Record<Status, string[]>) => (["fail", "unknown", "pass", "na"] as Status[]).map((s) => `${s}: ${g[s].join(",") || "-"}`).join(" | ");
const tally = (rows: { checks: CheckResult[] }[], signal: boolean) => {
  const by = new Map<string, Record<Status, number>>();
  for (const r of rows) for (const c of r.checks) if (!!c.signal === signal) { const t = by.get(c.id) ?? { pass: 0, fail: 0, unknown: 0, na: 0 }; t[c.status]++; by.set(c.id, t); }
  return [...by].map(([id, t]) => `${id} ${t.pass}P/${t.fail}F/${t.unknown}U/${t.na}NA`).join("; ") || "-";
};

/** Text report: one line per run, then per case with complete and interrupted runs in separate buckets. Counts, not rates. */
export function render(rows: (RunRow & { checks: CheckResult[] })[]) {
  const out = ["Per run (deterministic = decided by the code; signals = heuristics, not proof the workflow works):"];
  for (const r of rows) out.push(`${r.case} ${r.variant} ${r.model} #${r.run ?? "-"} | ${r.evaluation} | termination ${r.termination} | ${Math.round((r.ms ?? 0) / 1000)} s`,
    `  incidents: ${r.incidents.map((x) => `${x.kind} @ ${x.where}`).join("; ") || "none"}`, `  deterministic ${list(r.deterministic)}`, `  signals       ${list(r.signals)}`,
    ...(r.incomplete.length ? [`  incomplete: ${r.incomplete.join("; ")}`] : []));
  out.push("", "Per case (P/F/U/NA counts; interrupted runs are partial evidence up to the cut and never mixed with complete ones):");
  for (const id of [...new Set(rows.map((r) => r.case))]) {
    const rs = rows.filter((r) => r.case === id); const done = rs.filter((r) => r.evaluation === "complete"); const cut = rs.filter((r) => r.evaluation === "interrupted");
    const kinds = (xs: typeof rs) => { const m = new Map<string, number>(); for (const r of xs) for (const k of new Set(r.incidents.map((i) => i.kind))) m.set(k, (m.get(k) ?? 0) + 1); return [...m].map(([k, n]) => `${k} x${n}`).join(", ") || "none"; };
    out.push(`${id}: ${rs.length} runs, ${done.length} complete, ${cut.length} interrupted`);
    for (const [name, xs] of [["complete", done], ["interrupted", cut]] as const) if (xs.length) out.push(`  ${name} (${xs.length}; runs with incidents: ${kinds(xs)})`, `    deterministic: ${tally(xs, false)}`, `    signals:       ${tally(xs, true)}`);
  }
  return out.join("\n");
}
