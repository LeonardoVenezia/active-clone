/**
 * Registra en el log del run una omisión por configuración de solución
 * (fuente explícitamente inactiva). No ejecuta lógica ni llama proveedores:
 * deja constancia visible de que el paso no se consultó ni se esperó.
 */
import "server-only";
import { type StepInput, withStepLogging } from "./step-handler";

type OmittedResult = {
  success: boolean;
  data: unknown;
};

type OmittedInput = StepInput & {
  result: OmittedResult;
};

// biome-ignore lint/suspicious/useAwait: los pasos del workflow son async por contrato (igual que joinStep)
export async function solutionOmittedStep(
  input: OmittedInput
): Promise<OmittedResult> {
  "use step";
  return withStepLogging(input, () => Promise.resolve(input.result));
}
solutionOmittedStep.maxRetries = 0;
