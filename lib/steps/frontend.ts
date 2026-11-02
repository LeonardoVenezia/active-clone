/**
 * Frontend node step (prototype): presentation only. It does not touch data or
 * services; it reports where the page lives so later steps can reference it.
 */
import "server-only";

import { type StepInput, withStepLogging } from "./step-handler";

export type FrontendInput = StepInput;

export async function frontendStep(input: FrontendInput) {
  "use step";

  return withStepLogging(input, async () => ({
    success: true as const,
    page: input._context?.workflowId ? `/frontend/${input._context.workflowId}` : "",
  }));
}
frontendStep.maxRetries = 0;
