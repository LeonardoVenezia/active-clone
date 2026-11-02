/**
 * Executable step for the Datos action (prototype, local only).
 * The organization comes ONLY from the executor-injected _dataOrganizationId
 * (resolved on the server from the workflow's organization scope). Nothing in
 * the node config can choose or override it.
 */
import "server-only";

import { datosList, datosRead, datosSave } from "../datos/core";
import { pgDatosRepo } from "../datos/repo";
import { type StepInput, withStepLogging } from "./step-handler";

export type DatosInput = StepInput & {
  operation?: string;
  collection?: string;
  key?: string;
  value?: unknown;
  limit?: unknown;
  _dataOrganizationId?: string;
};

async function stepHandler(input: DatosInput) {
  const org = input._dataOrganizationId;
  const collection = input.collection;
  try {
    switch (input.operation) {
      case "save": return await datosSave(pgDatosRepo, org, { collection, key: input.key, value: input.value });
      case "read": return await datosRead(pgDatosRepo, org, { collection, key: input.key });
      case "list": return await datosList(pgDatosRepo, org, { collection, limit: input.limit });
      default: return { success: false as const, error: "Elegí una operación: guardar, leer o listar." };
    }
  } catch {
    // Never surface SQL or parameters (they can include the organization id).
    return { success: false as const, error: "No pudimos acceder a los datos. Probá de nuevo." };
  }
}

export async function datosStep(input: DatosInput) {
  "use step";

  return withStepLogging(input, () => stepHandler(input));
}
datosStep.maxRetries = 0;
