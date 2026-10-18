import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import type { ArcaCredentials } from "../credentials";
import { createEngine, hasArcaCredentials } from "../engine";

const NOT_CONFIGURED_ERROR =
  "ARCA CUIT, certificate or private key is not configured. Please add them in Project Integrations.";

type SalesPoint = { number: number; blocked: boolean; deactivatedAt?: string };

type Result =
  | { success: true; salesPoints: SalesPoint[]; count: number }
  | { success: false; error: string };

type Input = StepInput & { integrationId?: string };

async function stepHandler(_input: Input, credentials: ArcaCredentials): Promise<Result> {
  if (!hasArcaCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  try {
    const engine = createEngine(credentials);
    const points = (await engine.wsfe.getSalesPoints()) as SalesPoint[];
    return {
      success: true,
      salesPoints: points.map((p) => ({
        number: p.number,
        blocked: p.blocked,
        deactivatedAt: p.deactivatedAt,
      })),
      count: points.length,
    };
  } catch (error) {
    return { success: false, error: `ARCA sales points lookup failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function listSalesPointsStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
listSalesPointsStep.maxRetries = 0;

export const _integrationType = "arca";
