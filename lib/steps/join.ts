/** Record the executor-computed join result without changing its policy. */
import "server-only";
import { type StepInput, withStepLogging } from "./step-handler";

type JoinResult = {
  success: boolean;
  data: unknown;
  error?: string;
};

type JoinInput = StepInput & {
  result: JoinResult;
};

export async function joinStep(input: JoinInput): Promise<JoinResult> {
  "use step";
  return withStepLogging(input, async () => input.result, {
    preserveErrorData: true,
  });
}
joinStep.maxRetries = 0;
