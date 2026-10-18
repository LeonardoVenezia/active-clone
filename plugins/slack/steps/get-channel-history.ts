import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import type { SlackCredentials } from "../credentials";

const SLACK_API_URL = "https://slack.com/api";

type Message = { ts: string; user?: string; text: string; type: string };

type Result =
  | { success: true; messages: Message[]; count: number; hasMore: boolean }
  | { success: false; error: string };

export type GetChannelHistoryCoreInput = { channelId?: string; limit?: string };

export type GetChannelHistoryInput = StepInput &
  GetChannelHistoryCoreInput & { integrationId?: string };

async function stepHandler(
  input: GetChannelHistoryCoreInput,
  credentials: SlackCredentials
): Promise<Result> {
  const apiKey = credentials.SLACK_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: "SLACK_API_KEY is not configured. Please add it in Project Integrations.",
    };
  }
  if (!input.channelId) {
    return { success: false, error: "Channel ID is required (C...). Use List Channels to find it." };
  }
  try {
    const params = new URLSearchParams({
      channel: input.channelId,
      limit: input.limit || "20",
    });
    const response = await fetch(`${SLACK_API_URL}/conversations.history?${params.toString()}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const result = (await response.json()) as {
      ok: boolean;
      error?: string;
      has_more?: boolean;
      messages?: Array<{ ts: string; user?: string; text?: string; type: string }>;
    };
    if (!result.ok) {
      return { success: false, error: result.error || "Failed to get channel history" };
    }
    const messages = (result.messages || []).map((m) => ({
      ts: m.ts,
      user: m.user,
      text: m.text || "",
      type: m.type,
    }));
    return { success: true, messages, count: messages.length, hasMore: result.has_more || false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to get channel history: ${message}` };
  }
}

export async function getChannelHistoryStep(
  input: GetChannelHistoryInput
): Promise<Result> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
getChannelHistoryStep.maxRetries = 0;

export const _integrationType = "slack";
