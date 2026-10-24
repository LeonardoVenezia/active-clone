// D (proposal + test only, NOT wired into validateFlow). Separates three notions on a DAG under the engine's any-parent-once join
// (a node starts when its FIRST completed active parent finishes; lib/workflow-executor.workflow.ts "Merge semantics"):
//  reachable(X,Y)        X is an ancestor of Y.
//  guaranteedBefore(X,Y) in EVERY run X has completed before Y starts: for every parent p of Y, X==p or guaranteedBefore(X,p).  (all parents of Y, because Y may start after ANY one of them)
//  AND-join              Y waits for ALL parents. Not what the engine does; adding an edge X->Y adds a parent and can only make Y start EARLIER.
// The sweep below is a MODEL of the join rule (random durations), compared with the helper. The real engine was exercised separately (engine-join.mts, prod graph).
type G = Record<string, string[]>; // node -> parents
const reachable = (g: G, x: string, y: string): boolean => (g[y] ?? []).some((p) => p === x || reachable(g, x, p));
const guaranteedBefore = (g: G, x: string, y: string, memo = new Map<string, boolean>()): boolean => {
  const k = `${x}>${y}`; if (memo.has(k)) return memo.get(k)!;
  const ps = g[y] ?? []; const r = ps.length > 0 && ps.every((p) => p === x || guaranteedBefore(g, x, p, memo)); memo.set(k, r); return r;
};
// model: durations d; node completes at start+d; root starts at 0; Y starts at min over parents of completion (any-parent-once)
const simulate = (g: G, nodes: string[], d: Record<string, number>) => {
  const start: Record<string, number> = {}, end: Record<string, number> = {};
  for (const n of nodes) { const ps = g[n] ?? []; start[n] = ps.length ? Math.min(...ps.map((p) => end[p])) : 0; end[n] = start[n] + d[n]; }
  return { start, end };
};
const res: [string, boolean][] = []; const t = (n: string, ok: boolean) => res.push([n, ok]);
// property sweep over random DAGs (nodes in topological order n0..n5)
let rng = 12345; const rnd = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
let bad = 0, pairs = 0, reachNotGuaranteed = 0;
for (let it = 0; it < 400; it++) {
  const nodes = Array.from({ length: 6 }, (_, i) => `n${i}`); const g: G = {};
  nodes.forEach((n, i) => { g[n] = i === 0 ? [] : nodes.slice(0, i).filter(() => rnd() < 0.4); if (i > 0 && !g[n].length) g[n] = [nodes[Math.floor(rnd() * i)]]; });
  const runs = Array.from({ length: 40 }, () => Object.fromEntries(nodes.map((n) => [n, 1 + Math.floor(rnd() * 9)]))).map((d) => simulate(g, nodes, d));
  for (const x of nodes) for (const y of nodes) { if (x === y) continue; pairs++;
    const always = runs.every((r) => r.end[x] <= r.start[y]); const gb = guaranteedBefore(g, x, y);
    if (gb && !always) bad++;                       // helper claims guaranteed but a run violates -> unsound
    if (reachable(g, x, y) && !gb) reachNotGuaranteed++;
  }
}
t(`helper is SOUND on ${pairs} pairs (never claims order that a sampled run violates): violations=${bad}`, bad === 0);
t(`reachability is strictly weaker than guaranteed order (${reachNotGuaranteed} ancestor pairs were not guaranteed)`, reachNotGuaranteed > 0);
// the prod graph shape: loop-guiones refs detail-ml; approve refs texto-guiones with a parallel parent loop-guiones
const prod: G = { research: ["ml", "tn"], ml: ["t"], tn: ["t"], dml: ["ml"], dtn: ["tn"], loopg: ["research"], texto: ["loopg"], approve: ["texto", "loopg"], t: [] };
t("detail-ml is reachable but NOT guaranteed before loop-guiones (research starts when the first parent ends)", guaranteedBefore(prod, "dml", "loopg") === false);
const g2: G = { t: [], a: ["t"], slow: ["t"], y: ["a"], y2: ["a", "slow"] };
t("y2 has parents a and slow: a is a parent but NOT guaranteed before y2 (slow may complete first)", guaranteedBefore(g2, "a", "y2") === false);
t("extra edge slow->y does NOT make y wait for slow (adds a parent, y starts earlier or equal)", (() => { const g3: G = { t: [], a: ["t"], slow: ["t"], y: ["a", "slow"] }; const r = simulate(g3, ["t", "a", "slow", "y"], { t: 1, a: 1, slow: 9, y: 1 }); return r.start.y === 2 && r.end.slow === 10; })());
t("approve refs texto-guiones; loopg->approve parallel parent: texto NOT guaranteed before approve", guaranteedBefore(prod, "texto", "approve") === false);
t("same graph with the direct loopg->approve edge removed: texto IS guaranteed before approve", guaranteedBefore({ ...prod, approve: ["texto"] }, "texto", "approve") === true);
t("dominance would reject a valid alternative-branch ref: cond->(a|b)->y, y reads a only when a ran (b branch leaves it literal) => a not guaranteed", guaranteedBefore({ c: [], a: ["c"], b: ["c"], y: ["a", "b"] }, "a", "y") === false);
let f = 0; for (const [k, ok] of res) { console.log(ok ? "PASS" : "FAIL", k); if (!ok) f++; } console.log(`${res.length - f}/${res.length}`); process.exit(f ? 1 : 0);
