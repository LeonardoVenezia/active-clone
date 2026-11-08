// Fixture-driven shipment review: alert states and no-movement threshold.
// Validates lib/shipments/review-shared.ts. No real courier APIs.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVista,
  parseEstadosAlerta,
  revisarEnvios,
  type EnvioShape,
} from "../../lib/shipments/review-shared";

// Shapes reducidas al contrato: ML get-shipment (status/substatus) y un envío
// de courier con días sin movimiento.
const enviosFixture: EnvioShape[] = [
  { envioId: "ME2-111", canal: "mercadolibre", estado: "shipped", subestado: "delayed", referencia: "ML-2001" },
  { envioId: "CA-222", canal: "correoargentino", estado: "en_transito", diasEnEstado: 9, referencia: "TN-1001" },
  { envioId: "ZN-333", canal: "zipnova", estado: "en_transito", diasEnEstado: 2, referencia: "TN-1002" },
  { envioId: "EP-444", canal: "enviopack", estado: "delivered", referencia: "TN-1003" },
];

test("estado alerta (con subestado compuesto) y demora por umbral", () => {
  const alertas = revisarEnvios(enviosFixture, {
    estadosAlerta: ["shipped/delayed", "devolucion"],
    umbralDias: 7,
  });
  assert.equal(alertas.length, 2);
  const porEnvio = new Map(alertas.map((a) => [a.envioId, a]));
  assert.equal(porEnvio.get("ME2-111")?.motivo, "estado_alerta");
  assert.equal(porEnvio.get("ME2-111")?.estado, "shipped/delayed");
  assert.equal(porEnvio.get("CA-222")?.motivo, "sin_movimiento");
  assert.equal(porEnvio.get("CA-222")?.marcaKey, "CA-222:sin_movimiento:en_transito");
  assert.equal(porEnvio.has("ZN-333"), false);
  assert.equal(porEnvio.has("EP-444"), false);
});

test("un envío genera una sola alerta: estado alerta prevalece sobre demora", () => {
  const alertas = revisarEnvios(
    [{ envioId: "X1", canal: "ml", estado: "shipped", subestado: "delayed", diasEnEstado: 30 }],
    { estadosAlerta: ["shipped/delayed"], umbralDias: 7 }
  );
  assert.equal(alertas.length, 1);
  assert.equal(alertas[0].motivo, "estado_alerta");
});

test("match de estado solo (sin subestado) también alerta", () => {
  const alertas = revisarEnvios(enviosFixture, { estadosAlerta: ["delivered"] });
  assert.deepEqual(alertas.map((a) => a.envioId), ["EP-444"]);
});

test("días no numéricos o sin dato no disparan demora", () => {
  const alertas = revisarEnvios(
    [
      { envioId: "A", estado: "en_transito", diasEnEstado: "abc" },
      { envioId: "B", estado: "en_transito" },
      { envioId: "C", estado: "en_transito", diasEnEstado: Number.NaN },
    ],
    { umbralDias: 5 }
  );
  assert.equal(alertas.length, 0);
});

test("sin umbral configurado no hay alertas de demora", () => {
  const alertas = revisarEnvios(
    [{ envioId: "A", estado: "en_transito", diasEnEstado: 99 }],
    { estadosAlerta: [] }
  );
  assert.equal(alertas.length, 0);
});

test("envíos sin id se ignoran", () => {
  const alertas = revisarEnvios(
    [{ estado: "shipped", subestado: "delayed" }, { envioId: " ", estado: "shipped" }],
    { estadosAlerta: ["shipped/delayed", "shipped"] }
  );
  assert.equal(alertas.length, 0);
});

test("parseEstadosAlerta acepta lista o string separado por comas", () => {
  assert.deepEqual(parseEstadosAlerta("a, b ,,c"), ["a", "b", "c"]);
  assert.deepEqual(parseEstadosAlerta(["x", " y "]), ["x", "y"]);
  assert.deepEqual(parseEstadosAlerta(""), []);
  assert.deepEqual(parseEstadosAlerta(null), []);
});

test("vista: Nuevo vs Ya detectado según marcas, motivos en español", () => {
  const alertas = revisarEnvios(enviosFixture, { estadosAlerta: ["shipped/delayed"], umbralDias: 7 });
  const yaAvisadas = new Set(["CA-222:sin_movimiento:en_transito"]);
  const vista = buildVista(alertas, yaAvisadas);
  const porEnvio = new Map(vista.map((v) => [v.envio, v]));
  assert.equal(porEnvio.get("ME2-111")?.aviso, "Nuevo");
  assert.equal(porEnvio.get("ME2-111")?.motivo, "Estado de alerta");
  assert.equal(porEnvio.get("CA-222")?.aviso, "Ya detectado");
  assert.equal(porEnvio.get("CA-222")?.motivo, "Sin movimiento");
});
