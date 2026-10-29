import { test } from "node:test";
import assert from "node:assert/strict";
import { isManualConsoleWorkflow } from "../../lib/console/workflow-summary";
test("manual trigger matches builder defaults, not scheduled or missing triggers", () => {
  for (const triggerType of [undefined, "", "Manual"])
    assert.equal(
      isManualConsoleWorkflow([
        { data: { type: "trigger", config: { triggerType } } },
      ]),
      true,
    );
  for (const nodes of [
    null,
    [],
    [{ data: { type: "trigger", config: { triggerType: "Schedule" } } }],
    [{ data: { type: "http" } }],
  ])
    assert.equal(isManualConsoleWorkflow(nodes), false);
});
