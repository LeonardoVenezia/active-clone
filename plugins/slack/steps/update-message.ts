import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import type { SlackCredentials } from "../credentials";

const SLACK_API_URL = "https://slack.com/api";

type Result =
  | { success: true; ts: string; channel: string }
  | { success: false; error: string };

export type UpdateMessageCoreInput = {
  channelId?: string;
  messageTs?: string;
  newText?: string;
};

export type UpdateMessageInput = StepInput &
  UpdateMessageCoreInput & { integrationId?: string };

async function stepHandler(
  input: UpdateMessageCoreInput,
  credentials: SlackCredentials
): Promise<Result> {
  const apiKey = credentials.SLACK_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: "SLACK_API_KEY is not configured. Please add it in Project Integrations.",
    };
  }
  if (!input.channelId || !input.messageTs) {
    return { success: false, error: "Channel ID and Message timestamp (ts) are required" };
  }
  if (!input.newText?.trim()) {
    return { success: false, error: "New message text is required" };
  }
  try {
    const response = await fetch(`${SLACK_API_URL}/chat.update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        channel: input.channelId,
        ts: input.messageTs,
        text: input.newText,
      }),
    });
    const result = (await response.json()) as {
      ok: boolean;
      error?: string;
      ts?: string;
      channel?: string;
    };
    if (!result.ok) {
      return { success: false, error: result.error || "Failed to update message" };
    }
    return { success: true, ts: result.ts || input.messageTs, channel: result.channel || input.channelId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to update message: ${message}` };
  }
}

export async function updateMessageStep(input: UpdateMessageInput): Promise<Result> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
updateMessageStep.maxRetries = 0;

export const _integrationType = "slack";
