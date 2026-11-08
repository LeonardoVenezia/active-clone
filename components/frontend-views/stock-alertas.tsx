import {
  numeroCampo,
  reporteFromRecords,
  textoCelda,
} from "@/lib/soluciones/reporte";
import {
  Advertencias,
  Badge,
  CaseShell,
  type CaseViewProps,
  KpiStrip,
  ReportBody,
} from "./shell";

/**
 * Vista dedicada del caso "alertas de stock": tarjetas por producto con su
 * motivo, stock contra umbral y marca de detección. Sólo lectura + Ejecutar:
 * el paso del caso no modifica stock ni envía avisos (advertencias del
 * reporte lo dicen al cliente).
 */
export function StockAlertasView(props: CaseViewProps) {
  const reporte = reporteFromRecords(props.records, props.view.rowsField ?? "");
  const r = reporte.resumen;
  return (
    <CaseShell {...props}>
      <KpiStrip
        items={[
          { label: "Productos revisados", value: r.productosRevisados ?? 0 },
          { label: "Alertas nuevas", value: r.alertasNuevas ?? 0 },
          { label: "Ya detectadas", value: r.yaDetectadas ?? 0 },
        ].filter((k) => k.value !== 0 || reporte.rows.length > 0)}
      />
      <Advertencias items={reporte.advertencias} />
      <ReportBody
        emptyText={props.view.solution?.emptyText || "No hay alertas de stock."}
        isEmpty={reporte.rows.length === 0}
        loading={props.records === null}
        updatedAt={reporte.updatedAt}
      >
        <ul className="space-y-2">
          {reporte.rows.map((row, i) => {
            const deteccion = textoCelda(row, "deteccion");
            const motivo = textoCelda(row, "motivo");
            const stock = numeroCampo(row, "stock");
            const umbral = numeroCampo(row, "umbral");
            const detalle = textoCelda(row, "detalle");
            return (
              <li
                className="rounded-xl border p-4 transition-colors hover:bg-muted/40"
                key={textoCelda(row, "sku") || textoCelda(row, "producto") || i}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">
                      {textoCelda(row, "nombre") || "Producto"}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {[
                        textoCelda(row, "sku") &&
                          `SKU ${textoCelda(row, "sku")}`,
                        textoCelda(row, "producto"),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {motivo && (
                      <Badge
                        tone={motivo === "Stock sin dato" ? "warning" : "error"}
                      >
                        {motivo}
                      </Badge>
                    )}
                    {deteccion && (
                      <Badge tone={deteccion === "Nuevo" ? "error" : "neutral"}>
                        {deteccion}
                      </Badge>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-sm tabular-nums">
                  {stock !== null && umbral !== null
                    ? `Stock ${stock} · mínimo ${umbral}`
                    : detalle || "Sin dato numérico de stock"}
                </p>
                {detalle && stock !== null && (
                  <p className="mt-0.5 text-muted-foreground text-xs">
                    {detalle}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </ReportBody>
    </CaseShell>
  );
}
