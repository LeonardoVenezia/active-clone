// Fixture-driven post-purchase notices: permitted events only, send-once keys,
// no marketing. Validates lib/notices/postpurchase-shared.ts. No real sending.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVistaAvisos,
  EVENTOS_PERMITIDOS,
  prepararAvisos,
  type PedidoEvento,
} from "../../lib/notices/postpurchase-shared";

const eventosFixture: PedidoEvento[] = [
  { pedidoId: "TN-1001", referencia: "TN-1001", evento: "pago_confirmado", canal: "tiendanube", cliente: "Ana" },
  { pedidoId: "TN-1001", referencia: "TN-1001", evento: "despachado", canal: "tiendanube", cliente: "Ana" },
  { pedidoId: "ML-2001", referencia: "ML-2001", evento: "entregado", canal: "mercadolibre" },
  { pedidoId: "ML-2002", referencia: "ML-2002", evento: "cumpleanos", canal: "mercadolibre" },
  { pedidoId: "TN-1003", evento: "pago_confirmado" },
];

test("solo eventos transaccionales permitidos; el resto se omite reportado", () => {
  const { avisos, omitidos } = prepararAvisos(eventosFixture);
  assert.equal(avisos.length, 4);
  assert.equal(omitidos.length, 1);
  assert.equal(omitidos[0].evento, "cumpleanos");
  assert.match(omitidos[0].motivo, /no permitido/i);
  // Nunca se mapea un evento desconocido a una plantilla existente
  assert.equal(avisos.some((a) => a.pedidoId === "ML-2002"), false);
});

test("estado siempre pendiente_aprobacion y textos transaccionales", () => {
  const { avisos } = prepararAvisos(eventosFixture);
  for (const a of avisos) {
    assert.equal(a.estado, "pendiente_aprobacion");
  }
  const pago = avisos.find((a) => a.evento === "pago_confirmado" && a.pedidoId === "TN-1001");
  assert.match(pago?.texto ?? "", /TN-1001/);
});

test("eventosHabilitados restringe; vacío habilita los tres", () => {
  const { avisos } = prepararAvisos(eventosFixture, ["pago_confirmado"]);
  assert.equal(avisos.length, 2);
  assert.ok(avisos.every((a) => a.evento === "pago_confirmado"));
  const todos = prepararAvisos(eventosFixture, []);
  assert.equal(todos.avisos.length, 4);
  assert.deepEqual(EVENTOS_PERMITIDOS, ["pago_confirmado", "despachado", "entregado"]);
});

test("marcaKey send-once estable y válida para Datos", () => {
  const { avisos } = prepararAvisos(eventosFixture);
  const keys = avisos.map((a) => a.marcaKey);
  assert.equal(new Set(keys).size, keys.length); // una por pedido+evento
  for (const k of keys) assert.match(k, /^[A-Za-z0-9._:@-]+$/);
  // Misma entrada → mismas claves (dedupe determinista)
  const otra = prepararAvisos(eventosFixture);
  assert.deepEqual(otra.avisos.map((a) => a.marcaKey), keys);
});

test("vista distingue Nuevo de Ya preparado", () => {
  const { avisos } = prepararAvisos(eventosFixture);
  const conocidas = new Set([avisos[0].marcaKey]);
  const vista = buildVistaAvisos(avisos, conocidas);
  assert.deepEqual(
    vista.map((v) => v.preparacion),
    ["Ya preparado", "Nuevo", "Nuevo", "Nuevo"],
  );
});
