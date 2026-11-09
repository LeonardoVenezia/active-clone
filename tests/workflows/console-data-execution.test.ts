import assert from "node:assert/strict";
import test from "node:test";
import {
  consoleDataScope,
  needsConsoleData,
} from "../../lib/console/data-execution-policy";
import { leoDemoPack } from "../../lib/demo/leo-pack";

test("console execution passes data scope only from matched server organization", () => {
  assert.equal(consoleDataScope("org", null), null);
  assert.equal(
    consoleDataScope("org", { organizationId: "foreign", memberRole: "owner" }),
    null
  );
  assert.deepEqual(
    consoleDataScope("org", { organizationId: "org", memberRole: "owner" }),
    { dataOrganizationId: "org", dataCanDefineFields: true }
  );
  assert.deepEqual(
    consoleDataScope("org", { organizationId: "org", memberRole: "member" }),
    { dataOrganizationId: "org", dataCanDefineFields: false }
  );
});
test("all five demo graphs require server data scope", () => {
  for (const c of leoDemoPack().cases) {
    assert.equal(needsConsoleData(c.nodes), true);
  }
  assert.equal(
    needsConsoleData([{ data: { config: { actionType: "Slack" } } }]),
    false
  );
});
