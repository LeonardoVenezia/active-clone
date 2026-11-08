// Contract adaptation tests for shipment connector outputs (field names from
// plugins/mercadolibre|zipnova|enviopack get-shipment steps).
import test from "node:test";
import assert from "node:assert/strict";
import { adaptEnvios } from "../../lib/shipments/review-adapters";
import { revisarEnvios } from "../../lib/shipments/review-shared";

// Salida real de mercadolibre/get-shipment
const mlShipment = {
  success: true,
  shipment: {},
  id: "4466778899",
  status: "shipped",
  substatus: "delayed",
  trackingNumber: "ME2-111",
  trackingMethod: "MEP2",
  serviceId: "",
  estimatedDelivery: "",
  receiverCity: "Rosario",
};

// Salida real de zipnova/get-shipment
const zipnovaShipment = { success: true, status: "in_transit", statusDetail: "delayed_at_branch", tracking: "ZN-333", raw: {} };

// Salida real de enviopack/get-shipment: cruda sin taxonomía verificada
const enviopackRaw = { success: true, shipment: { cualquier: "forma" } };

test("ML get-shipment se adapta a EnvioShape", () => {
  const { envios, omitidos } = adaptEnvios([mlShipment]);
  assert.equal(omitidos, 0);
  assert.deepEqual(envios[0], { envioId: "4466778899", canal: "mercadolibre", estado: "shipped", subestado: "delayed", referencia: "ME2-111" });
});

test("zipnova get-shipment se adapta con statusDetail como subestado", () => {
  const { envios } = adaptEnvios([zipnovaShipment]);
  assert.equal(envios[0].canal, "zipnova");
  assert.equal(envios[0].envioId, "ZN-333");
  assert.equal(envios[0].estado, "in_transit");
  assert.equal(envios[0].subestado, "delayed_at_branch");
});

test("enviopack crudo se omite con advertencia, nunca se adivina", () => {
  const { envios, omitidos, advertencias } = adaptEnvios([enviopackRaw]);
  assert.equal(envios.length, 0);
  assert.equal(omitidos, 1);
  assert.ok(advertencias.some((a) => a.includes("Enviopack")));
  assert.ok(advertencias.some((a) => a.includes("días en el estado actual")));
});

test("salidas ML adaptadas alimentan la revisión por estado", () => {
  const { envios } = adaptEnvios([mlShipment, zipnovaShipment]);
  const alertas = revisarEnvios(envios, { estadosAlerta: ["shipped/delayed"] });
  assert.equal(alertas.length, 1);
  assert.equal(alertas[0].envioId, "4466778899");
  assert.equal(alertas[0].marcaKey, "4466778899:estado_alerta:shipped-delayed");
});

test("entradas ya normalizadas pasan sin cambios", () => {
  const normal = { envioId: "X1", canal: "ml", estado: "delivered" };
  const { envios, omitidos } = adaptEnvios([normal]);
  assert.equal(omitidos, 0);
  assert.deepEqual(envios[0], normal);
});
