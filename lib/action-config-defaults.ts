// Defaults apply to a deliberate action selection, never a read/reload.
export function withActionDefaults(
  config: Record<string, unknown>,
  actionType: string
) {
  return {
    ...config,
    actionType,
    ...(actionType === "Datos" && !config.operation
      ? { operation: "save" }
      : {}),
  };
}
