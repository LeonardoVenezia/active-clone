"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MoreHorizontal, Play, Share2, Users } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { AuthDialog } from "@/components/auth/dialog";
import { useSession } from "@/lib/auth-client";
import { api } from "@/lib/api-client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Row = { id: string; name: string; href: string; kind: "mail" | "canvas"; status?: string; steps?: number; trigger?: string; manual?: boolean; updated?: string; shared?: boolean; sharedByMe?: boolean; sharedAdmin?: boolean };
type Tpl = { id: string; name: string; description?: string | null; steps?: number; updatedAt?: string; orgId?: string | null; mine?: boolean; canManage?: boolean };
type W = { id: string; name: string; updatedAt?: string; shared?: boolean; sharedByMe?: boolean; sharedAdmin?: boolean; nodes?: { data?: { type?: string; config?: { triggerType?: string } } }[] };
type Share = { id: string; userId: string; email: string; name?: string | null };

function Badge({ tone, children }: { tone: "green" | "amber" | "blue" | "violet"; children: React.ReactNode }) {
  const cls = {
    green: "bg-green-100 text-green-800",
    amber: "bg-amber-100 text-amber-800",
    blue: "bg-blue-100 text-blue-800",
    violet: "bg-violet-100 text-violet-800",
  }[tone];
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{children}</span>;
}

