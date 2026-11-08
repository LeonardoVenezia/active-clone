// Fixture-driven reconciliation: sales (TN/ML shapes) vs Mercado Pago payments.
// Validates lib/payments/reconcile-shared.ts matching by referencia and the
// four states. No real APIs.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVista,
  reconcilePayments,
  type PagoShape,
  type VentaShape,
} from "../../lib/payments/reconcile-shared";

// Ventas: TN order + ML order shapes reduced to the reconciliation contract
// (canal, ordenId, referencia, total). One TN sale without a payment, one ML
// sale whose payment is short, one exact match.
const ventasFixture: VentaShape[] = [
  { canal: "tiendanube", ordenId: "1001", referencia: "TN-1001", total: 100000 },
  { canal: "tiendanube", ordenId: "1002", referencia: "TN-1002", total: 50000 },
  { canal: "mercadolibre", ordenId: "2000000001", referencia: "ML-2001", total: 80000 },
];

// Cobros: MP payment search shape reduced to the contract (pagoId, referencia,
// bruto, comision, neto). One short payment, one external charge with no sale.
const pagosFixture: PagoShape[] = [
  { pagoId: "MP-A", referencia: "TN-1001", bruto: 100000, comision: 5490, neto: 94510 },
  { pagoId: "MP-B", referencia: "ML-2001", bruto: 79500, comision: 4400, neto: 75100 },
  { pagoId: "MP-C", referencia: "EXT-9", bruto: 12000, comision: 700, neto: 11300 },
];

test("concilia exactos, detecta venta sin cobro y cobro sin venta", () => {
  const { filas, resumen } = reconcilePayments(ventasFixture, pagosFixture);
  assert.equal(resumen.ventas, 3);
  assert.equal(resumen.pagos, 3);
  assert.equal(resumen.conciliados, 1);
  assert.equal(resumen.diferencias, 1);
  assert.equal(resumen.ventasSinCobro, 1);
  assert.equal(resumen.cobrosSinVenta, 1);

  const byRef = new Map(filas.map((f) => [f.referencia, f]));
  assert.equal(byRef.get("TN-1001")?.estado, "conciliado");
  assert.equal(byRef.get("TN-1001")?.neto, 94510);
  assert.equal(byRef.get("TN-1002")?.estado, "venta_sin_cobro");
  assert.equal(byRef.get("TN-1002")?.pagoId, "");
  assert.equal(byRef.get("ML-2001")?.estado, "diferencia_monto");
  assert.equal(byRef.get("EXT-9")?.estado, "cobro_sin_venta");
});

test("la diferencia dentro de la tolerancia no se reporta", () => {
  const { resumen } = reconcilePayments(
    [{ canal: "tiendanube", ordenId: "1", referencia: "R1", total: 100 }],
    [{ pagoId: "P1", referencia: "R1", bruto: 100.4, comision: 0, neto: 100.4 }],
    1
  );
  assert.equal(resumen.conciliados, 1);
  assert.equal(resumen.diferencias, 0);
});

test("entradas vacías producen reporte vacío sin errores", () => {
  const { filas, resumen } = reconcilePayments([], []);
  assert.equal(filas.length, 0);
  assert.equal(resumen.ventas, 0);
  assert.equal(resumen.pagos, 0);
});

test("filas sin referencia se ignoran, no rompen el reporte", () => {
  const { resumen } = reconcilePayments(
    [{ canal: "tiendanube", ordenId: "x", referencia: " ", total: 10 }],
    [{ pagoId: "P", referencia: "", bruto: 10 }]
  );
  assert.equal(resumen.ventas, 0);
  assert.equal(resumen.pagos, 0);
});

test("un pago duplicado no concilia dos ventas con la misma referencia", () => {
  const { filas, resumen } = reconcilePayments(
    [
      { canal: "tiendanube", ordenId: "1", referencia: "R1", total: 100 },
      { canal: "tiendanube", ordenId: "2", referencia: "R1", total: 100 },
    ],
    [{ pagoId: "P1", referencia: "R1", bruto: 100 }]
  );
  assert.equal(resumen.conciliados, 1);
  assert.equal(resumen.ventasSinCobro, 1);
  assert.equal(filas.find((f) => f.ordenId === "2")?.estado, "venta_sin_cobro");
});

test("orden determinista: problemas primero, luego por referencia", () => {
  const { filas } = reconcilePayments(ventasFixture, pagosFixture);
  assert.deepEqual(
    filas.map((f) => f.estado),
    ["diferencia_monto", "venta_sin_cobro", "cobro_sin_venta", "conciliado"]
  );
});

test("vista para el reporte del cliente: etiquetas en español y montos legibles", () => {
  const { filas } = reconcilePayments(ventasFixture, pagosFixture);
  const vista = buildVista(filas);
  const byRef = new Map(vista.map((v) => [v.referencia, v]));
  assert.equal(byRef.get("TN-1001")?.estado, "Conciliado");
  assert.equal(byRef.get("TN-1002")?.estado, "Venta sin cobro");
  assert.equal(byRef.get("TN-1002")?.cobrado, "sin dato");
  assert.equal(byRef.get("EXT-9")?.estado, "Cobro sin venta");
  assert.equal(byRef.get("ML-2001")?.estado, "Diferencia de monto");
});
