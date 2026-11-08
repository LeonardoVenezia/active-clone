// Suite "soluciones" (vive en tests/workflows para heredar el gate CI del pack).
// Contratos de la configuración de solución cerrada configurable:
// parse defensivo, identificación de fuentes y contrato de ausencia.

import assert from "node:assert/strict";
import test from "node:test";
import {
  integrationFromActionType,
  isOmittedOutput,
  isSourceInactive,
  OMITTED_MARKER,
  omittedSourceOutput,
  parseSolutionConfig,
  solutionConfigFromNodes,
} from "../../lib/soluciones/config";

test("parse: config inválida o vacía devuelve null", () => {
  assert.equal(parseSolutionConfig(null), null);
  assert.equal(parseSolutionConfig("x"), null);
  assert.equal(parseSolutionConfig([]), null);
  assert.equal(parseSolutionConfig({}), null);
  assert.equal(parseSolutionConfig({ sources: {} }), null);
  assert.equal(
    parseSolutionConfig({ sources: { tiendanube: "apagada" } }),
    null
  );
});

test("parse: fuentes se normalizan y lo inválido se descarta", () => {
  const c = parseSolutionConfig({
    name: "  Mi Solución  ",
    sources: {
      " TiendaNube ": "inactive",
      mercadolibre: "active",
      amazon: "off", // valor inválido: descartado
      "MAL KEY!": "inactive", // clave inválida: descartada
    },
  });
  assert.equal(c?.name, "Mi Solución");
  assert.deepEqual(c?.sources, {
    tiendanube: "inactive",
    mercadolibre: "active",
  });
});

test("parse: slots de frontend validados y recortados", () => {
  const c = parseSolutionConfig({
    frontend: {
      brand: "  Acme ",
      subheading: "Pedidos al día",
      accent: "#0af",
      emptyText: "Sin pedidos",
    },
  });
  assert.deepEqual(c?.frontend, {
    brand: "Acme",
    subheading: "Pedidos al día",
    accent: "#0af",
    emptyText: "Sin pedidos",
  });
  // acento inválido se descarta sin invalidar el resto
  const bad = parseSolutionConfig({ frontend: { accent: "rojo" } });
  assert.equal(bad, null);
  const long = parseSolutionConfig({ frontend: { brand: "x".repeat(200) } });
  assert.equal(long?.frontend?.brand?.length, 60);
  // la bajada admite una frase completa: el tope es 240, no 140 (cortaba
  // la frase a media palabra en desktop)
  const sub = parseSolutionConfig({ frontend: { subheading: "y".repeat(300) } });
  assert.equal(sub?.frontend?.subheading?.length, 240);
  const frase =
    "Demostración con datos ficticios. Fuentes desactivadas: la demo no las consulta.";
  const kept = parseSolutionConfig({ frontend: { subheading: frase } });
  assert.equal(kept?.frontend?.subheading, frase);
});

test("integración de un paso: solo IDs plugin/slug; sistema nunca se omite", () => {
  assert.equal(
    integrationFromActionType("tiendanube/search-orders"),
    "tiendanube"
  );
  assert.equal(
    integrationFromActionType("mercadolibre/get-order"),
    "mercadolibre"
  );
  assert.equal(integrationFromActionType("Condition"), null);
  assert.equal(integrationFromActionType("Datos"), null);
  assert.equal(integrationFromActionType("Unir"), null);
  assert.equal(integrationFromActionType(""), null);
  assert.equal(integrationFromActionType("/sin-integracion"), null);
});

test("inactividad: solo la inactiva explícita cuenta", () => {
  const c = parseSolutionConfig({
    sources: { mercadolibre: "inactive", tiendanube: "active" },
  });
  assert.equal(isSourceInactive(c, "mercadolibre"), true);
  // activa explícita: NO se omite (si falta credencial, falla visible)
  assert.equal(isSourceInactive(c, "tiendanube"), false);
  // no declarada: NO se omite (ausencia de config != inactiva)
  assert.equal(isSourceInactive(c, "amazon"), false);
  assert.equal(isSourceInactive(null, "mercadolibre"), false);
});

test("contrato de ausencia: salida registrada y detectable", () => {
  const out = omittedSourceOutput("mercadolibre");
  assert.equal(out[OMITTED_MARKER], true);
  assert.equal(out.integration, "mercadolibre");
  assert.ok(out.reason.includes("no se consultó"));
  assert.equal(isOmittedOutput(out), true);
  assert.equal(isOmittedOutput({ orders: [] }), false);
  assert.equal(isOmittedOutput(null), false);
  assert.equal(isOmittedOutput({ [OMITTED_MARKER]: false }), false);
});

test("nodo Solución: config declarada en el propio workflow", () => {
  const nodes = [
    { data: { config: { actionType: "tiendanube/search-orders" } } },
    {
      data: {
        config: {
          actionType: "Solución",
          solutionName: "Pedidos Acme",
          sources: "tiendanube=active, mercadolibre = inactive, amazon=off",
          brand: "Acme",
          subheading: "Pedidos al día",
          accent: "#3366ff",
          emptyText: "Sin pedidos todavía",
        },
      },
    },
  ];
  const c = solutionConfigFromNodes(nodes);
  assert.equal(c?.name, "Pedidos Acme");
  assert.deepEqual(c?.sources, {
    tiendanube: "active",
    mercadolibre: "inactive",
  }); // "off" descartado
  assert.deepEqual(c?.frontend, {
    brand: "Acme",
    subheading: "Pedidos al día",
    accent: "#3366ff",
    emptyText: "Sin pedidos todavía",
  });
  // fan-in mixto: TN activa corre, ML inactiva se omite, amazon nunca existe
  assert.equal(isSourceInactive(c, "tiendanube"), false);
  assert.equal(isSourceInactive(c, "mercadolibre"), true);
  assert.equal(isSourceInactive(c, "amazon"), false);
});

test("nodo Solución: ausente, inválido o vacío => workflow libre (null)", () => {
  assert.equal(solutionConfigFromNodes(null), null);
  assert.equal(solutionConfigFromNodes([]), null);
  assert.equal(
    solutionConfigFromNodes([{ data: { config: { actionType: "Solución" } } }]),
    null
  );
  assert.equal(
    solutionConfigFromNodes([
      { data: { config: { actionType: "Solución", accent: "no-es-color" } } },
    ]),
    null
  );
  // el primer nodo válido gana
  const dos = solutionConfigFromNodes([
    { data: { config: { actionType: "Solución", sources: "vtex=inactive" } } },
    {
      data: {
        config: { actionType: "Solución", sources: "tiendanube=inactive" },
      },
    },
  ]);
  assert.deepEqual(dos?.sources, { vtex: "inactive" });
});
