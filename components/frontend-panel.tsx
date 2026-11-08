import { AlertTriangle, Inbox } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_PANEL_BLOCKS,
  type PanelAction,
  type PanelBlockKey,
} from "@/lib/datos/frontend";

export type SolutionSlots = {
  brand?: string;
  subheading?: string;
  accent?: string;
  emptyText?: string;
};
export type PanelView = {
  title: string;
  collection: string;
  showRun: boolean;
  columns?: string[];
  showForm?: boolean;
  keyField?: string;
  runOnSubmit?: boolean;
  rowsField?: string;
  labels?: Record<string, string>;
  /** Orden de los bloques de contenido declarado por el caso (config). */
  blocks?: PanelBlockKey[];
  /** Acciones por fila declaradas por el caso: cada una escribe actionField=<id> en el registro. */
  actions?: PanelAction[];
  /** Campo del registro que escribe cada acción (default "estado"). */
  actionField?: string;
  /** Slots declarativos de diseño de la solución (config por cliente). */
  solution?: SolutionSlots;
};
export type PanelRecord = { key: string; value: unknown; updatedAt: string };
export type PanelField = {
  name: string;
  type: "texto" | "numero" | "booleano" | "fecha";
  required: boolean;
};
export type PanelFuente = {
  integration: string;
  label: string;
  state: "al_dia" | "sin_datos" | "error" | "desactivada";
  detail: string;
  /** ISO de la última consulta: la frescura se muestra, no se promete. */
  lastRunAt?: string;
};

// El color de una fuente es SIEMPRE estado semántico (ver DESIGN.md).
const FUENTE_STATE_TEXT: Record<PanelFuente["state"], string> = {
  al_dia: "Consulta exitosa",
  sin_datos: "Sin datos todavía",
  error: "Error",
  desactivada: "Desactivada",
};

const FUENTE_STATE_DOT: Record<PanelFuente["state"], string> = {
  al_dia: "bg-success",
  sin_datos: "bg-warning",
  error: "bg-error",
  desactivada: "bg-muted-foreground/40",
};

const FUENTE_STATE_TONE: Record<PanelFuente["state"], string> = {
  al_dia: "text-success-foreground",
  sin_datos: "text-warning-foreground",
  error: "text-error-foreground",
  desactivada: "text-muted-foreground",
};

