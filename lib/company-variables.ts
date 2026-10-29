// Separate namespace from node outputs: {{company.KEY}} never means {{@node:...}}.
export type CompanyVariable = { key: string; secret: boolean; value: string };
export function validateVariableKey(key: string) {
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(key);
}
export function companyVariableKeys(value: unknown): string[] {
  const result = new Set<string>();
  function scan(v: unknown) {
    if (typeof v === "string")
      for (const m of v.matchAll(/\{\{company\.([A-Z][A-Z0-9_]{0,63})\}\}/g))
        result.add(m[1]);
    else if (Array.isArray(v)) v.forEach(scan);
    else if (v && typeof v === "object") Object.values(v).forEach(scan);
  }
  scan(value);
  return [...result];
}
export function resolveCompanyVariables(
  value: unknown,
  values: Record<string, string>,
): unknown {
  if (typeof value === "string")
    return value.replace(
      /\{\{company\.([A-Z][A-Z0-9_]{0,63})\}\}/g,
      (_match, key) => {
        if (!Object.hasOwn(values, key))
          throw Error("Company variable is not configured: " + key);
        return values[key];
      },
    );
  if (Array.isArray(value))
    return value.map((v) => resolveCompanyVariables(v, values));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        resolveCompanyVariables(v, values),
      ]),
    );
  return value;
}
