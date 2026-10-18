import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import type { SlackCredentials } from "../credentials";

const SLACK_API_URL = "https://slack.com/api";

type SlackUser = { id: string; name: string; realName: string; email?: string; isBot: boolean };

type Result =
  | { success: true; users: SlackUser[]; count: number }
  | { success: false; error: string };

export type ListUsersCoreInput = { limit?: string };

export type ListUsersInput = StepInput &
  ListUsersCoreInput & { integrationId?: string };

async function stepHandler(
  input: ListUsersCoreInput,
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
    const params = new URLSearchParams({ limit: input.limit || "100" });
    const response = await fetch(`${SLACK_API_URL}/users.list?${params.toString()}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const result = (await response.json()) as {
      ok: boolean;
      error?: string;
      members?: Array<{
        id: string;
        name: string;
        real_name?: string;
        is_bot?: boolean;
        profile?: { email?: string };
      }>;
    };
    if (!result.ok) {
      return { success: false, error: result.error || "Failed to list users" };
    }
    const users = (result.members || []).map((u) => ({
      id: u.id,
      name: u.name,
      realName: u.real_name || u.name,
      email: u.profile?.email,
      isBot: u.is_bot || false,
    }));
    return { success: true, users, count: users.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to list users: ${message}` };
  }
}

export async function listUsersStep(input: ListUsersInput): Promise<Result> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
listUsersStep.maxRetries = 0;

export const _integrationType = "slack";
