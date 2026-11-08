import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import {
  canDecryptHere,
  decrypt,
  encrypt,
  IntegrationConfigUnreadableError,
} from "@/lib/integrations/crypto";
import type { IntegrationConfig, IntegrationType } from "../types/integration";
import { db } from "./index";
import { integrations, type NewIntegration } from "./schema";

// encrypt/decrypt viven en @/lib/integrations/crypto (módulo puro, testeable);
// se re-exportan acá para no romper importadores existentes.
export { decrypt, encrypt } from "@/lib/integrations/crypto";

/**
 * Encrypt integration config object
 */
function encryptConfig(config: Record<string, unknown>): string {
  return encrypt(JSON.stringify(config));
}

/**
 * Decrypt integration config object
 */
function decryptConfig(encryptedConfig: string): Record<string, unknown> {
  try {
    const decrypted = decrypt(encryptedConfig);
    return JSON.parse(decrypted);
  } catch (error) {
    console.error("Failed to decrypt integration config:", error);
    return {};
  }
}

export type DecryptedIntegration = {
  id: string;
  userId: string;
  name: string;
  type: IntegrationType;
  config: IntegrationConfig;
  isManaged: boolean | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Get all integrations for a user, optionally filtered by type
 */
export async function getIntegrations(
  userId: string,
  type?: IntegrationType
): Promise<DecryptedIntegration[]> {
  const conditions = [eq(integrations.userId, userId)];

  if (type) {
    conditions.push(eq(integrations.type, type));
  }

  const results = await db
    .select()
    .from(integrations)
    .where(and(...conditions));

  return results.map((integration) => ({
    ...integration,
    config: decryptConfig(integration.config as string) as IntegrationConfig,
  }));
}

/**
 * Get a single integration by ID
 */
export async function getIntegration(
  integrationId: string,
  userId: string
): Promise<DecryptedIntegration | null> {
  const result = await db
    .select()
    .from(integrations)
    .where(
      and(eq(integrations.id, integrationId), eq(integrations.userId, userId))
    )
    .limit(1);

  if (result.length === 0) {
    return null;
  }

  return {
    ...result[0],
    config: decryptConfig(result[0].config as string) as IntegrationConfig,
  };
}

/**
 * Get a single integration by ID without user check (for system use during workflow execution)
 */
export async function getIntegrationById(
  integrationId: string
): Promise<DecryptedIntegration | null> {
  const result = await db
    .select()
    .from(integrations)
    .where(eq(integrations.id, integrationId))
    .limit(1);

  if (result.length === 0) {
    return null;
  }

  return {
    ...result[0],
    config: decryptConfig(result[0].config as string) as IntegrationConfig,
  };
}

/**
 * Create a new integration
 */
export async function createIntegration(
  userId: string,
  name: string,
  type: IntegrationType,
  config: IntegrationConfig
): Promise<DecryptedIntegration> {
  const encryptedConfig = encryptConfig(config);

  const [result] = await db
    .insert(integrations)
    .values({
      userId,
      name,
      type,
      config: encryptedConfig,
    })
    .returning();

  return {
    ...result,
    config,
  };
}

/**
 * Update an integration
 */
export async function updateIntegration(
  integrationId: string,
  userId: string,
  updates: {
    name?: string;
    config?: IntegrationConfig;
  }
): Promise<DecryptedIntegration | null> {
  const updateData: Partial<NewIntegration> = {
    updatedAt: new Date(),
  };

  if (updates.name !== undefined) {
    updateData.name = updates.name;
  }

  if (updates.config !== undefined) {
    // Guard anti re-cifrado cruzado: si el config guardado no se puede
    // descifrar con la clave de ESTE entorno, fue cifrado en otro entorno.
    // Sobrescribirlo acá lo haría ilegible donde fue creado. Los cambios de
    // solo nombre siguen permitidos.
    const [current] = await db
      .select({ config: integrations.config })
      .from(integrations)
      .where(
        and(eq(integrations.id, integrationId), eq(integrations.userId, userId))
      );
    if (current && !canDecryptHere(current.config as string)) {
      throw new IntegrationConfigUnreadableError();
    }
    updateData.config = encryptConfig(updates.config);
  }

  const [result] = await db
    .update(integrations)
    .set(updateData)
    .where(
      and(eq(integrations.id, integrationId), eq(integrations.userId, userId))
    )
    .returning();

  if (!result) {
    return null;
  }

  return {
    ...result,
    config: decryptConfig(result.config as string) as IntegrationConfig,
  };
}

/**
 * Delete an integration
 */
export async function deleteIntegration(
  integrationId: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .delete(integrations)
    .where(
      and(eq(integrations.id, integrationId), eq(integrations.userId, userId))
    )
    .returning();

  return result.length > 0;
}

/**
 * Workflow node structure for validation
 */
type WorkflowNodeForValidation = {
  data?: {
    config?: {
      integrationId?: string;
    };
  };
};

/**
 * Extract all integration IDs from workflow nodes
 */
export function extractIntegrationIds(
  nodes: WorkflowNodeForValidation[]
): string[] {
  const integrationIds: string[] = [];

  for (const node of nodes) {
    const integrationId = node.data?.config?.integrationId;
    if (integrationId && typeof integrationId === "string") {
      integrationIds.push(integrationId);
    }
  }

  return [...new Set(integrationIds)];
}

/**
 * Validate that all integration IDs in workflow nodes either:
 * 1. Belong to the specified user, or
 * 2. Don't exist (deleted integrations - stale references are allowed)
 *
 * This prevents users from accessing other users' credentials by embedding
 * foreign integration IDs in their workflows, while allowing workflows
 * with references to deleted integrations to still be saved.
 *
 * @returns Object with `valid` boolean and optional `invalidIds` array
 */
export async function validateWorkflowIntegrations(
  nodes: WorkflowNodeForValidation[],
  userId: string
): Promise<{ valid: boolean; invalidIds?: string[] }> {
  const integrationIds = extractIntegrationIds(nodes);

  if (integrationIds.length === 0) {
    return { valid: true };
  }

  // Query for ALL integrations with these IDs (regardless of user)
  // to check if any belong to other users
  const existingIntegrations = await db
    .select({ id: integrations.id, userId: integrations.userId })
    .from(integrations)
    .where(inArray(integrations.id, integrationIds));

  // Find integrations that exist but belong to a different user
  // (deleted integrations won't appear here, which is fine)
  const invalidIds = existingIntegrations
    .filter((i) => i.userId !== userId)
    .map((i) => i.id);

  if (invalidIds.length > 0) {
    return { valid: false, invalidIds };
  }

  return { valid: true };
}

/**
 * All integrations of one type, across users (system use: routing webhooks
 * that arrive on a single app-wide URL, like Mercado Libre's).
 */
export async function getIntegrationsByType(
  type: IntegrationType
): Promise<DecryptedIntegration[]> {
  const rows = await db
    .select()
    .from(integrations)
    .where(eq(integrations.type, type));
  return rows.map((row) => ({
    ...row,
    config: decryptConfig(row.config as string) as IntegrationConfig,
  }));
}
