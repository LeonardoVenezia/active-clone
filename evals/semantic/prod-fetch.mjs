// Convert a raw /api/ai/generate op-stream text into a snapshot {name,nodes,edges}.
import fs from "node:fs";
const [inPath, outPath] = process.argv.slice(2);
const text = fs.readFileSync(inPath, "utf8");
const nodes = [], edges = [];
let name = "", opCount = 0;
const other = [];
function applyOp(o) {
  if (o.op === "addNode" && o.node) nodes.push(o.node);
  else if (o.op === "addEdge" && o.edge) { if (!o.edge.id) o.edge.id = `e-${o.edge.source}-${o.edge.target}`; edges.push(o.edge); }
  else if (o.op === "removeNode" && o.nodeId) { const i = nodes.findIndex(n => n.id === o.nodeId); if (i >= 0) nodes.splice(i, 1); for (let i = edges.length - 1; i >= 0; i--) if (edges[i].source === o.nodeId || edges[i].target === o.nodeId) edges.splice(i, 1); }
  else if (o.op === "removeEdge" && o.edgeId) { const i = edges.findIndex(e => e.id === o.edgeId); if (i >= 0) edges.splice(i, 1); }
  else if (o.op === "updateNode" && o.nodeId && o.updates) {
    const n = nodes.find(x => x.id === o.nodeId); if (!n) return;
    const upd = o.updates.data;
    if (upd) n.data = { ...(n.data ?? {}), ...upd, config: { ...((n.data?.config) ?? {}), ...((upd.config) ?? {}) } };
    if (o.updates.position) n.position = o.updates.position;
  }
}
for (const line of text.split("\n")) {
  const t = line.trim(); if (!t) continue;
  try { const m = JSON.parse(t); if (m.type === "operation") { if (m.operation.op === "setName" && m.operation.name) name = m.operation.name; applyOp(m.operation); opCount++; } else other.push(JSON.stringify(m).slice(0, 200)); }
  catch { other.push("UNPARSED " + t.slice(0, 120)); }
}
fs.writeFileSync(outPath, JSON.stringify({ name: name || "prod-ab", nodes, edges }, null, 2));
console.log(JSON.stringify({ opCount, nodes: nodes.length, edges: edges.length, name, other: other.slice(0, 6) }, null, 2));
