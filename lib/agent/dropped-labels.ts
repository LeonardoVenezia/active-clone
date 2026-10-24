// Labels of canvas nodes that a build result no longer contains (for the "Se quitaron pasos" notice). Never returns empty labels.
export function droppedLabels(before: { id: string; data?: unknown }[], keptIds: Set<string>): string[] {
  return before
    .filter((n) => !keptIds.has(n.id))
    .map((n) => String((n.data as { label?: string } | undefined)?.label?.trim() || n.id || "paso"))
    .slice(0, 5);
}
