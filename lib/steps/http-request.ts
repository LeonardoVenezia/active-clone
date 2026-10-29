/**
 * Executable step function for HTTP Request action
 */
import "server-only";
import {companyVariableKeys} from "@/lib/company-variables";
import {withCompanyVariablesInsideStep} from "@/lib/company/step-variables";

import { getErrorMessage } from "../utils";
import { type StepInput, withStepLogging } from "./step-handler";

type HttpRequestResult =
  | { success: true; data: unknown; status: number }
  | { success: false; error: string; status?: number };

export type HttpRequestInput = StepInput & {
  endpoint: string;
  httpMethod: string;
  httpHeaders?: string;
  httpBody?: string;
  _companyTimeoutMs?: number;
};

function parseHeaders(httpHeaders?: string): Record<string, string> {
  if (!httpHeaders) {
    return {};
  }
  try {
    return JSON.parse(httpHeaders);
  } catch {
    return {};
  }
}

function parseBody(httpMethod: string, httpBody?: string): string | undefined {
  if (httpMethod === "GET" || !httpBody) {
    return;
  }
  try {
    const parsedBody = JSON.parse(httpBody);
    return Object.keys(parsedBody).length > 0
      ? JSON.stringify(parsedBody)
      : undefined;
  } catch {
    const trimmed = httpBody.trim();
    return trimmed && trimmed !== "{}" ? httpBody : undefined;
  }
}

function parseResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

/**
 * HTTP request logic
 */
async function httpRequest(
  input: HttpRequestInput
): Promise<HttpRequestResult> {
  if (!input.endpoint) {
    return {
      success: false,
      error: "HTTP request failed: URL is required",
    };
  }

  try {
    const response = await fetch(input.endpoint, {
      method: input.httpMethod,
      headers: parseHeaders(input.httpHeaders),
      body: parseBody(input.httpMethod, input.httpBody),
      ...(input._companyTimeoutMs?{signal:AbortSignal.timeout(input._companyTimeoutMs)}:{}),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      return {
        success: false,
        error: `HTTP request failed with status ${response.status}: ${errorText}`,
        status: response.status,
      };
    }

    const data = await parseResponse(response);
    return { success: true, data, status: response.status };
  } catch (error) {
    return {
      success: false,
      error: input._companyTimeoutMs ? "No se pudo confirmar el resultado remoto. No reintentar automáticamente. " + getErrorMessage(error) : `HTTP request failed: ${getErrorMessage(error)}`,
    };
  }
}

/**
 * HTTP Request Step
 * Makes an HTTP request to an endpoint
 */
// biome-ignore lint/suspicious/useAwait: workflow "use step" requires async
export async function httpRequestStep(
  input: HttpRequestInput
): Promise<HttpRequestResult> {
  "use step";
  if(!companyVariableKeys(input).length)return withStepLogging(input, () => httpRequest(input));
  if(!input._context?.executionId||!input._context.workflowId)throw Error("Company variable step context missing");
  // Parse JSON containers before substitution, then serialize afterwards so
  // quotes/backslashes in values cannot break JSON or inject another header.
  const jsonOrText=(value:string|undefined)=>{if(!value)return value;try{return JSON.parse(value)}catch{return value}};
  const config={endpoint:input.endpoint,httpMethod:input.httpMethod,httpHeaders:jsonOrText(input.httpHeaders),httpBody:jsonOrText(input.httpBody)};
  return withStepLogging(input, async()=> await withCompanyVariablesInsideStep({executionId:input._context!.executionId!,workflowId:input._context!.workflowId!,config},async resolved=>{
    const r=resolved as typeof config;const stringify=(v:unknown)=>typeof v==='string'?v:v===undefined?undefined:JSON.stringify(v);
    return httpRequest({endpoint:r.endpoint,httpMethod:r.httpMethod,httpHeaders:stringify(r.httpHeaders),httpBody:stringify(r.httpBody),_companyTimeoutMs:15000});
  },async()=>{}) as HttpRequestResult);

}
httpRequestStep.maxRetries = 0;
