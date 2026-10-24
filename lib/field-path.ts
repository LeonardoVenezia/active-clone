// Pure field-path resolver shared by the executor and offline tests.
// biome-ignore lint/suspicious/noExplicitAny: Dynamic output data traversal
export function resolveFieldValue(data: unknown, fieldPath: string): any {
  const fields = fieldPath.split(".");
  let current: any = data;
  const firstField = fields[0];
  if (
    current &&
    typeof current === "object" &&
    "success" in current &&
    "data" in current &&
    firstField !== "success" &&
    firstField !== "data" &&
    firstField !== "error"
  ) {
    current = current.data;
  }
  for (const field of fields) {
    if (!(current && typeof current === "object")) {
      return undefined;
    }
    const indexed = /^([^[]+)\[(\d+)\]$/.exec(field);
    if (indexed) {
      const list = current[indexed[1]];
      current = Array.isArray(list) ? list[Number(indexed[2])] : undefined;
    } else {
      current = current[field];
    }
  }
  return current;
}
