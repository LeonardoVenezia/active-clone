import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { mlFetch } from "../api";
import type { MercadoLibreCredentials } from "../credentials";

type Result =
  | { success: true; questionId: string }
  | { success: false; error: string };

export type AnswerQuestionInput = StepInput & { questionId: string; text: string; integrationId?: string };

async function stepHandler(
  input: AnswerQuestionInput,
  credentials: MercadoLibreCredentials
): Promise<Result> {
  const questionId = input.questionId?.toString().trim();
  const text = input.text?.toString().trim();
  if (!questionId) {
    return { success: false, error: "Question ID is required" };
  }
  if (!text) {
    return { success: false, error: "Answer text is required" };
  }
  try {
    const result = await mlFetch(input.integrationId, credentials, "/answers", {
      method: "POST",
      body: { question_id: Number(questionId), text },
    });
    if (!result.ok) {
      return { success: false, error: result.error };
    }
    return { success: true, questionId };
  } catch (error) {
    return { success: false, error: `Failed to answer question: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function answerQuestionStep(input: AnswerQuestionInput): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
answerQuestionStep.maxRetries = 0;

export const _integrationType = "mercadolibre";
