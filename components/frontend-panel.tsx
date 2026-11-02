import { Button } from "@/components/ui/button";

export type PanelView = { title: string; collection: string; showRun: boolean };
export type PanelRecord = { key: string; value: unknown; updatedAt: string };

// Presentational part of the Frontend page (no data fetching, no auth): easy to render with fixtures.
export function FrontendPanel({ view, records, message, canRun, running, onRun }: { view: PanelView | null; records: PanelRecord[] | null; message: string; canRun: boolean; running: boolean; onRun: () => void }) {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">{view?.title || "Panel"}</h1>
      <div className="flex items-center gap-3">
        {canRun && view?.showRun && <Button disabled={running} onClick={onRun}>{running ? "Iniciando..." : "Ejecutar"}</Button>}
        {message && <p className="text-muted-foreground text-sm">{message}</p>}
      </div>
      <section className="space-y-2">
        <h2 className="font-semibold">{view ? `Datos: ${view.collection}` : "Esta página todavía no está configurada."}</h2>
        <p className="text-muted-foreground text-xs">Se actualiza cada 5 segundos.</p>
        {records === null && <p>Cargando...</p>}
        {records?.length === 0 && <p className="text-muted-foreground">No hay datos todavía.</p>}
        {!!records?.length && (
          <table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="py-2">Clave</th><th>Valor</th><th>Actualizado</th></tr></thead>
            <tbody>{records.map((r) => (
              <tr className="border-b align-top" key={r.key}><td className="py-2 font-mono">{r.key}</td><td className="font-mono">{typeof r.value === "string" ? r.value : JSON.stringify(r.value)}</td><td>{new Date(r.updatedAt).toISOString().slice(0, 19).replace("T", " ")}</td></tr>
            ))}</tbody></table>
        )}
      </section>
    </div>
  );
}
