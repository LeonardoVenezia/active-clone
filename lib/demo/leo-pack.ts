import fixtures from "./leo-fixtures.json";

export const DEMO_EMAIL = "demo-leo-9nov2026@active-clone.invalid";

export function canPrepareLeoDemo(
  environment: string | undefined,
  email: string | undefined
): boolean {
  return environment === "preview" && email === DEMO_EMAIL;
}

/** Fixed fixture data only. No source workflow IDs, connection IDs or caller-selected data. */
type DemoRecord = { collection: string; key: string; value: unknown };
type DemoCase = {
  name: string;
  title: string;
  nodes: (typeof fixtures.cases)[number]["nodes"];
  edges: (typeof fixtures.cases)[number]["edges"];
  records: DemoRecord[];
};

export function leoDemoPack(): { cases: DemoCase[]; seeds: DemoRecord[] } {
  return fixtures;
}
