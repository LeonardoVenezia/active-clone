"use client";
import { use, useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { FrontendPanel } from "@/components/frontend-panel";

type View = { title: string; collection: string; showRun: boolean };
type Rec = { collection: string; key: string; value: unknown; updatedAt: string };

// Basic Frontend node page: a manual trigger button and a live table of one Datos collection.
// Title, collection and the Ejecutar button come from the workflow's Frontend node (server side).
// "Live" = refresh every 5 seconds (polling, not realtime).
export default function FrontendPage({ params }: { params: Promise<{ workflowId: string }> }) {
  const { workflowId } = use(params);
  const [view, setView] = useState<View | null>(null);
  const [canRun, setCanRun] = useState(false);
  const [records, setRecords] = useState<Rec[] | null>(null);
  const [message, setMessage] = useState("");
  const [running, setRunning] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    document.title = "Panel | Active-clone";
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/datos?workflowId=${encodeURIComponent(workflowId)}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) { setMessage(d.error || "No pudimos cargar los datos."); setBlocked(true); setCanRun(false); setView(null); setRecords([]); return; }
      setBlocked(false);
      setMessage(d.enabled === false ? "Los datos todavía no están habilitados." : "");
      setView(d.view || null);
      setCanRun(!!d.canRun);
      setRecords(d.records || []);
    } catch { setMessage("No pudimos cargar los datos."); }
  }, [workflowId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function run() {
    setRunning(true); setMessage("");
    try {
      const r = await fetch(`/api/frontend/${encodeURIComponent(workflowId)}/run`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      setMessage(r.ok ? "Ejecución iniciada." : d.error || "No se pudo iniciar.");
      setTimeout(load, 1500);
    } catch { setMessage("No se pudo iniciar."); }
    setRunning(false);
  }

  return (
    <main className="pointer-events-auto fixed inset-0 z-20 flex flex-col bg-background">
      <AppHeader />
      <div className="flex-1 overflow-auto"><FrontendPanel blocked={blocked} canRun={canRun} message={message} onRun={run} records={records} running={running} view={view} /></div>
    </main>
  );
}
