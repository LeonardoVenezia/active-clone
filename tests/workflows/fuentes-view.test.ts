import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  allSourcesInactive,
  clientErrorDetail,
  type FuenteOutcome,
  fuentesView,
} from "../../lib/soluciones/fuentes-view";

const noOutcome = () => null;

describe("fuentesView", () => {
  test("sin config o sin fuentes: lista vacía", () => {
    assert.deepStrictEqual(fuentesView(null, noOutcome), []);
    assert.deepStrictEqual(fuentesView({ sources: {} }, noOutcome), []);
  });

  test("fuente inactiva se explica siempre, aunque nunca se haya consultado", () => {
    const [f] = fuentesView(
      { sources: { tiendanube: "inactive" } },
      noOutcome,
      { tiendanube: "Tiendanube" }
    );
    assert.strictEqual(f.state, "desactivada");
    assert.strictEqual(f.label, "Tiendanube");
    assert.ok(f.detail.includes("no se consulta"));
  });

  test("activa sin consulta en el último run: sin_datos (no falso éxito)", () => {
    const [f] = fuentesView({ sources: { stripe: "active" } }, noOutcome);
    assert.strictEqual(f.state, "sin_datos");
  });

  test("activa con error de credencial: copy de cliente, sin nombres internos", () => {
    const outcome = (): FuenteOutcome => ({
      status: "error",
      error: "STRIPE_SECRET_KEY is not configured. Please add it.",
      at: "2026-11-08T17:00:00.000Z",
    });
    const [f] = fuentesView(
      { sources: { stripe: "active" } },
      outcome,
      { stripe: "Stripe" }
    );
    assert.strictEqual(f.state, "error");
    assert.strictEqual(f.detail, "Falta conectar Stripe.");
    assert.ok(!f.detail.includes("STRIPE_SECRET_KEY"));
    assert.strictEqual(f.lastRunAt, "2026-11-08T17:00:00.000Z");
  });

  test("activa con error genérico: detalle genérico, nunca el mensaje crudo", () => {
    const outcome = (): FuenteOutcome => ({
      status: "error",
      error: "connect ETIMEDOUT 10.0.0.1:443",
    });
    const [f] = fuentesView({ sources: { stripe: "active" } }, outcome);
    assert.strictEqual(f.state, "error");
    assert.strictEqual(f.detail, "La última consulta falló.");
  });

  test("activa con éxito: al_dia con fecha de la consulta", () => {
    const outcome = (): FuenteOutcome => ({
      status: "success",
      at: "2026-11-08T16:30:00.000Z",
    });
    const [f] = fuentesView({ sources: { stripe: "active" } }, outcome);
    assert.strictEqual(f.state, "al_dia");
    assert.strictEqual(f.lastRunAt, "2026-11-08T16:30:00.000Z");
  });

  test("clientErrorDetail: not configured / not connected / otros", () => {
    assert.strictEqual(
      clientErrorDetail("Stripe", "STRIPE_SECRET_KEY is not configured."),
      "Falta conectar Stripe."
    );
    assert.strictEqual(
      clientErrorDetail("Mercado Libre", "Mercado Libre is not connected."),
      "Falta conectar Mercado Libre."
    );
    assert.strictEqual(
      clientErrorDetail("Stripe", "timeout"),
      "La última consulta falló."
    );
    assert.strictEqual(
      clientErrorDetail("Stripe", undefined),
      "La última consulta falló."
    );
  });

  test("mezcla: conserva el orden de la config y distingue los 4 estados", () => {
    const outcomes: Record<string, FuenteOutcome> = {
      stripe: { status: "error", error: "no key" },
      mercadolibre: { status: "success" },
    };
    const fuentes = fuentesView(
      {
        sources: {
          tiendanube: "inactive",
          stripe: "active",
          mercadolibre: "active",
          vtex: "active",
        },
      },
      (i) => outcomes[i] ?? null
    );
    assert.deepStrictEqual(
      fuentes.map((f) => f.state),
      ["desactivada", "error", "al_dia", "sin_datos"]
    );
  });

});

describe("allSourcesInactive", () => {
  test("true sólo con todas desactivadas y al menos una fuente", () => {
    assert.strictEqual(allSourcesInactive([]), false);
    assert.strictEqual(
      allSourcesInactive(
        fuentesView({ sources: { a: "inactive", b: "inactive" } }, noOutcome)
      ),
      true
    );
    assert.strictEqual(
      allSourcesInactive(
        fuentesView({ sources: { a: "inactive", b: "active" } }, noOutcome)
      ),
      false
    );
  });
});
