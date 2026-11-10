import type { Assignment, ConsoleGrant } from "../console/policy";
import { leoDemoPack } from "./leo-pack";

export const LEO_CONSOLE_ORIGIN =
  "https://active-clone-console-git-inte-930d70-leonardo-venezias-projects.vercel.app";
export const LEO_PRODUCTION_CONSOLE_ORIGIN =
  "https://active-clone-console.vercel.app";
export const LEO_DEMO_USER = "OlGX3cdPsYdJ38fyV4fopt8zIphNwsST";
export const LEO_DEMO_ORG = "gxx8o0eesceviaq8084dn";
export const LEO_DEMO_IDS = [
  "9jpvsbxnpsmux0vz3mp2k",
  "x8qo2dptc1hm64dy1neq8",
  "to3njx19syw2owsguek1v",
  "agubieqkn2zalr3fz6435",
  "3qjuzqykojdn0jlqhcun1",
] as const;

function stable(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(row[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** No workflow activation or general execution flag. Only the five unchanged
 * fictitious graphs may run from the exact approved preview or production console. */
export function isLeoConsoleFixture(input: {
  environment: string | undefined;
  consoleOrigin: string | undefined;
  userId: string;
  organizationId: string;
  workflowId: string;
  nodes: unknown;
  edges: unknown;
}) {
  if (
    !(
      (input.environment === "preview" &&
        input.consoleOrigin === LEO_CONSOLE_ORIGIN) ||
      (input.environment === "production" &&
        input.consoleOrigin === LEO_PRODUCTION_CONSOLE_ORIGIN)
    ) ||
    input.userId !== LEO_DEMO_USER ||
    input.organizationId !== LEO_DEMO_ORG
  ) {
    return false;
  }
  const index = (LEO_DEMO_IDS as readonly string[]).indexOf(input.workflowId);
  if (index < 0) {
    return false;
  }
  const expected = leoDemoPack().cases[index];
  return (
    stable(input.nodes) === stable(expected.nodes) &&
    stable(input.edges) === stable(expected.edges)
  );
}

// Additive production scope. Existing configured/persisted grants and revocations
// keep their precedence. No product-wide flag or account is changed.
export function leoProductionGrant(
  environment: string | undefined,
  consoleOrigin: string | undefined,
  userId: string,
  organizationId: string
): ConsoleGrant | null {
  if (
    environment !== "production" ||
    consoleOrigin !== LEO_PRODUCTION_CONSOLE_ORIGIN ||
    userId !== LEO_DEMO_USER ||
    organizationId !== LEO_DEMO_ORG
  ) {
    return null;
  }
  return {
    userId,
    organizationId,
    role: "operator",
    teamIds: [],
    workflowIds: [...LEO_DEMO_IDS],
    canRun: true,
    runWorkflowIds: [...LEO_DEMO_IDS],
  };
}
export function leoProductionAssignments(
  environment: string | undefined,
  consoleOrigin: string | undefined
): Assignment[] {
  if (
    !leoProductionGrant(environment, consoleOrigin, LEO_DEMO_USER, LEO_DEMO_ORG)
  ) {
    return [];
  }
  return LEO_DEMO_IDS.map((workflowId) => ({
    organizationId: LEO_DEMO_ORG,
    workflowId,
    teamId: null,
  }));
}
