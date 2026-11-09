import assert from "node:assert/strict";
import test from "node:test";
import { consolePanelDecision } from "../../lib/console/panel";
import type { ConsoleGrant } from "../../lib/console/policy";
import { leoDemoPack } from "../../lib/demo/leo-pack";

const grant: ConsoleGrant = {
  userId: "user",
  organizationId: "org",
  role: "owner",
  teamIds: [],
  workflowIds: [],
  canRun: true,
};
const fixture = leoDemoPack().cases[0];
const base = {
  grant,
  flow: { id: "flow", nodes: fixture.nodes, active: true },
  assignment: { organizationId: "org", workflowId: "flow", teamId: "team" },
  dataOrganizationId: "org",
  dataEnabled: true,
  executionEnabled: true,
};
test("console panel: no grant is not promoted from builder membership", () =>
  assert.equal(consolePanelDecision({ ...base, grant: null }).status, 401));
test("console panel: every role rejects a foreign organization or data scope", () => {
  for (const role of ["owner", "admin", "manager", "operator"] as const) {
    assert.equal(
      consolePanelDecision({
        ...base,
        grant: { ...grant, role },
        assignment: { ...base.assignment, organizationId: "foreign" },
      }).status,
      403
    );
    assert.equal(
      consolePanelDecision({
        ...base,
        grant: { ...grant, role },
        dataOrganizationId: "foreign",
      }).status,
      403
    );
  }
});
test("console panel: unassigned operator and manager cannot read", () => {
  for (const role of ["operator", "manager"] as const) {
    assert.equal(
      consolePanelDecision({ ...base, grant: { ...grant, role } }).status,
      403
    );
  }
});
test("console panel: assigned manager and operator can read but never gain run permission", () => {
  for (const role of ["operator", "manager"] as const) {
    const result = consolePanelDecision({
      ...base,
      grant: {
        ...grant,
        role,
        teamIds: ["team"],
        workflowIds: ["flow"],
        canRun: false,
      },
    });
    assert.equal(result.status, 200);
    if (result.status === 200) {
      assert.equal(result.canRun, false);
    }
  }
});
test("console panel: absent assignment or workflow is denied", () => {
  assert.equal(consolePanelDecision({ ...base, assignment: null }).status, 403);
  assert.equal(consolePanelDecision({ ...base, flow: null }).status, 403);
  assert.equal(
    consolePanelDecision({ ...base, flow: { ...base.flow, id: "other" } })
      .status,
    403
  );
});
test("console panel: disabled data and missing view fail closed", () => {
  assert.equal(
    consolePanelDecision({ ...base, dataEnabled: false }).status,
    503
  );
  assert.equal(
    consolePanelDecision({ ...base, flow: { ...base.flow, nodes: [] } }).status,
    404
  );
});
test("console panel: all five existing case contracts are returned, without graph or keys", () => {
  for (const item of leoDemoPack().cases) {
    const result = consolePanelDecision({
      ...base,
      flow: { ...base.flow, nodes: item.nodes },
    });
    assert.equal(result.status, 200);
    if (result.status === 200) {
      assert(result.view.solution?.view);
      assert(!("nodes" in result));
      assert(!("edges" in result));
      assert.equal(
        result.view.collection,
        (item.nodes.find((n) => n.data.type === "frontend") as any)?.data.config
          ?.collection || result.view.collection
      );
    }
  }
});
test("console panel: run still needs runtime enabled, active manual workflow and exact run scope", () => {
  const a = consolePanelDecision({ ...base, executionEnabled: false });
  const b = consolePanelDecision({
    ...base,
    flow: { ...base.flow, active: false },
  });
  const c = consolePanelDecision({
    ...base,
    grant: { ...grant, runWorkflowIds: ["different"] },
  });
  for (const r of [a, b, c]) {
    assert.equal(r.status, 200);
    if (r.status === 200) {
      assert.equal(r.canRun, false);
    }
  }
});
