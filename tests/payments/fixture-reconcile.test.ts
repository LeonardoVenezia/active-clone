// Fixture-driven reconciliation: sales (TN/ML shapes) vs Mercado Pago payments.
// Validates lib/payments/reconcile-shared.ts matching safety rules: no false
// "conciliado" from simple equality. No real APIs.

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVista,
  FUERA_DE_ALCANCE,
  type PagoShape,
  reconcilePayments,
  type VentaShape,
} from "../../lib/payments/reconcile-shared";

// Ventas: TN order + ML order shapes reduced to the reconciliation contract
// (canal, ordenId, referencia, total). One TN sale without a payment, one ML
// sale whose payment is short, one exact match.
const ventasFixture: VentaShape[] = [
  {
    canal: "tiendanube",
    ordenId: "1001",
    referencia: "TN-1001",
    total: 100_000,
    moneda: "ARS",
  },
  {
    canal: "tiendanube",
    ordenId: "1002",
    referencia: "TN-1002",
    total: 50_000,
    moneda: "ARS",
  },
  {
    canal: "mercadolibre",
    ordenId: "2000000001",
    referencia: "ML-2001",
    total: 80_000,
    moneda: "ARS",
  },
];

// Cobros: MP payment search shape reduced to the contract (pagoId, referencia,
// bruto, comision, neto, estado). One short payment, one external charge with
// no sale, one pending payment that must never count as a cobro.
const pagosFixture: PagoShape[] = [
  {
    pagoId: "MP-A",
    referencia: "TN-1001",
    bruto: 100_000,
    comision: 5490,
    neto: 94_510,
    moneda: "ARS",
    estado: "approved",
  },
  {
    pagoId: "MP-B",
    referencia: "ML-2001",
    bruto: 79_500,
    comision: 4400,
    neto: 75_100,
    moneda: "ARS",
    estado: "approved",
  },
  {
    pagoId: "MP-C",
    referencia: "EXT-9",
    bruto: 12_000,
    comision: 700,
    neto: 11_300,
    moneda: "ARS",
    estado: "approved",
  },
  {
    pagoId: "MP-D",
    referencia: "TN-1002",
    bruto: 50_000,
    comision: 2800,
    neto: 47_200,
    moneda: "ARS",
    estado: "pending",
  },
];

test("concilia exactos, detecta venta sin cobro, cobro sin venta y pendiente aparte", () => {
  const { filas, resumen } = reconcilePayments(ventasFixture, pagosFixture);
  assert.equal(resumen.ventas, 3);
  assert.equal(resumen.pagos, 4);
  assert.equal(resumen.conciliados, 1);
  assert.equal(resumen.diferencias, 1);
  assert.equal(resumen.ventasSinCobro, 1);
  assert.equal(resumen.cobrosSinVenta, 1);
  assert.equal(resumen.pagosNoAcreditados, 1);

  const byRef = new Map(filas.map((f) => [`${f.referencia}|${f.estado}`, f]));
  assert.equal(byRef.get("TN-1001|conciliado")?.neto, 94_510);
  assert.equal(byRef.get("TN-1002|venta_sin_cobro")?.pagoId, "");
  assert.equal(byRef.get("ML-2001|diferencia_monto")?.bruto, 79_500);
  assert.equal(byRef.get("EXT-9|cobro_sin_venta")?.pagoId, "MP-C");
  assert.equal(byRef.get("TN-1002|pago_no_acreditado")?.pagoId, "MP-D");
});

test("un cobro pendiente NUNCA deja la venta como conciliada", () => {
  const { filas, resumen } = reconcilePayments(
    [{ canal: "tiendanube", ordenId: "1", referencia: "R1", total: 100 }],
    [{ pagoId: "P1", referencia: "R1", bruto: 100, estado: "in_process" }]
  );
  assert.equal(resumen.conciliados, 0);
  assert.equal(resumen.ventasSinCobro, 1);
  assert.equal(resumen.pagosNoAcreditados, 1);
  assert.ok(filas.every((f) => f.estado !== "conciliado"));
});

test("un cobro sin estado declarado no se asume acreditado", () => {
  const { resumen } = reconcilePayments(
    [{ canal: "tiendanube", ordenId: "1", referencia: "R1", total: 100 }],
    [{ pagoId: "P1", referencia: "R1", bruto: 100 }]
  );
  assert.equal(resumen.conciliados, 0);
  assert.equal(resumen.pagosNoAcreditados, 1);
});

