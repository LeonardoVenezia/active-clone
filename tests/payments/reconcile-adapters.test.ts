// Contract adaptation tests: inputs mirror the plugin step outputs verbatim
// (field names from plugins/tiendanube|mercadolibre|mercadopago steps).
import test from "node:test";
import assert from "node:assert/strict";
import {
  adaptCobrosMP,
  adaptVentasML,
  adaptVentasTN,
  isOrdersEnvelope,
  isPaymentsEnvelope,
} from "../../lib/payments/reconcile-adapters";
import { reconcilePayments } from "../../lib/payments/reconcile-shared";

// Salida real de tiendanube/search-orders (total es string)
const tnOrders = {
  count: 2,
  orders: [
    { id: 555, number: 1001, status: "open", paymentStatus: "paid", shippingStatus: "shipped", total: "100000.00", currency: "ARS", customerEmail: "a@b.com", customerName: "Ana", createdAt: "2026-11-08" },
    { id: 556, number: 1002, status: "open", paymentStatus: "pending", shippingStatus: "unshipped", total: "50000.00", currency: "ARS", customerEmail: "", customerName: "", createdAt: "" },
  ],
};

// Salida real de mercadolibre/search-orders (id string, total number)
const mlOrders = {
  count: 1,
  orders: [
    { id: "2000000001", status: "paid", total: 80000, currency: "ARS", buyerNickname: "COMPRADOR", dateCreated: "2026-11-08" },
  ],
};

// Salida real de mercadopago/search-payments (sin comisión en el conector)
const mpPayments = {
  total: 2,
  count: 2,
  payments: [
    { id: 901, status: "approved", amount: 100000, currency: "ARS", externalReference: "1001", payerEmail: "", dateCreated: "" },
    { id: 902, status: "approved", amount: 79500, currency: "ARS", externalReference: "2000000001", payerEmail: "", dateCreated: "" },
  ],
};

test("adapta órdenes TN: referencia = número de orden, total string → número", () => {
  const { items, advertencias } = adaptVentasTN(tnOrders);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { ordenId: "1001", referencia: "1001", canal: "tiendanube", total: 100000, moneda: "ARS" });
  assert.ok(advertencias[0].includes("número de orden"));
});

test("adapta órdenes ML: referencia = id de orden", () => {
  const { items } = adaptVentasML(mlOrders);
  assert.deepEqual(items[0], { ordenId: "2000000001", referencia: "2000000001", canal: "mercadolibre", total: 80000, moneda: "ARS" });
});

test("adapta cobros MP: sin comisión expuesta, estado declarado", () => {
  const { items, advertencias } = adaptCobrosMP(mpPayments);
  assert.equal(items.length, 2);
  assert.equal(items[0].pagoId, "901");
  assert.equal(items[0].referencia, "1001");
  assert.equal(items[0].bruto, 100000);
  assert.equal(items[0].estado, "approved");
  assert.equal(items[0].comision, undefined); // nunca inventado
  assert.ok(advertencias[0].includes("no expone comisión"));
});

test("envelopes detectados; listas normales no", () => {
  assert.ok(isOrdersEnvelope(tnOrders));
  assert.ok(isPaymentsEnvelope(mpPayments));
  assert.equal(isOrdersEnvelope([{ a: 1 }]), false);
  assert.equal(isPaymentsEnvelope("[]"), false);
  assert.equal(isOrdersEnvelope(null), false);
});

test("recorrido extremo a extremo con salidas reales de conector", () => {
  const ventasTN = adaptVentasTN(tnOrders).items;
  const ventasML = adaptVentasML(mlOrders).items;
  const cobros = adaptCobrosMP(mpPayments).items;
  const report = reconcilePayments([...ventasTN, ...ventasML], cobros, 1);
  const porRef = new Map(report.filas.map((f) => [f.referencia, f.estado]));
  assert.equal(porRef.get("1001"), "conciliado");
  assert.equal(porRef.get("2000000001"), "diferencia_monto");
  assert.equal(porRef.get("1002"), "venta_sin_cobro");
});

test("pago no acreditado no concilia aunque el monto coincida", () => {
  const cobros = adaptCobrosMP({ payments: [{ id: 903, status: "pending", amount: 50000, currency: "ARS", externalReference: "1002" }] }).items;
  const ventas = adaptVentasTN(tnOrders).items;
  const report = reconcilePayments(ventas, cobros, 1);
  const porRef = new Map(report.filas.map((f) => [f.referencia, f.estado]));
  assert.equal(porRef.get("1002"), "pago_no_acreditado");
});

test("TN total no numérico queda sin dato, nunca cero", () => {
  const { items } = adaptVentasTN({ orders: [{ id: 1, number: 7, total: "abc", currency: "ARS" }] });
  assert.equal(items[0].total, null);
});
