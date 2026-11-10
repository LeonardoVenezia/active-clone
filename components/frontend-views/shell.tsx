import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import {
  EmptyState,
  FuentesSection,
  LiveNote,
  type PanelFuente,
  type PanelRecord,
  type PanelView,
  TableSkeleton,
} from "@/components/frontend-panel";
import { Button } from "@/components/ui/button";

/** Props comunes de una vista dedicada de caso (mismo contrato que el panel genérico). */
export type CaseViewProps = {
  view: PanelView;
  records: PanelRecord[] | null;
  message: string;
  canRun: boolean;
  running: boolean;
  onRun: () => void;
  blocked?: boolean;
  fuentes?: PanelFuente[];
};

export function CaseShell({
  view,
  fuentes,
  canRun,
  running,
  onRun,
  message,
  blocked,
  children,
}: CaseViewProps & { children: ReactNode }) {
  const slots = view.solution;
  const accentStyle = slots?.accent ? { color: slots.accent } : undefined;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="space-y-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1
            className="font-semibold text-2xl tracking-tight"
            style={accentStyle}
          >
            {view.title || "Panel"}
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
        {canRun && view.showRun && (
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
      {fuentes && fuentes.length > 0 && <FuentesSection fuentes={fuentes} />}
      {children}
    </div>
  );
}

/** Franja de indicadores del caso (contadores del resumen del reporte). */
export function KpiStrip({
  items,
}: {
  items: { label: string; value: number }[];
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((k) => (
        <div className="rounded-xl border px-4 py-3" key={k.label}>
          <dt className="text-muted-foreground text-xs">{k.label}</dt>
          <dd className="font-semibold text-xl tabular-nums">{k.value}</dd>
        </div>
      ))}
    </dl>
  );
}

type BadgeTone = "neutral" | "success" | "warning" | "error" | "brand";

const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success-subtle text-success-foreground",
  warning: "bg-warning-subtle text-warning-foreground",
  error: "bg-error-subtle text-error-foreground",
  brand: "bg-brand/10 text-brand",
};

/** Etiqueta de estado semántica: el color siempre significa estado (DESIGN.md). */
export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-medium text-xs ${BADGE_TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

/** Avisos de alcance del reporte (advertencias honestas del paso del caso). */
export function Advertencias({ items }: { items: string[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-warning bg-warning-subtle px-4 py-3 text-warning-foreground dark:border-warning/40">
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="text-sm">
        {items.map((a) => (
          <p key={a}>Atención: {a}</p>
        ))}
      </div>
    </div>
  );
}

/** Cuerpo del reporte: skeleton, vacío que enseña, o el contenido del caso. */
export function ReportBody({
  loading,
  isEmpty,
  emptyText,
  updatedAt,
  children,
}: {
  loading: boolean;
  isEmpty: boolean;
  emptyText: string;
  updatedAt?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <LiveNote />
        {updatedAt && (
          <p className="text-muted-foreground text-xs tabular-nums">
            Actualizado{" "}
            {new Date(updatedAt).toLocaleString("es-AR", {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </p>
        )}
      </div>
      {loading && <TableSkeleton />}
      {!loading && isEmpty && <EmptyState text={emptyText} />}
      {!(loading || isEmpty) && children}
    </section>
  );
}
