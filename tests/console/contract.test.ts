import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("bootstrap never sends graph or secret config", () => {
  const text = readFileSync("app/api/console/v1/bootstrap/route.ts", "utf8")
    .replace(/\s+/g, "")
    .replace(/"/g, "\'");
  assert(!text.includes("...w,"));
  assert(!text.includes("config:w."));
  assert(text.includes("CONSOLE_EXECUTION_ENABLED==='true'"));
  assert(!text.includes("output:"));
});
test("history has no execution payloads", () => {
  const s = readFileSync("lib/console/data.ts", "utf8");
  const select = s.split("export async function runHistory")[1];
  assert(!select.includes("input:"));
  assert(!select.includes("output:"));
  assert(!select.includes("error:"));
});
test("grant authority is server-only, not organization metadata", () => {
  const s = readFileSync("lib/console/grants.ts", "utf8").replace(/\s+/g, "");
  assert(s.includes("parseGrant(process.env.CONSOLE_ACCESS_CONFIG"));
  assert(!s.includes("parseGrant(org.metadata"));
});
test("real execution cannot fall through to builder runner", () => {
  const s = readFileSync(
    "app/api/console/v1/workflows/[workflowId]/execute/route.ts",
    "utf8",
  )
    .replace(/\s+/g, "")
    .replace(/"/g, "\'");
  assert(!s.includes('from "workflow/api"'));
  assert(s.includes("CONSOLE_EXECUTION_ENABLED!=='true'"));
  assert(
    s.indexOf("CONSOLE_EXECUTION_ENABLED!=='true'") <
      s.indexOf("reserveAndLaunch(ctx"),
  );
  assert(s.includes("Noseejecutónada."));
});
