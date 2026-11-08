import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  allSourcesInactive,
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

  test("activa con error: estado error con el detalle acotado", () => {
    const outcome = (): FuenteOutcome => ({
      status: "error",
      error: `STRIPE_SECRET_KEY is not configured. ${"x".repeat(300)}`,
    });
    const [f] = fuentesView({ sources: { stripe: "active" } }, outcome);
    assert.strictEqual(f.state, "error");
    assert.ok(f.detail.length <= 140);
    assert.ok(f.detail.includes("STRIPE_SECRET_KEY"));
  });

  test("activa con éxito: al_dia", () => {
    const outcome = (): FuenteOutcome => ({ status: "success" });
    const [f] = fuentesView({ sources: { stripe: "active" } }, outcome);
    assert.strictEqual(f.state, "al_dia");
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

  test("error sin mensaje usa detalle genérico", () => {
    const [f] = fuentesView({ sources: { stripe: "active" } }, () => ({
      status: "error",
    }));
    assert.strictEqual(f.state, "error");
    assert.strictEqual(f.detail, "La última consulta falló.");
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
