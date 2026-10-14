import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { hasZipnovaCredentials, NOT_CONFIGURED_ERROR, zipnovaRequest } from "../api";
import type { ZipnovaCredentials } from "../credentials";

type Option = {
  selectable?: boolean;
  carrier?: { id?: number; name?: string };
  logistic_type?: string;
  service_type?: { code?: string; name?: string };
  delivery_time?: { min?: number; max?: number };
  amounts?: { price?: number; price_incl_tax?: number };
};
type Result =
  | { success: true; count: number; options: Option[]; cheapest: Option | null }
  | { success: false; error: string };
type Input = StepInput & {
  city: string;
  state: string;
  zipcode: string;
  declaredValue: string;
  weightGrams: string;
  heightCm: string;
  widthCm: string;
  lengthCm: string;
  sortBy?: string;
  integrationId?: string;
};

async function stepHandler(input: Input, credentials: ZipnovaCredentials): Promise<Result> {
  if (!hasZipnovaCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  const n = (value: unknown) => Number(value);
  const pkg = { weight: n(input.weightGrams), height: n(input.heightCm), width: n(input.widthCm), length: n(input.lengthCm) };
  if (!input.city || !input.state || !input.zipcode || Object.values(pkg).some((v) => !Number.isFinite(v) || v <= 0)) {
    return { success: false, error: "City, state, zip code, weight (g) and height/width/length (cm) are required" };
  }
  const sortBy = input.sortBy?.toString().trim().toLowerCase();
  try {
    const data = (await zipnovaRequest(credentials, "POST", "/shipments/quote", {
      account_id: n(credentials.ZIPNOVA_ACCOUNT_ID),
      source: "active-clone",
      destination: { city: input.city.toString().trim(), state: input.state.toString().trim(), zipcode: input.zipcode.toString().trim() },
      declared_value: Number.isFinite(n(input.declaredValue)) ? n(input.declaredValue) : 0,
      packages: [pkg],
      ...(sortBy === "price" || sortBy === "rating" || sortBy === "time" ? { sort_by: sortBy } : {}),
    })) as { all_results?: Record<string, Option> | Option[] };
    const all = data.all_results ?? {};
    const options = (Array.isArray(all) ? all : Object.values(all)).filter((o) => o.selectable !== false);
    const sorted = [...options].sort((a, b) => (a.amounts?.price ?? Infinity) - (b.amounts?.price ?? Infinity));
    return { success: true, count: options.length, options, cheapest: sorted[0] ?? null };
  } catch (error) {
    return { success: false, error: `Failed to get rates: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function getRatesStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
getRatesStep.maxRetries = 0;

export const _integrationType = "zipnova";
