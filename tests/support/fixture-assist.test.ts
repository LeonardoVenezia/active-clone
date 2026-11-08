// Fixture-driven assisted support: drafts only with real context, human
// routing for anything uncovered. Validates lib/support/assisted-shared.ts.
// No real sending.

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVistaRespuestas,
  type Consulta,
  clasificarTema,
  prepararRespuestas,
} from "../../lib/support/assisted-shared";

const contexto = {
  "TN-1001": { estado: "pagado", detalle: "pago acreditado" },
  "TN-1002": { estado: "despachado" },
};

const consultasFixture: Consulta[] = [
  {
    consultaId: "C-1",
    cliente: "Ana",
    texto: "Hola, ¿cómo viene mi pedido?",
    pedidoId: "TN-1001",
  },
  {
    consultaId: "C-2",
    cliente: "Bruno",
    texto: "¿Dónde está el envío? ¿Tienen tracking?",
    pedidoId: "TN-1002",
  },
  {
    consultaId: "C-3",
    cliente: "Carla",
    texto: "El paquete no llega, viene con demora",
    pedidoId: "TN-1002",
  },
  {
    consultaId: "C-4",
    cliente: "Damián",
    texto: "Quiero devolver el producto",
    pedidoId: "TN-1001",
  },
  {
    consultaId: "C-5",
    cliente: "Elsa",
    texto: "¿Hacen envíos a Tierra del Fuego?",
    pedidoId: "",
  },
  {
    consultaId: "C-6",
    cliente: "Fede",
    texto: "¿Cómo viene mi pedido?",
    pedidoId: "TN-9999",
  },
];

test("clasificación conservadora por palabras clave", () => {
  assert.equal(clasificarTema("quiero devolver esto"), "devolucion");
  assert.equal(clasificarTema("no llega, cuándo llega?"), "demora_envio");
  assert.equal(clasificarTema("dónde está mi paquete"), "estado_envio");
  assert.equal(clasificarTema("mi pedido está pago?"), "estado_pedido");
  assert.equal(clasificarTema("tienen local en CABA?"), "otro");
});

test("borrador solo con contexto real; el resto deriva a humano", () => {
  const respuestas = prepararRespuestas(consultasFixture, contexto);
  assert.equal(respuestas.length, 6);
  const porId = new Map(respuestas.map((r) => [r.consultaId, r]));
  // Con contexto: borrador pendiente de aprobación con el estado REAL
  const c1 = porId.get("C-1");
  assert.equal(c1?.estado, "pendiente_aprobacion");
  assert.match(c1?.borrador ?? "", /pagado/);
  assert.match(c1?.borrador ?? "", /pago acreditado/);
  const c2 = porId.get("C-2");
  assert.match(c2?.borrador ?? "", /despachado/);
  const c3 = porId.get("C-3");
  assert.equal(c3?.tema, "demora_envio");
  assert.match(c3?.borrador ?? "", /despachado/);
  // Devolución: siempre humano (política de tienda)
  assert.equal(porId.get("C-4")?.estado, "derivar_humano");
  assert.match(porId.get("C-4")?.motivoDerivacion ?? "", /[Dd]evoluci/);
  // Tema no cubierto: humano
  assert.equal(porId.get("C-5")?.estado, "derivar_humano");
  // Pedido sin contexto: humano, NUNCA inventar estado
  const c6 = porId.get("C-6");
  assert.equal(c6?.estado, "derivar_humano");
  assert.match(c6?.motivoDerivacion ?? "", /sin contexto|Sin contexto/);
  assert.equal(c6?.borrador, "");
});

test("marcaKey una por consulta, estable y válida", () => {
  const respuestas = prepararRespuestas(consultasFixture, contexto);
  const keys = respuestas.map((r) => r.marcaKey);
  assert.equal(new Set(keys).size, keys.length);
  for (const k of keys) {
    assert.match(k, /^[A-Za-z0-9._:@-]+$/);
  }
});

test("vista distingue Nuevo / Ya preparado y muestra derivación", () => {
  const respuestas = prepararRespuestas(consultasFixture, contexto);
  const conocidas = new Set([respuestas[0].marcaKey]);
  const vista = buildVistaRespuestas(respuestas, conocidas);
  assert.equal(vista[0].preparacion, "Ya preparado");
  assert.equal(vista[1].preparacion, "Nuevo");
  const derivada = vista.find((v) => v.consulta === "C-4");
  assert.match(derivada?.estado ?? "", /Deriva a humano/);
  assert.equal(derivada?.borrador, "(sin borrador)");
});

test("derivación registrada no se etiqueta como borrador preparado", () => {
  const respuestas = prepararRespuestas(consultasFixture, contexto);
  const derivada = respuestas.find((r) => r.estado === "derivar_humano");
  assert.ok(derivada);
  const vista = buildVistaRespuestas(respuestas, new Set([derivada.marcaKey]));
  const fila = vista.find((v) => v.consulta === derivada.consultaId);
  assert.equal(fila?.preparacion, "Derivación registrada");
  assert.equal(fila?.borrador, "(sin borrador)");
});

test("borradores sin compromisos futuros: solo hechos del contexto", () => {
  const respuestas = prepararRespuestas(consultasFixture, contexto);
  for (const r of respuestas) {
    assert.doesNotMatch(r.borrador, /revisamos con el correo/i);
    assert.doesNotMatch(r.borrador, /te avisamos/i);
    assert.doesNotMatch(r.borrador, /vamos a|haremos|gestionaremos/i);
  }
});
