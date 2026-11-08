import { readFileSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { FrontendPanel } from "../components/frontend-panel";

const baseView = {
  title: "Panel de precios mayoristas",
  collection: "reportes",
  showRun: true,
  solution: {
    brand: "Distribuidora Andina",
    subheading: "Precios mayoristas actualizados con cada ejecución.",
    accent: "#0f766e",
  },
};

const ahora = new Date("2026-11-08T14:30:00-03:00").toISOString();
const ayer = new Date("2026-11-07T09:12:00-03:00").toISOString();

const escenarioMixto = h(FrontendPanel, {
  view: baseView,
  records: [],
  message: "",
  canRun: true,
  running: false,
  onRun: () => {},
  fuentes: [
    {
      integration: "tiendanube",
      label: "Tiendanube",
      state: "al_dia",
      detail: "Última consulta correcta.",
      lastRunAt: ahora,
    },
    {
      integration: "stripe",
      label: "Stripe",
      state: "error",
      detail: "Falta conectar Stripe.",
      lastRunAt: ayer,
    },
    {
      integration: "mercadolibre",
      label: "Mercado Libre",
      state: "desactivada",
      detail:
        "Desactivada en la configuración de esta solución: no se consulta.",
    },
  ],
});

const escenarioTodasOff = h(FrontendPanel, {
  view: { ...baseView, title: "Panel de stock" },
  records: [],
  message: "",
  canRun: true,
  running: false,
  onRun: () => {},
  fuentes: [
    {
      integration: "tiendanube",
      label: "Tiendanube",
      state: "desactivada",
      detail:
        "Desactivada en la configuración de esta solución: no se consulta.",
    },
    {
      integration: "mercadolibre",
      label: "Mercado Libre",
      state: "desactivada",
      detail:
        "Desactivada en la configuración de esta solución: no se consulta.",
    },
  ],
});

const css = readFileSync("/tmp/panel.css", "utf8");
const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demo panel Fuentes</title>
<style>${css}</style>
</head>
<body class="bg-white text-zinc-900">
<div id="mixto">${renderToStaticMarkup(escenarioMixto)}</div>
<hr style="margin:2rem 0">
<div id="todas-off">${renderToStaticMarkup(escenarioTodasOff)}</div>
</body>
</html>`;
writeFileSync("/tmp/panel-demo.html", html);
console.log("panel-demo.html written", html.length);
