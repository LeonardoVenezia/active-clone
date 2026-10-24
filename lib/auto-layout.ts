/**
 * Deterministic auto-layout for generated workflows (dagre, left-to-right).
 * Node positions come from the graph structure, not from the model's guesses.
 */
import dagre from "@dagrejs/dagre";

const NODE_W = 192; // rendered card is h-48 w-48 (192px)
const NODE_H = 192;

export function layoutPositions(
  nodes: Array<{ id: string }>,
  edges: Array<{ source: string; target: string }>
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", ranksep: 150, nodesep: 60, marginx: 90, marginy: 110 });
  g.setDefaultEdgeLabel(() => ({}));
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) {
    if (ids.has(e.source) && ids.has(e.target) && e.source !== e.target) g.setEdge(e.source, e.target);
  }
  dagre.layout(g);
  const out = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const p = g.node(n.id);
    // dagre returns node centers; React Flow positions are top-left corners.
    out.set(n.id, { x: Math.round(p.x - NODE_W / 2), y: Math.round(p.y - NODE_H / 2) });
  }
  return out;
}