export default function FlowsPage() {
  const { data: session, isPending } = useSession();
  const signedIn = !!session?.user && !session.user.isAnonymous;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [templates, setTemplates] = useState<Tpl[] | null>(null);
  const [orgCtx, setOrgCtx] = useState<{ activeOrganizationId: string | null; canManageOrgTemplates: boolean }>({ activeOrganizationId: null, canManageOrgTemplates: false });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  // Dialog state
  const [shareRow, setShareRow] = useState<Row | null>(null);
  const [shares, setShares] = useState<Share[] | null>(null);
  const [shareEmail, setShareEmail] = useState("");
  const [shareError, setShareError] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [tplRow, setTplRow] = useState<Row | null>(null);
  const [tplName, setTplName] = useState("");
  const [tplOrg, setTplOrg] = useState(false);
  const [renameTpl, setRenameTpl] = useState<Tpl | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deleteRow, setDeleteRow] = useState<Row | null>(null);
  const [deleteTpl, setDeleteTpl] = useState<Tpl | null>(null);

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
        out.push({ id: w.id, name: w.name, href: `/workflows/${w.id}`, kind: "canvas", steps: (w.nodes || []).filter(n => n.data?.type !== "trigger").length, trigger: t === "Manual" ? "Manual" : t === "Schedule" ? "Programado" : t === "Webhook" ? "Webhook" : t, manual: t === "Manual", updated: w.updatedAt, shared: !!w.shared, sharedByMe: !!w.sharedByMe, sharedAdmin: !!w.sharedAdmin });
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

  async function act(row: Row, action: "run" | "pause" | "resume") {
    setBusy(row.kind + row.id);
    try {
      if (action === "run") {
        const r = await fetch(`/api/workflow/${row.id}/execute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: {} }) });
        const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "No se pudo ejecutar.");
        toast.success(`Ejecutando "${row.name}". El resultado queda en Runs.`);
      } else {
        const r = await fetch("/api/mail-flow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
        const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "No se pudo cambiar el estado.");
        toast.success(action === "pause" ? "Flujo pausado." : "Flujo reanudado."); await load();
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Algo falló."); } finally { setBusy(""); }
  }

  async function confirmDelete() {
    if (!deleteRow) return;
    const row = deleteRow;
    setBusy(row.kind + row.id);
    try {
      await fetch(`/api/workflows/${row.id}/executions`, { method: "DELETE" });
      const r = await fetch(`/api/workflows/${row.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("No se pudo borrar.");
      toast.success(`Borrado "${row.name}".`);
      setDeleteRow(null); await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Algo falló."); } finally { setBusy(""); }
  }

  // --- Sharing dialog ---
  async function openShare(row: Row) {
    setShareRow(row); setShares(null); setShareEmail(""); setShareError("");
    try {
      const r = await fetch(`/api/workflows/${row.id}/shares`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      setShares(r.ok && Array.isArray(d.shares) ? d.shares : []);
    } catch { setShares([]); }
  }

  async function addShare() {
    if (!shareRow || !shareEmail.trim()) return;
    setShareBusy(true); setShareError("");
    try {
      const r = await fetch(`/api/workflows/${shareRow.id}/shares`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: shareEmail.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo compartir.");
      toast.success(`Compartido con ${d.sharedWith?.email || shareEmail.trim()}.`);
      setShareEmail("");
      await openShare(shareRow);
    } catch (e) { setShareError(e instanceof Error ? e.message : "Algo falló."); } finally { setShareBusy(false); }
  }

  async function removeShare(userId: string, email: string) {
    if (!shareRow) return;
    setShareBusy(true); setShareError("");
    try {
      const r = await fetch(`/api/workflows/${shareRow.id}/shares`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
      if (!r.ok) throw new Error("No se pudo quitar el acceso.");
      toast.success(`Acceso quitado a ${email}.`);
      await openShare(shareRow);
    } catch (e) { setShareError(e instanceof Error ? e.message : "Algo falló."); } finally { setShareBusy(false); }
  }

  // --- Save-as-template dialog ---
  function openTplDialog(row: Row) {
    setTplRow(row); setTplName(row.name); setTplOrg(false);
  }

  async function confirmSaveTemplate() {
    if (!tplRow) return;
    const row = tplRow;
    setBusy(row.kind + row.id);
    try {
      const r = await fetch("/api/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflowId: row.id, name: tplName.trim() || row.name, shareWithOrg: tplOrg }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo guardar la plantilla.");
      toast.success(`Plantilla "${d.name}" guardada${tplOrg ? " para la empresa" : ""}.`);
      setTplRow(null); await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Algo falló."); } finally { setBusy(""); }
  }

  async function useTemplate(t: Tpl) {
    setBusy("tpl" + t.id);
    try {
      const r = await fetch(`/api/templates/${t.id}/use`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo crear el workflow.");
      toast.success(`Workflow "${d.name}" creado desde la plantilla.`);
      window.location.href = `/workflows/${d.id}`;
    } catch (e) { toast.error(e instanceof Error ? e.message : "Algo falló."); setBusy(""); }
  }

  async function confirmRename() {
    if (!renameTpl || !renameName.trim()) return;
    const t = renameTpl;
    setBusy("tpl" + t.id);
    try {
      const r = await fetch(`/api/templates/${t.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: renameName.trim() }) });
      if (!r.ok) throw new Error("No se pudo renombrar.");
      toast.success("Plantilla renombrada.");
      setRenameTpl(null); await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Algo falló."); } finally { setBusy(""); }
  }

  async function confirmDeleteTpl() {
    if (!deleteTpl) return;
    const t = deleteTpl;
    setBusy("tpl" + t.id);
    try {
      const r = await fetch(`/api/templates/${t.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("No se pudo borrar.");
      toast.success(`Plantilla "${t.name}" borrada.`);
      setDeleteTpl(null); await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Algo falló."); } finally { setBusy(""); }
  }

  return <main className="pointer-events-auto fixed inset-0 z-20 flex flex-col bg-background"><AppHeader /><div className="flex-1 overflow-auto p-4 sm:p-6"><div className="mx-auto max-w-5xl space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">Workflows</h1><Button asChild size="sm"><a href="/?new=1">+ Nuevo workflow</a></Button></div>
    {isPending ? <p>Cargando...</p> : !signedIn ? <div className="space-y-3 rounded-xl border p-5"><p className="font-semibold">Iniciá sesión para ver y crear workflows.</p><p className="text-sm text-muted-foreground">Se guardan en tu cuenta.</p><AuthDialog><Button>Sign In</Button></AuthDialog></div> : <>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {rows === null && <p>Cargando workflows...</p>}
      {rows?.length === 0 && !error && <p>Todavía no tenés workflows. <a className="underline" href="/?new=1">Creá uno.</a></p>}
      {(() => {
        const sharedRows = (rows || []).filter(r => r.shared || r.sharedByMe);
        const privateRows = (rows || []).filter(r => !(r.shared || r.sharedByMe));
        const renderCard = (r: Row) => { const key = r.kind + r.id; const working = busy === key; return <li key={key} className="flex flex-col gap-3 rounded-xl border p-4">
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-2">
            <p className="break-words font-semibold leading-snug">{r.name}</p>
            <span className="flex shrink-0 gap-1">
              {r.kind === "mail" && <Badge tone={r.status === "active" ? "green" : "amber"}>{r.status === "active" ? "Activo" : r.status === "paused" ? "Pausado" : r.status}</Badge>}
              {r.sharedByMe && <Badge tone="violet">Dueño</Badge>}
              {r.shared && r.sharedAdmin && <Badge tone="amber">Admin</Badge>}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{r.kind === "mail" ? "Email to sheet" : "Workflow de lienzo"} · Dispara: {r.trigger}{r.kind === "canvas" ? ` · ${r.steps} paso${r.steps === 1 ? "" : "s"}` : ""}</p>
        </div>
        <div className="mt-auto flex items-center gap-2">
          <Button asChild size="sm"><Link href={r.href}>Editar</Link></Button>
          {r.kind === "canvas" && r.manual && <Button size="sm" variant="outline" disabled={working} onClick={() => void act(r, "run")}><Play className="mr-1 size-3.5" />Ejecutar</Button>}
          {!(r.kind === "canvas" && r.shared) && <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" className="ml-auto px-2" aria-label="Más acciones"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {r.kind === "mail" && (r.status === "active"
                ? <DropdownMenuItem disabled={working} onClick={() => void act(r, "pause")}>Pausar</DropdownMenuItem>
                : <DropdownMenuItem disabled={working} onClick={() => void act(r, "resume")}>Reanudar</DropdownMenuItem>)}
              {r.kind === "canvas" && !r.shared && <DropdownMenuItem onClick={() => void openShare(r)}><Share2 className="mr-2 size-3.5" />Compartir…</DropdownMenuItem>}
              {r.kind === "canvas" && !r.shared && <DropdownMenuItem onClick={() => openTplDialog(r)}>Guardar como plantilla…</DropdownMenuItem>}
              {!r.shared && <DropdownMenuSeparator />}
              {!r.shared && <DropdownMenuItem className="text-destructive" disabled={working} onClick={() => setDeleteRow(r)}>Borrar…</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>}
        </div>
      </li>; };
        return <>
          {sharedRows.length > 0 && <div className="space-y-3">
            <h2 className="text-lg font-semibold">Compartidos</h2>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{sharedRows.map(renderCard)}</ul>
          </div>}
          <div className="space-y-3">
            {sharedRows.length > 0 && <h2 className="text-lg font-semibold">Privados</h2>}
            {privateRows.length === 0 && sharedRows.length > 0 && <p className="text-sm text-muted-foreground">No tenés flujos privados.</p>}
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{privateRows.map(renderCard)}</ul>
          </div>
        </>;
      })()}
      {templates !== null && templates.length > 0 && <div className="space-y-3"><h2 className="text-lg font-semibold">Plantillas</h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{templates.map(t => { const working = busy === "tpl" + t.id; return <li key={t.id} className="flex flex-col gap-3 rounded-xl border border-dashed p-4">
          <div className="space-y-1">
            <div className="flex items-start justify-between gap-2">
              <p className="break-words font-semibold leading-snug">{t.name}</p>
              {t.orgId ? <Badge tone="violet">De la empresa</Badge> : null}
            </div>
            <p className="text-xs text-muted-foreground">Plantilla · {t.steps ?? 0} paso{t.steps === 1 ? "" : "s"}</p>
          </div>
          <div className="mt-auto flex items-center gap-2">
            <Button size="sm" disabled={working} onClick={() => void useTemplate(t)}>Usar</Button>
            {t.canManage && <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" className="ml-auto px-2" aria-label="Más acciones"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => { setRenameTpl(t); setRenameName(t.name); }}>Renombrar…</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" disabled={working} onClick={() => setDeleteTpl(t)}>Borrar…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>}
          </div>
        </li>; })}</ul></div>}
    </>}

    {/* Share dialog */}
    <Dialog open={!!shareRow} onOpenChange={(o) => { if (!o) setShareRow(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Users className="size-4" />Compartir "{shareRow?.name}"</DialogTitle>
          <DialogDescription>Quien tenga acceso puede ver, editar y ejecutar este flujo con tus conexiones. Solo vos podés borrarlo o cambiar su visibilidad.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input type="email" placeholder="Email de su cuenta" value={shareEmail} onChange={(e) => setShareEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void addShare(); }} />
            <Button disabled={shareBusy || !shareEmail.trim()} onClick={() => void addShare()}>Invitar</Button>
          </div>
          {shareError && <p role="alert" className="text-sm text-destructive">{shareError}</p>}
          <div className="space-y-2">
            {shares === null && <p className="text-sm text-muted-foreground">Cargando...</p>}
            {shares?.length === 0 && <p className="text-sm text-muted-foreground">Todavía no lo compartiste con nadie.</p>}
            {shares?.map(s => <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
              <div className="min-w-0"><p className="truncate text-sm font-medium">{s.name || s.email}</p>{s.name && <p className="truncate text-xs text-muted-foreground">{s.email}</p>}</div>
              <Button size="sm" variant="ghost" className="text-destructive" disabled={shareBusy} onClick={() => void removeShare(s.userId, s.email)}>Quitar</Button>
            </div>)}
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Save as template dialog */}
    <Dialog open={!!tplRow} onOpenChange={(o) => { if (!o) setTplRow(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Guardar como plantilla</DialogTitle>
          <DialogDescription>Guarda la estructura del flujo (sin conexiones) para reutilizarla. Al usarla se piden conexiones nuevas.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-name">Nombre</Label>
            <Input id="tpl-name" value={tplName} onChange={(e) => setTplName(e.target.value)} />
          </div>
          {orgCtx.activeOrganizationId && orgCtx.canManageOrgTemplates && <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={tplOrg} onCheckedChange={(v) => setTplOrg(v === true)} />
            Visible para todos los miembros de la empresa
          </label>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setTplRow(null)}>Cancelar</Button>
          <Button disabled={!tplName.trim() || !!busy} onClick={() => void confirmSaveTemplate()}>Guardar plantilla</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Rename template dialog */}
    <Dialog open={!!renameTpl} onOpenChange={(o) => { if (!o) setRenameTpl(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Renombrar plantilla</DialogTitle></DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="tpl-rename">Nombre</Label>
          <Input id="tpl-rename" value={renameName} onChange={(e) => setRenameName(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setRenameTpl(null)}>Cancelar</Button>
          <Button disabled={!renameName.trim() || !!busy} onClick={() => void confirmRename()}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Delete workflow confirm */}
    <AlertDialog open={!!deleteRow} onOpenChange={(o) => { if (!o) setDeleteRow(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Borrar "{deleteRow?.name}"</AlertDialogTitle>
          <AlertDialogDescription>Se borran también sus ejecuciones. No se puede deshacer.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => void confirmDelete()}>Borrar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Delete template confirm */}
    <AlertDialog open={!!deleteTpl} onOpenChange={(o) => { if (!o) setDeleteTpl(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Borrar la plantilla "{deleteTpl?.name}"</AlertDialogTitle>
          <AlertDialogDescription>Los workflows creados desde ella no se tocan.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => void confirmDeleteTpl()}>Borrar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div></div></main>;
}
