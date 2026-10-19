/**
 * Code template for Fórmula action step
 * This is a string template used for code generation - keep as string export
 *
 * Requires: pnpm add jsonata
 */
export default `export async function formulaStep(input: {
  expression: string;
  input?: unknown;
}) {
  "use step";

  const jsonata = (await import("jsonata")).default;

  const MAX_EXPRESSION_LENGTH = 2000;
  const MAX_INPUT_BYTES = 262144;
  const EVAL_TIMEOUT_MS = 1000;

  const expression = input.expression;
  if (typeof expression !== "string" || expression.trim().length === 0) {
    return { success: false, error: "La expresión es obligatoria." };
  }
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    return {
      success: false,
      error: "La expresión supera el máximo de " + MAX_EXPRESSION_LENGTH + " caracteres.",
    };
  }

  let data = input.input;
  if (typeof data === "string" && data.trim().length > 0) {
    try {
      data = JSON.parse(data);
    } catch {
      // Keep the raw string as input value
    }
  }

  let inputBytes = 0;
  try {
    const serialized = JSON.stringify(data == null ? null : data);
    inputBytes = serialized ? serialized.length : 0;
  } catch {
    return { success: false, error: "La entrada no es serializable a JSON." };
  }
  if (inputBytes > MAX_INPUT_BYTES) {
    return { success: false, error: "La entrada supera el máximo de 256 KB." };
  }

  try {
    const compiled = jsonata(expression);
    const result = await Promise.race([
      compiled.evaluate(data == null ? {} : data),
      new Promise(function (_resolve, reject) {
        setTimeout(function () {
          reject(new Error("formula_timeout"));
        }, EVAL_TIMEOUT_MS);
      }),
    ]);
    return { success: true, result: result === undefined ? null : result };
  } catch (error) {
    if (error instanceof Error && error.message === "formula_timeout") {
      return {
        success: false,
        error: "La expresión tardó más de " + EVAL_TIMEOUT_MS + " ms.",
      };
    }
    const message = error instanceof Error ? error.message : "Error desconocido";
    return { success: false, error: "Error en la expresión: " + message };
  }
}`;
