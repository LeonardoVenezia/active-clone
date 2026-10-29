import { test } from "node:test";
import assert from "node:assert/strict";
import { canManageGrant, type ConsoleGrant } from "../../lib/console/policy";
const g = (
  role: ConsoleGrant["role"],
  userId = "target",
  teamIds = ["sales"],
): ConsoleGrant => ({
  userId,
  role,
  teamIds,
  workflowIds: [],
  organizationId: "one",
  canRun: false,
});
test("admin manages lower roles without owner/peer elevation", () => {
  const a = g("admin", "actor");
  assert(canManageGrant(a, g("operator"), g("manager")));
  assert(!canManageGrant(a, g("admin"), g("operator")));
  assert(!canManageGrant(a, g("operator"), g("admin")));
  assert(!canManageGrant(a, null, { ...g("operator"), organizationId: "two" }));
});
test("manager manages only operators fully inside own teams", () => {
  const a = g("manager", "actor");
  assert(canManageGrant(a, g("operator"), g("operator")));
  assert(!canManageGrant(a, g("manager"), g("operator")));
  assert(
    !canManageGrant(
      a,
      g("operator", "target", ["sales", "finance"]),
      g("operator"),
    ),
  );
  assert(
    !canManageGrant(a, g("operator"), g("operator", "target", ["finance"])),
  );
  assert(!canManageGrant(a, null, { ...g("operator"), canRun: true }));
  assert(!canManageGrant(a, g("operator"), g("operator", "actor")));
});
test("operator cannot manage and owner cannot change owner/self", () => {
  assert(!canManageGrant(g("operator", "actor"), g("operator"), g("operator")));
  assert(canManageGrant(g("owner", "actor"), g("admin"), g("admin")));
  assert(!canManageGrant(g("owner", "actor"), g("owner"), g("operator")));
  assert(!canManageGrant(g("owner", "actor"), null, g("owner")));
});
