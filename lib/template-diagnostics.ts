import { resolveFieldValue } from "./field-path";

type NodeOutputs = Record<string, { label: string; data: unknown }>;
export type TemplateDiagnostic = {
  kind: "missing-node" | "missing-field" | "missing-output" | "formula-empty-input";
  configKey: string;
  nodeId: string;
  fieldPath?: string;
};

/** Inspect only strings, matching processTemplates. Never include source values. */
export function diagnoseTemplateReferences(
  config: Record<string, unknown>,
  outputs: NodeOutputs,
): TemplateDiagnostic[] {
  const diagnostics: TemplateDiagnostic[] = [];
  const seen = new Set<string>();
  for (const [configKey, value] of Object.entries(config)) {
    if (typeof value !== "string") continue;
    for (const match of value.matchAll(/\{\{@([^:]+):([^}]+)\}\}/g)) {
      const nodeId = match[1].replace(/[^a-zA-Z0-9]/g, "_");
      const dot = match[2].indexOf(".");
      const fieldPath = dot === -1 ? undefined : match[2].slice(dot + 1);
      const output = outputs[nodeId];
      const kind = !output
        ? "missing-node"
        : output.data === undefined
          ? "missing-output"
          : fieldPath !== undefined &&
              output.data !== null &&
              resolveFieldValue(output.data, fieldPath) === undefined
            ? "missing-field"
            : undefined;
      if (!kind) continue;
      const diagnostic: TemplateDiagnostic = { kind, configKey, nodeId };
      if (fieldPath !== undefined) diagnostic.fieldPath = fieldPath;
      const identity = JSON.stringify(diagnostic);
      if (seen.has(identity)) continue;
      seen.add(identity);
      diagnostics.push(diagnostic);
    }
  }
  return diagnostics;
}

/** Warn when a Fórmula action has no Entrada: it runs with empty data and may return null. */
export function diagnoseFormulaAction(
  config: Record<string, unknown>,
): TemplateDiagnostic[] {
  if (config.actionType !== "Fórmula") return [];
  const input = config.input;
  if (typeof input === "string" && input.trim().length > 0) return [];
  if (input !== undefined && input !== null && typeof input !== "string")
    return [];
  return [{ kind: "formula-empty-input", configKey: "input", nodeId: "" }];
}
