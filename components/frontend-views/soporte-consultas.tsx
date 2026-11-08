import { reporteFromRecords, textoCelda } from "@/lib/soluciones/reporte";
import {
  Advertencias,
  Badge,
  CaseShell,
  type CaseViewProps,
  KpiStrip,
  ReportBody,
} from "./shell";

const DERIVA_PREFIX = "Deriva a humano";

function motivoDerivacion(estado: string): string {
  return estado.startsWith(`${DERIVA_PREFIX}:`)
    ? estado.slice(DERIVA_PREFIX.length + 1).trim()
    : estado;
}

/**
 * Vista dedicada del caso "soporte asistido": consultas con borrador listo
 * para aprobación humana y consultas derivadas a una persona con su motivo.
 * La derivación es una marca interna registrada: esta vista no envía
 * respuestas ni deriva hacia sistemas externos.
 */
export function SoporteConsultasView(props: CaseViewProps) {
  const reporte = reporteFromRecords(props.records, props.view.rowsField ?? "");
  const r = reporte.resumen;
  const pendientes = reporte.rows.filter(
    (row) => !textoCelda(row, "estado").startsWith(DERIVA_PREFIX)
  );
  const derivadas = reporte.rows.filter((row) =>
    textoCelda(row, "estado").startsWith(DERIVA_PREFIX)
  );
  return (
    <CaseShell {...props}>
      <KpiStrip
        items={[
          { label: "Consultas recibidas", value: r.consultasRecibidas ?? 0 },
          { label: "Con borrador", value: pendientes.length },
          { label: "Derivadas a una persona", value: derivadas.length },
        ].filter((k) => k.value !== 0 || reporte.rows.length > 0)}
      />
      <Advertencias items={reporte.advertencias} />
      <ReportBody
        emptyText={
          props.view.solution?.emptyText || "No hay consultas registradas."
        }
        isEmpty={reporte.rows.length === 0}
        loading={props.records === null}
        updatedAt={reporte.updatedAt}
      >
        <div className="space-y-4">
          {pendientes.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-medium text-sm">Pendientes de aprobación</h2>
              <ul className="space-y-2">
                {pendientes.map((row, i) => (
                  <li
                    className="rounded-xl border p-4"
                    key={textoCelda(row, "consulta") || i}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm">
                          {textoCelda(row, "cliente") || "Cliente"}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {[
                            textoCelda(row, "tema"),
                            textoCelda(row, "consulta"),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <Badge tone="warning">
                        {textoCelda(row, "estado") || "Pendiente"}
                      </Badge>
                    </div>
                    <blockquote className="mt-3 rounded-lg border-brand border-l-2 bg-muted/40 px-3 py-2 text-sm">
                      {textoCelda(row, "borrador")}
                    </blockquote>
                    <p className="mt-2 text-muted-foreground text-xs">
                      Borrador para revisión: todavía no se envió nada al
                      cliente.
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {derivadas.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-medium text-sm">Derivadas a una persona</h2>
              <ul className="space-y-2">
                {derivadas.map((row, i) => (
                  <li
                    className="rounded-xl border border-dashed p-4"
                    key={textoCelda(row, "consulta") || i}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm">
                          {textoCelda(row, "cliente") || "Cliente"}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {[
                            textoCelda(row, "tema"),
                            textoCelda(row, "consulta"),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <Badge tone="neutral">
                        {textoCelda(row, "preparacion") ||
                          "Derivación registrada"}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm">
                      {motivoDerivacion(textoCelda(row, "estado"))}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </ReportBody>
    </CaseShell>
  );
}
