import { leoDemoPack } from "./leo-pack";

export const LEO_CONSOLE_ORIGIN =
  "https://active-clone-console-git-inte-930d70-leonardo-venezias-projects.vercel.app";
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
 * fictitious graphs may run from this exact authorized preview console. */
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
    input.environment !== "preview" ||
    input.consoleOrigin !== LEO_CONSOLE_ORIGIN ||
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
