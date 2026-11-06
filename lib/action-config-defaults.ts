// Defaults apply to a deliberate action selection, never a read/reload.
export function withActionDefaults(
  config: Record<string, unknown>,
  actionType: string
) {
  return {
    ...config,
    actionType,
    // Apply the common safe default only on deliberate selection, never reload.
    onError: config.onError === "continue" ? "continue" : "stop",
    ...(actionType === "Datos" && !config.operation
      ? { operation: "save" }
      : {}),
  };
}
