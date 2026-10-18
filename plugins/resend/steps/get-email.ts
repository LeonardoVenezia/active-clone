import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import type { ResendCredentials } from "../credentials";

const RESEND_API_URL = "https://api.resend.com";

type Result =
  | {
      success: true;
      id: string;
      to: string[];
      from: string;
      subject: string;
      lastEvent: string;
      createdAt: string;
    }
  | { success: false; error: string };

export type GetEmailCoreInput = { emailId?: string };

export type GetEmailInput = StepInput &
  GetEmailCoreInput & { integrationId?: string };

async function stepHandler(
  input: GetEmailCoreInput,
  credentials: ResendCredentials
): Promise<Result> {
  const apiKey = credentials.RESEND_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: "RESEND_API_KEY is not configured. Please add it in Project Integrations.",
    };
  }
  if (!input.emailId) {
    return { success: false, error: "Email ID is required (returned by Send Email)" };
  }
  try {
    const response = await fetch(
      `${RESEND_API_URL}/emails/${encodeURIComponent(input.emailId)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (!response.ok) {
      const errorData = (await response.json()) as { message?: string };
      return {
        success: false,
        error: errorData.message || `HTTP ${response.status}: Failed to get email`,
      };
    }
    const email = (await response.json()) as {
      id: string;
      to: string[];
      from: string;
      subject: string;
      last_event: string;
      created_at: string;
    };
    return {
      success: true,
      id: email.id,
      to: email.to,
      from: email.from,
      subject: email.subject,
      lastEvent: email.last_event,
      createdAt: email.created_at,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to get email: ${message}` };
  }
}

export async function getEmailStep(input: GetEmailInput): Promise<Result> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
getEmailStep.maxRetries = 0;

export const _integrationType = "resend";
