/**
 * Executable step function for Fórmula action
 * Evaluates a JSONata expression over a JSON input.
 * Sandboxed by design: JSONata has no IO, no network access and no custom
 * functions are registered. Guardrails: expression length cap, input size
 * cap and an evaluation timeout.
 */
import "server-only";

import jsonata from "jsonata";

import { type StepInput, withStepLogging } from "./step-handler";

export type FormulaInput = StepInput & {
  /** JSONata expression string (raw, not template-processed) */
  expression: string;
  /** JSON input for the expression (template-resolved). Object, array or JSON string. */
  input?: unknown;
};

const MAX_EXPRESSION_LENGTH = 2000;
const MAX_INPUT_BYTES = 262_144; // 256 KB
const EVAL_TIMEOUT_MS = 1000;

type FormulaResult =
  | { success: true; result: unknown }
  | { success: false; error: string };

async function evaluateFormula(input: FormulaInput): Promise<FormulaResult> {
  const { expression } = input;

  if (typeof expression !== "string" || expression.trim().length === 0) {
    return { success: false, error: "La expresión es obligatoria." };
  }
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    return {
      success: false,
      error: `La expresión supera el máximo de ${MAX_EXPRESSION_LENGTH} caracteres.`,
    };
  }

  let data: unknown = input.input;
  if (typeof data === "string" && data.trim().length > 0) {
    try {
      data = JSON.parse(data);
    } catch {
      // Keep the raw string as input value
    }
  }

  let inputBytes = 0;
  try {
    inputBytes = JSON.stringify(data ?? null)?.length ?? 0;
  } catch {
    return {
      success: false,
      error: "La entrada no es serializable a JSON.",
    };
  }
  if (inputBytes > MAX_INPUT_BYTES) {
    return {
      success: false,
      error: "La entrada supera el máximo de 256 KB.",
    };
  }

  try {
    const compiled = jsonata(expression);
    const result = await Promise.race([
      compiled.evaluate(data ?? {}),
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error("formula_timeout")),
          EVAL_TIMEOUT_MS
        )
      ),
    ]);
    return { success: true, result: result === undefined ? null : result };
  } catch (error) {
    if (error instanceof Error && error.message === "formula_timeout") {
      return {
        success: false,
        error: `La expresión tardó más de ${EVAL_TIMEOUT_MS} ms.`,
      };
    }
    const message =
      error instanceof Error ? error.message : "Error desconocido";
    return { success: false, error: `Error en la expresión: ${message}` };
  }
}

export async function formulaStep(input: FormulaInput): Promise<FormulaResult> {
  "use step";
  return withStepLogging(input, () => evaluateFormula(input));
}
formulaStep.maxRetries = 0;
