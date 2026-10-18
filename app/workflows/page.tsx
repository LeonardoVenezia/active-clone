"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AuthDialog } from "@/components/auth/dialog";
import { useSession } from "@/lib/auth-client";
import { api } from "@/lib/api-client";

type Row = { id: string; name: string; href: string; kind: "mail" | "canvas"; status?: string; steps?: number; trigger?: string; manual?: boolean; updated?: string; shared?: boolean };
type Tpl = { id: string; name: string; description?: string | null; steps?: number; updatedAt?: string; orgId?: string | null; mine?: boolean; canManage?: boolean };
type W = { id: string; name: string; updatedAt?: string; shared?: boolean; nodes?: { data?: { type?: string; config?: { triggerType?: string } } }[] };

export default function FlowsPage() {
  const { data: session, isPending } = useSession();
  const signedIn = !!session?.user && !session.user.isAnonymous;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [templates, setTemplates] = useState<Tpl[] | null>(null);
  const [orgCtx, setOrgCtx] = useState<{ activeOrganizationId: string | null; canManageOrgTemplates: boolean }>({ activeOrganizationId: null, canManageOrgTemplates: false });
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
        out.push({ id: w.id, name: w.name, href: `/workflows/${w.id}`, kind: "canvas", steps: (w.nodes || []).filter(n => n.data?.type !== "trigger").length, trigger: t === "Manual" ? "Manual" : t === "Schedule" ? "Programado" : t === "Webhook" ? "Webhook" : t, manual: t === "Manual", updated: w.updatedAt, shared: !!w.shared });
      }
      setRows(out); setError("");
      try {
        const tr = await fetch("/api/templates", { cache: "no-store" });
        const td = await tr.json().catch(() => ({}));
        setTemplates(tr.ok && Array.isArray(td.templates) ? td.templates : []);
        setOrgCtx({ activeOrganizationId: td.activeOrganizationId || null, canManageOrgTemplates: !!td.canManageOrgTemplates });
      } catch { setTemplates([]); }
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

  async function shareFlow(row: Row) {
    const email = window.prompt(`¿Con quién compartís "${row.name}"? Email de su cuenta:`);
    if (email === null || !email.trim()) return;
    setBusy(row.kind + row.id);
    try {
      const r = await fetch(`/api/workflows/${row.id}/shares`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo compartir.");
      toast.success(`"${row.name}" compartido con ${d.sharedWith?.email || email.trim()}. Puede verlo y editarlo.`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Algo falló."); } finally { setBusy(""); }
  }

  async function unshareFlow(row: Row) {
    const email = window.prompt(`¿A quién le quitás el acceso a "${row.name}"? Email:`);
    if (email === null || !email.trim()) return;
    setBusy(row.kind + row.id);
    try {
      const lr = await fetch(`/api/workflows/${row.id}/shares`, { cache: "no-store" });
      const ld = await lr.json().catch(() => ({}));
      const target = (ld.shares || []).find((sh: { email?: string }) => sh.email?.toLowerCase() === email.trim().toLowerCase());
      if (!target) throw new Error("Ese email no tiene acceso a este flujo.");
      const r = await fetch(`/api/workflows/${row.id}/shares`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: target.userId }) });
      if (!r.ok) throw new Error("No se pudo quitar el acceso.");
      toast.success(`Acceso quitado a ${target.email}.`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Algo falló."); } finally { setBusy(""); }
  }

  async function saveAsTemplate(row: Row) {
    const name = window.prompt("Nombre de la plantilla", row.name);
    if (name === null) return;
    let shareWithOrg = false;
    if (orgCtx.activeOrganizationId && orgCtx.canManageOrgTemplates) {
      shareWithOrg = window.confirm("¿Guardarla como plantilla de la empresa?\nAceptar = visible para todos los miembros\nCancelar = personal (solo vos)");
    }
    setBusy(row.kind + row.id);
    try {
      const r = await fetch("/api/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflowId: row.id, name: name.trim() || row.name, shareWithOrg }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo guardar la plantilla.");
      toast.success(`Plantilla "${d.name}" guardada.`);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Algo falló."); } finally { setBusy(""); }
  }

  async function templateAction(t: Tpl, action: "use" | "rename" | "delete") {
    if (action === "delete" && !window.confirm(`¿Borrar la plantilla "${t.name}"? Los workflows creados desde ella no se tocan.`)) return;
    let name: string | undefined;
    if (action === "rename") {
      const n = window.prompt("Nuevo nombre de la plantilla", t.name);
      if (n === null || !n.trim()) return;
      name = n.trim();
    }
    setBusy("tpl" + t.id);
    try {
      if (action === "use") {
        const r = await fetch(`/api/templates/${t.id}/use`, { method: "POST" });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "No se pudo crear el workflow.");
        toast.success(`Workflow "${d.name}" creado desde la plantilla.`);
        window.location.href = `/workflows/${d.id}`;
        return;
      }
      const r = await fetch(`/api/templates/${t.id}`, action === "delete"
        ? { method: "DELETE" }
        : { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      if (!r.ok) throw new Error(action === "delete" ? "No se pudo borrar." : "No se pudo renombrar.");
      toast.success(action === "delete" ? `Plantilla "${t.name}" borrada.` : "Plantilla renombrada.");
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Algo falló."); } finally { setBusy(""); }
  }

  return <main className="pointer-events-auto fixed inset-0 z-20 flex flex-col bg-background"><AppHeader /><div className="flex-1 overflow-auto p-4 sm:p-6"><div className="mx-auto max-w-5xl space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">Workflows</h1><Button asChild size="sm"><a href="/?new=1">+ Nuevo workflow</a></Button></div>
    {isPending ? <p>Cargando...</p> : !signedIn ? <div className="space-y-3 rounded-xl border p-5"><p className="font-semibold">Iniciá sesión para ver y crear workflows.</p><p className="text-sm text-muted-foreground">Se guardan en tu cuenta.</p><AuthDialog><Button>Sign In</Button></AuthDialog></div> : <>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {rows === null && <p>Cargando workflows...</p>}
      {rows?.length === 0 && !error && <p>Todavía no tenés workflows. <a className="underline" href="/?new=1">Creá uno.</a></p>}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{rows?.map(r => { const key = r.kind + r.id; const working = busy === key; return <li key={key} className="flex flex-col justify-between gap-4 rounded-xl border p-4"><div className="space-y-1"><div className="flex items-start justify-between gap-2"><p className="break-words font-semibold">{r.name}</p>{r.kind === "mail" && <span className={"shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium " + (r.status === "active" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800")}>{r.status === "active" ? "Activo" : r.status === "paused" ? "Pausado" : r.status}</span>}{r.shared && <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-800">Compartido</span>}</div><p className="text-xs text-muted-foreground">{r.kind === "mail" ? "Email to sheet" : "Workflow de lienzo"} · Dispara: {r.trigger}{r.kind === "canvas" ? ` · ${r.steps} paso${r.steps === 1 ? "" : "s"}` : ""}</p></div>
        <div className="flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><Link href={r.href}>Editar</Link></Button>
          {r.kind === "canvas" && r.manual && <Button size="sm" disabled={working} onClick={() => void act(r, "run")}>Ejecutar</Button>}
          {r.kind === "mail" && (r.status === "active" ? <Button size="sm" variant="outline" disabled={working} onClick={() => void act(r, "pause")}>Pausar</Button> : <Button size="sm" disabled={working} onClick={() => void act(r, "resume")}>Reanudar</Button>)}
          {r.kind === "canvas" && !r.shared && <Button size="sm" variant="outline" disabled={working} onClick={() => void shareFlow(r)}>Compartir</Button>}
          {r.kind === "canvas" && !r.shared && <Button size="sm" variant="ghost" disabled={working} onClick={() => void unshareFlow(r)}>Quitar acceso</Button>}
          {r.kind === "canvas" && !r.shared && <Button size="sm" variant="outline" disabled={working} onClick={() => void saveAsTemplate(r)}>Guardar como plantilla</Button>}
          {r.kind === "canvas" && !r.shared && <Button size="sm" variant="ghost" className="text-destructive" disabled={working} onClick={() => void act(r, "delete")}>Borrar</Button>}</div></li>; })}</ul>
      {templates !== null && templates.length > 0 && <div className="space-y-3"><h2 className="text-lg font-semibold">Plantillas</h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{templates.map(t => { const working = busy === "tpl" + t.id; return <li key={t.id} className="flex flex-col justify-between gap-4 rounded-xl border border-dashed p-4"><div className="space-y-1"><p className="break-words font-semibold">{t.name}</p><p className="text-xs text-muted-foreground">Plantilla{t.orgId ? " de la empresa" : ""} · {t.steps ?? 0} paso{t.steps === 1 ? "" : "s"}</p></div>
          <div className="flex flex-wrap gap-2"><Button size="sm" disabled={working} onClick={() => void templateAction(t, "use")}>Usar</Button>
            {t.canManage && <Button size="sm" variant="outline" disabled={working} onClick={() => void templateAction(t, "rename")}>Renombrar</Button>}
            {t.canManage && <Button size="sm" variant="ghost" className="text-destructive" disabled={working} onClick={() => void templateAction(t, "delete")}>Borrar</Button>}</div></li>; })}</ul></div>}
    </>}
  </div></div></main>;
}
