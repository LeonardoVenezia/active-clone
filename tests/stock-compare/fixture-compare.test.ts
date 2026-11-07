// Fixture-driven comparison ML stock-snapshot vs Tiendanube list-products.
// Prep for card 11 (stock real): validates the comparison logic and the
// equivalence-table design against documented payload shapes, no real APIs.
import test from "node:test";
import assert from "node:assert/strict";
import { mapItemBody, type StockSnapshotItem } from "../../plugins/mercadolibre/steps/stock-snapshot-shared";

// ---- Shapes (mirroring plugins/tiendanube/steps/list-products.ts output) ----
type TnVariant = { id: number; sku: string; price: string; stock: number | null };
type TnProduct = { id: number; name: string; totalStock: number | null; variants: TnVariant[] };

// Equivalence row as it would live in a Datos collection "equivalencias_sku"
// per company (Owner/Admin-editable): maps an ML SELLER_SKU to a TN variant sku.
type Equivalence = { mlSku: string; tnSku: string };

type DiffRow = {
  mlSku: string | null;
  tnSku: string | null;
  via: "equivalencia" | "sku-directo" | null;
  mlStock: number | null;
  tnStock: number | null;
  estado: "ok" | "diferente" | "solo_en_ml" | "solo_en_tn" | "sin_sku_ml";
};

function compareStock(mlItems: StockSnapshotItem[], tnProducts: TnProduct[], equivalences: Equivalence[]): DiffRow[] {
  const tnBySku = new Map<string, { sku: string; stock: number | null }>();
  for (const p of tnProducts) for (const v of p.variants) tnBySku.set(v.sku, { sku: v.sku, stock: v.stock });
  const eqByMl = new Map(equivalences.map((e) => [e.mlSku, e.tnSku]));
  const usedTn = new Set<string>();
  const rows: DiffRow[] = [];

  const emit = (mlSku: string | null, mlStock: number) => {
    if (!mlSku) {
      rows.push({ mlSku: null, tnSku: null, via: null, mlStock, tnStock: null, estado: "sin_sku_ml" });
      return;
    }
    const eqTn = eqByMl.get(mlSku);
    const tnSku = eqTn ?? (tnBySku.has(mlSku) ? mlSku : null);
    if (!tnSku) {
      rows.push({ mlSku, tnSku: null, via: null, mlStock, tnStock: null, estado: "solo_en_ml" });
      return;
    }
    usedTn.add(tnSku);
    const tn = tnBySku.get(tnSku)!;
    rows.push({
      mlSku, tnSku, via: eqTn ? "equivalencia" : "sku-directo",
      mlStock, tnStock: tn.stock,
      estado: tn.stock === mlStock ? "ok" : "diferente",
    });
  };

  for (const item of mlItems) {
    if (item.variations.length === 0) emit(item.sku, item.availableQuantity);
    for (const v of item.variations) emit(v.sku, v.availableQuantity);
  }
  for (const [sku, tn] of tnBySku) {
    if (!usedTn.has(sku)) rows.push({ mlSku: null, tnSku: sku, via: null, mlStock: null, tnStock: tn.stock, estado: "solo_en_tn" });
  }
  return rows;
}

// ---- Fixtures ----
// ML documented payload: item with 2 variations, SELLER_SKU per variation
// (developers.mercadolibre.com.ar variations doc), plus an item-level SKU row.
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
];

// TN list-products output shape (same products, one renamed sku, one TN-only).
const tnFixture: TnProduct[] = [
  { id: 501, name: "Remera básica", totalStock: 7, variants: [
    { id: 5011, sku: "REM-NE-M", price: "12000", stock: 5 },
    { id: 5012, sku: "REM-NE-L", price: "12000", stock: 0 },
  ]},
  { id: 502, name: "Gorra trucker", totalStock: 9, variants: [
    { id: 5021, sku: "CAP-TRUCKER", price: "8000", stock: 9 },
  ]},
  { id: 503, name: "Medias pack x3", totalStock: 20, variants: [
    { id: 5031, sku: "MED-X3", price: "4500", stock: 20 },
  ]},
];

const equivalences: Equivalence[] = [{ mlSku: "GOR-TRU", tnSku: "CAP-TRUCKER" }];

test("fixture comparison covers all cases", () => {
  const rows = compareStock(mlFixture, tnFixture, equivalences);
  const byEstado = (s: DiffRow["estado"]) => rows.filter((r) => r.estado === s);

  assert.equal(byEstado("ok").length, 2);
  assert.equal(byEstado("ok")[0].mlSku, "REM-NE-M");

  const diff = byEstado("diferente");
  assert.equal(diff.length, 1);
  assert.equal(diff[0].mlSku, "REM-NE-L");
  assert.deepEqual([diff[0].mlStock, diff[0].tnStock], [2, 0]);

  const eq = rows.find((r) => r.via === "equivalencia");
  assert.ok(eq);
  assert.deepEqual([eq.mlSku, eq.tnSku], ["GOR-TRU", "CAP-TRUCKER"]);
  assert.equal(eq.estado, "ok");

  assert.equal(byEstado("sin_sku_ml").length, 1); // variation Blanco/M without SELLER_SKU
  assert.equal(byEstado("solo_en_tn").length, 1);
  assert.equal(byEstado("solo_en_tn")[0].tnSku, "MED-X3");
  assert.equal(byEstado("solo_en_ml").length, 0);

  // Visible difference report (evidence for the milestone):
  console.log("=== REPORTE DE DIFERENCIAS (fixture) ===");
  for (const r of rows) {
    console.log(
      [r.estado.padEnd(11), (r.mlSku ?? "-").padEnd(9), (r.tnSku ?? "-").padEnd(11),
       `ml=${r.mlStock ?? "-"}`, `tn=${r.tnStock ?? "-"}`, r.via ?? "-"].join(" | ")
    );
  }
});
