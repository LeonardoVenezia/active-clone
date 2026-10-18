import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import type { ArcaCredentials } from "../credentials";
import { createEngine, hasArcaCredentials } from "../engine";

const NOT_CONFIGURED_ERROR =
  "ARCA CUIT, certificate or private key is not configured. Please add them in Project Integrations.";

type Result =
  | { success: true; found: boolean; voucher: Record<string, unknown> | null }
  | { success: false; error: string };

type Input = StepInput & {
  salesPoint?: string;
  voucherType?: string;
  number?: string;
  integrationId?: string;
};

async function stepHandler(input: Input, credentials: ArcaCredentials): Promise<Result> {
  if (!hasArcaCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  const salesPoint = Number.parseInt(input.salesPoint?.toString() ?? "", 10);
  const voucherType = Number.parseInt(input.voucherType?.toString() ?? "", 10);
  const number = Number.parseInt(input.number?.toString() ?? "", 10);
  if (!(salesPoint > 0) || !(voucherType > 0) || !(number > 0)) {
    return {
      success: false,
      error: "Sales point, voucher type and voucher number are required (numbers, e.g. 3, 11, 42)",
    };
  }
  try {
    const engine = createEngine(credentials);
    const voucher = await engine.lookup({ salesPoint, voucherType, number });
    if (!voucher) {
      return { success: true, found: false, voucher: null };
    }
    return {
      success: true,
      found: true,
      voucher: JSON.parse(JSON.stringify(voucher)) as Record<string, unknown>,
    };
  } catch (error) {
    return { success: false, error: `ARCA voucher lookup failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function getVoucherStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
getVoucherStep.maxRetries = 0;

export const _integrationType = "arca";
