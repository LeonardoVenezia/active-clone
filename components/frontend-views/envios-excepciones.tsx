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
 * Vista dedicada del caso "excepciones de envío": una tarjeta por envío con
 * problema, con canal, estado, motivo y detalle. Sólo lectura + Ejecutar:
 * la detección marca internamente; no contacta al cliente ni al correo.
 */
export function EnviosExcepcionesView(props: CaseViewProps) {
  const reporte = reporteFromRecords(props.records, props.view.rowsField ?? "");
  const r = reporte.resumen;
  return (
    <CaseShell {...props}>
      <KpiStrip
        items={[
          { label: "Envíos revisados", value: r.enviosRevisados ?? 0 },
          { label: "Alertas nuevas", value: r.alertasNuevas ?? 0 },
          { label: "Ya detectadas", value: r.yaAvisadas ?? 0 },
        ].filter((k) => k.value !== 0 || reporte.rows.length > 0)}
      />
      <Advertencias items={reporte.advertencias} />
      <ReportBody
        emptyText={
          props.view.solution?.emptyText || "No hay envíos con problemas."
        }
        isEmpty={reporte.rows.length === 0}
        loading={props.records === null}
        updatedAt={reporte.updatedAt}
      >
        <ul className="space-y-2">
          {reporte.rows.map((row, i) => {
            const aviso = textoCelda(row, "aviso");
            const canal = textoCelda(row, "canal");
            return (
              <li
                className="rounded-xl border p-4 transition-colors hover:bg-muted/40"
                key={textoCelda(row, "envio") || i}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">
                      Envío {textoCelda(row, "envio")}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {[
                        textoCelda(row, "referencia") &&
                          `Pedido ${textoCelda(row, "referencia")}`,
                        canal,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {textoCelda(row, "motivo") && (
                      <Badge tone="warning">{textoCelda(row, "motivo")}</Badge>
                    )}
                    {aviso && (
                      <Badge tone={aviso === "Nuevo" ? "error" : "neutral"}>
                        {aviso}
                      </Badge>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-sm">
                  {[
                    textoCelda(row, "estado") &&
                      `Estado: ${textoCelda(row, "estado")}`,
                    textoCelda(row, "detalle"),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            );
          })}
        </ul>
      </ReportBody>
    </CaseShell>
  );
}
