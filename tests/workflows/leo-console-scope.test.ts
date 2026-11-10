import assert from "node:assert/strict";
import test from "node:test";
import {
  isLeoConsoleFixture,
  LEO_CONSOLE_ORIGIN,
  LEO_DEMO_IDS,
  LEO_DEMO_ORG,
  LEO_DEMO_USER,
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
test("demo console denies production, other origins, users, orgs, ids and edited graphs", () => {
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
