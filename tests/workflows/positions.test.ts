// Position safety net: loading never crashes, saving never drops positions.
import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultPosition,
  ensureNodePositions,
} from "../../lib/workflows/positions";

test("preserva posiciones válidas y completa las ausentes", () => {
  const nodes = [
    { id: "a", position: { x: 10, y: 20 } },
    { id: "b" },
    { id: "c", position: undefined },
    { id: "d", position: { x: "10" } },
    { id: "e", position: null },
  ] as never[];
  const out = ensureNodePositions(nodes) as Array<{ id: string; position: { x: number; y: number } }>;
  assert.deepEqual(out[0].position, { x: 10, y: 20 }); // intacta
  for (const n of out) {
    assert.equal(typeof n.position.x, "number");
    assert.equal(typeof n.position.y, "number");
  }
  // determinista por índice
  assert.deepEqual(out[1].position, defaultPosition(1));
  assert.deepEqual(out[4].position, defaultPosition(4));
  // no muta la entrada
  assert.equal((nodes[1] as { position?: unknown }).position, undefined);
});

test("defaultPosition apila verticalmente", () => {
  assert.deepEqual(defaultPosition(0), { x: 250, y: 80 });
  assert.deepEqual(defaultPosition(3), { x: 250, y: 80 + 3 * 180 });
});
