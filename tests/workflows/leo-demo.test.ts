import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canPrepareLeoDemo,
  DEMO_EMAIL,
  leoDemoPack,
} from "../../lib/demo/leo-pack";

test("demo provisioning is preview-only and only the new demo identity", () => {
  assert.equal(canPrepareLeoDemo("production", DEMO_EMAIL), false);
  assert.equal(
    canPrepareLeoDemo("preview", "leovenezia@outlook.com.ar"),
    false
  );
  assert.equal(canPrepareLeoDemo(undefined, DEMO_EMAIL), false);
  assert.equal(canPrepareLeoDemo("preview", DEMO_EMAIL), true);
});

test("fixed demo pack has five cases, internal steps only, inactive sources and no connection references", () => {
  const pack = leoDemoPack();
  assert.equal(pack.cases.length, 5);
  assert.equal(pack.seeds.length, 7);
  const allowed = new Set([
    "Datos",
    "Frontend",
    "Solución",
    "Alertas de Stock",
    "Revisar Envíos",
    "Conciliar Pagos",
    "Preparar Avisos",
    "Preparar Respuestas",
  ]);
  for (const example of pack.cases) {
    assert.equal(example.records.length, 1);
    for (const node of example.nodes) {
      const config = node.data.config as Record<string, unknown>;
      if (node.type === "trigger") {
        assert.ok(!config.triggerType || config.triggerType === "Manual");
      } else {
        assert.ok(allowed.has(String(config.actionType)));
      }
      assert.ok(
        !Object.keys(config).some((k) =>
          /integration|secret|token|password|endpoint/i.test(k)
        )
      );
      if (config.actionType === "Solución") {
        assert.ok(
          String(config.sources)
            .split(",")
            .every((s) => s.trim().endsWith("=inactive"))
        );
      }
    }
  }
});
