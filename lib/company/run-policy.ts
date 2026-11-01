// Scoped allowance for running one specific company workflow that references
// {{company.KEY}} variables. Everything not listed here keeps the closed 409
// guard. Mirrors fixture-policy.ts: exact owner + organization + workflow from
// server configuration, both runtime flags required, deny by default.
export type CompanyRunScope = {
  organizationId: string;
  workflowId: string;
  ownerId: string;
};

function parseScopes(raw: string | undefined): CompanyRunScope[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is CompanyRunScope =>
        !!v &&
        [v.organizationId, v.workflowId, v.ownerId].every(
          (s) => typeof s === "string" && s.length > 0 && s.length <= 128,
        ),
    );
  } catch {
    return [];
  }
}

export function companyRunScopes(): CompanyRunScope[] {
  return parseScopes(process.env.COMPANY_VARIABLE_RUN_SCOPES);
}

export function canRunWithCompanyVariables(input: {
  userId: string;
  organizationId: string;
  workflowId: string;
}): boolean {
  if (
    process.env.COMPANY_VARIABLES_POLICY_APPROVED !== "true" ||
    process.env.COMPANY_VARIABLES_STEP_RUNTIME_ENABLED !== "true"
  )
    return false;
  return companyRunScopes().some(
    (s) =>
      s.ownerId === input.userId &&
      s.organizationId === input.organizationId &&
      s.workflowId === input.workflowId,
  );
}
