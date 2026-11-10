import { parseSolutionViewKind } from "@/lib/soluciones/views";
import { AvisosBorradoresView } from "./avisos-borradores";
import { ConciliacionDiferenciasView } from "./conciliacion-diferencias";
import { EnviosExcepcionesView } from "./envios-excepciones";
import type { CaseViewProps } from "./shell";
import { SoporteConsultasView } from "./soporte-consultas";
import { StockAlertasView } from "./stock-alertas";

/**
 * Dispatcher de vistas dedicadas por caso: la clave declarada en el nodo
 * "Solución" (slot `view`) elige la experiencia. Una clave ausente o
 * desconocida devuelve null y la página cae al panel genérico, así una
 * solución sin vista dedicada nunca se rompe por este parámetro.
 */
export function CaseFrontend(props: CaseViewProps) {
  const kind = parseSolutionViewKind(props.view.solution?.view);
  switch (kind) {
    case "stock-alertas":
      return <StockAlertasView {...props} />;
    case "envios-excepciones":
      return <EnviosExcepcionesView {...props} />;
    case "conciliacion-diferencias":
      return <ConciliacionDiferenciasView {...props} />;
    case "avisos-borradores":
      return <AvisosBorradoresView {...props} />;
    case "soporte-consultas":
      return <SoporteConsultasView {...props} />;
    default:
      return null;
  }
}

/** true si la vista declara una vista dedicada válida del registro cerrado. */
export function hasCaseView(
  view: { solution?: { view?: string } } | null
): boolean {
  return !!parseSolutionViewKind(view?.solution?.view);
}
