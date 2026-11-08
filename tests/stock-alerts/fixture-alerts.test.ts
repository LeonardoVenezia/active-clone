// Fixture-driven stock alerts: threshold, per-product override, sin_dato.
// Validates lib/stock/alerts-shared.ts. No real stock APIs.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVistaStock,
  revisarStock,
  type ProductoShape,
} from "../../lib/stock/alerts-shared";

const productosFixture: ProductoShape[] = [
  { productoId: "P-1", sku: "SKU-ROJO", nombre: "Remera roja", stock: 2 },
  { productoId: "P-2", sku: "SKU-AZUL", nombre: "Remera azul", stock: 20 },
  { productoId: "P-3", sku: "SKU-VERDE", nombre: "Remera verde", stock: 8, umbral: 10 },
  { productoId: "P-4", sku: "SKU-SIN", nombre: "Sin dato", stock: "no se" },
  { sku: "SKU-SINID", stock: 0 },
];

test("umbral default, umbral por producto y stock sin dato", () => {
  const alertas = revisarStock(productosFixture, 5);
  assert.equal(alertas.length, 4);
  const porId = new Map(alertas.map((a) => [a.productoId, a]));
  // P-1: 2 < 5 → bajo stock
  assert.equal(porId.get("P-1")?.motivo, "bajo_stock");
  assert.equal(porId.get("P-1")?.umbral, 5);
  // P-2: 20 ≥ 5 → sin alerta
  assert.equal(porId.has("P-2"), false);
  // P-3: umbral propio 10, stock 8 → bajo stock con ese umbral
  assert.equal(porId.get("P-3")?.motivo, "bajo_stock");
  assert.equal(porId.get("P-3")?.umbral, 10);
  // P-4: stock no numérico → sin_dato, NUNCA evaluado como cero
  assert.equal(porId.get("P-4")?.motivo, "sin_dato");
  assert.equal(porId.get("P-4")?.stock, null);
  // SKU-SINID sin productoId: cae al sku como identidad
  assert.equal(porId.get("SKU-SINID")?.motivo, "bajo_stock");
});

test("stock igual al umbral NO alerta", () => {
  const alertas = revisarStock([{ productoId: "P-X", stock: 5 }], 5);
  assert.equal(alertas.length, 0);
});

test("marcaKey estable y con caracteres válidos para Datos", () => {
  const alertas = revisarStock(
    [{ productoId: "prod éxito/1 (a)", stock: 1 }],
    5,
  );
  assert.equal(alertas.length, 1);
  const key = alertas[0].marcaKey;
  assert.match(key, /^[A-Za-z0-9._:@-]+$/);
  assert.ok(key.length <= 120);
  // Misma entrada → misma clave (dedupe determinista)
  const otra = revisarStock([{ productoId: "prod éxito/1 (a)", stock: 1 }], 5);
  assert.equal(otra[0].marcaKey, key);
});

test("vista marca Ya detectado solo en claves conocidas", () => {
  const alertas = revisarStock(productosFixture, 5);
  const conocidas = new Set([alertas[0].marcaKey]);
  const vista = buildVistaStock(alertas, conocidas);
  const detecciones = vista.map((v) => v.deteccion);
  assert.deepEqual(detecciones, ["Ya detectado", "Nuevo", "Nuevo", "Nuevo"]);
  // sin dato queda explícito en la fila
  const filaSinDato = vista.find((v) => v.producto === "P-4");
  assert.equal(filaSinDato?.stock, "sin dato");
});
