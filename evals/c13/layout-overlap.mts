// Checks that auto-layout never overlaps rendered node cards (192x192) for graphs with sibling branches.
import fs from "node:fs";
const { layoutPositions } = await import("../../lib/auto-layout");
let bad = 0;
for (const f of process.argv.slice(2)) {
  const g = JSON.parse(fs.readFileSync(f, "utf8"));
  const pos = layoutPositions(g.nodes, g.edges); const ids = [...pos.keys()]; let ov = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = pos.get(ids[i])!, b = pos.get(ids[j])!;
    if (Math.abs(a.x - b.x) < 192 && Math.abs(a.y - b.y) < 192) ov++;
  }
  console.log(f.split("/").pop(), "nodes", ids.length, "overlaps", ov); if (ov) bad++;
}
process.exit(bad ? 1 : 0);
