import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import type { ArcaCredentials } from "../credentials";
import { createEngine, hasArcaCredentials } from "../engine";

const NOT_CONFIGURED_ERROR =
  "ARCA CUIT, certificate or private key is not configured. Please add them in Project Integrations.";

type Result =
  | { success: true; outcome: "authorized" | "rejected" | "indeterminate" | "conflict"; cae: string; caeExpiry: string; voucherType: string; salesPoint: string; number: string; date: string; qr: string; issues: string; detail: Record<string, unknown> }
  | { success: false; error: string };

type Input = StepInput & {
  issuer: string;
  salesPoint: string;
  customerCondition: string;
  customerTaxId?: string;
  amount: string;
  description?: string;
  idempotencyKey: string;
  integrationId?: string;
};

// Issues ONE invoice with one line. `amount` is the total in pesos; the SDK
// works in minor units (centavos). The idempotency key (for example the sale
// ID) is mandatory: ARCA has no idempotency, so a retry with the same key
// looks up the reserved number instead of issuing a second invoice.
// Fiscal outcomes are RETURNED, never thrown: authorized, rejected,
// indeterminate (do not retry blindly, reconcile) or conflict.
async function stepHandler(input: Input, credentials: ArcaCredentials): Promise<Result> {
  if (!hasArcaCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  const issuer = input.issuer === "responsable_inscripto" ? "responsable_inscripto" : "monotributo";
  const salesPoint = Number(input.salesPoint);
  const pesos = Number(input.amount);
  const key = input.idempotencyKey?.toString().trim();
  if (!(Number.isInteger(salesPoint) && salesPoint > 0)) {
    return { success: false, error: "Sales point must be a whole number greater than 0" };
  }
  if (!(pesos > 0)) {
    return { success: false, error: "Amount must be greater than 0 (in pesos)" };
  }
  if (!key) {
    return { success: false, error: "Idempotency key is required (use a stable ID of the sale)" };
  }
  const condition = input.customerCondition?.toString().trim() || "consumidor_final";
  const customerTaxId = input.customerTaxId?.toString().replace(/\D/g, "");
  if (condition !== "consumidor_final" && !customerTaxId) {
    return { success: false, error: "Customer tax ID is required unless the customer is consumidor_final" };
  }
  try {
    const engine = createEngine(credentials);
    const outcome = await engine.issue(
      {
        issuer,
        salesPoint,
        to: (condition === "consumidor_final"
          ? { condition: "consumidor_final", ...(customerTaxId ? { cuit: customerTaxId } : {}) }
          : { condition, cuit: customerTaxId }) as never,
        items: [{ amount: Math.round(pesos * 100), ...(input.description ? { description: input.description } : {}) }],
      } as never,
      { idempotencyKey: key }
    );
    const base = { success: true as const, cae: "", caeExpiry: "", voucherType: "", salesPoint: String(salesPoint), number: "", date: "", qr: "", issues: "" };
    const detail = JSON.parse(JSON.stringify(outcome)) as Record<string, unknown>;
    if (outcome.kind === "authorized") {
      return {
        ...base,
        outcome: "authorized",
        cae: outcome.voucher.cae,
        caeExpiry: outcome.voucher.caeExpiry,
        voucherType: String(outcome.voucher.voucherType),
        number: String(outcome.voucher.number),
        date: outcome.voucher.date,
        qr: outcome.voucher.qr ?? "",
        detail,
      };
    }
    return {
      ...base,
      outcome: outcome.kind as "rejected" | "indeterminate" | "conflict",
      issues: outcome.kind === "rejected" ? JSON.stringify(outcome.issues) : "",
      detail,
    };
  } catch (error) {
    return { success: false, error: `ARCA issue failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function issueInvoiceStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
issueInvoiceStep.maxRetries = 0;

export const _integrationType = "arca";
