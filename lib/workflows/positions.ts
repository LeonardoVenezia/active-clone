/**
 * Position safety net for workflow nodes. Pure, no I/O.
 *
 * A workflow node without a valid position crashes the React Flow canvas
 * (it reads position.x). This helper keeps existing positions untouched and
 * assigns a deterministic stacked layout to nodes that are missing one, so
 * loading never crashes and saving never drops positions.
 */

export type NodeWithMaybePosition = {
  id?: unknown;
  position?: unknown;
  [key: string]: unknown;
};

function isValidPosition(p: unknown): p is { x: number; y: number } {
  return (
    !!p &&
    typeof p === "object" &&
    typeof (p as { x?: unknown }).x === "number" &&
    Number.isFinite((p as { x: number }).x) &&
    typeof (p as { y?: unknown }).y === "number" &&
    Number.isFinite((p as { y: number }).y)
  );
}

export function defaultPosition(index: number): { x: number; y: number } {
  return { x: 250, y: 80 + index * 180 };
}

// Devuelve los nodos con position válida garantizada. No muta la entrada.
export function ensureNodePositions<T extends NodeWithMaybePosition>(nodes: T[]): T[] {
  return nodes.map((node, index) => {
    if (isValidPosition(node.position)) return node;
    return { ...node, position: defaultPosition(index) };
  });
}
