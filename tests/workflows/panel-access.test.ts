import assert from "node:assert/strict";
import { test } from "node:test";
import {
  panelAccessState,
  pausePanelPolling,
} from "../../lib/datos/panel-access";

test("panel denial waits for session before deciding login vs missing permission", () => {
  assert.equal(panelAccessState(false, false, false), null);
  assert.equal(panelAccessState(true, true, false), "checking");
  assert.equal(panelAccessState(true, true, true), "checking");
  assert.equal(panelAccessState(true, false, false), "signin");
  assert.equal(panelAccessState(true, false, true), "forbidden");
});

test("401/403 pause automatic requests; retry does not alter authorization", () => {
  assert.equal(pausePanelPolling(401), true);
  assert.equal(pausePanelPolling(403), true);
  assert.equal(pausePanelPolling(200), false);
  assert.equal(pausePanelPolling(500), false);
});
