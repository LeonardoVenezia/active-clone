import { reporteFromRecords, textoCelda } from "@/lib/soluciones/reporte";
import {
  Advertencias,
  Badge,
  CaseShell,
  type CaseViewProps,
  KpiStrip,
  ReportBody,
} from "./shell";

/**
 * Vista dedicada del caso "avisos postcompra": revisión de los borradores
 * preparados. NADA se envía desde esta vista: cada tarjeta es un borrador
 * marcado como tal y el envío requiere aprobación humana en otro paso.
 */
export function AvisosBorradoresView(props: CaseViewProps) {
  const reporte = reporteFromRecords(props.records, props.view.rowsField ?? "");
  const r = reporte.resumen;
  return (
    <CaseShell {...props}>
      <KpiStrip
        items={[
          { label: "Eventos recibidos", value: r.eventosRecibidos ?? 0 },
          { label: "Borradores preparados", value: r.yaPreparados ?? 0 },
          { label: "Omitidos", value: r.omitidos ?? 0 },
        ].filter((k) => k.value !== 0 || reporte.rows.length > 0)}
      />
      <Advertencias items={reporte.advertencias} />
      <ReportBody
        emptyText={
          props.view.solution?.emptyText || "No hay borradores preparados."
        }
        isEmpty={reporte.rows.length === 0}
        loading={props.records === null}
        updatedAt={reporte.updatedAt}
      >
        <ul className="space-y-2">
          {reporte.rows.map((row, i) => (
            <li
              className="rounded-xl border p-4"
              key={`${textoCelda(row, "pedido")}-${textoCelda(row, "evento")}-${i}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm">
                    Pedido {textoCelda(row, "pedido")}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {[textoCelda(row, "canal"), textoCelda(row, "evento")]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <Badge tone="brand">
                  {textoCelda(row, "preparacion") === "Ya preparado"
                    ? "Borrador listo"
                    : textoCelda(row, "preparacion") || "Borrador"}
                </Badge>
              </div>
              <blockquote className="mt-3 rounded-lg border-brand border-l-2 bg-muted/40 px-3 py-2 text-sm">
                {textoCelda(row, "texto")}
              </blockquote>
              <p className="mt-2 text-muted-foreground text-xs">
                Borrador para revisión: todavía no se envió nada al cliente.
              </p>
            </li>
          ))}
        </ul>
      </ReportBody>
      {reporte.omitidos.length > 0 && (
        <section className="space-y-1 rounded-xl border p-4 text-xs">
          <h2 className="font-medium text-sm">Omitidos (sin borrador)</h2>
          {reporte.omitidos.map((o, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: omitidos sin id estable; orden fijo por corrida
            <p className="text-muted-foreground" key={i}>
              {Object.entries(o)
                .map(
                  ([k, v]) =>
                    `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`
                )
                .join(" · ")}
            </p>
          ))}
        </section>
      )}
    </CaseShell>
  );
}
