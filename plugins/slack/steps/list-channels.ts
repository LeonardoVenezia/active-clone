import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import type { SlackCredentials } from "../credentials";

const SLACK_API_URL = "https://slack.com/api";

type Channel = { id: string; name: string; isPrivate: boolean; memberCount?: number };

type Result =
  | { success: true; channels: Channel[]; count: number }
  | { success: false; error: string };

export type ListChannelsCoreInput = { limit?: string };

export type ListChannelsInput = StepInput &
  ListChannelsCoreInput & { integrationId?: string };

async function stepHandler(
  input: ListChannelsCoreInput,
  credentials: SlackCredentials
): Promise<Result> {
  const apiKey = credentials.SLACK_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: "SLACK_API_KEY is not configured. Please add it in Project Integrations.",
    };
  }
  try {
    const params = new URLSearchParams({
      types: "public_channel,private_channel",
      limit: input.limit || "100",
    });
    const response = await fetch(`${SLACK_API_URL}/conversations.list?${params.toString()}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const result = (await response.json()) as {
      ok: boolean;
      error?: string;
      channels?: Array<{ id: string; name: string; is_private: boolean; num_members?: number }>;
    };
    if (!result.ok) {
      return { success: false, error: result.error || "Failed to list channels" };
    }
    const channels = (result.channels || []).map((c) => ({
      id: c.id,
      name: c.name,
      isPrivate: c.is_private,
      memberCount: c.num_members,
    }));
    return { success: true, channels, count: channels.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to list channels: ${message}` };
  }
}

export async function listChannelsStep(input: ListChannelsInput): Promise<Result> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
listChannelsStep.maxRetries = 0;

export const _integrationType = "slack";