test("referencia duplicada entre ventas: ambiguo, nunca emparejado", () => {
  const { filas, resumen } = reconcilePayments(
    [
      { canal: "tiendanube", ordenId: "1", referencia: "R1", total: 100 },
      { canal: "mercadolibre", ordenId: "2", referencia: "R1", total: 100 },
    ],
    [{ pagoId: "P1", referencia: "R1", bruto: 100, estado: "approved" }]
  );
  assert.equal(resumen.conciliados, 0);
  assert.equal(resumen.ambiguos, 3); // 2 ventas + 1 cobro
  assert.ok(filas.every((f) => f.estado === "ambiguo"));
  assert.match(filas[0].detalle, /referencia/i);
});

test("dos cobros acreditados con la misma referencia: ambiguo, no sumados (parciales/reintentos)", () => {
  const { filas, resumen } = reconcilePayments(
    [{ canal: "tiendanube", ordenId: "1", referencia: "R1", total: 100 }],
    [
      { pagoId: "P1", referencia: "R1", bruto: 60, estado: "approved" },
      { pagoId: "P2", referencia: "R1", bruto: 40, estado: "approved" },
    ]
  );
  assert.equal(resumen.conciliados, 0);
  assert.equal(resumen.ambiguos, 3);
  assert.ok(filas.some((f) => /parciales o reintentos/.test(f.detalle)));
});

test("monedas distintas: ambiguo, montos no comparados", () => {
  const { resumen } = reconcilePayments(
    [
      {
        canal: "tiendanube",
        ordenId: "1",
        referencia: "R1",
        total: 100,
        moneda: "ARS",
      },
    ],
    [
      {
        pagoId: "P1",
        referencia: "R1",
        bruto: 100,
        estado: "approved",
        moneda: "USD",
      },
    ]
  );
  assert.equal(resumen.conciliados, 0);
  assert.equal(resumen.diferencias, 0);
  assert.equal(resumen.ambiguos, 1);
});

test("montos no finitos o no numéricos: sin_datos_monto, nunca cero ni conciliado", () => {
  const casos: [unknown, unknown][] = [
    [Number.NaN, 100],
    [100, Number.POSITIVE_INFINITY],
    ["abc", 100],
    [null, 100],
  ];
  for (const [total, bruto] of casos) {
    const { filas, resumen } = reconcilePayments(
      [{ canal: "tiendanube", ordenId: "1", referencia: "R1", total }],
      [{ pagoId: "P1", referencia: "R1", bruto, estado: "approved" }]
    );
    assert.equal(
      resumen.conciliados,
      0,
      `total=${String(total)} bruto=${String(bruto)}`
    );
    assert.equal(filas[0]?.estado, "sin_datos_monto");
  }
});

test("la diferencia dentro de la tolerancia no se reporta", () => {
  const { resumen } = reconcilePayments(
    [{ canal: "tiendanube", ordenId: "1", referencia: "R1", total: 100 }],
    [{ pagoId: "P1", referencia: "R1", bruto: 100.4, estado: "approved" }],
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
    [{ pagoId: "P", referencia: "", bruto: 10, estado: "approved" }]
  );
  assert.equal(resumen.ventas, 0);
  assert.equal(resumen.pagos, 0);
});

test("orden determinista: ambigüedad y problemas primero, conciliados al final", () => {
  const { filas } = reconcilePayments(ventasFixture, pagosFixture);
  assert.deepEqual(
    filas.map((f) => f.estado),
    [
      "diferencia_monto",
      "venta_sin_cobro",
      "pago_no_acreditado",
      "cobro_sin_venta",
      "conciliado",
    ]
  );
});

test("vista para el cliente: etiquetas en español, montos legibles y detalle visible", () => {
  const { filas } = reconcilePayments(ventasFixture, pagosFixture);
  const vista = buildVista(filas);
  const byRef = new Map(vista.map((v) => [`${v.referencia}|${v.estado}`, v]));
  assert.equal(byRef.get("TN-1001|Conciliado")?.cobrado, "100000");
  assert.equal(byRef.get("TN-1002|Venta sin cobro")?.cobrado, "sin dato");
  assert.equal(byRef.get("EXT-9|Cobro sin venta")?.pago, "MP-C");
  assert.equal(
    byRef.get("ML-2001|Diferencia de monto")?.estado,
    "Diferencia de monto"
  );
  assert.equal(
    byRef.get("TN-1002|Pago no acreditado")?.detalle,
    "Estado del cobro: pending."
  );
});

test("el alcance no soportado se declara explícitamente", () => {
  assert.ok(FUERA_DE_ALCANCE.length >= 3);
  assert.ok(FUERA_DE_ALCANCE.some((t) => /[Rr]eembolso/.test(t)));
  assert.ok(FUERA_DE_ALCANCE.some((t) => /parciales|cuotas/.test(t)));
  assert.ok(FUERA_DE_ALCANCE.some((t) => /moneda/i.test(t)));
});
