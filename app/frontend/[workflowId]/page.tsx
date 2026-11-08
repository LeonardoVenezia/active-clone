"use client";
import { use, useCallback, useEffect, useState } from "react";
import {
  FrontendPanel,
  type PanelField,
  type PanelFuente,
  type PanelView,
} from "@/components/frontend-panel";
import { CaseFrontend, hasCaseView } from "@/components/frontend-views";

type View = PanelView;
type Rec = {
  collection: string;
  key: string;
  value: unknown;
  updatedAt: string;
};

// Basic Frontend node page: a manual trigger button and a live table of one Datos collection.
// Title, collection and the Ejecutar button come from the workflow's Frontend node (server side).
// "Live" = refresh every 5 seconds (polling, not realtime).
export default function FrontendPage({
  params,
}: {
  params: Promise<{ workflowId: string }>;
}) {
  const { workflowId } = use(params);
  const [view, setView] = useState<View | null>(null);
  const [canRun, setCanRun] = useState(false);
  const [records, setRecords] = useState<Rec[] | null>(null);
  const [message, setMessage] = useState("");
  const [running, setRunning] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [fields, setFields] = useState<PanelField[] | null>(null);
  const [fuentes, setFuentes] = useState<PanelFuente[] | undefined>(undefined);
  const [formMessage, setFormMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Panel | Active-clone";
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/datos?workflowId=${encodeURIComponent(workflowId)}`,
        { cache: "no-store" }
      );
      const d = await r.json();
      if (!r.ok) {
        setMessage(d.error || "No pudimos cargar los datos.");
        setBlocked(true);
        setCanRun(false);
        setView(null);
        setRecords([]);
        return;
      }
      setBlocked(false);
      setMessage(
        d.enabled === false ? "Los datos todavía no están habilitados." : ""
      );
      setView(d.view || null);
      setCanRun(!!d.canRun);
      setRecords(d.records || []);
      setFields(d.fields || null);
      setFuentes(d.sources || undefined);
    } catch {
      setMessage("No pudimos cargar los datos.");
    }
  }, [workflowId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function run() {
    setRunning(true);
    setMessage("");
    try {
      const r = await fetch(
        `/api/frontend/${encodeURIComponent(workflowId)}/run`,
        { method: "POST" }
      );
      const d = await r.json().catch(() => ({}));
      setMessage(
        r.ok ? "Ejecución iniciada." : d.error || "No se pudo iniciar."
      );
      setTimeout(load, 1500);
    } catch {
      setMessage("No se pudo iniciar.");
    }
    setRunning(false);
  }

  async function submit(values: Record<string, string>): Promise<boolean> {
    setSubmitting(true);
    setFormMessage("");
    try {
      const r = await fetch(
        `/api/frontend/${encodeURIComponent(workflowId)}/submit`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ values }),
        }
      );
      const d = await r.json().catch(() => ({}));
      const okMessage = d.started
        ? "Guardado. Workflow iniciado."
        : "Guardado.";
      setFormMessage(r.ok ? okMessage : d.error || "No se pudo enviar.");
      setTimeout(load, 500);
      setSubmitting(false);
      return r.ok || !!d.saved;
    } catch {
      setFormMessage("No se pudo enviar.");
      setSubmitting(false);
      return false;
    }
  }

  async function act(key: string, actionId: string) {
    setActionBusy(`${key}:${actionId}`);
    setMessage("");
    try {
      const r = await fetch(
        `/api/frontend/${encodeURIComponent(workflowId)}/action`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key, action: actionId }),
        }
      );
      const d = await r.json().catch(() => ({}));
      setMessage(
        r.ok ? "Acción aplicada." : d.error || "No se pudo aplicar la acción."
      );
      setTimeout(load, 500);
    } catch {
      setMessage("No se pudo aplicar la acción.");
    }
    setActionBusy(null);
  }

  // Superficie cliente: header mínimo de marca, sin la navegación del backoffice.
  // Si la solución declara una vista dedicada (slot `view` del nodo Solución),
  // el caso define su experiencia; si no, el panel genérico sigue siendo el fallback.
  const caseView = view && hasCaseView(view) ? view : null;
  return (
    <main className="pointer-events-auto fixed inset-0 z-20 flex flex-col bg-background">
      <div className="flex-1 overflow-auto">
        {caseView ? (
          <CaseFrontend
            blocked={blocked}
            canRun={canRun}
            fuentes={fuentes}
            message={message}
            onRun={run}
            records={records}
            running={running}
            view={caseView}
          />
        ) : (
          <FrontendPanel
            actionBusy={actionBusy}
            blocked={blocked}
            canRun={canRun}
            fields={fields}
            formMessage={formMessage}
            fuentes={fuentes}
            message={message}
            onAction={act}
            onRun={run}
            onSubmit={submit}
            records={records}
            running={running}
            submitting={submitting}
            view={view}
          />
        )}
      </div>
    </main>
  );
}
