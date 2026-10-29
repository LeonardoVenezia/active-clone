import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseGrant,
  canView,
  canExecute,
  type ConsoleGrant,
} from "../../lib/console/policy";
const base: ConsoleGrant = {
  organizationId: "one",
  userId: "u",
  role: "operator",
  teamIds: ["a"],
  workflowIds: ["w"],
  canRun: true,
};
const assigned = { organizationId: "one", workflowId: "w", teamId: "a" };
test("every role rejects a different organization", () => {
  for (const role of ["owner", "admin", "manager", "operator"] as const)
    assert(!canView({ ...base, role }, { ...assigned, organizationId: "two" }));
});
test("operator only sees explicit workflow assignment", () => {
  assert(canView(base, assigned));
  assert(!canView(base, { ...assigned, workflowId: "other" }));
  assert(!canView({ ...base, workflowIds: [] }, assigned));
});
test("manager sees only assigned teams", () => {
  assert(canView({ ...base, role: "manager" }, assigned));
  assert(!canView({ ...base, role: "manager" }, { ...assigned, teamId: "b" }));
  assert(!canView({ ...base, role: "manager" }, { ...assigned, teamId: null }));
});
test("owner/admin do not cross organizations", () => {
  assert(canView({ ...base, role: "owner" }, assigned));
  assert(
    !canView(
      { ...base, role: "admin" },
      { ...assigned, organizationId: "two" },
    ),
  );
});
test("execution needs all four boundaries", () => {
  assert(canExecute(base, assigned, true, true));
  assert(!canExecute({ ...base, canRun: false }, assigned, true, true));
  assert(!canExecute(base, assigned, false, true));
  assert(!canExecute(base, assigned, true, false));
  assert(!canExecute(base, { ...assigned, organizationId: "two" }, true, true));
});
test("missing malformed and foreign grants fail closed", () => {
  for (const v of [
    null,
    "{}",
    "bad",
    '{"organizations":{"one":{"users":{"u":{"role":"owner"}}}}}',
  ])
    assert.equal(parseGrant(v, "u", "one"), null);
  const config = JSON.stringify({
    organizations: { one: { users: { u: base } } },
  });
  assert.deepEqual(parseGrant(config, "u", "one"), base);
  assert.equal(parseGrant(config, "u", "two"), null);
  assert.equal(parseGrant(config, "other", "one"), null);
});
