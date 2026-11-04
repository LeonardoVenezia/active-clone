import assert from "node:assert/strict";
import { createRequire } from "node:module";
import Module from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { WorkflowNode } from "../../lib/workflow-store";

// The SDK generator is server-only; this isolated test does not call a provider.
const require = createRequire(import.meta.url);
const resolver = Module as typeof Module & {
  _resolveFilename: (request: string, ...args: unknown[]) => string;
};
const originalResolve = resolver._resolveFilename;
resolver._resolveFilename = function (request, ...args) {
  if (request === "server-only") {
    return require.resolve("../semantic/stubs/server-only.ts");
  }
  return originalResolve.call(this, request, ...args);
};
const { generateWorkflowCode, generateWorkflowModule } =
  await import("../../lib/workflow-codegen");
const { generateWorkflowSDKCode } =
  await import("../../lib/workflow-codegen-sdk");
const { getWorkflowFunctionName } =
  await import("../../lib/workflow-codegen-shared");
resolver._resolveFilename = originalResolve;

const trigger: WorkflowNode = {
  id: "trigger",
  type: "trigger",
  position: { x: 0, y: 0 },
  data: {
    type: "trigger",
    label: "Manual",
    config: { triggerType: "Manual" },
    status: "idle",
  },
};
function assertSyntax(code: string) {
  const result = ts.transpileModule(code, {
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
    },
  });
  assert.deepEqual(
    result.diagnostics,
    [],
    result.diagnostics
      ?.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
      .join("\n"),
  );
}
for (const name of [
  "123 stock",
  "0",
  "",
  "!!!",
  "Venta normal",
  "stock_2026",
  "class",
  "await",
  "yield",
  "eval",
  "arguments",
  "$workflow",
]) {
  test(`syntactically valid export for name ${JSON.stringify(name)}`, () => {
    const binding = getWorkflowFunctionName(name);
    const generated = generateWorkflowCode([trigger], [], {
      functionName: binding,
    });
    assert.equal(generated.functionName, binding);
    assertSyntax(generated.code);
    assertSyntax(
      generateWorkflowModule(name, [trigger], [], { functionName: binding }),
    );
    assertSyntax(generateWorkflowSDKCode(name, [trigger], []));
    assertSyntax(
      generateWorkflowCode([trigger], [], { functionName: name }).code,
    );
  });
}
test("ordinary workflow bindings stay unchanged", () => {
  assert.equal(getWorkflowFunctionName("Mi venta"), "miVentaWorkflow");
  assert.equal(getWorkflowFunctionName(""), "executeWorkflow");
  assert.equal(getWorkflowFunctionName("123 stock"), "_123StockWorkflow");
  assert.equal(
    generateWorkflowCode([trigger], []).functionName,
    "executeWorkflow",
  );
});
test("both Code views and download use the same binding helper", () => {
  for (const file of [
    "components/overlays/configuration-overlay.tsx",
    "components/workflow/node-config-panel.tsx",
    "app/api/workflows/[workflowId]/download/route.ts",
  ]) {
    const source = readFileSync(
      new URL(`../../${file}`, import.meta.url),
      "utf8",
    );
    assert.match(source, /const functionName = getWorkflowFunctionName\(/);
  }
});
for (const actionType of ["Unir", "Datos", "Frontend"]) {
  test(`${actionType} keeps its deliberate export guard`, () => {
    const action: WorkflowNode = {
      ...trigger,
      id: "a",
      type: "action",
      data: {
        type: "action",
        label: actionType,
        config: { actionType },
        status: "idle",
      },
    };
    const nodes = [trigger, action];
    const edges = [{ id: "e", source: "trigger", target: "a" }];
    for (const code of [
      generateWorkflowCode(nodes, edges).code,
      generateWorkflowSDKCode("123", nodes, edges),
    ]) {
      assertSyntax(code);
      assert.match(code, /throw new Error\("Export not supported:/);
      assert.match(code, /Run it on the platform/);
    }
  });
}
