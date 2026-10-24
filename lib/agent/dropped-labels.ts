// Labels of canvas nodes that a build result no longer contains (for the "Se quitaron pasos" notice).
// The empty starter trigger the app puts on a new canvas (config.placeholder) is not user content: it is never listed.
// A real node without a label is named "paso sin nombre"; an internal id is never shown. Never returns empty labels.
export function droppedLabels(before: { id: string; data?: unknown }[], keptIds: Set<string>): string[] {
  return before
    .filter((n) => !keptIds.has(n.id))
    .filter((n) => (n.data as { config?: { placeholder?: boolean } } | undefined)?.config?.placeholder !== true)
    .map((n) => (n.data as { label?: string } | undefined)?.label?.trim() || "paso sin nombre")
    .slice(0, 5);
}
