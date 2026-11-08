// Suite "soluciones" (gate CI del pack, como las demás de tests/workflows).
// Contratos de bloques y acciones por caso del nodo Frontend:
// parse defensivo de config nueva, defaults que no cambian paneles existentes
// y autorización server-side de la acción de fila.

import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeFrontendAction,
  DEFAULT_PANEL_BLOCKS,
  frontendViewFromNodes,
  MAX_ACTIONS,
} from "../../lib/datos/frontend";

const node = (config: Record<string, unknown>) => [
  { data: { config: { actionType: "Frontend", ...config } } },
];
const base = { collection: "casos", title: "Panel" };

test("sin config nueva: bloques por defecto, sin acciones, actionField 'estado'", () => {
  const v = frontendViewFromNodes(node(base));
  assert.ok(v);
  assert.deepEqual(v.blocks, DEFAULT_PANEL_BLOCKS);
  assert.deepEqual(v.actions, []);
  assert.equal(v.actionField, "estado");
});

test("blocks: orden declarado se respeta y completa omisiones", () => {
  const v = frontendViewFromNodes(node({ ...base, blocks: "tabla, fuentes" }));
  assert.ok(v);
  assert.deepEqual(v.blocks, ["tabla", "fuentes"]);
});

test("blocks: claves desconocidas y duplicadas se descartan; vacío cae al default", () => {
  const v = frontendViewFromNodes(
    node({ ...base, blocks: "tabla, mapa, tabla, formulario" })
  );
  assert.ok(v);
  assert.deepEqual(v.blocks, ["tabla", "formulario"]);
  const v2 = frontendViewFromNodes(node({ ...base, blocks: "mapa, , " }));
  assert.ok(v2);
  assert.deepEqual(v2.blocks, DEFAULT_PANEL_BLOCKS);
});

test("actions: parse id=label, dedupe por id y límite MAX_ACTIONS", () => {
  const v = frontendViewFromNodes(
    node({
      ...base,
      actions:
        "aprobar=Aprobar, derivar=Derivar a soporte, aprobar=Otra, x1=Uno, x2=Dos, x3=Tres",
    })
  );
  assert.ok(v);
  assert.equal(v.actions.length, MAX_ACTIONS);
  assert.deepEqual(v.actions[0], { id: "aprobar", label: "Aprobar" });
  assert.deepEqual(v.actions[1], { id: "derivar", label: "Derivar a soporte" });
  // El duplicado no pisa el label original.
  assert.equal(v.actions.filter((a) => a.id === "aprobar").length, 1);
});

test("actions: ids inválidos y pares sin label se ignoran", () => {
  const v = frontendViewFromNodes(
    node({ ...base, actions: "1mal=Nope, sinlabel=, =sinid, bien= Sí " })
  );
  assert.ok(v);
  assert.deepEqual(v.actions, [{ id: "bien", label: "Sí" }]);
});

test("actionField: válido se respeta; inválido cae a 'estado'", () => {
  const v = frontendViewFromNodes(
    node({ ...base, actions: "aprobar=Aprobar", actionField: "resolucion" })
  );
  assert.ok(v);
  assert.equal(v.actionField, "resolucion");
  const v2 = frontendViewFromNodes(
    node({ ...base, actions: "aprobar=Aprobar", actionField: "9mal!" })
  );
  assert.ok(v2);
  assert.equal(v2.actionField, "estado");
});

test("autorización de acción: sesión, origen, empresa y acciones declaradas", () => {
  const nodes = node({ ...base, actions: "aprobar=Aprobar" });
  const facts = {
    signedIn: true,
    anonymous: false,
    workflowExists: true,
    isOwner: true,
    hasShare: false,
    scopeOrganizationId: "org1",
    isMemberOfScopeOrg: true,
  };
  const okReq = {
    facts,
    nodes,
    requestOrigin: "https://app.example",
    urlOrigin: "https://app.example",
  };
  const ok = authorizeFrontendAction(okReq);
  assert.equal(ok.ok, true);
  const statusOf = (r: ReturnType<typeof authorizeFrontendAction>) =>
    r.ok ? 200 : r.status;
  assert.equal(
    statusOf(
      authorizeFrontendAction({
        ...okReq,
        facts: { ...facts, signedIn: false },
      })
    ),
    401
  );
  assert.equal(
    statusOf(
      authorizeFrontendAction({
        ...okReq,
        requestOrigin: "https://evil.example",
      })
    ),
    403
  );
  assert.equal(
    statusOf(
      authorizeFrontendAction({
        ...okReq,
        facts: {
          ...facts,
          scopeOrganizationId: "otra",
          isMemberOfScopeOrg: false,
        },
      })
    ),
    403
  );
  // Sin acciones declaradas la página no tiene acción que correr.
  assert.equal(
    statusOf(authorizeFrontendAction({ ...okReq, nodes: node(base) })),
    404
  );
});
