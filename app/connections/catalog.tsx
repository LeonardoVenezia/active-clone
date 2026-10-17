"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
type Permission = { id: string; label: string; risk: string };
type Preset = { id: string; toolkitId: string; title: string; grants: Permission[]; doesNotGrant: string[]; consentHint: string; notes?: string };
type Verification = { ok: boolean; checked: boolean; missing: { id: string; label: string }[]; unexpected: string[] };
type Connection = { id: string; toolkitId: string; status: "pending" | "active" | "needs_attention" | "failed"; label: string; verification: Verification | null; recovery: string | null; usedBy: string[] };
type TestResult = { ok: boolean; message: string; checkedAt: string };
type Toolkit = { id: string; name: string; description: string; logoUrl: string | null; categories: string[]; authKind: string; reviewed: boolean };
type NativeApp = { id: string; name: string; description: string; source: "native"; group: "app" | "platform"; connect: { kind: "oauth"; path: string } | { kind: "manual" }; actions: string[]; triggers: string[] };
type NativeConnection = { id: string; appId: string; source: "native"; label: string; status: "active"; createdAt: string };
type Data = { items: Toolkit[]; nextCursor: string | null; total: number | null; connections: Record<string, Connection[]>; featured: Preset[]; native?: { apps: NativeApp[]; connections: NativeConnection[] } };
const BADGE: Record<string, string> = { active: "Connected and verified", needs_attention: "Connected, permissions need attention", pending: "Waiting for consent", failed: "Not usable" };
const BADGE_CLASS: Record<string, string> = { active: "text-green-700", needs_attention: "text-destructive", pending: "text-muted-foreground", failed: "text-destructive" };
async function call(path: string, init?: RequestInit) {
  const r = await fetch(path, { cache: "no-store", ...init, signal: AbortSignal.timeout(60000) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Request failed.");
  return d;
}
function Grants({ preset }: { preset: Preset }) {
  return <div className="space-y-2 text-sm"><div><p className="font-semibold">This connection allows</p><ul className="list-disc pl-5">{preset.grants.map(g => <li key={g.id}>{g.label}</li>)}</ul></div><div><p className="font-semibold">It does not allow</p><ul className="list-disc pl-5">{preset.doesNotGrant.map(x => <li key={x}>{x}</li>)}</ul></div>{preset.notes && <p className="text-muted-foreground">{preset.notes}</p>}<p className="text-muted-foreground">On the provider's screen: {preset.consentHint}</p></div>;
}
export function Catalog({ signedIn }: { signedIn: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Toolkit[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState("");
  const [tests, setTests] = useState<Record<string, TestResult>>({});
  const [loadedAt, setLoadedAt] = useState<string>("");
  const lock = useRef(false);
  const load = useCallback(async (query: string, more?: string | null, quiet?: boolean) => {
    if (lock.current) return; lock.current = true;
    if (!quiet) { setBusy(more ? "Loading more apps..." : "Loading apps and connection status..."); setError(""); }
    try {
      const p = new URLSearchParams(); if (query) p.set("q", query); if (more) p.set("cursor", more);
      const d: Data = await call(`/api/connectors?${p}`);
      setData(d); setLoadedAt(new Date().toISOString()); setItems(prev => more ? [...prev, ...d.items] : d.items); setCursor(d.nextCursor);
    } catch (e) { setError(e instanceof Error ? e.message : "Request failed."); }
    finally { lock.current = false; setBusy(""); }
  }, []);
  useEffect(() => {
    if (!signedIn) return;
    const returned = new URLSearchParams(window.location.search).get("returned");
    if (returned) setNotice("You are back from the provider. We checked the permissions that were really granted; the result is shown on the connection below.");
    const t = setTimeout(() => void load(q), q ? 350 : 0);
    return () => clearTimeout(t);
  }, [signedIn, q, load]);
  async function connect(toolkitId: string) {
    if (lock.current) return; lock.current = true; setBusy("Opening the provider's consent screen..."); setError(""); setNotice("");
    try { const d = await call("/api/connectors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "connect", toolkitId }) }); window.location.assign(d.redirectUrl); }
    catch (e) { setError(e instanceof Error ? e.message : "Request failed."); lock.current = false; setBusy(""); }
  }
  async function test(toolkitId: string, connectionId: string) {
    if (lock.current) return; lock.current = true; setBusy("Testing the connection with a read-only call..."); setError("");
    try { const d: TestResult = await call("/api/connectors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "test", toolkitId, connectionId }) }); setTests(prev => ({ ...prev, [connectionId]: d })); }
    catch (e) { setTests(prev => ({ ...prev, [connectionId]: { ok: false, message: e instanceof Error ? e.message : "Test failed.", checkedAt: new Date().toISOString() } })); }
    finally { lock.current = false; setBusy(""); }
  }
  function ConnectionRow({ c, preset }: { c: Connection; preset: Preset }) {
    return <div className={"rounded-lg border p-3 space-y-2 " + (c.status === "needs_attention" || c.status === "failed" ? "border-destructive" : "")}>
      <p className="text-sm"><span className={"font-semibold " + BADGE_CLASS[c.status]}>{BADGE[c.status]}</span> · {c.label}</p>
      {c.recovery && <div role="alert" className="text-sm space-y-2"><p>{c.recovery}</p><Button size="sm" disabled={!!busy} onClick={() => void connect(preset.toolkitId)}>Reconnect with reviewed permissions</Button></div>}
      {c.usedBy.length > 0 && <p className="text-xs text-muted-foreground">Used by: {c.usedBy.join(", ")}</p>}
      {c.status === "active" && <p className="text-xs text-muted-foreground">Granted permissions match the reviewed setup exactly. Last verified {new Date((tests[c.id]?.checkedAt) || loadedAt).toLocaleTimeString()}.</p>}
      {c.status !== "pending" && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void test(preset.toolkitId, c.id)}>Test connection</Button>}
      {tests[c.id] && <p role={tests[c.id].ok ? "status" : "alert"} className={"text-sm " + (tests[c.id].ok ? "text-green-700" : "text-destructive")}>{tests[c.id].message}</p>}
      <details className="text-xs text-muted-foreground"><summary>Connection ID</summary><span className="break-all">{c.id}</span></details>
    </div>;
  }
  if (!signedIn) return null;
  const featuredIds = new Set((data?.featured ?? []).map(f => f.toolkitId));
  return <div className="space-y-6">
    {(data?.native?.apps.length ?? 0) > 0 && <section className="space-y-3"><h2 className="text-lg font-bold">Apps del proyecto</h2><p className="text-sm text-muted-foreground">Integraciones nativas de Active-clone, sin intermediarios. Es la misma lista que leen el chat y el editor.</p>
      <div className="grid gap-3 sm:grid-cols-2">{data?.native?.apps.filter(a => a.group !== "platform").map(a => { const conns = (data?.native?.connections ?? []).filter(c => c.appId === a.id); return <article key={a.id} className="rounded-xl border p-4 space-y-2">
        <h3 className="font-semibold">{a.name}</h3>
        <p className="text-xs text-muted-foreground line-clamp-2">{a.description}</p>
        {conns.map(c => <p key={c.id} className="text-sm"><span className="font-semibold text-green-700">Conectada</span> · {c.label}</p>)}
        {a.connect.kind === "oauth" ? <a className="inline-flex h-8 items-center rounded-md bg-primary px-3 font-medium text-primary-foreground text-sm" href={a.connect.path}>{conns.length ? "Conectar otra cuenta" : "Conectar"}</a> : <p className="text-xs text-muted-foreground">Se conecta con credenciales desde el editor (agregá un paso de esta app y cargá la conexión ahí).</p>}
      </article>; })}</div>
      {(data?.native?.apps.some(a => a.group === "platform")) && <details className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold text-sm">Plataforma (componentes internos de la app)</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">{data?.native?.apps.filter(a => a.group === "platform").map(a => { const conns = (data?.native?.connections ?? []).filter(c => c.appId === a.id); return <article key={a.id} className="rounded-lg border p-3 space-y-1">
          <h3 className="font-semibold text-sm">{a.name}</h3>
          <p className="text-xs text-muted-foreground line-clamp-2">{a.description}</p>
          {conns.map(c => <p key={c.id} className="text-xs"><span className="font-semibold text-green-700">Conectada</span> · {c.label}</p>)}
        </article>; })}</div>
      </details>}
    </section>}
    {busy && <p role="status" className="rounded-lg border border-primary p-4 animate-pulse">{busy}</p>}
    {notice && <p role="status" className="rounded-lg border border-green-600 p-4 text-sm">{notice}</p>}
    {error && <p role="alert" className="rounded-lg border border-destructive p-4 text-sm text-destructive">{error}</p>}
    <section className="space-y-3"><h2 className="text-lg font-bold">Ready to connect</h2><p className="text-sm text-muted-foreground">Each of these has a reviewed, minimal permission setup. After you approve, we check what was actually granted and tell you exactly what to fix if something is missing.</p>
      {(data?.featured ?? []).map(f => { const conns = data?.connections[f.toolkitId] ?? []; return <article key={f.id} className="rounded-xl border p-4 space-y-3"><h3 className="font-bold">{f.title}</h3>
        {conns.map(c => <ConnectionRow key={c.id} c={c} preset={f} />)}
        {confirm === f.toolkitId ? <div className="space-y-3 rounded-lg bg-muted p-3"><Grants preset={f} /><div className="flex gap-2"><Button disabled={!!busy} onClick={() => void connect(f.toolkitId)}>Continue to consent</Button><Button variant="outline" onClick={() => setConfirm("")}>Cancel</Button></div></div> : <Button variant={conns.length ? "outline" : "default"} disabled={!!busy} onClick={() => setConfirm(f.toolkitId)}>{conns.length ? "Connect another account" : "Connect"}</Button>}
      </article>; })}
    </section>
    <section className="space-y-3"><h2 className="text-lg font-bold">All apps</h2><p className="text-sm text-muted-foreground">The full catalog{data?.total ? ` (${data.total} apps)` : ""}. Apps without a reviewed permission setup cannot be connected yet, so nothing gets broader access than intended.</p>
      <input aria-label="Search apps" className="w-full rounded-lg border bg-background p-3 text-sm" placeholder="Search apps, for example Slack or Notion" value={q} onChange={e => setQ(e.target.value)} />
      <div className="grid gap-3 sm:grid-cols-2">{items.filter(t => !featuredIds.has(t.id)).map(t => <article key={t.id} className="rounded-xl border p-4 space-y-2"><div className="flex items-center gap-3">{t.logoUrl && <img src={t.logoUrl} alt="" className="h-6 w-6 object-contain" />}<h3 className="font-semibold">{t.name}</h3></div><p className="text-xs text-muted-foreground line-clamp-3">{t.description}</p><Button size="sm" variant="outline" disabled>Permissions not reviewed yet</Button></article>)}</div>
      {!items.length && !busy && <p className="text-sm">No apps found.</p>}
      {cursor && <Button variant="outline" disabled={!!busy} onClick={() => void load(q, cursor)}>Load more</Button>}
    </section>
  </div>;
}
