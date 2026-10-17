"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AuthDialog } from "@/components/auth/dialog";
import { useSession } from "@/lib/auth-client";
import { api } from "@/lib/api-client";

type Row = { id: string; name: string; href: string; kind: "mail" | "canvas"; status?: string; steps?: number; trigger?: string; manual?: boolean; updated?: string };
type W = { id: string; name: string; updatedAt?: string; nodes?: { data?: { type?: string; config?: { triggerType?: string } } }[] };

export default function FlowsPage() {
  const { data: session, isPending } = useSession();
  const signedIn = !!session?.user && !session.user.isAnonymous;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const out: Row[] = [];
      const r = await fetch("/api/flows", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (r.ok && Array.isArray(d.flows)) for (const f of d.flows) out.push({ id: f.id, name: f.name, href: `/workflows/mail/${f.id}`, kind: "mail", status: f.status, trigger: "Mail entrante" });
      const ws = (await api.workflow.getAll()) as W[];
      for (const w of ws.filter(w => w.name !== "__current__")) {
        const trig = (w.nodes || []).find(n => n.data?.type === "trigger");
        const t = trig?.data?.config?.triggerType || "Manual";
        out.push({ id: w.id, name: w.name, href: `/workflows/${w.id}`, kind: "canvas", steps: (w.nodes || []).filter(n => n.data?.type !== "trigger").length, trigger: t === "Manual" ? "Manual" : t === "Schedule" ? "Programado" : t === "Webhook" ? "Webhook" : t, manual: t === "Manual", updated: w.updatedAt });
      }
      setRows(out); setError("");
    } catch { setError("No pude cargar tus workflows. Recargá para reintentar."); setRows([]); }
  }, []);

  useEffect(() => { document.title = "Workflows | Active-clone"; if (!signedIn) { setRows([]); return; } void load(); }, [signedIn, load]);

  async function act(row: Row, action: "run" | "delete" | "pause" | "resume") {
    if (action === "delete" && !window.confirm(`¿Borrar "${row.name}"? Se borran también sus ejecuciones. No se puede deshacer.`)) return;
    setBusy(row.kind + row.id);
    try {
      if (action === "run") {
        const r = await fetch(`/api/workflow/${row.id}/execute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: {} }) });
        const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "No se pudo ejecutar.");
        toast.success(`Ejecutando "${row.name}". El resultado queda en Runs.`);
      } else if (action === "delete") {
        await fetch(`/api/workflows/${row.id}/executions`, { method: "DELETE" });
        const r = await fetch(`/api/workflows/${row.id}`, { method: "DELETE" });
        if (!r.ok) throw new Error("No se pudo borrar.");
        toast.success(`Borrado "${row.name}".`); await load();
      } else {
        const r = await fetch("/api/mail-flow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
        const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "No se pudo cambiar el estado.");
        toast.success(action === "pause" ? "Flujo pausado." : "Flujo reanudado."); await load();
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Algo falló."); } finally { setBusy(""); }
  }

  return <main className="pointer-events-auto fixed inset-0 z-20 flex flex-col bg-background"><AppHeader /><div className="flex-1 overflow-auto p-6"><div className="mx-auto max-w-5xl space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">Workflows</h1><Button asChild size="sm"><a href="/?new=1">+ Nuevo workflow</a></Button></div>
    {isPending ? <p>Cargando...</p> : !signedIn ? <div className="space-y-3 rounded-xl border p-5"><p className="font-semibold">Iniciá sesión para ver y crear workflows.</p><p className="text-sm text-muted-foreground">Se guardan en tu cuenta.</p><AuthDialog><Button>Sign In</Button></AuthDialog></div> : <>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {rows === null && <p>Cargando workflows...</p>}
      {rows?.length === 0 && !error && <p>Todavía no tenés workflows. <a className="underline" href="/?new=1">Creá uno.</a></p>}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{rows?.map(r => { const key = r.kind + r.id; const working = busy === key; return <li key={key} className="flex flex-col justify-between gap-4 rounded-xl border p-4"><div className="space-y-1"><div className="flex items-start justify-between gap-2"><p className="break-words font-semibold">{r.name}</p>{r.kind === "mail" && <span className={"shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium " + (r.status === "active" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800")}>{r.status === "active" ? "Activo" : r.status === "paused" ? "Pausado" : r.status}</span>}</div><p className="text-xs text-muted-foreground">{r.kind === "mail" ? "Email to sheet" : "Workflow de lienzo"} · Dispara: {r.trigger}{r.kind === "canvas" ? ` · ${r.steps} paso${r.steps === 1 ? "" : "s"}` : ""}</p></div>
        <div className="flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><Link href={r.href}>Editar</Link></Button>
          {r.kind === "canvas" && r.manual && <Button size="sm" disabled={working} onClick={() => void act(r, "run")}>Ejecutar</Button>}
          {r.kind === "mail" && (r.status === "active" ? <Button size="sm" variant="outline" disabled={working} onClick={() => void act(r, "pause")}>Pausar</Button> : <Button size="sm" disabled={working} onClick={() => void act(r, "resume")}>Reanudar</Button>)}
          {r.kind === "canvas" && <Button size="sm" variant="ghost" className="text-destructive" disabled={working} onClick={() => void act(r, "delete")}>Borrar</Button>}</div></li>; })}</ul>
    </>}
  </div></div></main>;
}
