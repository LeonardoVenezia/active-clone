/** Shared by the editor and executor, never implemented separately per plugin. */
export type NodeErrorPolicy = "stop" | "continue";

export function explicitErrorPolicy(config?: Record<string, unknown>): NodeErrorPolicy | undefined {
  return config?.onError === "stop" || config?.onError === "continue" ? config.onError : undefined;
}

export function canContinueAfterError(config?: Record<string, unknown>): boolean {
  // A rejected approval is a refusal, not permission to run the protected steps.
  return config?.actionType !== "Approval" && explicitErrorPolicy(config) === "continue";
}

export function failedStepOutput(error: string) {
  return { success: false as const, error };
}
