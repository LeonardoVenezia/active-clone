// Suite "soluciones" (gate CI del pack, como las demás de tests/workflows).
// Contratos de las vistas dedicadas por caso:
// - slot `view` del nodo Solución: registro cerrado, parse defensivo, nunca
//   rompe soluciones sin vista (caen al panel genérico);
// - extracción del reporte del caso (filas/resumen/advertencias/omitidos)
//   desde los registros del panel, con parse defensivo.

import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSolutionConfig,
  solutionConfigFromNodes,
} from "../../lib/soluciones/config";
import {
  numeroCampo,
  reporteFromRecords,
  textoCelda,
} from "../../lib/soluciones/reporte";
import {
  parseSolutionViewKind,
  SOLUTION_VIEW_KINDS,
} from "../../lib/soluciones/views";

test("view: claves válidas del registro cerrado; lo demás se descarta", () => {
  for (const k of SOLUTION_VIEW_KINDS) {
    assert.equal(parseSolutionViewKind(k), k);
  }
  assert.equal(parseSolutionViewKind("mapa"), undefined);
  assert.equal(parseSolutionViewKind(""), undefined);
  assert.equal(parseSolutionViewKind(" stock-alertas "), "stock-alertas");
  assert.equal(parseSolutionViewKind(42), undefined);
  assert.equal(parseSolutionViewKind(null), undefined);
});

test("view: slot válido se conserva en la config de la solución", () => {
  const c = parseSolutionConfig({
    name: "Stock",
    frontend: { view: "stock-alertas", brand: "Acme" },
  });
  assert.ok(c?.frontend);
  assert.equal(c.frontend.view, "stock-alertas");
  assert.equal(c.frontend.brand, "Acme");
});

test("view: slot desconocido se descarta; una vista sola ya habilita slots", () => {
  const c = parseSolutionConfig({ frontend: { view: "no-existe" } });
  assert.equal(c, null);
  const soloVista = parseSolutionConfig({
    frontend: { view: "avisos-borradores" },
  });
  assert.equal(soloVista?.frontend?.view, "avisos-borradores");
});

test("view: configs viejas sin view quedan igual (fallback genérico)", () => {
  const c = parseSolutionConfig({
    name: "Pack",
    frontend: { brand: "Acme", emptyText: "Sin datos" },
  });
  assert.ok(c?.frontend);
  assert.equal(c.frontend.view, undefined);
  assert.equal(c.frontend.brand, "Acme");
});

test("view: el nodo Solución del workflow declara la vista dedicada", () => {
  const nodes = [
    {
      data: {
        config: {
          actionType: "Solución",
          solutionName: "Soporte",
          view: "soporte-consultas",
          sources: "tiendanube=active",
        },
      },
    },
  ];
  const c = solutionConfigFromNodes(nodes);
  assert.equal(c?.frontend?.view, "soporte-consultas");
  assert.equal(c?.sources.tiendanube, "active");
  const sinVista = solutionConfigFromNodes([
    { data: { config: { actionType: "Solución", solutionName: "X" } } },
  ]);
  assert.equal(sinVista?.frontend, undefined);
});

const rec = (value: unknown, updatedAt = "2026-11-08T16:00:00.000Z") => ({
  value,
  updatedAt,
});

test("reporte: extrae filas, resumen, advertencias, omitidos y fecha", () => {
  const records = [
    rec({
      filas: [{ sku: "A", stock: "1" }, { sku: "B" }],
      resumen: { alertasNuevas: 1, productosRevisados: 4 },
      advertencias: ["Solo reporte."],
      omitidos: [{ motivo: "x" }],
      generado: "2026-11-08T15:59:59.000Z",
      total: 2,
    }),
  ];
  const r = reporteFromRecords(records, "filas");
  assert.equal(r.rows.length, 2);
  assert.equal(r.resumen.alertasNuevas, 1);
  assert.deepEqual(r.advertencias, ["Solo reporte."]);
  assert.equal(r.omitidos.length, 1);
  assert.equal(r.generado, "2026-11-08T15:59:59.000Z");
  assert.equal(r.total, 2);
  assert.equal(r.updatedAt, "2026-11-08T16:00:00.000Z");
});

test("reporte: sin rowsField o sin registros válidos devuelve vacío", () => {
  assert.deepEqual(reporteFromRecords([], "filas").rows, []);
  assert.deepEqual(reporteFromRecords(null, "filas").rows, []);
  assert.deepEqual(reporteFromRecords([rec({ filas: [] })], "").rows, []);
  // Un registro cuyo campo no es array no califica; valores no-objeto se filtran.
  const r = reporteFromRecords(
    [rec({ filas: "no-array" }), rec({ filas: [{ a: 1 }, "x", null, [1]] })],
    "filas"
  );
  assert.deepEqual(r.rows, [{ a: 1 }]);
  // Resumen con valores no numéricos se filtra.
  const r2 = reporteFromRecords(
    [rec({ filas: [{}], resumen: { ok: 3, mal: "x", nan: Number.NaN } })],
    "filas"
  );
  assert.deepEqual(r2.resumen, { ok: 3 });
});

test("celdas: textoCelda nunca devuelve [object Object]; numeroCampo interpreta", () => {
  const row = { a: "x", b: 3, c: true, d: { z: 1 }, e: "12,5", f: " 7 " };
  assert.equal(textoCelda(row, "a"), "x");
  assert.equal(textoCelda(row, "b"), "3");
  assert.equal(textoCelda(row, "c"), "Sí");
  assert.equal(textoCelda(row, "d"), '{"z":1}');
  assert.equal(textoCelda(row, "zzz"), "");
  assert.equal(numeroCampo(row, "b"), 3);
  assert.equal(numeroCampo(row, "f"), 7);
  assert.equal(numeroCampo(row, "e"), null);
  assert.equal(numeroCampo(row, "d"), null);
  assert.equal(numeroCampo({ stock: "sin dato" }, "stock"), null);
});
