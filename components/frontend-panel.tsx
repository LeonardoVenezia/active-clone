import { useState } from "react";
import { Button } from "@/components/ui/button";

export type PanelView = { title: string; collection: string; showRun: boolean; columns?: string[]; showForm?: boolean; keyField?: string; runOnSubmit?: boolean };
export type PanelRecord = { key: string; value: unknown; updatedAt: string };
export type PanelField = { name: string; type: "texto" | "numero" | "booleano" | "fecha"; required: boolean };

function cell(value: unknown, col: string): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "";
  const v = (value as Record<string, unknown>)[col];
  if (v === undefined || v === null) return "";
  return typeof v === "string" ? v : typeof v === "boolean" ? (v ? "Sí" : "No") : JSON.stringify(v);
}

function FormBlock({ fields, onSubmit, busy }: { fields: PanelField[]; onSubmit: (values: Record<string, string>) => Promise<boolean>; busy: boolean }) {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <form
      className="space-y-3 rounded-md border p-4"
      onSubmit={async (e) => { e.preventDefault(); if (await onSubmit(values)) setValues({}); }}
    >
      <h2 className="font-semibold">Nuevo registro</h2>
      {fields.map((f) => (
        <label className="block space-y-1 text-sm" key={f.name}>
          <span>{f.name}{f.required ? " *" : ""}</span>
          {f.type === "booleano" ? (
            <select className="h-9 w-full rounded-md border bg-transparent px-3 text-sm" onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} value={values[f.name] ?? ""}>
              <option value="">-</option><option value="true">Sí</option><option value="false">No</option>
            </select>
          ) : (
            <input
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              maxLength={f.type === "texto" ? 1000 : undefined}
              onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              required={f.required}
              step={f.type === "numero" ? "any" : undefined}
              type={f.type === "numero" ? "number" : f.type === "fecha" ? "date" : "text"}
              value={values[f.name] ?? ""}
            />
          )}
        </label>
      ))}
      <Button disabled={busy} type="submit">{busy ? "Enviando..." : "Enviar"}</Button>
    </form>
  );
}

// Presentational part of the Frontend page (no data fetching, no auth): easy to render with fixtures.
export function FrontendPanel({ view, records, message, canRun, running, onRun, blocked, fields, formMessage, submitting, onSubmit }: {
  blocked?: boolean; view: PanelView | null; records: PanelRecord[] | null; message: string; canRun: boolean; running: boolean; onRun: () => void;
  fields?: PanelField[] | null; formMessage?: string; submitting?: boolean; onSubmit?: (values: Record<string, string>) => Promise<boolean>;
}) {
  const columns = view?.columns ?? [];
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">{view?.title || "Panel"}</h1>
      <div className="flex items-center gap-3">
        {canRun && view?.showRun && <Button disabled={running} onClick={onRun}>{running ? "Iniciando..." : "Ejecutar"}</Button>}
        {message && <p className="text-muted-foreground text-sm">{message}</p>}
      </div>
      {!blocked && view?.showForm && (
        <section className="space-y-2">
          {fields?.length && onSubmit ? <FormBlock busy={!!submitting} fields={fields} onSubmit={onSubmit} /> : <p className="text-muted-foreground text-sm">El formulario necesita campos definidos para la colección (nodo Datos, Definir campos).</p>}
          {formMessage && <p className="text-sm">{formMessage}</p>}
        </section>
      )}
      {!blocked && <section className="space-y-2">
        <h2 className="font-semibold">{view ? `Datos: ${view.collection}` : "Esta página todavía no está configurada."}</h2>
        <p className="text-muted-foreground text-xs">Se actualiza cada 5 segundos.</p>
        {records === null && <p>Cargando...</p>}
        {records?.length === 0 && <p className="text-muted-foreground">No hay datos todavía.</p>}
        {!!records?.length && (
          <div className="overflow-x-auto"><table className="w-full min-w-max text-left text-sm">
            <thead><tr className="border-b"><th className="py-2 pr-4">Clave</th>{columns.length ? columns.map((c) => <th className="pr-4" key={c}>{c}</th>) : <th className="pr-4">Valor</th>}<th>Actualizado</th></tr></thead>
            <tbody>{records.map((r) => (
              <tr className="border-b align-top" key={r.key}>
                <td className="py-2 pr-4 font-mono">{r.key}</td>
                {columns.length ? columns.map((c) => <td className="pr-4" key={c}>{cell(r.value, c)}</td>) : <td className="pr-4 font-mono">{typeof r.value === "string" ? r.value : JSON.stringify(r.value)}</td>}
                <td>{new Date(r.updatedAt).toISOString().slice(0, 19).replace("T", " ")}</td>
              </tr>
            ))}</tbody></table></div>
        )}
      </section>}
    </div>
  );
}
