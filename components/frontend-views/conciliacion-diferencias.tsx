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

type BadgeTone = "neutral" | "success" | "warning" | "error" | "brand";

function estadoTone(estado: string): BadgeTone {
  if (estado === "Conciliado") {
    return "success";
  }
  if (estado.startsWith("Diferencia")) {
    return "error";
  }
  return "warning";
}

function formatMonto(n: number | null): string {
  if (n === null) {
    return "sin dato";
  }
  return n.toLocaleString("es-AR");
}

function formatDif(dif: number | null): string {
  if (dif === null) {
    return "-";
  }
  if (dif === 0) {
    return "0";
  }
  return `${dif > 0 ? "+" : ""}${dif.toLocaleString("es-AR")}`;
}

function datosFila(row: Record<string, unknown>) {
  const venta = numeroCampo(row, "total_venta");
  const cobrado = numeroCampo(row, "cobrado");
  return {
    venta,
    cobrado,
    dif: venta !== null && cobrado !== null ? cobrado - venta : null,
    estado: textoCelda(row, "estado"),
    detalle: [
      textoCelda(row, "canal"),
      textoCelda(row, "orden") && `Orden ${textoCelda(row, "orden")}`,
      textoCelda(row, "pago") && `Pago ${textoCelda(row, "pago")}`,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

/**
 * Vista dedicada del caso "conciliación de pagos": diferencias entre venta y
 * cobro por referencia. SÓLO LECTURA: el reporte compara y marca; no mueve
 * dinero ni ejecuta acciones sobre pagos. Los límites de comparación
 * (fueraDeAlcance) se muestran siempre junto al reporte.
 */
export function ConciliacionDiferenciasView(props: CaseViewProps) {
  const reporte = reporteFromRecords(props.records, props.view.rowsField ?? "");
  const r = reporte.resumen;
  const TH_CLASS =
    "px-3 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider";
  return (
    <CaseShell {...props}>
      <KpiStrip
        items={[
          { label: "Ventas", value: r.ventas ?? 0 },
          { label: "Pagos", value: r.pagos ?? 0 },
          { label: "Conciliados", value: r.conciliados ?? 0 },
          {
            label: "Diferencias",
            value:
              (r.diferencias ?? 0) +
              (r.ventasSinCobro ?? 0) +
              (r.cobrosSinVenta ?? 0),
          },
        ].filter((k) => k.value !== 0 || reporte.rows.length > 0)}
      />
      <Advertencias items={reporte.advertencias} />
      <ReportBody
        emptyText={
          props.view.solution?.emptyText || "No hay movimientos para conciliar."
        }
        isEmpty={reporte.rows.length === 0}
        loading={props.records === null}
        updatedAt={reporte.updatedAt}
      >
        <div className="space-y-2">
          <div className="hidden overflow-x-auto rounded-xl border sm:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className={TH_CLASS}>Referencia</th>
                  <th className={TH_CLASS}>Venta</th>
                  <th className={TH_CLASS}>Cobrado</th>
                  <th className={TH_CLASS}>Diferencia</th>
                  <th className={TH_CLASS}>Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {reporte.rows.map((row, i) => {
                  const f = datosFila(row);
                  return (
                    <tr
                      className="align-top transition-colors hover:bg-muted/40"
                      key={textoCelda(row, "referencia") || i}
                    >
                      <td className="break-words px-3 py-2.5">
                        <p className="font-medium">
                          {textoCelda(row, "referencia")}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {f.detalle}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {formatMonto(f.venta)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {formatMonto(f.cobrado)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {formatDif(f.dif)}
                      </td>
                      <td className="px-3 py-2.5">
                        {f.estado && (
                          <Badge tone={estadoTone(f.estado)}>{f.estado}</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="space-y-2 sm:hidden">
            {reporte.rows.map((row, i) => {
              const f = datosFila(row);
              return (
                <div
                  className="rounded-xl border p-3 text-sm"
                  key={textoCelda(row, "referencia") || i}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">
                      {textoCelda(row, "referencia")}
                    </p>
                    {f.estado && (
                      <Badge tone={estadoTone(f.estado)}>{f.estado}</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-muted-foreground text-xs">
                    {textoCelda(row, "canal")}
                  </p>
                  <p className="mt-2 tabular-nums">
                    Venta {formatMonto(f.venta)} · Cobrado{" "}
                    {formatMonto(f.cobrado)}
                    {f.dif !== null && f.dif !== 0
                      ? ` · Diferencia ${formatDif(f.dif)}`
                      : ""}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="text-muted-foreground text-xs">
            Los importes son los declarados por cada fuente, sin conversión de
            moneda. Esta vista compara y marca; no mueve dinero.
          </p>
        </div>
      </ReportBody>
      {reporte.fueraDeAlcance.length > 0 && (
        <section className="space-y-1 rounded-xl border p-4 text-xs">
          <h2 className="font-medium text-sm">Alcance de este reporte</h2>
          {reporte.fueraDeAlcance.map((f) => (
            <p className="text-muted-foreground" key={f}>
              {f}
            </p>
          ))}
        </section>
      )}
    </CaseShell>
  );
}
