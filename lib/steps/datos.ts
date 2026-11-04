/**
 * Executable step for the Datos action (prototype, local only).
 * The organization comes ONLY from the executor-injected _dataOrganizationId
 * (resolved on the server from the workflow's organization scope). Nothing in
 * the node config can choose or override it.
 */
import "server-only";

import { getStepMetadata } from "workflow";

import { datosAdd, datosApplyTogether, datosDefineFields, datosList, datosRead, datosSave, datosSaveIfAbsent, datosUpdateIfMatches } from "../datos/core";
import { pgDatosRepo } from "../datos/repo";
import { type StepInput, withStepLogging } from "./step-handler";

export type DatosInput = StepInput & {
  operation?: string;
  collection?: string;
  key?: string;
  value?: unknown;
  limit?: unknown;
  fields?: unknown;
  expected?: unknown;
  operations?: unknown;
  field?: unknown;
  amount?: unknown;
  startAtZero?: unknown;
  min?: unknown;
  max?: unknown;
  _dataOrganizationId?: string;
  _dataCanDefineFields?: boolean;
};

const NO_ID = "No se pudo identificar esta operación, así que no se hizo nada (para evitar repetirla en un reintento).";
/** Stable id of this step call: the SDK gives the same stepId on every retry/replay of it, unique per call. */
function currentStepId(): string | undefined {
  try { const id = getStepMetadata().stepId; return typeof id === "string" && id.length > 0 ? id : undefined; } catch { return undefined; }
}

async function stepHandler(input: DatosInput, stepId?: string) {
  const org = input._dataOrganizationId;
  const collection = input.collection;
  try {
    switch (input.operation) {
      case "save": return await datosSave(pgDatosRepo, org, { collection, key: input.key, value: input.value });
      case "saveIfAbsent":
        if (!stepId) return { success: false as const, error: NO_ID };
        return await datosSaveIfAbsent(pgDatosRepo, org, { collection, key: input.key, value: input.value, operationId: stepId });
      case "updateIfMatches":
        if (!stepId) return { success: false as const, error: NO_ID };
        return await datosUpdateIfMatches(pgDatosRepo, org, { collection, key: input.key, expected: input.expected, value: input.value, operationId: stepId });
      case "add":
        // Fail closed: without a stable operation identity a retry could add twice.
        if (!stepId) return { success: false as const, error: NO_ID };
        return await datosAdd(pgDatosRepo, org, { collection, key: input.key, field: input.field, amount: input.amount, startAtZero: input.startAtZero, min: input.min, max: input.max, operationId: stepId });
      case "applyTogether":
        // Fail closed: without a stable operation identity a retry could apply the list twice.
        if (!stepId) return { success: false as const, error: NO_ID };
        return await datosApplyTogether(pgDatosRepo, org, { operations: input.operations, operationId: stepId });
      case "read": return await datosRead(pgDatosRepo, org, { collection, key: input.key });
      case "list": return await datosList(pgDatosRepo, org, { collection, limit: input.limit });
      case "fields":
        // Server-decided by the executor (owner/admin of the organization); never from the node config.
        if (input._dataCanDefineFields !== true) return { success: false as const, error: "Solo el Dueño o un Admin de la empresa puede definir los campos de una colección." };
        return await datosDefineFields(pgDatosRepo, org, { collection, fields: input.fields });
      default: return { success: false as const, error: "Elegí una operación: guardar, leer, listar o definir campos." };
    }
  } catch {
    // Never surface SQL or parameters (they can include the organization id).
    return { success: false as const, error: "No pudimos acceder a los datos. Probá de nuevo." };
  }
}

export async function datosStep(input: DatosInput) {
  "use step";

  const stepId = currentStepId();
  return withStepLogging(input, () => stepHandler(input, stepId));
}
datosStep.maxRetries = 0;
