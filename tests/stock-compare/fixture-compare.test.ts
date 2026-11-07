// Fixture-driven comparison ML stock-snapshot vs Tiendanube list-products.
// Validates the shipped compare logic (lib/stock/compare-shared.ts) against
// documented payload shapes and the equivalence-table design. No real APIs.
import test from "node:test";
import assert from "node:assert/strict";
import { mapItemBody } from "../../plugins/mercadolibre/steps/stock-snapshot-shared";
import {
  compareStock,
  type StockEquivalence,
  type TnProductShape,
} from "../../lib/stock/compare-shared";

// ML documented payload: item with variations carrying SELLER_SKU
// (developers.mercadolibre.com.ar variations doc), plus an item-level SKU row,
// one variation without SKU and a duplicated SKU across two variations.
const mlFixture = [
  mapItemBody({
    id: "MLA1001", title: "Remera básica", status: "active", available_quantity: 0,
    variations: [
      { id: 11, available_quantity: 5, attributes: [{ id: "SELLER_SKU", value_name: "REM-NE-M" }], attribute_combinations: [{ name: "Color", value_name: "Negro" }, { name: "Talle", value_name: "M" }] },
      { id: 12, available_quantity: 2, attributes: [{ id: "SELLER_SKU", value_name: "REM-NE-L" }], attribute_combinations: [{ name: "Color", value_name: "Negro" }, { name: "Talle", value_name: "L" }] },
      { id: 13, available_quantity: 7, attributes: [], attribute_combinations: [{ name: "Color", value_name: "Blanco" }, { name: "Talle", value_name: "M" }] },
    ],
  }),
  mapItemBody({
    id: "MLA1002", title: "Gorra trucker", status: "active", available_quantity: 9,
    attributes: [{ id: "SELLER_SKU", value_name: "GOR-TRU" }],
  }),
  mapItemBody({
    id: "MLA1003", title: "Jean slim", status: "active", available_quantity: 4,
    variations: [
      { id: 31, available_quantity: 1, attributes: [{ id: "SELLER_SKU", value_name: "JEA-DUP" }], attribute_combinations: [{ name: "Talle", value_name: "40" }] },
      { id: 32, available_quantity: 3, attributes: [{ id: "SELLER_SKU", value_name: "JEA-DUP" }], attribute_combinations: [{ name: "Talle", value_name: "42" }] },
    ],
  }),
  mapItemBody({
    id: "MLA1004", title: "Buzo canguro", status: "active", available_quantity: 6,
    attributes: [{ id: "SELLER_SKU", value_name: "BUZ-CAN" }],
  }),
];

// TN list-products output shape (plugins/tiendanube/steps/list-products.ts):
// one direct match, one renamed sku (equivalence), one TN-only product, one
// sku duplicated on two variants, one product whose equivalence is missing.
const tnFixture: TnProductShape[] = [
  { id: 501, name: "Remera básica", variants: [
    { id: 5011, sku: "REM-NE-M", stock: 5 },
    { id: 5012, sku: "REM-NE-L", stock: 0 },
  ]},
  { id: 502, name: "Gorra trucker", variants: [
    { id: 5021, sku: "CAP-TRUCKER", stock: 9 },
  ]},
  { id: 503, name: "Medias pack x3", variants: [
    { id: 5031, sku: "MED-X3", stock: 20 },
  ]},
  { id: 504, name: "Camisa lino", variants: [
    { id: 5041, sku: "CAM-LIN", stock: 3 },
    { id: 5042, sku: "CAM-LIN", stock: 8 },
  ]},
];

const equivalences: StockEquivalence[] = [
  { mlSku: "GOR-TRU", tnSku: "CAP-TRUCKER" },
  // Ambiguous: two ML skus mapped to the same TN sku.
  { mlSku: "BUZ-CAN", tnSku: "MED-X3" },
  { mlSku: "OTRO-ML", tnSku: "MED-X3" },
  // Points nowhere in TN.
  { mlSku: "REM-NE-L", tnSku: "REM-L-OLD" },
];

