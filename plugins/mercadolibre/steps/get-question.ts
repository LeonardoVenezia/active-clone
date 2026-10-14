import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { mlFetch } from "../api";
import type { MercadoLibreCredentials } from "../credentials";

type Result =
  | { success: true; id: string; itemId: string; text: string; status: string; dateCreated: string; answer: string }
  | { success: false; error: string };

export type GetQuestionInput = StepInput & { questionId: string; integrationId?: string };

type MlQuestion = {
  id: number;
  item_id: string;
  text: string;
  status: string;
  date_created?: string;
  answer?: { text?: string } | null;
};

async function stepHandler(
  input: GetQuestionInput,
  credentials: MercadoLibreCredentials
): Promise<Result> {
  const questionId = input.questionId?.toString().trim();
  if (!questionId) {
    return { success: false, error: "Question ID is required" };
  }
  try {
    const result = await mlFetch(input.integrationId, credentials, `/questions/${encodeURIComponent(questionId)}?api_version=4`);
    if (!result.ok) {
      return { success: false, error: result.error };
    }
    const question = result.data as MlQuestion;
    return {
      success: true,
      id: String(question.id),
      itemId: question.item_id,
      text: question.text,
      status: question.status,
      dateCreated: question.date_created ?? "",
      answer: question.answer?.text ?? "",
    };
  } catch (error) {
    return { success: false, error: `Failed to get question: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function getQuestionStep(input: GetQuestionInput): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
getQuestionStep.maxRetries = 0;

export const _integrationType = "mercadolibre";
