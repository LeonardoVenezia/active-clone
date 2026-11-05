import assert from "node:assert/strict";
import { test } from "node:test";
import { withActionDefaults } from "../../lib/action-config-defaults";

const cases: [Record<string, unknown>, string, unknown][] = [
  [{}, "Datos", "save"],
  [{ operation: "read" }, "Datos", "read"],
  [{ operation: "saveIfAbsent" }, "Datos", "saveIfAbsent"],
  [{ operation: "invalid" }, "Datos", "invalid"],
  [{}, "Condition", undefined],
];
test("defaults preserve explicit operations without mutation", () => {
  for (const [config, type, expected] of cases) {
    const original = JSON.stringify(config);
    assert.equal(withActionDefaults(config, type).operation, expected);
    assert.equal(JSON.stringify(config), original);
  }
  const extra = {
    operation: "applyTogether",
    operations: "[]",
    integrationId: "fixture",
  };
  assert.deepEqual(withActionDefaults(extra, "Datos"), {
    ...extra,
    actionType: "Datos",
  });
  console.log("PASS 6 default/preservation/immutability cases");
});
