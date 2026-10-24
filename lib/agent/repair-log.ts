// REPORT-ONLY, pure: sanitized before/after diff of node configs around a deterministic repair. Not wired into the app.
// Values are redacted for secret-looking keys and truncated, so a log never carries credentials or long user data.
export type RepairEntry = { repair: string; nodeId: string; path: string; before: string; after: string };
type NodeLike = { id: string; data?: unknown };
const SECRET_KEY = /(token|secret|password|passwd|api[-_]?key|authorization|bearer|cookie|credential|private)/i;
const MAX = 80;

function flat(v: unknown, path: string, out: Map<string, string>): void {
  if (Array.isArray(v)) { v.forEach((x, i) => flat(x, `${path}[${i}]`, out)); if (!v.length) out.set(path, "[]"); }
  else if (v && typeof v === "object") { const e = Object.entries(v as Record<string, unknown>); e.forEach(([k, x]) => flat(x, path ? `${path}.${k}` : k, out)); if (!e.length) out.set(path, "{}"); }
  else out.set(path, v === undefined ? "undefined" : JSON.stringify(v));
}
const show = (path: string, val: string | undefined): string => {
  if (val === undefined) return "(absent)";
  const last = path.split(/[.[]/).filter(Boolean).pop() ?? "";
  if (SECRET_KEY.test(last) || SECRET_KEY.test(path)) return "[redacted]";
  return val.length > MAX ? `${val.slice(0, MAX)}...(${val.length} chars)` : val;
};
const snap = (nodes: NodeLike[]) => { const m = new Map<string, string>(); for (const n of nodes) flat((n.data as { config?: unknown } | undefined)?.config ?? {}, `${n.id}::`, m); return m; };

/** Runs `fn` (which may mutate the nodes' configs in place) and returns what changed, sanitized. */
export function recordRepair<T>(name: string, nodes: NodeLike[], fn: () => T): { result: T; entries: RepairEntry[] } {
  const before = snap(nodes);
  const result = fn();
  const after = snap(nodes);
  const entries: RepairEntry[] = [];
  for (const k of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(k) === after.get(k)) continue;
    const [nodeId, path] = k.split("::");
    entries.push({ repair: name, nodeId, path: path.replace(/^\./, ""), before: show(path, before.get(k)), after: show(path, after.get(k)) });
  }
  return { result, entries };
}