test("fixture comparison separates every non-equal case from ok", () => {
  const { resumen, filas } = compareStock(mlFixture, tnFixture, equivalences);
  const byEstado = (s: keyof typeof resumen) => filas.filter((r) => r.estado === s);

  // ok: direct match plus the clean equivalence — nothing ambiguous.
  assert.equal(resumen.ok, 2);
  assert.equal(byEstado("ok")[0].mlSku, "REM-NE-M");

  // The equivalence for REM-NE-L points to a TN sku that does not exist:
  // reported, never matched by falling back to the direct REM-NE-L row.
  const sinDestino = byEstado("equivalencia_sin_destino");
  assert.equal(sinDestino.length, 1);
  assert.equal(sinDestino[0].mlSku, "REM-NE-L");
  assert.equal(sinDestino[0].tnSku, "REM-L-OLD");

  // Two ML skus mapped to the same TN sku: ambiguous, not matched.
  assert.equal(resumen.equivalencia_ambigua, 1);
  assert.equal(byEstado("equivalencia_ambigua")[0].mlSku, "BUZ-CAN");

  // Duplicated ML sku: both occurrences flagged, no stock claim.
  assert.equal(resumen.ml_sku_duplicado, 2);

  // Missing SELLER_SKU on a variation.
  assert.equal(resumen.sin_sku_ml, 1);

  // Equivalence mapping: GOR-TRU ↔ CAP-TRUCKER, same stock.
  const viaEq = filas.find((r) => r.via === "equivalencia" && r.estado === "ok");
  assert.ok(viaEq);
  assert.deepEqual([viaEq.mlSku, viaEq.tnSku], ["GOR-TRU", "CAP-TRUCKER"]);

  // TN rows never consumed: the ambiguous-equivalence target and the TN row
  // left unmatched because its ML counterpart had a dead equivalence.
  assert.equal(resumen.solo_en_tn, 2);
  assert.deepEqual(byEstado("solo_en_tn").map((r) => r.tnSku).sort(), ["MED-X3", "REM-NE-L"]);

  // Duplicated TN sku: reported as ambiguous, not silently matched or "solo".
  assert.equal(resumen.tn_sku_duplicado, 1);
  assert.equal(byEstado("tn_sku_duplicado")[0].tnSku, "CAM-LIN");

  // No row may be counted twice.
  assert.equal(
    filas.length,
    Object.entries(resumen)
      .filter(([k]) => k !== "mlVacio" && k !== "tnVacio")
      .reduce((acc, [, v]) => acc + (v as number), 0)
  );

  // Visible difference report (evidence for the milestone):
  console.log("=== REPORTE DE DIFERENCIAS (fixture) ===");
  for (const r of filas) {
    console.log(
      [r.estado.padEnd(24), (r.mlSku ?? "-").padEnd(9), (r.tnSku ?? "-").padEnd(11),
       `ml=${r.mlStock ?? "-"}`, `tn=${r.tnStock ?? "-"}`, r.via ?? "-"].join(" | ")
    );
  }
});

test("empty inputs are reported as empty, not as ok", () => {
  const { resumen, filas } = compareStock([], [], []);
  assert.equal(resumen.mlVacio, true);
  assert.equal(resumen.tnVacio, true);
  assert.equal(resumen.ok, 0);
  assert.equal(filas.length, 0);
});

test("difference in stock is diferente, never ok", () => {
  const ml = [{ id: "MLA1", title: "X", availableQuantity: 2, sku: "A-1", variations: [] }];
  const tn = [{ id: 1, name: "X", variants: [{ id: 1, sku: "A-1", stock: 0 }] }];
  const { resumen } = compareStock(ml, tn, []);
  assert.equal(resumen.ok, 0);
  assert.equal(resumen.diferente, 1);
});
