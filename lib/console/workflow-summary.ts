// Keep the console's manual-trigger rule aligned with the builder/engine default.
export function isManualConsoleWorkflow(nodes: unknown): boolean {
  if (!Array.isArray(nodes)) return false;
  const trigger = nodes.find((n) => n?.data?.type === "trigger");
  if (!trigger) return false;
  const type = trigger.data?.config?.triggerType;
  return type === undefined || type === "" || type === "Manual";
}
