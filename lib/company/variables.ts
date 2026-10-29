import "server-only";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { companyVariables } from "@/lib/console/schema";
import { encrypt, decrypt } from "@/lib/db/integrations";
import { validateVariableKey } from "@/lib/company-variables";
// Inert storage contract: no public endpoint or runtime resolver is wired until
// variable writer/reader policy is decided. All values encrypted at rest, including
// nonsecret IDs, but only secret values are write-only in the eventual console UI.
export async function storeCompanyVariable(input: {
  organizationId: string;
  key: string;
  secret: boolean;
  value: string;
  actorId: string;
}) {
  if (process.env.COMPANY_VARIABLES_STORAGE_ENABLED !== "true")
    throw Error("Company variables disabled");
  if (
    !input.organizationId ||
    !input.actorId ||
    !validateVariableKey(input.key) ||
    typeof input.secret !== "boolean" ||
    !input.value ||
    input.value.length > 8192
  )
    throw Error("Invalid company variable");
  await db
    .insert(companyVariables)
    .values({
      organizationId: input.organizationId,
      key: input.key,
      secret: input.secret,
      ciphertext: encrypt(input.value),
      updatedBy: input.actorId,
    })
    .onConflictDoUpdate({
      target: [companyVariables.organizationId, companyVariables.key],
      set: {
        secret: input.secret,
        ciphertext: encrypt(input.value),
        updatedBy: input.actorId,
        updatedAt: new Date(),
      },
    });
}
export async function variableMetadata(organizationId: string) {
  if (process.env.COMPANY_VARIABLES_STORAGE_ENABLED !== "true")
    throw Error("Company variables disabled");
  return db
    .select({
      key: companyVariables.key,
      secret: companyVariables.secret,
      updatedAt: companyVariables.updatedAt,
    })
    .from(companyVariables)
    .where(eq(companyVariables.organizationId, organizationId));
}
// Server-only value retrieval requires exact tenant+key. Never return this via UI.
export async function readRuntimeVariable(organizationId: string, key: string) {
  if (process.env.COMPANY_VARIABLES_RUNTIME_ENABLED !== "true")
    throw Error("Company variable runtime disabled");
  const [row] = await db
    .select()
    .from(companyVariables)
    .where(
      and(
        eq(companyVariables.organizationId, organizationId),
        eq(companyVariables.key, key),
      ),
    );
  if (!row) throw Error("Company variable missing");
  return decrypt(row.ciphertext);
}
