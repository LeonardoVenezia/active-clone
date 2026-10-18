import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { enviopackGet, enviopackGetBytes, enviopackPost, hasEnviopackCredentials, NOT_CONFIGURED_ERROR } from "../api";
import type { EnviopackCredentials } from "../credentials";

type Result = { success: true; branches: unknown } | { success: false; error: string };
type Input = StepInput & { carrierId?: string; localityId?: string; integrationId?: string };

async function stepHandler(input: Input, credentials: EnviopackCredentials): Promise<Result> {
  if (!hasEnviopackCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  try {
    const branches = await enviopackGet(credentials, "/sucursales", {
      id_correo: input.carrierId,
      id_localidad: input.localityId,
    });
    return { success: true, branches };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function enviopackListBranches(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
enviopackListBranches.maxRetries = 0;

export const _integrationType = "enviopack";
