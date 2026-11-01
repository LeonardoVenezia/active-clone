import { test } from "node:test";
import assert from "node:assert/strict";
import { companyVariablesDeniedForRun } from "../../lib/company/run-policy";

const SCOPE = { ownerId: "owner1", organizationId: "org1", workflowId: "wf1" };

function withScopeEnv() {
  process.env.COMPANY_VARIABLE_RUN_SCOPES = JSON.stringify([SCOPE]);
  process.env.COMPANY_VARIABLES_POLICY_APPROVED = "true";
  process.env.COMPANY_VARIABLES_STEP_RUNTIME_ENABLED = "true";
}

function clearEnv() {
  delete process.env.COMPANY_VARIABLE_RUN_SCOPES;
  delete process.env.COMPANY_VARIABLES_POLICY_APPROVED;
  delete process.env.COMPANY_VARIABLES_STEP_RUNTIME_ENABLED;
}

test("executor guard: exact scope allowed, everything else denied", () => {
  withScopeEnv();
  assert.equal(
    companyVariablesDeniedForRun({
      hasCompanyReferences: true,
      userId: "owner1",
      organizationId: "org1",
      workflowId: "wf1",
    }),
    false,
  );
  for (const id of [
    { userId: "other", organizationId: "org1", workflowId: "wf1" },
    { userId: "owner1", organizationId: "other", workflowId: "wf1" },
    { userId: "owner1", organizationId: "org1", workflowId: "other" },
  ]) {
    assert.equal(
      companyVariablesDeniedForRun({ hasCompanyReferences: true, ...id }),
      true,
    );
  }
  clearEnv();
});

test("executor guard: missing identity (webhook/background) denied", () => {
  withScopeEnv();
  for (const id of [
    { userId: undefined, organizationId: "org1", workflowId: "wf1" },
    { userId: "owner1", organizationId: undefined, workflowId: "wf1" },
    { userId: undefined, organizationId: undefined, workflowId: undefined },
  ]) {
    assert.equal(
      companyVariablesDeniedForRun({ hasCompanyReferences: true, ...id }),
      true,
    );
  }
  clearEnv();
});

test("executor guard: flags off denied, no company references untouched", () => {
  withScopeEnv();
  delete process.env.COMPANY_VARIABLES_STEP_RUNTIME_ENABLED;
  assert.equal(
    companyVariablesDeniedForRun({
      hasCompanyReferences: true,
      userId: "owner1",
      organizationId: "org1",
      workflowId: "wf1",
    }),
    true,
  );
  process.env.COMPANY_VARIABLES_STEP_RUNTIME_ENABLED = "true";
  delete process.env.COMPANY_VARIABLES_POLICY_APPROVED;
  assert.equal(
    companyVariablesDeniedForRun({
      hasCompanyReferences: true,
      userId: "owner1",
      organizationId: "org1",
      workflowId: "wf1",
    }),
    true,
  );
  clearEnv();
  assert.equal(
    companyVariablesDeniedForRun({
      hasCompanyReferences: false,
      userId: undefined,
      organizationId: undefined,
      workflowId: "wf1",
    }),
    false,
  );
});