function FuentesSection({ fuentes }: { fuentes: PanelFuente[] }) {
  if (fuentes.length === 0) {
    return null;
  }
  const todasDesactivadas = fuentes.every((f) => f.state === "desactivada");
  return (
    <section className="rounded-xl border">
      <h2 className="border-b px-4 py-3 font-medium text-sm">
        Fuentes de esta solución
      </h2>
      <ul className="divide-y">
        {fuentes.map((f) => (
          <li className="flex items-start gap-3 px-4 py-3" key={f.integration}>
            <span
              aria-hidden
              className={`mt-1.5 size-2 shrink-0 rounded-full ${FUENTE_STATE_DOT[f.state]}`}
            />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm leading-5">{f.label}</p>
              <p className="text-muted-foreground text-xs">{f.detail}</p>
            </div>
            <div className="shrink-0 text-right">
              <p
                className={`font-medium text-xs ${FUENTE_STATE_TONE[f.state]}`}
              >
                {FUENTE_STATE_TEXT[f.state]}
              </p>
              {f.lastRunAt && (
                <p className="text-muted-foreground text-xs tabular-nums">
                  {new Date(f.lastRunAt).toLocaleString("es-AR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
      {todasDesactivadas && (
        <p className="border-t px-4 py-3 text-muted-foreground text-xs">
          Todas las fuentes están desactivadas en esta solución: no hay
          consultas en curso. Esto es una configuración, no un error.
        </p>
      )}
    </section>
  );
}

function cell(value: unknown, col: string): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "";
  }
  const v = (value as Record<string, unknown>)[col];
  if (v === undefined || v === null) {
    return "";
  }
  if (typeof v === "string") {
    return v;
  }
  if (typeof v === "boolean") {
    return v ? "Sí" : "No";
  }
  return JSON.stringify(v);
}

function inputTypeOf(t: PanelField["type"]): string {
  if (t === "numero") {
    return "number";
  }
  if (t === "fecha") {
    return "date";
  }
  return "text";
}

const INPUT_CLASS =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50";

function FormBlock({
  fields,
  onSubmit,
  busy,
  labels,
}: {
  fields: PanelField[];
  onSubmit: (values: Record<string, string>) => Promise<boolean>;
  busy: boolean;
  labels: Record<string, string>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <form
      className="space-y-4 rounded-xl border p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onSubmit(values)) {
          setValues({});
        }
      }}
    >
      <h2 className="font-medium">Nuevo registro</h2>
      {fields.map((f) => (
        // biome-ignore lint/a11y/noLabelWithoutControl: el control va anidado dentro del label
        <label className="block space-y-1.5 text-sm" key={f.name}>
          <span className="font-medium">
            {labels[f.name] ?? f.name}
            {f.required && <span className="text-error"> *</span>}
          </span>
          {f.type === "booleano" ? (
            <select
              className={INPUT_CLASS}
              onChange={(e) =>
                setValues({ ...values, [f.name]: e.target.value })
              }
              value={values[f.name] ?? ""}
            >
              <option value="">-</option>
              <option value="true">Sí</option>
              <option value="false">No</option>
            </select>
          ) : (
            <input
              className={INPUT_CLASS}
              maxLength={f.type === "texto" ? 1000 : undefined}
              onChange={(e) =>
                setValues({ ...values, [f.name]: e.target.value })
              }
              required={f.required}
              step={f.type === "numero" ? "any" : undefined}
              type={inputTypeOf(f.type)}
              value={values[f.name] ?? ""}
            />
          )}
        </label>
      ))}
      <Button
        className="bg-brand text-brand-foreground transition-colors hover:bg-brand/90"
        disabled={busy}
        type="submit"
      >
        {busy ? "Enviando..." : "Enviar"}
      </Button>
    </form>
  );
}

function TableSkeleton() {
  return (
    <output aria-busy="true" className="block space-y-2">
      <span className="sr-only">Cargando datos...</span>
      <div className="h-4 w-40 animate-pulse rounded bg-muted" />
      <div className="overflow-hidden rounded-xl border">
        {[80, 65, 72].map((w) => (
          <div className="border-b px-3 py-3 last:border-b-0" key={w}>
            <div
              className="h-3.5 animate-pulse rounded bg-muted"
              style={{ width: `${w}%` }}
            />
          </div>
        ))}
      </div>
    </output>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center">
      <Inbox aria-hidden className="size-6 text-muted-foreground" />
      <p className="text-muted-foreground text-sm">{text}</p>
    </div>
  );
}

function LiveNote() {
  return (
    <p className="flex items-center gap-2 text-muted-foreground text-xs">
      <span
        aria-hidden
        className="size-1.5 animate-pulse rounded-full bg-brand"
      />
      Esta vista se actualiza cada 5 segundos
    </p>
  );
}

// Presentational part of the Frontend page (no data fetching, no auth): easy to render with fixtures.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: panel con ramas de presentación (tabla/tarjetas/form); refactor fuera de alcance
export function FrontendPanel({
  view,
  records,
  message,
  canRun,
  running,
  onRun,
  blocked,
  fields,
  formMessage,
  submitting,
  onSubmit,
  fuentes,
  onAction,
  actionBusy,
}: {
  blocked?: boolean;
  view: PanelView | null;
  records: PanelRecord[] | null;
  message: string;
  canRun: boolean;
  running: boolean;
  onRun: () => void;
  fields?: PanelField[] | null;
  formMessage?: string;
  submitting?: boolean;
  onSubmit?: (values: Record<string, string>) => Promise<boolean>;
  fuentes?: PanelFuente[];
  /** Aplica una acción declarada sobre el registro de la fila. */
  onAction?: (key: string, actionId: string) => void;
  /** "<key>:<actionId>" de la acción en curso (deshabilita ese botón). */
  actionBusy?: string | null;
}) {
  const columns = view?.columns ?? [];
  const labels = view?.labels ?? {};
  const labelOf = (c: string) => labels[c] ?? c;
  // Slots de diseño de la solución (config por cliente, sanitizados en servidor).
  const slots = view?.solution;
  const accentStyle = slots?.accent ? { color: slots.accent } : undefined;
  const emptyText = slots?.emptyText || "No hay datos todavía.";
  // rowsField mode: the latest record holds the report; its value[rowsField]
  // array is the table. One overwritten record = no stale rows across runs.
  const rowsField = view?.rowsField ?? "";
  const reportRecord = rowsField
    ? (records ?? []).find(
        (r) =>
          r.value &&
          typeof r.value === "object" &&
          !Array.isArray(r.value) &&
          Array.isArray((r.value as Record<string, unknown>)[rowsField])
      )
    : undefined;
  const reportRows = reportRecord
    ? ((reportRecord.value as Record<string, unknown>)[rowsField] as Record<
        string,
        unknown
      >[])
    : null;
  const reportAdvertencias = reportRecord
    ? (((reportRecord.value as Record<string, unknown>).advertencias as
        | string[]
        | undefined) ?? [])
    : [];
  const reportDate = reportRecord
    ? new Date(reportRecord.updatedAt).toLocaleString("es-AR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "";
  const reportOmitidos = reportRecord
    ? (((reportRecord.value as Record<string, unknown>).omitidos as
        | Record<string, unknown>[]
        | undefined) ?? [])
    : [];
  const TH_CLASS =
    "px-3 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider";
  const TD_CLASS = "break-words px-3 py-2.5";
  // Orden de bloques declarado por el caso; desconocidos/ausentes caen al final
  // en el orden original, así un panel sin config nueva no cambia.
  const rowActions = view?.actions ?? [];
  const blockOrder = new Map<PanelBlockKey, number>(
    (view?.blocks?.length ? view.blocks : DEFAULT_PANEL_BLOCKS).map(
      (b, i) => [b, i + 1] as const
    )
  );
  const ord = (k: PanelBlockKey) => blockOrder.get(k) ?? 99;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="space-y-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1
            className="font-semibold text-2xl tracking-tight"
            style={accentStyle}
          >
            {view?.title || "Panel"}
          </h1>
          {slots?.brand && (
            <p
              className="font-medium text-brand text-xs tracking-wide"
              style={accentStyle}
            >
              {slots.brand}
            </p>
          )}
        </div>
        {slots?.subheading && (
          <p className="text-muted-foreground text-sm">{slots.subheading}</p>
        )}
      </header>
      {blocked && message && (
        <div className="flex items-start gap-2.5 rounded-xl border border-warning bg-warning-subtle px-4 py-3 text-warning-foreground">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p className="text-sm">{message}</p>
        </div>
      )}
      <div className="flex items-center gap-3">
        {canRun && view?.showRun && (
          <Button
            className="bg-brand text-brand-foreground transition-colors hover:bg-brand/90"
            disabled={running}
            onClick={onRun}
          >
            {running ? "Iniciando..." : "Ejecutar"}
          </Button>
        )}
        {!blocked && message && (
          <p className="text-muted-foreground text-sm">{message}</p>
        )}
      </div>
      {fuentes && fuentes.length > 0 && (
        <div style={{ order: ord("fuentes") }}>
          <FuentesSection fuentes={fuentes} />
        </div>
      )}
      {!blocked && view?.showForm && (
        <section className="space-y-2" style={{ order: ord("formulario") }}>
          {fields?.length && onSubmit ? (
            <FormBlock
              busy={!!submitting}
              fields={fields}
              labels={labels}
              onSubmit={onSubmit}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              El formulario necesita campos definidos para la colección (nodo
              Datos, Definir campos).
            </p>
          )}
          {formMessage && (
            <p
              className={`rounded-lg px-3 py-2 text-sm ${
                formMessage.startsWith("Guardado")
                  ? "bg-success-subtle text-success-foreground"
                  : "bg-error-subtle text-error-foreground"
              }`}
            >
              {formMessage}
            </p>
          )}
        </section>
      )}
      {!blocked && (
        <section className="space-y-2.5" style={{ order: ord("tabla") }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium">
              {view ? "Datos" : "Esta página todavía no está configurada."}
            </h2>
            {view && <LiveNote />}
          </div>
          {records === null && <TableSkeleton />}
          {rowsField && records !== null && !reportRows?.length && (
            <EmptyState text={emptyText} />
          )}
          {rowsField && reportAdvertencias.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-xl border border-warning bg-warning-subtle px-4 py-3 text-warning-foreground dark:border-warning/40">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <div className="text-sm">
                {reportAdvertencias.map((a, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: advertencias sin id estable; orden fijo por corrida
                  <p key={i}>Atención: {a}</p>
                ))}
              </div>
            </div>
          )}
          {rowsField && !!reportRows?.length && (
            <div className="space-y-2">
              <div className="hidden overflow-hidden rounded-xl border sm:block">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      {columns.map((c) => (
                        <th className={TH_CLASS} key={c}>
                          {labelOf(c)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {reportRows.map((row, i) => (
                      <tr
                        className="align-top transition-colors hover:bg-muted/40"
                        // biome-ignore lint/suspicious/noArrayIndexKey: filas de reporte sin id estable; orden fijo por corrida
                        key={i}
                      >
                        {columns.map((c) => (
                          <td className={TD_CLASS} key={c}>
                            {cell(row, c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-2 sm:hidden">
                {reportRows.map((row, i) => (
                  <div
                    className="rounded-xl border p-3 text-sm"
                    // biome-ignore lint/suspicious/noArrayIndexKey: filas de reporte sin id estable; orden fijo por corrida
                    key={i}
                  >
                    {columns.map((c) => (
                      <div className="flex justify-between gap-3 py-1" key={c}>
                        <span className="shrink-0 text-muted-foreground text-xs uppercase tracking-wide">
                          {labelOf(c)}
                        </span>
                        <span className="break-words text-right">
                          {cell(row, c)}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground text-xs tabular-nums">
                Actualizado {reportDate}
              </p>
            </div>
          )}
          {rowsField && reportOmitidos.length > 0 && (
            <div className="space-y-1 rounded-xl border p-3 text-xs">
              <p className="font-medium">Omitidos (sin borrador)</p>
              {reportOmitidos.map((o, i) => (
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
            </div>
          )}
          {!rowsField && records?.length === 0 && (
            <EmptyState text={emptyText} />
          )}
          {!rowsField && !!records?.length && (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className={TH_CLASS}>Clave</th>
                    {columns.length ? (
                      columns.map((c) => (
                        <th className={TH_CLASS} key={c}>
                          {labelOf(c)}
                        </th>
                      ))
                    ) : (
                      <th className={TH_CLASS}>Valor</th>
                    )}
                    <th className={TH_CLASS}>Actualizado</th>
                    {rowActions.length > 0 && (
                      <th className={TH_CLASS}>Acciones</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {records.map((r) => (
                    <tr
                      className="align-top transition-colors hover:bg-muted/40"
                      key={r.key}
                    >
                      <td className="break-words px-3 py-2.5 font-mono text-xs">
                        {r.key}
                      </td>
                      {columns.length ? (
                        columns.map((c) => (
                          <td className={TD_CLASS} key={c}>
                            {cell(r.value, c)}
                          </td>
                        ))
                      ) : (
                        <td className="px-3 py-2.5 font-mono text-xs">
                          {typeof r.value === "string"
                            ? r.value
                            : JSON.stringify(r.value)}
                        </td>
                      )}
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground text-xs tabular-nums">
                        {new Date(r.updatedAt).toLocaleString("es-AR", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </td>
                      {rowActions.length > 0 && (
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col items-start gap-1.5">
                            {rowActions.map((a) => {
                              const busy = actionBusy === `${r.key}:${a.id}`;
                              return (
                                <Button
                                  disabled={!onAction || busy}
                                  key={a.id}
                                  onClick={() => onAction?.(r.key, a.id)}
                                  size="sm"
                                  variant="outline"
                                >
                                  {busy ? "Aplicando..." : a.label}
                                </Button>
                              );
                            })}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
