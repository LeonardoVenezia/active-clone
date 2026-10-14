import "server-only";

import { and, eq } from "drizzle-orm";
import { start } from "workflow/api";
import { db } from "@/lib/db";
import {
  getIntegrationById,
  validateWorkflowIntegrations,
} from "@/lib/db/integrations";
import {
  integrationEvents,
  workflowExecutions,
  workflows,
} from "@/lib/db/schema";
import type { IntegrationType } from "@/lib/types/integration";
import { executeWorkflow } from "@/lib/workflow-executor.workflow";
import type { WorkflowEdge, WorkflowNode } from "@/lib/workflow-store";
import { getCredentialMapping, getIntegration } from "@/plugins";

const MAX_BODY_BYTES = 1024 * 1024;

export type IntegrationWebhookResult = {
  status: number;
  body: Record<string, unknown>;
};

/**
 * Start every active workflow of the connection's owner whose trigger is
 * this event from this exact connection. Returns how many runs were started.
 */
async function startWorkflowsForEvent(params: {
  userId: string;
  integrationId: string;
  triggerId: string; // "{type}/{slug}"
  data: Record<string, unknown>;
}): Promise<number> {
  const activeWorkflows = await db
    .select()
    .from(workflows)
    .where(
      and(eq(workflows.userId, params.userId), eq(workflows.active, true))
    );

  let started = 0;
  for (const workflow of activeWorkflows) {
    const nodes = workflow.nodes as WorkflowNode[];
    const trigger = nodes.find((node) => node.data.type === "trigger");
    const config = trigger?.data.config;
    if (
      config?.triggerType !== "Integration" ||
      config.integrationTrigger !== params.triggerId ||
      config.integrationId !== params.integrationId
    ) {
      continue;
    }

    const validation = await validateWorkflowIntegrations(
      nodes,
      workflow.userId
    );
    if (!validation.valid) {
      console.error(
        "[Integration Webhook] Workflow has invalid integration references:",
        workflow.id
      );
      continue;
    }

    try {
      const [execution] = await db
        .insert(workflowExecutions)
        .values({
          workflowId: workflow.id,
          userId: workflow.userId,
          status: "running",
          input: params.data,
        })
        .returning();

      try {
        start(executeWorkflow, [
          {
            nodes,
            edges: workflow.edges as WorkflowEdge[],
            triggerInput: params.data,
            executionId: execution.id,
            workflowId: workflow.id,
          },
        ]);
        started += 1;
      } catch (error) {
        await db
          .update(workflowExecutions)
          .set({
            status: "error",
            error: error instanceof Error ? error.message : "Failed to start",
            completedAt: new Date(),
          })
          .where(eq(workflowExecutions.id, execution.id));
      }
    } catch (error) {
      console.error("[Integration Webhook] Could not start workflow:", error);
    }
  }
  return started;
}

/**
 * Receive a webhook for one integration connection.
 *
 * Flow: find the connection -> verify the provider signature -> normalize the
 * payload into events -> store each event once (retries are dropped).
 *
 * Each new event then starts the owner's workflows that are switched on
 * ("active"), use this event as trigger, and point at this same connection.
 */
export async function receiveIntegrationWebhook(
  type: string,
  integrationId: string,
  request: Request
): Promise<IntegrationWebhookResult> {
  const plugin = getIntegration(type as IntegrationType);
  if (!plugin?.webhook) {
    return { status: 404, body: { error: "Webhooks not supported" } };
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return { status: 413, body: { error: "Payload too large" } };
  }
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return { status: 413, body: { error: "Payload too large" } };
  }

  // Same response for "no such connection" and "wrong type" so ids can't be probed.
  const integration = await getIntegrationById(integrationId);
  if (!integration || integration.type !== type) {
    return { status: 404, body: { error: "Not found" } };
  }

  const credentials = getCredentialMapping(
    plugin,
    integration.config as Record<string, unknown>
  );
  const webhookRequest = {
    headers: request.headers,
    rawBody,
    query: new URL(request.url).searchParams,
  };

  const handler = await plugin.webhook.getHandler();

  const rejection = handler.verify(webhookRequest, credentials);
  if (rejection) {
    console.warn("[Integration Webhook] Rejected", type, rejection);
    return { status: 401, body: { error: "Invalid signature" } };
  }

  let events: ReturnType<typeof handler.parse>;
  try {
    events = handler.parse(webhookRequest, credentials);
  } catch {
    return { status: 400, body: { error: "Invalid payload" } };
  }

  let stored = 0;
  let started = 0;
  for (const event of events) {
    const inserted = await db
      .insert(integrationEvents)
      .values({
        integrationId: integration.id,
        userId: integration.userId,
        type,
        trigger: event.trigger,
        externalId: event.externalId,
        data: event.data,
      })
      .onConflictDoNothing()
      .returning({ id: integrationEvents.id });
    if (inserted.length === 0) {
      continue; // retried delivery, already handled
    }
    stored += 1;
    const runs = await startWorkflowsForEvent({
      userId: integration.userId,
      integrationId: integration.id,
      triggerId: `${type}/${event.trigger}`,
      data: event.data,
    });
    started += runs;
    if (runs > 0) {
      await db
        .update(integrationEvents)
        .set({ processedAt: new Date() })
        .where(eq(integrationEvents.id, inserted[0].id));
    }
  }

  return {
    status: 200,
    body: { received: events.length, stored, started },
  };
}

/**
 * Answer a provider's GET handshake for one connection (for example WhatsApp's
 * hub.challenge). Same 404 for unknown connections as the POST route.
 */
export async function answerWebhookHandshake(
  type: string,
  integrationId: string,
  request: Request
): Promise<{ status: number; body: string }> {
  const plugin = getIntegration(type as IntegrationType);
  if (!plugin?.webhook) {
    return { status: 404, body: "Not found" };
  }
  const integration = await getIntegrationById(integrationId);
  if (!integration || integration.type !== type) {
    return { status: 404, body: "Not found" };
  }
  const handler = await plugin.webhook.getHandler();
  const credentials = getCredentialMapping(
    plugin,
    integration.config as Record<string, unknown>
  );
  const answer = handler.handshake?.(
    new URL(request.url).searchParams,
    credentials
  );
  return answer ?? { status: 404, body: "Not found" };
}
