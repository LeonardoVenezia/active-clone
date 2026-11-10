import assert from "node:assert/strict";
import test from "node:test";
import {
  isLeoConsoleFixture,
  LEO_CONSOLE_ORIGIN,
  LEO_DEMO_IDS,
  LEO_DEMO_ORG,
  LEO_DEMO_USER,
  LEO_PRODUCTION_CONSOLE_ORIGIN,
  leoProductionAssignments,
  leoProductionGrant,
} from "../../lib/demo/console-scope";
import { leoDemoPack } from "../../lib/demo/leo-pack";

const fixtures = leoDemoPack().cases;
const base = {
  environment: "preview",
  consoleOrigin: LEO_CONSOLE_ORIGIN,
  userId: LEO_DEMO_USER,
  organizationId: LEO_DEMO_ORG,
  workflowId: LEO_DEMO_IDS[0],
  nodes: fixtures[0].nodes,
  edges: fixtures[0].edges,
};
test("demo console only permits the five exact unchanged fixtures", () => {
  for (const [index, workflowId] of LEO_DEMO_IDS.entries()) {
    assert.equal(
      isLeoConsoleFixture({
        ...base,
        workflowId,
        nodes: fixtures[index].nodes,
        edges: fixtures[index].edges,
      }),
      true
    );
  }
});
test("demo console denies mismatched environments, origins, users, orgs, ids and edited graphs", () => {
  for (const patch of [
    { environment: "production" },
    { environment: undefined },
    { consoleOrigin: "https://active-clone-console.vercel.app" },
    { userId: "other" },
    { organizationId: "other" },
    { workflowId: "other" },
    { nodes: [] },
    { edges: [] },
    {
      nodes: [
        ...fixtures[0].nodes,
        { id: "injected", data: { type: "action" } },
      ],
    },
  ]) {
    assert.equal(isLeoConsoleFixture({ ...base, ...patch }), false);
  }
});

test("production allows exactly the same five unmodified fictitious graphs, not other principals", () => {
  for (const [index, workflowId] of LEO_DEMO_IDS.entries()) {
    const production = {
      ...base,
      environment: "production",
      consoleOrigin: LEO_PRODUCTION_CONSOLE_ORIGIN,
      workflowId,
      nodes: fixtures[index].nodes,
      edges: fixtures[index].edges,
    };
    assert.equal(isLeoConsoleFixture(production), true);
    for (const patch of [
      { userId: "other" },
      { organizationId: "other" },
      { workflowId: "other" },
      { nodes: [] },
      { edges: [] },
      { consoleOrigin: LEO_CONSOLE_ORIGIN },
      { environment: "preview" },
    ]) {
      assert.equal(isLeoConsoleFixture({ ...production, ...patch }), false);
    }
  }
});

test("production grant is an operator limited to the exact five IDs; no cross-scope addition", () => {
  const grant = leoProductionGrant(
    "production",
    LEO_PRODUCTION_CONSOLE_ORIGIN,
    LEO_DEMO_USER,
    LEO_DEMO_ORG
  );
  assert.equal(grant?.role, "operator");
  assert.deepEqual(grant?.workflowIds, [...LEO_DEMO_IDS]);
  assert.deepEqual(grant?.runWorkflowIds, [...LEO_DEMO_IDS]);
  assert.equal(
    leoProductionAssignments("production", LEO_PRODUCTION_CONSOLE_ORIGIN)
      .length,
    5
  );
  assert.equal(
    leoProductionAssignments("preview", LEO_PRODUCTION_CONSOLE_ORIGIN).length,
    0
  );
  for (const args of [
    ["preview", LEO_PRODUCTION_CONSOLE_ORIGIN, LEO_DEMO_USER, LEO_DEMO_ORG],
    ["production", LEO_CONSOLE_ORIGIN, LEO_DEMO_USER, LEO_DEMO_ORG],
    ["production", LEO_PRODUCTION_CONSOLE_ORIGIN, "other", LEO_DEMO_ORG],
    ["production", LEO_PRODUCTION_CONSOLE_ORIGIN, LEO_DEMO_USER, "other"],
  ]) {
    assert.equal(
      leoProductionGrant(...(args as [string, string, string, string])),
      null
    );
  }
});
